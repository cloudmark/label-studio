import type React from "react";
import {type FC, type MouseEvent, useContext, useEffect, useMemo, useRef, useState} from "react";
import { createPortal } from "react-dom";
import {Toggle, Tooltip} from "@humansignal/ui";
import {Block, Elem} from "../../../utils/bem";
import {Slider as AntSlider, Select} from "antd";
import {Range} from "../../../common/Range/Range";

import {IconConfig, IconInfoConfig} from "@humansignal/icons";
import {TimelineContext} from "../Context";
import {ControlButton} from "../Controls";
import {Slider} from "./Slider";
import "./ConfigControl.scss";
import colormap from 'colormap';
import { ExclamationCircleOutlined, WarningFilled } from '@ant-design/icons';

// Define Scale Options Type
type SpectrogramScale = 'linear' | 'log' | 'mel';

const MAX_SPEED = 2.5;
const MAX_ZOOM = 150;
const MIN_SPEED = 0.5;
const MIN_ZOOM = 1;

// Default values
const DEFAULT_FFT_VALUE = 512;
const DEFAULT_MEL_VALUE = 64;
const DEFAULT_WINDOWING_FUNCTION = 'blackman';
const DEFAULT_COLOR_SCHEME = 'viridis';
const DEFAULT_MIN_DB = -80;
const DEFAULT_MAX_DB = -10;
const DEFAULT_SCALE: SpectrogramScale = 'mel'; // Default scale

// FFT Samples Setup
const FFT_SAMPLE_VALUES = [64, 128, 256, 512, 1024, 2048];
const FFT_MARKS = FFT_SAMPLE_VALUES.reduce((acc, val, index) => {
  acc[index] = val.toString();
  return acc;
}, {} as Record<number, string>);
const DEFAULT_FFT_INDEX = FFT_SAMPLE_VALUES.indexOf(DEFAULT_FFT_VALUE);

// Helper function
const findBestMelBandValue = (fftSize: number): number => {
  const maxAllowedMel = (fftSize / 4) - 1;
  return Math.min(maxAllowedMel, DEFAULT_MEL_VALUE);
};

// Windowing Options
const WINDOWING_OPTIONS = [
  {value: 'hann', label: 'Hann'},
  {value: 'hamming', label: 'Hamming'},
  {value: 'blackman', label: 'Blackman'},
  {value: 'sine', label: 'Sine'},
  {value: 'rectangular', label: 'Rectangular'},
];

// Colormap Helper functions
const getColorSchemeGradient = (name: any): string => {
  const colors = colormap({
    colormap: name,
    nshades: 16,
    format: 'hex',
    alpha: 1,
  });
  return `linear-gradient(to right, ${colors.join(', ')})`;
};

// Restore the function to render label + small box
const renderColorSchemeOption = (label: string, gradient: string) => (
  <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
    <span>{label}</span>
    <span
      style={{
        display: 'inline-block',
        width: '50px', // Width of the preview box
        height: '10px', // Height of the preview box
        marginLeft: '10px',
        border: '1px solid var(--sand_300)',
        background: gradient,
      }}
    />
  </div>
);

