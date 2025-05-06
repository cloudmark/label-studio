import type {WaveformAudio} from "../Media/WaveformAudio";
import {BROWSER_SCROLLBAR_WIDTH, clamp, debounce, defaults, warn} from "../Common/Utils";
import type {Waveform, WaveformOptions} from "../Waveform";
import {type CanvasCompositeOperation, Layer, type RenderingContext} from "./Layer";
import {Events} from "../Common/Events";
import {LayerGroup} from "./LayerGroup";
import {Playhead} from "./PlayHead";
import {rgba} from "../Common/Color";
import type {Cursor} from "../Cursor/Cursor";
import type {Padding} from "../Common/Style";
import type {TimelineOptions} from "../Timeline/Timeline";
import {getCurrentTheme} from "@humansignal/ui";
import "./Loader";
import {WindowFunctionType} from './WindowFunctions';
import {COLOR_SCHEMES, ColorMapper, type ColorScheme} from './ColorMapper';
import {SPECTROGRAM_DEFAULTS} from './constants';
import {FFTProcessorOptions, SpectrogramScale} from '../Analysis/FFTProcessor';
import {WaveformRenderer} from './Renderer/WaveformRenderer';
import {SpectrogramRenderer} from './Renderer/SpectrogramRenderer';
import {LRUCache} from '../Common/LRUCache';
import {RenderContext, Renderer} from './Renderer/Renderer';
import {LayerM} from './Composition/LayerM';

interface VisualizerEvents {
  draw: (visualizer: Visualizer) => void;
  initialized: (visualizer: Visualizer) => void;
  destroy: (visualizer: Visualizer) => void;
  mouseMove: (event: MouseEvent, cursor: Cursor) => void;
  layersUpdated: (layers: Map<string, Layer>) => void;
  layerAdded: (layer: Layer) => void;
  layerRemoved: (layer: Layer) => void;
  heightAdjusted: (Visualizer: Visualizer) => void;
}

export type VisualizerOptions = Pick<
  WaveformOptions,
  | "zoomToCursor"
  | "autoCenter"
  | "splitChannels"
  | "cursorWidth"
  | "zoom"
  | "amp"
  | "padding"
  | "playhead"
  | "timeline"
  | "height"
  | "waveHeight"
  | "gridWidth"
  | "gridColor"
  | "waveColor"
  | "backgroundColor"
  | "container"
  | "experimental"
> & {
  spectrogramFftSamples?: number;
  numberOfMelBands?: number;
  spectrogramWindowingFunction?: string;
  spectrogramMinDb?: number;
  spectrogramMaxDb?: number;
  spectrogramColorScheme?: string;
  spectrogramHopFactor?: number;
  spectrogramScale?: SpectrogramScale;
};

const DEBOUNCE_PAINT_AMOUNT = 8; // ms, for ~120fps

export class Visualizer extends Events<VisualizerEvents> {
  private wrapper!: HTMLElement;
  private scrollFiller!: HTMLElement;
  private layers = new Map<string, Layer>();
  private observer!: ResizeObserver;
  private currentTime = 0;
  public audio!: WaveformAudio | null;
  public zoom = 1;
  private scrollLeft = 0;
  public renderId = 0;
  public amp = 1;
  private seekLocked = false;
  protected wf: Waveform;
  private waveContainer!: HTMLElement | string;
  private playheadPadding = 4;
  private zoomToCursor = false;
  protected autoCenter = false;
  private splitChannels = false;
  public padding: Padding = {top: 0, bottom: 0, left: 0, right: 0};
  private gridWidth = 1;
  private gridColor = rgba("rgba(0, 0, 0, 0.1)");
  public backgroundColor = rgba("#fff");
  public waveColor = rgba("#000");
  protected waveHeight = 32;
  private _container!: HTMLElement;
  private _loader!: HTMLElement;
  private composer?: LayerM;



  timelineHeight: number = defaults.timelineHeight;
  timelinePlacement: TimelineOptions["placement"] = "top";
  maxZoom = 1500;
  playhead: Playhead;
  reservedSpace = 0;
  public samplesPerPx = 0;

  public waveformRenderer!: WaveformRenderer;
  private readonly spectrogramRenderer!: SpectrogramRenderer;
  private renderers: Renderer[] = [];

