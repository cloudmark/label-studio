import type {Layer} from "../../Layer";
import type {SpectrogramScale} from "../../../Analysis/FFTProcessor";
import type {ColorMapper} from "../../ColorMapper";
import type {RendererPlugin} from "./RendererPlugin";
import type {WaveformAudio} from '../../../Media/WaveformAudio';
import type {RenderContext} from '../Renderer';

/**
 * Renders a frequency grid and labels on the spectrogram-grid layer.
 * All dependencies are passed via the constructor. Only runtime-tunable options are in config.
 */
export interface GridRendererPluginConfig {
  spectrogramScale: SpectrogramScale;
  visible: boolean;
}

export interface GridRendererPluginConstructorConfig {
  height: number;
  fontSize?: number;
}

export class GridRendererPlugin implements RendererPlugin<GridRendererPluginConfig> {
  private readonly layer: Layer;
  private readonly colorMapper: ColorMapper;
  public config: GridRendererPluginConfig;
  private audio: WaveformAudio | null = null;
  private height: number = 0;
  private fontSize: number = 11;
  private gridNeedsRedraw: boolean = false;

  constructor(
    layer: Layer,
    colorMapper: ColorMapper,
    config: GridRendererPluginConstructorConfig & GridRendererPluginConfig,
  ) {
    this.layer = layer;
    this.colorMapper = colorMapper;
    this.height = config.height;
    this.fontSize = config.fontSize ?? 11;
    this.config = {
      visible: config.visible,
      spectrogramScale: config.spectrogramScale
    };
  }

  /**
   * Update runtime-tunable config options.
   */
  public updateConfig(config: Partial<GridRendererPluginConfig>) {
    const oldConfig = { ...this.config };

    // Handle SpectrogramScale updates
    if ('spectrogramScale' in config) {
      this.config = { ...this.config, ...config };
      if (oldConfig.spectrogramScale !== this.config.spectrogramScale) {
        this.gridNeedsRedraw = true;
      }
    }

    if ('visible' in config) {
      this.config.visible = config.visible ?? this.config.visible;
    }
  }

  /**
   * RendererPlugin interface: store audio and state.
   */
  public init(audio: WaveformAudio, state: RenderContext): void {
    this.audio = audio;
    this.gridNeedsRedraw = true;
  }

  /**
   * RendererPlugin interface: render the grid using current state.
   */
  public render(state: RenderContext): void {
    if (!this.config.visible) return;
    if (this.gridNeedsRedraw) {
        this.drawFrequencyGrid(state);
    }
    this.gridNeedsRedraw = false;
  }

  /**
   * RendererPlugin interface: clean up if needed.
   */
  public destroy(): void {
    this.layer.clear();
  }

  /**
   * Request a grid redraw on the next render cycle.
   */
  public requestGridRedraw(): void {
    this.gridNeedsRedraw = true;
  }