// Generate COLOR_SCHEME_OPTIONS with label + box
const COLOR_SCHEME_OPTIONS = [
  // Rebuild list using renderColorSchemeOption
  {label: renderColorSchemeOption("Autumn", getColorSchemeGradient('autumn')), value: "autumn", key: "autumn"},
  {
    label: renderColorSchemeOption("Bathymetry", getColorSchemeGradient('bathymetry')),
    value: "bathymetry",
    key: "bathymetry"
  },
  {
    label: renderColorSchemeOption("Blackbody", getColorSchemeGradient('blackbody')),
    value: "blackbody",
    key: "blackbody"
  },
  {label: renderColorSchemeOption("BlueRed", getColorSchemeGradient('bluered')), value: "bluered", key: "bluered"},
  {label: renderColorSchemeOption("Bone", getColorSchemeGradient('bone')), value: "bone", key: "bone"},
  {label: renderColorSchemeOption("CDOM", getColorSchemeGradient('cdom')), value: "cdom", key: "cdom"},
  {
    label: renderColorSchemeOption("Chlorophyll", getColorSchemeGradient('chlorophyll')),
    value: "chlorophyll",
    key: "chlorophyll"
  },
  {label: renderColorSchemeOption("Cool", getColorSchemeGradient('cool')), value: "cool", key: "cool"},
  {label: renderColorSchemeOption("Copper", getColorSchemeGradient('copper')), value: "copper", key: "copper"},
  {
    label: renderColorSchemeOption("Cubehelix", getColorSchemeGradient('cubehelix')),
    value: "cubehelix",
    key: "cubehelix"
  },
  {label: renderColorSchemeOption("Density", getColorSchemeGradient('density')), value: "density", key: "density"},
  {label: renderColorSchemeOption("Earth", getColorSchemeGradient('earth')), value: "earth", key: "earth"},
  {label: renderColorSchemeOption("Electric", getColorSchemeGradient('electric')), value: "electric", key: "electric"},
  {
    label: renderColorSchemeOption("Freesurface Blue", getColorSchemeGradient('freesurface-blue')),
    value: "freesurface-blue",
    key: "freesurface-blue"
  },
  {
    label: renderColorSchemeOption("Freesurface Red", getColorSchemeGradient('freesurface-red')),
    value: "freesurface-red",
    key: "freesurface-red"
  },
  {label: renderColorSchemeOption("Greens", getColorSchemeGradient('greens')), value: "greens", key: "greens"},
  {label: renderColorSchemeOption("Greys", getColorSchemeGradient('greys')), value: "greys", key: "greys"},
  {label: renderColorSchemeOption("Hot", getColorSchemeGradient('hot')), value: "hot", key: "hot"},
  {label: renderColorSchemeOption("HSV", getColorSchemeGradient('hsv')), value: "hsv", key: "hsv"},
  {label: renderColorSchemeOption("Inferno", getColorSchemeGradient('inferno')), value: "inferno", key: "inferno"},
  {label: renderColorSchemeOption("Jet", getColorSchemeGradient('jet')), value: "jet", key: "jet"},
  {label: renderColorSchemeOption("Magma", getColorSchemeGradient('magma')), value: "magma", key: "magma"},
  {label: renderColorSchemeOption("Oxygen", getColorSchemeGradient('oxygen')), value: "oxygen", key: "oxygen"},
  {label: renderColorSchemeOption("PAR", getColorSchemeGradient('par')), value: "par", key: "par"},
  {label: renderColorSchemeOption("Phase", getColorSchemeGradient('phase')), value: "phase", key: "phase"},
  {label: renderColorSchemeOption("Picnic", getColorSchemeGradient('picnic')), value: "picnic", key: "picnic"},
  {label: renderColorSchemeOption("Plasma", getColorSchemeGradient('plasma')), value: "plasma", key: "plasma"},
  {label: renderColorSchemeOption("Portland", getColorSchemeGradient('portland')), value: "portland", key: "portland"},
  {label: renderColorSchemeOption("Rainbow", getColorSchemeGradient('rainbow')), value: "rainbow", key: "rainbow"},
  {
    label: renderColorSchemeOption("Rainbow Soft", getColorSchemeGradient('rainbow-soft')),
    value: "rainbow-soft",
    key: "rainbow-soft"
  },
  {label: renderColorSchemeOption("RdBu", getColorSchemeGradient('RdBu')), value: "RdBu", key: "RdBu"},
  {label: renderColorSchemeOption("Salinity", getColorSchemeGradient('salinity')), value: "salinity", key: "salinity"},
  {label: renderColorSchemeOption("Spring", getColorSchemeGradient('spring')), value: "spring", key: "spring"},
  {label: renderColorSchemeOption("Summer", getColorSchemeGradient('summer')), value: "summer", key: "summer"},
  {
    label: renderColorSchemeOption("Temperature", getColorSchemeGradient('temperature')),
    value: "temperature",
    key: "temperature"
  },
  {
    label: renderColorSchemeOption("Turbidity", getColorSchemeGradient('turbidity')),
    value: "turbidity",
    key: "turbidity"
  },
  {
    label: renderColorSchemeOption("Velocity Blue", getColorSchemeGradient('velocity-blue')),
    value: "velocity-blue",
    key: "velocity-blue"
  },
  {
    label: renderColorSchemeOption("Velocity Green", getColorSchemeGradient('velocity-green')),
    value: "velocity-green",
    key: "velocity-green"
  },
  {label: renderColorSchemeOption("Viridis", getColorSchemeGradient('viridis')), value: "viridis", key: "viridis"},
  {label: renderColorSchemeOption("Warm", getColorSchemeGradient('warm')), value: "warm", key: "warm"},
  {label: renderColorSchemeOption("Winter", getColorSchemeGradient('winter')), value: "winter", key: "winter"},
  {label: renderColorSchemeOption("YIGnBu", getColorSchemeGradient('YIGnBu')), value: "YIGnBu", key: "YIGnBu"},
  {label: renderColorSchemeOption("YIOrRd", getColorSchemeGradient('YIOrRd')), value: "YIOrRd", key: "YIOrRd"},
].sort((a, b) => a.value.localeCompare(b.value));