  private scrollPauseTimeout: number | null = null;

  private debouncedDraw: () => void;

  constructor(options: VisualizerOptions, waveform: Waveform) {
    super();

    const isDarkMode = getCurrentTheme() === "Dark";
    this.wf = waveform;
    this.waveContainer = options.container;
    this.waveColor = options.waveColor ? rgba(options.waveColor) : this.waveColor;
    this.padding = {...this.padding, ...options.padding};
    this.playheadPadding = options.playhead?.padding ?? this.playheadPadding;
    this.zoomToCursor = options.zoomToCursor ?? this.zoomToCursor;
    this.autoCenter = options.autoCenter ?? this.autoCenter;
    this.splitChannels = options.splitChannels ?? this.splitChannels;
    this.waveHeight = options.height ?? options.waveHeight ?? this.waveHeight;
    this.timelineHeight = options.timeline?.height ?? this.timelineHeight;
    this.timelinePlacement = options?.timeline?.placement ?? this.timelinePlacement;
    this.gridColor = options.gridColor ? rgba(options.gridColor) : this.gridColor;
    this.gridWidth = options.gridWidth ?? this.gridWidth;
    this.backgroundColor = options.backgroundColor ? rgba(options.backgroundColor) : this.backgroundColor;
    this.zoom = options.zoom ?? this.zoom;
    this.amp = options.amp ?? this.amp;
    this.playhead = new Playhead(
      {
        ...options.playhead,
        x: 0,
        color: isDarkMode ? rgba("#fff") : rgba("#000"),
        fillColor: isDarkMode ? rgba("#fff") : rgba("#BAE7FF"),
        width: options.cursorWidth ?? 2,
      },
      this,
      this.wf,
    );

    // Layer and container setup should be handled by Visualizer
    if (this.container) {
      // Set an initial height for the container so the progress bar is visible during loading
      const initialHeight = this.waveHeight + this.timelineHeight;
      this.container.style.height = `${initialHeight}px`;
    }
    this.createLayers();
    // Instantiate renderers
    const waveformLayer = this.getLayer('waveform');
    const backgroundLayer = this.getLayer('background');
    if (!waveformLayer) throw new Error('Waveform layer not found');
    if (!backgroundLayer) throw new Error('Background layer not found');
    this.waveformRenderer = new WaveformRenderer({
      layer: waveformLayer,
      backgroundLayer,
      config: {
        renderId: this.renderId,
        waveHeight: this.waveHeight,
        padding: this.padding,
        reservedSpace: this.reservedSpace,
        waveColor: this.waveColor,
      },
      onRenderTransfer: this.transferImage.bind(this),
    });

    this.attachEvents();

    // Prepare a spectrogram-related state for SpectrogramRenderer
    const spectrogramColorScheme = (options.spectrogramColorScheme as ColorScheme) ?? COLOR_SCHEMES.VIRIDIS;
    const colorMapper = new ColorMapper(spectrogramColorScheme);
    const spectrogramScale = options.spectrogramScale ?? 'mel';
    const numberOfMelBands = options.numberOfMelBands ?? SPECTROGRAM_DEFAULTS.MEL_BANDS;
    const spectrogramHopFactor = options.spectrogramHopFactor ?? 2;
    const spectrogramMinDb = options.spectrogramMinDb ?? SPECTROGRAM_DEFAULTS.MIN_DB;
    const spectrogramMaxDb = options.spectrogramMaxDb ?? SPECTROGRAM_DEFAULTS.MAX_DB;
    const fftSamples = options.spectrogramFftSamples ?? SPECTROGRAM_DEFAULTS.FFT_SAMPLES;
    const windowFunction = (options.spectrogramWindowingFunction as WindowFunctionType) ?? SPECTROGRAM_DEFAULTS.WINDOWING_FUNCTION;
    const fftCache = new Map<number, LRUCache<number, Float32Array>>();

    this.spectrogramRenderer = new SpectrogramRenderer(
      this._container,
      this.getLayer("spectrogram")!,
      this.getLayer("spectrogram-grid")!,
      {
        channelHeight: this.channelHeight,
        spectrogramMinDb,
        spectrogramScale,
        spectrogramHopFactor,
        colorMapper,
        fftCache,
        spectrogramColorScheme,
        spectrogramMaxDb,
        numberOfMelBands,
        fftSamples,
        windowFunction,
      },
      this.transferImage.bind(this)
    );

    this.debouncedDraw = debounce(this.draw.bind(this), DEBOUNCE_PAINT_AMOUNT);
  }