  /**
   * Draws a frequency grid and labels on the spectrogram-grid layer.
   * Uses only constructor dependencies, config, and state.
   */
  private drawFrequencyGrid(state: RenderContext) {
    const audio = this.audio;
    if (!audio) return;
    const ctx = this.layer.context;
    const width = state.width;
    const height = this.height;
    const paddingLeft = (state as any).padding?.left ?? 0;
    // Use the visualizer's getSpectrogramChannelYOffset method if available, otherwise use 0
    const sampleRate = audio.sampleRate;
    const scale = this.config.spectrogramScale;
    const fontSize = this.fontSize;
    const colorMapper = this.colorMapper;
    const gridColor = colorMapper.magnitudeToColor(1); // highest color
    const gridShadowColor = colorMapper.magnitudeToColor(0); // lowest color
    const labelBgColor = colorMapper.magnitudeToColor(0); // lowest color
    const labelColor = colorMapper.magnitudeToColor(1); // highest color
    const labelPadding = 2;
    // Clear previous grid
    this.layer.clear();
    ctx.save();
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textBaseline = "middle";
    ctx.strokeStyle = gridColor;
    ctx.fillStyle = labelColor;
    ctx.lineWidth = 1;

    // Determine grid frequencies (Hz)
    let gridFreqs: number[] = [];
    const nyquist = sampleRate / 2;
    if (scale === "linear") {
      // 10 grid lines, round to the nearest 100/500/1000 Hz
      const approxStep = nyquist / 10;
      let step: number;
      if (approxStep > 2000) step = 2000;
      else if (approxStep > 1000) step = 1000;
      else if (approxStep > 500) step = 500;
      else if (approxStep > 100) step = 100;
      else step = 50;
      for (let f = 0; f <= nyquist; f += step) gridFreqs.push(f);
      if (gridFreqs[gridFreqs.length - 1] !== nyquist) gridFreqs.push(nyquist);
    } else if (scale === "log") {
      // Logarithmic grid: 10, 20, 50, 100, 200, 500, 1k, 2k, 5k, 10k, ...
      const decades = Math.floor(Math.log10(nyquist)) - 1;
      for (let d = 1; d <= decades; d++) {
        for (const m of [1, 2, 5]) {
          const f = m * Math.pow(10, d);
          if (f > nyquist) break;
          gridFreqs.push(f);
        }
      }
      if (gridFreqs[0] !== 0) gridFreqs.unshift(0);
      if (gridFreqs[gridFreqs.length - 1] !== nyquist) gridFreqs.push(nyquist);
    } else if (scale === "mel") {
      // Mel scale: label at 0, 500, 1000, 2000, 4000, 8000, nyquist (if in range)
      const mel = (f: number) => 2595 * Math.log10(1 + f / 700);
      const invMel = (m: number) => 700 * (Math.pow(10, m / 2595) - 1);
      const melMax = mel(nyquist);
      const melGrid = [0, 500, 1000, 2000, 4000, 8000]
        .map(mel)
        .filter(m => m <= melMax);
      gridFreqs = melGrid.map(invMel);
      if (gridFreqs[0] !== 0) gridFreqs.unshift(0);
      if (gridFreqs[gridFreqs.length - 1] < nyquist) gridFreqs.push(nyquist);
    }

    // Draw grid lines and labels
    for (const freq of gridFreqs) {
      let y: number;
      if (scale === "linear" || scale === "mel") {
        // Linear mapping: y = height * (1 - freq/nyquist)
        y = height * (1 - freq / nyquist);
      } else if (scale === "log") {
        // Correct log mapping: y = height * (1 - log10(freq/minFreq)/log10(nyquist/minFreq))
        const minFreq = 10; // Set to your lowest grid frequency
        if (freq < minFreq) continue; // Skip frequencies below minFreq
        y = height *
            (1 - Math.log10(freq / minFreq) / Math.log10(nyquist / minFreq));
      } else {
        y = height * (1 - freq / nyquist);
      }
      // Draw a horizontal line with shadow
      ctx.save();
      ctx.shadowColor = gridShadowColor;
      ctx.shadowBlur = 2;
      ctx.shadowOffsetY = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(paddingLeft, y);
      ctx.lineTo(paddingLeft + width, y);
      ctx.stroke();
      ctx.restore();
      // Draw label (left edge) with the background
      if (freq === 0) continue; // Omit 0 Hz label
      let label: string;
      if (freq >= 1000) label = `${(freq / 1000).toFixed(1)} kHz`;
      else label = `${Math.round(freq)} Hz`;
      const textX = paddingLeft + labelPadding;
      const textMetrics = ctx.measureText(label);
      const rectPaddingX = 4;
      const rectPaddingY = 2;
      const rectWidth = textMetrics.width + rectPaddingX * 2;
      const rectHeight = fontSize + rectPaddingY * 2;
      const rectX = textX - rectPaddingX;
      let rectY: number, textY: number;
      if (freq === nyquist) {
        // Align top of label with grid line
        rectY = y;
        textY = y + rectHeight / 2;
      } else {
        // Center label on grid line
        textY = y;
        rectY = textY - rectHeight / 2;
      }
      // Draw background rectangle
      ctx.save();
      ctx.fillStyle = labelBgColor;
      ctx.fillRect(rectX, rectY, rectWidth, rectHeight);
      ctx.restore();
      // Draw label text
      ctx.fillStyle = labelColor;
      ctx.fillText(label, textX, textY);
    }
    ctx.restore();
  }

  onResize() {
    // Plugin-specific resize logic can be added here if needed
    // For example, you might want to recalculate cached layout or mark for redraw
    this.requestGridRedraw();
  }
}