// Scale Options
const SCALE_OPTIONS: { label: string; value: SpectrogramScale }[] = [
  { value: 'linear', label: 'Linear Frequency' },
  { value: 'log', label: 'Logarithmic Frequency' },
  { value: 'mel', label: 'Mel Scale' },
];

// --- End Moved Constants and Helpers ---

export interface ConfigControlProps {
  configModal: boolean;
  speed: number;
  amp: number;
  onSetModal?: (e: MouseEvent<HTMLButtonElement>) => void;
  onSpeedChange: (speed: number) => void;
  onAmpChange: (amp: number) => void;
  toggleVisibility?: (layerName: string, isVisible: boolean) => void;
  layerVisibility?: Map<string, boolean>;
  onSpectrogramFftSamplesChange?: (samples: number) => void;
  onNumberOfMelBandsChange?: (bands: number) => void;
  onSpectrogramWindowingFunctionChange?: (windowFunction: string) => void;
  onSpectrogramColorSchemeChange?: (schemeName: string) => void;
  onSpectrogramDbRangeChange?: (minDb: number, maxDb: number) => void;
  spectrogramFftSamples?: number;
  numberOfMelBands?: number;
  spectrogramWindowingFunction?: string;
  spectrogramColorScheme?: string;
  spectrogramMinDb?: number;
  spectrogramMaxDb?: number;
  spectrogramScale?: SpectrogramScale;
  onSpectrogramScaleChange?: (scale: SpectrogramScale) => void;
}