  init(audio: WaveformAudio) {
    this.init = () => warn("Visualizer is already initialized");
    this.audio = audio;
    this.setLoading(false);


    // TODO: Wrap into LayerMs

    // This triggers the resize observer when loading in differing heights
    // as a result of multichannel or differently configured waveHeight
    this.setContainerHeight();

    // Set renderers array
    this.renderers = [this.waveformRenderer, this.spectrogramRenderer];

    // Dynamically set maxZoom so you can zoom to 1:1 (one sample per pixel)
    if (this.audio && this.width > 0) {
      this.maxZoom = Math.max(1, Math.ceil(this.audio.dataLength / this.width));
    }

    // Compose all layers together so that we cache the composition of the layers.
    this.createComposer();

    // Initialize all renderers generically
    const renderContext = {
      scrollLeftPx: this.getScrollLeftPx(),
      width: this.width,
      zoom: this.zoom,
      samplesPerPx: this.samplesPerPx,
      dataLength: this.dataLength,
    };

    for (const renderer of this.renderers) {
      renderer.init(renderContext, this.audio);
    }

    this.invoke("initialized", [this]);
    this.transferImage()
  }

  private createComposer() {
    const backgroundM = LayerM.lift(this.layers.get("background")!);
    const waveformM = LayerM.lift(this.layers.get("waveform")!);
    const spectrogramM = LayerM.lift(this.layers.get("spectrogram")!);
    const progressM = LayerM.lift(this.layers.get("progress")!);
    const spectrogramGridM = LayerM.lift(this.layers.get("spectrogram-grid")!);
    const regionsM = LayerM.lift(this.layers.get("regions")!);
    const controlsM = LayerM.lift(this.layers.get("controls")!);
    const  timelineM = LayerM.lift(this.layers.get("timeline")!);

  // Compose layers using the functional approach
    // First create the background+waveform composition
    const waveform: LayerM = LayerM.overlay([waveformM, backgroundM]);

    // Then create the spectrogram+progress+grid composition
    const spectrogram: LayerM = LayerM.overlay([spectrogramGridM, progressM, spectrogramM]);

    let waveFormAndSpectrogram: LayerM = waveform.above(spectrogram)
    if (timelineM.isVisible())  {
      waveFormAndSpectrogram = waveFormAndSpectrogram.pad({ top: this.timelineHeight })
    }

    this.composer  = LayerM.overlay([waveFormAndSpectrogram, controlsM, regionsM, timelineM])
  }

  setLoading(loading: boolean) {
    if (loading) {
      this._loader = document.createElement("loading-progress-bar");
      this._container.appendChild(this._loader);
    } else {
      this._container.removeChild(this._loader);
    }
  }

  setLoadingProgress(loaded?: number, total?: number, completed?: boolean) {
    if (this._loader) {
      if (completed) {
        (this._loader as any).total = (this._loader as any).loaded;
      } else {
        if (loaded !== undefined) (this._loader as any).loaded = loaded;
        if (total !== undefined) (this._loader as any).total = total;
      }
      (this._loader as any).update();
    }
  }

  setDecodingProgress(chunk?: number, total?: number) {
    if (this._loader) {
      if (chunk !== undefined) (this._loader as any).loaded = chunk;
      if (total !== undefined) (this._loader as any).total = total;
      (this._loader as any).update();
    }
  }

  setError(error: string) {
    if (this._loader) {
      (this._loader as any).error = error;
      (this._loader as any).update();
    }
  }

  setZoom(value: number) {
    this.getSamplesPerPx();
    this.updateScrollFiller();

    this.zoom = clamp(value, 1, this.maxZoom);
    if (this.zoomToCursor) {
      this.centerToCurrentTime();
    } else {
      this.updatePosition(false);
    }

    this.debouncedDraw();
    this.wf.invoke("zoom", [this.zoom]);

  }

  getZoom() {
    return this.zoom;
  }