export const ConfigControl: FC<ConfigControlProps> = ({
                                                        configModal,
                                                        speed,
                                                        amp,
                                                        onSpeedChange,
                                                        onSetModal,
                                                        onAmpChange,
                                                        toggleVisibility,
                                                        layerVisibility,
                                                        spectrogramFftSamples = DEFAULT_FFT_VALUE,
                                                        numberOfMelBands = DEFAULT_MEL_VALUE,
                                                        spectrogramWindowingFunction = DEFAULT_WINDOWING_FUNCTION,
                                                        spectrogramColorScheme = DEFAULT_COLOR_SCHEME,
                                                        spectrogramMinDb = DEFAULT_MIN_DB,
                                                        spectrogramMaxDb = DEFAULT_MAX_DB,
                                                        onSpectrogramFftSamplesChange,
                                                        onNumberOfMelBandsChange,
                                                        onSpectrogramWindowingFunctionChange,
                                                        onSpectrogramColorSchemeChange,
                                                        onSpectrogramDbRangeChange,
                                                        spectrogramScale = DEFAULT_SCALE,
                                                        onSpectrogramScaleChange,
                                                      }) => {
  const {settings, changeSetting} = useContext(TimelineContext);
  const playbackSpeed = speed ?? 1;
  const [isTimeline, setTimeline] = useState(true);
  const [isAudioWave, setAudioWave] = useState(true);
  const [isSpectrogram, setSpectrogram] = useState(false);
  const [fftInputText, setFftInputText] = useState<string>(spectrogramFftSamples.toString());
  const [fftInputError, setFftInputError] = useState<boolean>(false);
  
  // Calculate initial index based on current value from props/settings
  const currentFftValue = useMemo(() => settings?.spectrogramFftSamples ?? spectrogramFftSamples, [settings?.spectrogramFftSamples, spectrogramFftSamples]);
  const initialFftIndex = useMemo(() => {
    const index = FFT_SAMPLE_VALUES.indexOf(currentFftValue);
    return index !== -1 ? index : (DEFAULT_FFT_INDEX !== -1 ? DEFAULT_FFT_INDEX : 3);
  }, [currentFftValue]);

  // State for the slider's current index
  const [fftSliderIndex, setFftSliderIndex] = useState(initialFftIndex);

  // Initialize displayColorScheme from settings or props
  const [displayColorScheme, setDisplayColorScheme] = useState(
    settings?.spectrogramColorScheme ?? spectrogramColorScheme
  );

  // Initialize displayDbRange from settings or props
  const [displayMinDb, setDisplayMinDb] = useState(
    settings?.spectrogramMinDb ?? spectrogramMinDb
  );
  const [displayMaxDb, setDisplayMaxDb] = useState(
    settings?.spectrogramMaxDb ?? spectrogramMaxDb
  );

  // Add state for scale
  const [displayScale, setDisplayScale] = useState<SpectrogramScale>(
      settings?.spectrogramScale ?? spectrogramScale
  );

  // Refs for positioning
  const modalRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Effect to dynamically position the modal within the viewport
  useEffect(() => {
    // Check if modal is open and refs are attached
    if (configModal && modalRef.current && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const modal = modalRef.current;
      // Temporarily make it visible off-screen to measure its actual size
      modal.style.opacity = '0';
      modal.style.position = 'fixed'; // Ensure fixed for measurement
      modal.style.top = '-9999px';
      modal.style.left = '-9999px';

      const calculatePosition = () => {
        if (!modalRef.current || !buttonRef.current) return; // Refs might detach
        const modalRect = modal.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const margin = 10; // Margin from viewport edges

        // Default position: below the button, aligned left
        let top = buttonRect.bottom + 5;
        let left = buttonRect.left;

        // Adjust top if modal goes below viewport
        if (top + modalRect.height > viewportHeight - margin) {
          // Try placing above the button first
          const topAbove = buttonRect.top - modalRect.height - 5;
          if (topAbove > margin) {
            top = topAbove; // Place above if enough space
          } else {
            top = viewportHeight - modalRect.height - margin; // Stick to bottom edge
          }
        }

        // Adjust top if modal goes above viewport
        if (top < margin) {
          top = margin;
        }

        // Adjust left if modal goes beyond right edge
        if (left + modalRect.width > viewportWidth - margin) {
          left = viewportWidth - modalRect.width - margin;
        }

        // Adjust left if modal goes beyond left edge
        if (left < margin) {
          left = margin;
        }

        // Apply calculated styles
        modal.style.top = `${top}px`;
        modal.style.left = `${left}px`;
        modal.style.opacity = '1'; // Make visible after positioning
      };
      
      // Calculate after a short delay or next frame to allow measurement
      requestAnimationFrame(calculatePosition);

    } else if (modalRef.current) {
      // Reset opacity when closing
      modalRef.current.style.opacity = '0';
    }
  }, [configModal]); // Rerun effect when modal visibility changes

  useEffect(() => {
    if (layerVisibility) {
      const defaultDisplay = true;
      setTimeline(layerVisibility?.get?.("timeline") ?? defaultDisplay);
      setAudioWave(layerVisibility?.get?.("waveform") ?? defaultDisplay);
      setSpectrogram(layerVisibility?.get?.("spectrogram") ?? defaultDisplay);
    }
  }, [layerVisibility]);

  useEffect(() => {
    setFftInputText(spectrogramFftSamples.toString());
    setFftInputError(false);
  }, [spectrogramFftSamples]);

  // Sync text input when external changes occur
  useEffect(() => {
    setFftInputText(spectrogramFftSamples.toString());
    setFftInputError(false);
  }, [spectrogramFftSamples]);

  // Update local state when settings or props change
  useEffect(() => {
    const newColorScheme = settings?.spectrogramColorScheme ?? spectrogramColorScheme;
    if (newColorScheme !== displayColorScheme) {
      setDisplayColorScheme(newColorScheme);
    }
  }, [settings?.spectrogramColorScheme, spectrogramColorScheme]);

  useEffect(() => {
    const newMinDb = settings?.spectrogramMinDb ?? spectrogramMinDb;
    const newMaxDb = settings?.spectrogramMaxDb ?? spectrogramMaxDb;
    if (newMinDb !== displayMinDb) {
      setDisplayMinDb(newMinDb);
    }
    if (newMaxDb !== displayMaxDb) {
      setDisplayMaxDb(newMaxDb);
    }
  }, [settings?.spectrogramMinDb, settings?.spectrogramMaxDb, spectrogramMinDb, spectrogramMaxDb]);

  // Update local scale state when settings or props change
  useEffect(() => {
      const newScale = settings?.spectrogramScale ?? spectrogramScale;
      if (newScale !== displayScale) {
          setDisplayScale(newScale);
      }
  }, [settings?.spectrogramScale, spectrogramScale]);

  // Effect to sync local slider state with external changes
  useEffect(() => {
      setFftSliderIndex(initialFftIndex);
      // Keep text input synced as well
      setFftInputText(FFT_SAMPLE_VALUES[initialFftIndex]?.toString() ?? DEFAULT_FFT_VALUE.toString());
      setFftInputError(false);
  }, [initialFftIndex]);

  const handleSetTimeline = () => {
    setTimeline(!isTimeline);
    toggleVisibility?.("timeline", !isTimeline);
  };

  const handleSetAudioWave = () => {
    setAudioWave(!isAudioWave);
    toggleVisibility?.("waveform", !isAudioWave);
    toggleVisibility?.("regions", !isAudioWave);
  };

  const handleChangePlaybackSpeed = (e: React.FormEvent<HTMLInputElement>) => {
    const _playbackSpeed = Number.parseFloat(e.currentTarget.value);

    if (isNaN(_playbackSpeed)) return;

    onSpeedChange(_playbackSpeed);
  };

  const handleChangeAmp = (e: React.FormEvent<HTMLInputElement>) => {
    const _amp = Number.parseFloat(e.currentTarget.value);

    onAmpChange(_amp);
  };

  const handleSetSpectrogram = () => {
    setSpectrogram(!isSpectrogram);
    toggleVisibility?.("spectrogram", !isSpectrogram);
  };

  const handleChangeFftSamples = (e: React.FormEvent<HTMLInputElement> | number) => {
    const sliderIndex = typeof e === 'number' ? e : Number.parseInt((e as React.FormEvent<HTMLInputElement>).currentTarget.value);
    if (!isNaN(sliderIndex)) {
      const clampedIndex = Math.max(0, Math.min(sliderIndex, FFT_SAMPLE_VALUES.length - 1));
      const actualFftValue = FFT_SAMPLE_VALUES[clampedIndex];

      if (actualFftValue !== undefined) {
        onSpectrogramFftSamplesChange?.(actualFftValue);
        changeSetting?.("spectrogramFftSamples", actualFftValue);

        const targetMelValue = findBestMelBandValue(actualFftValue);
        const currentMelValueFromState = settings?.numberOfMelBands ?? numberOfMelBands;
        if (targetMelValue !== currentMelValueFromState) {
          onNumberOfMelBandsChange?.(targetMelValue);
          changeSetting?.("numberOfMelBands", targetMelValue);
        }
      }
    }
  };

  const handleChangeNumberOfMelBands = (e: React.FormEvent<HTMLInputElement> | number) => {
    const actualMelValue = typeof e === 'number' ? e : Number.parseInt((e as React.FormEvent<HTMLInputElement>).currentTarget.value);
    if (!isNaN(actualMelValue)) {
      onNumberOfMelBandsChange?.(actualMelValue);
      changeSetting?.("numberOfMelBands", actualMelValue);
    }
  };

  const handleChangeWindowingFunction = (value: string) => {
    onSpectrogramWindowingFunctionChange?.(value);
    changeSetting?.("spectrogramWindowingFunction", value);
  };

  const handleChangeColorScheme = (value: string) => {
    setDisplayColorScheme(value);
    onSpectrogramColorSchemeChange?.(value);
    changeSetting?.("spectrogramColorScheme", value);
  };

  const handleChangeScale = (value: SpectrogramScale) => {
      setDisplayScale(value);
      onSpectrogramScaleChange?.(value);
      changeSetting?.("spectrogramScale", value);
      // If scale is not 'mel', potentially reset mel bands? Or just disable slider?
      // Let's just disable the slider for now.
  };

  const handleFftInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputText = e.target.value;
    setFftInputText(inputText);

    const parsedValue = Number.parseInt(inputText);

    if (!isNaN(parsedValue) && FFT_SAMPLE_VALUES.includes(parsedValue)) {
      setFftInputError(false);
      const index = FFT_SAMPLE_VALUES.indexOf(parsedValue);
      handleChangeFftSamples(index);
    } else {
      setFftInputError(true);
    }
  };

  const handleChangeFftSamplesSlider = (sliderIndex: number) => {
    if (!isNaN(sliderIndex)) {
      const clampedIndex = Math.max(0, Math.min(sliderIndex, FFT_SAMPLE_VALUES.length - 1));
      const actualFftValue = FFT_SAMPLE_VALUES[clampedIndex];

      if (actualFftValue !== undefined) {
        onSpectrogramFftSamplesChange?.(actualFftValue);
        changeSetting?.("spectrogramFftSamples", actualFftValue);

        // Update local slider index state
        setFftSliderIndex(clampedIndex);
        setFftInputText(actualFftValue.toString());
        setFftInputError(false);

        const targetMelValue = findBestMelBandValue(actualFftValue);
        const currentMelValueFromState = settings?.numberOfMelBands ?? numberOfMelBands;
        if (targetMelValue !== currentMelValueFromState) {
          onNumberOfMelBandsChange?.(targetMelValue);
          changeSetting?.("numberOfMelBands", targetMelValue);
        }
      }
    }
  };

  const [lastUpdate, setLastUpdate] = useState<{min: number; max: number; time: number} | null>(null);

  const handleDbRangeChange = (values: number[]) => {
    
    if (!Array.isArray(values) || values.length !== 2) {
      return;
    }

    const [newMinDb, newMaxDb] = values;
    
    // Basic validation
    if (isNaN(newMinDb) || isNaN(newMaxDb) || newMinDb >= newMaxDb) {
      return;
    }

    // Prevent rapid updates with unstable values
    const currentTime = Date.now();
    if (lastUpdate && currentTime - lastUpdate.time < 100) {
      // If we're getting a quick update that would change max when we're moving min
      if (lastUpdate.min === newMinDb && lastUpdate.max !== newMaxDb && newMaxDb !== displayMaxDb) {
        return;
      }
      // If we're getting a quick update that would change min when we're moving max
      if (lastUpdate.max === newMaxDb && lastUpdate.min !== newMinDb && newMinDb !== displayMinDb) {
        return;
      }
    }
    
    // Update last update time
    setLastUpdate({ min: newMinDb, max: newMaxDb, time: currentTime });
    
    // Update local state
    setDisplayMinDb(newMinDb);
    setDisplayMaxDb(newMaxDb);
    
    // Update the spectrogram
    onSpectrogramDbRangeChange?.(newMinDb, newMaxDb);
    
    // Update context settings
    changeSetting?.("spectrogramMinDb", newMinDb);
    changeSetting?.("spectrogramMaxDb", newMaxDb);
  };

  const handleRangeChange = (value: string | number | number[]) => {
    // Convert string or single number to array if needed
    const valueArray = Array.isArray(value) ? value : [Number(value)];
    
    if (!Array.isArray(valueArray) || valueArray.length !== 2) return;
    
    let [newMin, newMax] = valueArray.map(Math.round);
    
    // Determine which handle is moving
    const isMinMoving = newMin !== displayMinDb;
    const isMaxMoving = newMax !== displayMaxDb;
    
    // If only min is moving, preserve current max
    if (isMinMoving && !isMaxMoving) {
      newMax = displayMaxDb;
    }
    // If only max is moving, preserve current min
    else if (isMaxMoving && !isMinMoving) {
      newMin = displayMinDb;
    }

    // Ensure values stay within bounds
    newMin = Math.max(-120, Math.min(0, newMin));
    newMax = Math.max(-120, Math.min(0, newMax));

    // Ensure min is always less than max
    if (newMin >= newMax) {
      if (isMinMoving) {
        newMin = Math.min(newMin, newMax - 1);
      } else {
        newMax = Math.max(newMax, newMin + 1);
      }
    }
    handleDbRangeChange([newMin, newMax]);
  };

  const renderLayerToggles = () => {
    return (
      <Elem name={"buttons"}>
        <Elem name="menu-button" onClick={handleSetTimeline}>
          {isTimeline ? "Hide" : "Show"} timeline
        </Elem>
        <Elem name="menu-button" onClick={handleSetAudioWave}>
          {isAudioWave ? "Hide" : "Show"} audio wave
        </Elem>
        <Elem name="menu-button" onClick={handleSetSpectrogram}>
          {isSpectrogram ? "Hide" : "Show"} spectrogram
        </Elem>
      </Elem>
    );
  };

  const showWarning = (Number(fftInputText) > 1024) || (displayScale === 'mel' && numberOfMelBands > 140);

  const renderModal = () => {
    const fftInfoText = "Higher values provide more frequency resolution but increase computation.";
    const displayMelBands = settings?.numberOfMelBands ?? numberOfMelBands;
    const displayWindowFunc = settings?.spectrogramWindowingFunction ?? spectrogramWindowingFunction;
    const isMelScaleSelected = displayScale === 'mel';

    const modalJSX = (
      <Elem
        name="modal"
        ref={modalRef}
        onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
        // Add initial style to hide until positioned and ensure position is fixed
        style={{ opacity: 0, position: 'fixed' }}
      >
        {/* Warning icon at top right if FFT or mel bands are high */}
        {(Number(fftInputText) > 1024 || (displayScale === 'mel' && displayMelBands > 140)) && (
          <Tooltip title="High FFT or mel band values may cause performance issues or artifacts.">
            <WarningFilled
              style={{
                color: 'var(--color-warning-icon, #faad14)',
                position: 'absolute',
                top: 12,
                right: 16,
                fontSize: 22,
                zIndex: 10,
                cursor: 'pointer',
                filter: 'drop-shadow(0 2px 6px var(--color-warning-shadow, rgba(0,0,0,0.25)))',
                transition: 'color 0.2s',
              }}
            />
          </Tooltip>
        )}
        {/* Wrap main content in a scrollable element */}
        <Elem name="scroll-content">
          <Elem name="section-header">Playback Settings</Elem>
          <Slider
            min={MIN_SPEED}
            max={MAX_SPEED}
            step={0.1}
            value={speed}
            description={"Playback speed"}
            info={"Increase or decrease the playback speed"}
            onChange={handleChangePlaybackSpeed}
          />
          <Slider
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.1}
            value={amp}
            description={"Audio zoom y-axis"}
            info={"Increase or decrease the appearance of amplitude"}
            onChange={handleChangeAmp}
          />
          <Elem name="toggle">
            <Toggle
              checked={settings?.loopRegion}
              onChange={(e) => changeSetting?.("loopRegion", e.target.checked)}
              label="Loop Regions"
              labelProps={{ size: 'small' }}
            />
          </Elem>
          <Elem name="toggle">
            <Toggle
              checked={settings?.autoPlayNewSegments}
              onChange={(e) => changeSetting?.("autoPlayNewSegments", e.target.checked)}
              label="Auto-play New Regions"
              labelProps={{ size: 'small' }}
            />
          </Elem>
          <Elem name="section-header">Spectrogram Settings</Elem>
          <Elem name="slider-container">
            <AntSlider
              min={0} max={FFT_SAMPLE_VALUES.length - 1} step={1}
              marks={FFT_MARKS}
              value={fftSliderIndex}
              onChange={handleChangeFftSamplesSlider}
              tooltip={{formatter: (idx?: number) => FFT_SAMPLE_VALUES[idx ?? 0]?.toString()}}
            />
            <Elem name="control">
              <Elem name="info">
                FFT Samples
                <Tooltip title={fftInfoText}>
                  <IconInfoConfig/>
                </Tooltip>
              </Elem>
              <Elem
                tag="input"
                name="input"
                type="text"
                value={fftInputText}
                onChange={handleFftInputChange}
                mod={{error: fftInputError}}
              />
            </Elem>
          </Elem>
          <Elem name="spectrogram-controls">
            <Elem name="info">
              Scale
              <Tooltip title="Determines the frequency scale mapping: Linear, Logarithmic, or Mel (perceptual).">
                <IconInfoConfig />
              </Tooltip>
            </Elem>
            <Select
              value={displayScale}
              onChange={handleChangeScale}
              options={SCALE_OPTIONS}
              style={{ width: '100%' }}
            />
          </Elem>
          {isMelScaleSelected && (
            <Slider
              min={20}
              max={220}
              step={1}
              value={displayMelBands}
              description={"Number of Mel Bands"}
              info={"Specifies the number of frequency bands using the Mel scale. "}
              onChange={handleChangeNumberOfMelBands}
            />
          )}
          <Elem name="spectrogram-controls">
            <Range
              multi
              continuous
              min={-120}
              max={0}
              step={1}
              value={[displayMinDb, displayMaxDb]}
              resetValue={[DEFAULT_MIN_DB, DEFAULT_MAX_DB]}
              onChange={handleRangeChange}
              size={200}
            />
            <Elem name="control">
              <Elem name="info">
                Spectogram dB
                <Tooltip title="Controls the range of decibel values shown in the spectrogram. Lower values show quieter sounds.">
                  <IconInfoConfig/>
                </Tooltip>
              </Elem>
              <Elem name="input-group">
                <Elem name="input"
                  tag="input"
                  type="number"
                  value={displayMinDb}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const value = Number(e.target.value);
                    if (!isNaN(value) && value <= displayMaxDb - 10) {
                      handleDbRangeChange([value, displayMaxDb]);
                    }
                  }}
                  min={-120}
                  max={displayMaxDb - 10}
                  className="lsf-audio-slider__input"
                />
                <Elem tag="span" name="separator">to</Elem>
                <Elem name="input"
                  tag="input"
                  type="number"
                  value={displayMaxDb}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const value = Number(e.target.value);
                    if (!isNaN(value) && value >= displayMinDb + 10) {
                      handleDbRangeChange([displayMinDb, value]);
                    }
                  }}
                  min={displayMinDb + 10}
                  max={0}
                  className="lsf-audio-slider__input"
                />
              </Elem>
            </Elem>
          </Elem>
          <Elem name="spectrogram-controls">
            <Elem name="label">Windowing Function</Elem>
            <Select
              value={displayWindowFunc}
              onChange={handleChangeWindowingFunction}
              options={WINDOWING_OPTIONS}
              style={{width: '100%'}}
            />
          </Elem>
          <Elem name="spectrogram-controls">
            <Elem name="label">Color Scheme</Elem>
            <Select
              value={displayColorScheme}
              onChange={handleChangeColorScheme}
              style={{
                width: '100%',
              }}
              options={COLOR_SCHEME_OPTIONS}
              listHeight={320}
              className="color-scheme-select"
            />
          </Elem>
        </Elem>
        {/* Fixed bottom part */}
        {renderLayerToggles()}
      </Elem>
    );

    // Render using portal only if running in browser environment
    return typeof document !== 'undefined' ? createPortal(modalJSX, document.body) : null;
  };

  return (
    // Add ref to the button container (Block component renders a div)
    <Block name="audio-config" ref={buttonRef} onClick={(e: MouseEvent<HTMLButtonElement>) => e.stopPropagation()}>
      <ControlButton look={configModal ? "active" : undefined} onClick={onSetModal}>
        {<IconConfig/>}
      </ControlButton>
      {/* Conditional rendering of the portal */}
      {configModal && renderModal()}
    </Block>
  );
};