  setScrollLeft(value: number) {
    const maxScroll = this.scrollWidth / this.fullWidth;
    const clamped = clamp(value, 0, maxScroll);
    this.wrapper.scrollLeft = clamped * this.fullWidth;
  }

  _setScrollLeft(value: number, redraw = true) {
    const maxScroll = this.scrollWidth / this.fullWidth;
    this.scrollLeft = clamp(value, 0, maxScroll);
    if (redraw) {
      this.debouncedDraw();
    }
  }

  getScrollLeft() {
    return this.scrollLeft;
  }

  getScrollLeftPx() {
    return this.scrollLeft * this.fullWidth;
  }

  lockSeek() {
    this.seekLocked = true;
  }

  unlockSeek() {
    this.seekLocked = false;
  }

  draw(dry = false) {
    if (this.isDestroyed) return;
    if (!dry) {
      // Center to the current time if playing and autoCenter are enabled
      if (this.wf.playing && this.autoCenter) {
        this.centerToCurrentTime();
      }
      // Render all available channels using the renderer
      this.renderAvailableChannels();
      this.redrawCursor();
    }
    // Ensure compositing is always done after all drawing
    this.transferImage();

    this.invoke("draw", [this]);
  }

  destroy() {
    if (this.isDestroyed) return;

    this.invoke("destroy", [this]);
    this.clear();
    this.playhead.destroy();
    this.audio = null;
    // Call the destroy on all renderers
    for (const renderer of this.renderers) {
      renderer.destroy();
    }
    this.removeEvents();
    this.layers.forEach((layer) => layer.remove());
    this.wrapper.remove();

    super.destroy();
  }

  clear() {
    this.layers.get("main")?.clear();
    this.transferImage();
  }


  centerToCurrentTime() {
    if (this.zoom === 1) {
      this.setScrollLeft(0);
      return;
    }

    const offset = this.width / 2 / this.zoomedWidth;

    this.setScrollLeft(clamp(this.currentTime - offset, 0, 1));
  }

  /**
   * Update the visual render of the cursor in isolation
   */
  updateCursorToTime(time: number) {
    this.playhead.updatePositionFromTime(time);
  }

  /**
   * Render the visible range of waveform channels to the canvas
   */
  public renderAvailableChannels() {
    if (!this.audio) return;

    const renderContext: RenderContext = {
      scrollLeftPx: this.getScrollLeftPx(),
      width: this.width,
      zoom: this.zoom,
      samplesPerPx: this.samplesPerPx,
      dataLength: this.dataLength,
    };

    for (const renderer of this.renderers) {
      renderer.draw(renderContext);
    }
  }

  get pixelRatio() {
    return window.devicePixelRatio;
  }

  get width() {
    return this.container.clientWidth;
  }

  get waveformHeight() {
    return Math.max(
      this.waveHeight,
      this.waveHeight * (this.splitChannels ? (this.audio?.channelCount ?? 1) : 1) + this.timelineHeight,
    ) - this.timelineHeight;
  }

  get height() {
    let height = 0;
    const timelineLayer = this.getLayer("timeline");
    const waveformLayer = this.getLayer("waveform");
    const spectrogramLayer = this.getLayer("spectrogram");

    height += timelineLayer?.isVisible ? this.timelineHeight : 0;
    height += waveformLayer?.isVisible ? this.waveformHeight : 0;
    height += spectrogramLayer?.isVisible ? this.waveformHeight : 0;
    return height;
  }

  get scrollWidth() {
    return this.zoomedWidth - this.width;
  }

  get fullWidth() {
    return this.zoomedWidth;
  }

  get zoomedWidth() {
    return this.width * this.zoom;
  }

  get container() {
    if (this._container) return this._container;

    let result: HTMLElement | null = null;

    if (this.waveContainer instanceof HTMLElement) {
      result = this.waveContainer;
    } else if (typeof this.waveContainer === "string") {
      result = document.querySelector(this.waveContainer as string);
    }

    if (!result) throw new Error("Container element does not exist.");

    result.style.position = "relative";

    this._container = result;

    return result;
  }

  protected createLayers() {
    const {container} = this;

    this.wrapper = document.createElement("div");
    this.wrapper.style.height = "100%";

    const mainLayer = this.createLayer({name: "main"});
    this.createLayer({name: "background", offscreen: true, zIndex: 0, isVisible: false, height: this.waveformHeight});
    this.createLayer({name: "waveform", offscreen: true, zIndex: 100, height: this.waveformHeight});
    // Create spectrogram and progress as top-level layers (no group)
    this.createLayer({name: "spectrogram", offscreen: true, zIndex: 100, isVisible: true, height: this.waveformHeight});


    // This is really a virtual layer in that it uses DOM not the canvas.
    this.createLayer({name: "progress", offscreen: true, zIndex: 1020, isVisible: true, height: 0});
    this.createLayer({name: "spectrogram-grid", offscreen: true, zIndex: 1100, isVisible: true, height: this.waveformHeight});

    // Regions and controls
    this.createLayerGroup({name: "regions", offscreen: true, zIndex: 101, compositeOperation: "source-over", height: this.height});
    const controlsLayer = this.createLayer({name: "controls", offscreen: true, zIndex: 1000, height: this.height});

    this.playhead.setLayer(controlsLayer);
    this.initScrollBar();
    mainLayer.appendTo(this.wrapper);
    container.appendChild(this.wrapper);
  }


  initScrollBar() {
    this.wrapper.style.position = "relative";
    this.wrapper.style.overflowX = "scroll";
    this.wrapper.style.overflowY = "hidden";

    const mainLayer = this.getLayer( "main") as Layer;
    // The parent element scrolls natively, and the canvas is redrawn accordingly.
    // To maintain its position during scrolling, the element must use "sticky" positioning.
    if (mainLayer.canvas instanceof HTMLCanvasElement) {
      mainLayer.canvas.style.position = "sticky";
      mainLayer.canvas.style.top = "0";
      mainLayer.canvas.style.left = "0";
      mainLayer.canvas.style.zIndex = "2";
    }
    // Adds a scroll filler element to adjust the size of the scrollable area
    this.scrollFiller = document.createElement("div");
    this.scrollFiller.style.position = "absolute";
    this.scrollFiller.style.width = "100%";
    this.scrollFiller.style.height = `${BROWSER_SCROLLBAR_WIDTH}px`;
    this.scrollFiller.style.top = "100%";
    this.scrollFiller.style.minHeight = "1px";
    if (mainLayer.canvas instanceof HTMLCanvasElement) {
      mainLayer.canvas.style.zIndex = "1";
    }
    this.wrapper.appendChild(this.scrollFiller);
  }

  updateScrollFiller() {
    const {fullWidth} = this;
    this.scrollFiller.style.width = `${fullWidth}px`;
  }

  reserveSpace({height}: { height: number }) {
    this.reservedSpace = height;
  }

  createLayer(options: {
    name: string;
    groupName?: string;
    offscreen?: boolean;
    zIndex?: number;
    opacity?: number;
    compositeOperation?: CanvasCompositeOperation;
    isVisible?: boolean;
    height?: number;
  }) {
    const {name, offscreen = false, zIndex = 1, opacity = 1, compositeOperation = "source-over", isVisible, height} = options;

    if (!options.groupName && this.layers.has(name)) throw new Error(`Layer ${name} already exists.`);

    const layerOptions = {
      groupName: options.groupName,
      name,
      container: this.container,
      height: height ?? this.waveHeight,
      pixelRatio: this.pixelRatio,
      index: zIndex,
      offscreen,
      compositeOperation,
      opacity,
      isVisible,
    };

    let layer: Layer;

    if (options.groupName) {
      const group = this.layers.get(options.groupName);

      if (!group || !group.isGroup) throw new Error(`LayerGroup ${options.groupName} does not exist.`);

      layer = (group as LayerGroup).addLayer(layerOptions);
      this.layers.set(name, layer);
    } else {
      layer = new Layer(layerOptions);
      this.layers.set(name, layer);
    }

    this.invoke("layerAdded", [layer]);
    layer.on("layerUpdated", (layer) => {
      const mainLayer = this.getLayer("main");

      this.setContainerHeight();

      if (mainLayer) {
        mainLayer.height = this.height;
      }
      // Transfer the image to the main layer
      this.transferImage();

      this.invokeLayersUpdated();
    });

    return layer;
  }

  createLayerGroup(options: {
    name: string;
    offscreen?: boolean;
    zIndex?: number;
    opacity?: number;
    compositeAsGroup?: boolean;
    compositeOperation?: CanvasCompositeOperation;
    height?: number;
  }) {
    const {
      name,
      offscreen = false,
      zIndex = 1,
      opacity = 1,
      compositeOperation = "source-over",
      compositeAsGroup = true,
      height,
    } = options;

    if (this.layers.has(name)) throw new Error(`LayerGroup ${name} already exists.`);

    const layer = new LayerGroup({
      name,
      container: this.container,
      height: height ?? this.waveHeight,
      pixelRatio: this.pixelRatio,
      index: zIndex,
      offscreen,
      compositeOperation,
      compositeAsGroup,
      opacity,
    });

    this.invoke("layerAdded", [layer]);
    layer.on("layerUpdated", () => {
      this.invokeLayersUpdated();
    });
    this.layers.set(name, layer);
    return layer;
  }

  removeLayer(name: string) {
    if (!this.layers.has(name)) throw new Error(`Layer ${name} does not exist.`);
    const layer = this.layers.get(name);

    if (layer) {
      this.invoke("layerRemoved", [layer]);
      layer.off("layerUpdated", this.invokeLayersUpdated);
      layer.remove();
    }
    this.layers.delete(name);
  }

  getLayer(name: string) {
    return this.layers.get(name);
  }

  getLayers() {
    return this.layers;
  }

  useLayer(name: string, callback: (layer: Layer, context: RenderingContext) => void) {
    const layer = this.layers.get(name)!;

    if (layer) {
      callback(layer, layer.context!);
    }
  }

  private invokeLayersUpdated = debounce(async () => {
    this.invoke("layersUpdated", [this.layers]);
  }, 150);

  private attachEvents() {
    // Observers
    this.observer = new ResizeObserver(this.handleResize);
    this.observer.observe(this.wrapper);

    // DOM events
    this.wrapper.addEventListener("wheel", this.preventScrollX);
    this.wrapper.addEventListener("wheel", this.handleScroll, {
      passive: true,
    });
    this.wrapper.addEventListener("click", this.handleSeek);
    this.wrapper.addEventListener("mousedown", this.handleMouseDown);

    this.wrapper.addEventListener("scroll", (e) => {
      const scrollLeft = this.wrapper.scrollLeft / this.fullWidth;
      this.wf.invoke("scroll", [scrollLeft]);
      this._setScrollLeft(scrollLeft);
    });

    // Cursor events
    this.on("mouseMove", this.playHeadMove);

    this.on("layerAdded", this.invokeLayersUpdated);
    this.on("layerRemoved", this.invokeLayersUpdated);

    // WF events
    this.wf.on("playing", this.handlePlaying);
    this.wf.on("seek", this.handlePlaying);
    // Redraw spectrogram on pause to clear artifacts
    this.wf.on("pause", this.draw.bind(this));
  }

  private removeEvents() {
    // Observers
    this.observer.unobserve(this.wrapper);
    this.observer.disconnect();

    // DOM events
    this.wrapper.removeEventListener("wheel", this.preventScrollX);
    this.wrapper.removeEventListener("wheel", this.handleScroll);
    this.wrapper.removeEventListener("click", this.handleSeek);
    this.wrapper.removeEventListener("mousedown", this.handleMouseDown);

    // Cursor events
    this.off("mouseMove", this.playHeadMove);

    this.off("layerAdded", this.invokeLayersUpdated);
    this.off("layerRemoved", this.invokeLayersUpdated);

    // WF events
    this.wf.off("playing", this.handlePlaying);
    this.wf.off("seek", this.handlePlaying);
    // Remove pause event
    this.wf.off("pause", this.draw.bind(this));
  }

  private playHeadMove = (e: MouseEvent, cursor: Cursor) => {
    if (!this.wf.loaded) return;
    if (e.target instanceof Node && this.container.contains(e.target)) {
      const {x, y} = cursor;
      const {playhead, playheadPadding, height} = this;
      const playHeadTop = this.reservedSpace - playhead.capHeight - playhead.capPadding;

      if (
        x >= playhead.x - playheadPadding &&
        x <= playhead.x + playhead.width + playheadPadding &&
        y >= playHeadTop &&
        y <= height
      ) {
        if (!playhead.isHovered) {
          playhead.invoke("mouseEnter", [e]);
        }
        this.debouncedDraw();
      } else if (playhead.isHovered) {
        playhead.invoke("mouseLeave", [e]);
        this.debouncedDraw();
      }
    }
  };

  private handleSeek = (e: MouseEvent) => {
    if (e.offsetY > this.height) return;

    const mainLayer = this.getLayer("main");

    if (!this.wf.loaded || this.seekLocked || !(e.target && mainLayer?.canvas?.contains(e.target))) return;
    const offset = this.wrapper.getBoundingClientRect().left;
    const x = e.clientX - offset;
    const duration = this.wf.duration;
    const currentPosition = this.scrollLeft + x / this.container.clientWidth / this.zoom;
    const playheadX = clamp(x, 0, this.width);

    this.playhead.setX(playheadX);
    this.wf.currentTime = currentPosition * duration;
  };

  private handleMouseDown = (e: MouseEvent) => {
    if (e.offsetY > this.height) return;
    if (!this.wf.loaded) return;
    this.playhead.invoke("mouseDown", [e]);
  };

  private handlePlaying = (currentTime: number) => {
    if (!this.wf.loaded) return;
    this.currentTime = currentTime / this.wf.duration;
    this.debouncedDraw();
  };

  private handleScroll = (e: WheelEvent) => {
    if (!this.wf.loaded) return;

    if (this.isZooming(e)) {
      const zoom = this.zoom - e.deltaY * 0.2;

      this.setZoom(zoom);
      this.wf.invoke("zoom", [this.zoom]);
    } else if (this.zoom > 1) {
      // Base values
      const maxScroll = this.scrollWidth;
      const maxRelativeScroll = (maxScroll / this.fullWidth) * this.zoom;
      const delta = (Math.abs(e.deltaX) === 0 ? e.deltaY : e.deltaX) * this.zoom * 1.25;
      const position = this.scrollLeft * this.zoom;

      // Values for the update
      const currentSroll = maxScroll * position;
      const newPosition = Math.max(0, currentSroll + delta);
      const newRelativePosition = clamp(newPosition / maxScroll, 0, maxRelativeScroll);
      const scrollLeft = newRelativePosition / this.zoom;

      if (scrollLeft !== this.scrollLeft) {
        this.wf.invoke("scroll", [scrollLeft]);
        this.setScrollLeft(scrollLeft);
      }
    }

    // Debounce full redraw on scroll pause
    if (this.scrollPauseTimeout) {
      clearTimeout(this.scrollPauseTimeout);
    }
  };

  private updatePosition(redraw = true) {
    if (!this.wf.loaded) return;
    const maxScroll = this.scrollWidth;
    const maxRelativeScroll = (maxScroll / this.fullWidth) * this.zoom;

    this.setScrollLeft(clamp(this.scrollLeft, 0, maxRelativeScroll), redraw);
  }

  private get dataLength() {
    return this.audio?.dataLength ?? 0;
  }

  private getSamplesPerPx() {
    const newValue = this.dataLength / this.fullWidth;

    if (newValue !== this.samplesPerPx) {
      this.samplesPerPx = newValue;
    }

    return this.samplesPerPx;
  }

  private isZooming(e: WheelEvent) {
    return e.ctrlKey || e.metaKey;
  }

  private preventScrollX = (e: WheelEvent) => {
    const [dX, dY] = [Math.abs(e.deltaX), Math.abs(e.deltaY)];

    if (dX >= dY || (this.isZooming(e) && dY >= dX)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private setContainerHeight() {
    this.container.style.height = `${this.height + BROWSER_SCROLLBAR_WIDTH}px`;
  }

  private updateSize() {
    const newWidth = this.wrapper.clientWidth;
    this.getSamplesPerPx();
  }

  private handleResize = () => {
    if (!this.wf.duration) return;

    this.updateSize();
    this.updateCursorToTime(this.wf.currentTime);
    this.updateScrollFiller();
    this.setScrollLeft(this.scrollLeft, false);
    this.wf.renderTimeline();
    for (const renderer of this.renderers) {
      if (typeof renderer.onResize === 'function') {
        renderer.onResize();
      }
    }

    this.debouncedDraw();
    this.transferImage();
  };


  public transferImage() {
    const main = this.layers.get("main")!;
    if (this.composer) {
      main.clear()

      this.composer.renderTo(main);
    }
  }

  public updateSpectrogramConfig(params: {
    fftSamples?: number;
    melBands?: number;
    windowingFunction?: string;
    colorScheme?: string;
    minDb?: number;
    maxDb?: number;
    hopFactor?: number;
    scale?: SpectrogramScale;
  }) {
    let needsProcessorUpdate = false;
    const processorOptions: Partial<FFTProcessorOptions> = {};

    // Build new config based on current config and params
    const currentConfig = this.spectrogramRenderer.config;
    const newConfig = {...currentConfig};

    if (params.fftSamples !== undefined && currentConfig.fftSamples !== params.fftSamples) {
      newConfig.fftSamples = params.fftSamples;
      processorOptions.fftSamples = params.fftSamples;
      needsProcessorUpdate = true;
    }
    if (params.melBands !== undefined && currentConfig.numberOfMelBands !== params.melBands) {
      newConfig.numberOfMelBands = params.melBands;
    }
    if (params.windowingFunction !== undefined && currentConfig.windowFunction !== params.windowingFunction) {
      newConfig.windowFunction = params.windowingFunction as WindowFunctionType;
      processorOptions.windowingFunction = newConfig.windowFunction;
      needsProcessorUpdate = true;
    }
    if (params.hopFactor !== undefined && currentConfig.spectrogramHopFactor !== params.hopFactor) {
      newConfig.spectrogramHopFactor = params.hopFactor > 0 ? params.hopFactor : 2;
    }
    if (params.colorScheme !== undefined && currentConfig.spectrogramColorScheme !== params.colorScheme) {
      newConfig.spectrogramColorScheme = params.colorScheme as ColorScheme;
    }
    if (params.minDb !== undefined && currentConfig.spectrogramMinDb !== params.minDb) {
      newConfig.spectrogramMinDb = params.minDb;
    }
    if (params.maxDb !== undefined && currentConfig.spectrogramMaxDb !== params.maxDb) {
      newConfig.spectrogramMaxDb = params.maxDb;
    }
    if (params.scale !== undefined && currentConfig.spectrogramScale !== params.scale) {
      newConfig.spectrogramScale = params.scale;
    }

    // Update FFT Processor if necessary
    if (needsProcessorUpdate && this.spectrogramRenderer.fftProcessor && this.audio?.sampleRate) {
      processorOptions.sampleRate = this.audio.sampleRate; // Ensure the sample rate is included
      this.spectrogramRenderer.fftProcessor.updateParameters(processorOptions);
    }

    // Update colorMapper if colorScheme changed
    if (params.colorScheme !== undefined && this.spectrogramRenderer.colorMapper) {
      this.spectrogramRenderer.colorMapper.setColorScheme(params.colorScheme as ColorScheme);
    }

    // Use updateConfig to update the renderer's config
    this.spectrogramRenderer.updateConfig(newConfig);


    for (const renderer of this.renderers) {
      if (typeof renderer.onResize === 'function') {
        renderer.onResize();
      }
    }

      // We need to force a full redrawing here to ensure the spectrogram is updated correctly
      this.debouncedDraw();
  }

  /**
   * Redraw the play head/cursor in the waveform.
   */
  public redrawCursor() {
    this.playhead.render();
  }

  /**
   * Sync the cursor with the current time of the audio.
   * Useful when the audio is getting controlled externally.
   */
  public syncCursor() {
    this.updateCursorToTime(this.currentTime);
    this.redrawCursor();
  }

  /**
   * Get the vertical space allocated for a single spectrogram channel
   */
  get channelHeight(): number {
    const spectrogramLayer = this.getLayer("spectrogram");
    if (!spectrogramLayer?.isVisible) return 0;

    const channelCount = this.audio?.channelCount ?? 1;
    const totalAvailableHeight = this.waveHeight;

    if (this.splitChannels) {
      // Each channel gets an equal split of the spectrogram area
      return totalAvailableHeight / channelCount;
    } else {
      // Spectrogram uses the full height when not split
      return totalAvailableHeight;
    }
  }

  setAmp(amp: number) {
    this.waveformRenderer.updateConfig({amp: Math.max(1, amp)});
    this.debouncedDraw();
  }

}
