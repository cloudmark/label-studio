import { Layer } from "../Layer";
import { CompositionResult, LayerComposer } from "./LayerComposer";

/**
 * LayerM is a monadic wrapper around Layer or CompositionResult that provides functional composition methods.
 * It allows for more expressive and composable layer operations.
 */
export class LayerM {
  private layer: Layer;
  private composition: CompositionResult | null = null;
  private static composer = new LayerComposer();
  private static counter = 0;

  /**
   * Create a new LayerM instance wrapping a Layer or CompositionResult
   */
  private constructor(layerOrComposition: Layer | CompositionResult) {
    if ("layers" in layerOrComposition && "positions" in layerOrComposition) {
      // It's a CompositionResult
      this.composition = layerOrComposition;
      // Create a temporary layer for rendering
      this.layer = new Layer({
        name: `layerm-${LayerM.counter++}`,
        container: document.body,
        height: layerOrComposition.totalHeight,
        offscreen: true
      });
      this.layer.setSize(
        layerOrComposition.totalWidth,
        layerOrComposition.totalHeight
      );
    } else {
      // It's a Layer
      this.layer = layerOrComposition;
    }
  }

  /**
   * Lift a Layer or CompositionResult to a LayerM
   * @param layerOrComposition The Layer or CompositionResult to lift
   * @returns A new LayerM instance
   */
  public static lift(layerOrComposition: Layer | CompositionResult): LayerM {
    return new LayerM(layerOrComposition);
  }

  /**
   * Get the underlying Layer
   * @returns The wrapped Layer
   */
  public unwrap(): Layer | CompositionResult {
    return this.composition || this.layer;
  }

  /**
   * Compose this layer with another layer by placing the other layer on top of this one
   * @param other The layer to place on top of this one
   * @returns A new LayerM instance representing the composition
   */
  public onTopOf(other: LayerM): LayerM {
    const composition = LayerM.composer.onTopOfEachOther([
      other.unwrap(),
      this.composition || this.layer
    ]);

    return LayerM.lift(composition);
  }

  /**
   * Compose this layer with another layer by stacking them vertically
   * @param other The layer to stack below this one
   * @returns A new LayerM instance representing the composition
   */
  public above(other: LayerM): LayerM {
    // Convert this.layer to CompositionResult if it's not already
    const thisComp =
      this.composition || LayerM.composer.onTopOfEachOther([this.layer]);

    // Convert other.unwrap() to CompositionResult if it's not already
    const otherUnwrapped = other.unwrap();
    const otherComp =
      "layers" in otherUnwrapped
        ? (otherUnwrapped as CompositionResult)
        : LayerM.composer.onTopOfEachOther([otherUnwrapped as Layer]);

    const composition = LayerM.composer.composeVertically([
      thisComp,
      otherComp
    ]);

    return LayerM.lift(composition);
  }

  /**
   * Compose this layer with another layer by stacking them vertically
   * @param other The layer to stack above this one
   * @returns A new LayerM instance representing the composition
   */
  public below(other: LayerM): LayerM {
    // Convert this.layer to CompositionResult if it's not already
    const thisComp =
      this.composition || LayerM.composer.onTopOfEachOther([this.layer]);

    // Convert other.unwrap() to CompositionResult if it's not already
    const otherUnwrapped = other.unwrap();
    const otherComp =
      "layers" in otherUnwrapped
        ? (otherUnwrapped as CompositionResult)
        : LayerM.composer.onTopOfEachOther([otherUnwrapped as Layer]);

    const composition = LayerM.composer.composeVertically([
      otherComp,
      thisComp
    ]);

    return LayerM.lift(composition);
  }

  /**
   * Stack multiple layers vertically
   * @param layers The layers to stack
   * @returns A new LayerM instance representing the vertical stack
   */
  public static vStack(layers: LayerM[]): LayerM {
    // Convert each layer to a CompositionResult
    const compositions: CompositionResult[] = layers.map(l => {
      const unwrapped = l.unwrap();
      return "layers" in unwrapped
        ? (unwrapped as CompositionResult)
        : LayerM.composer.onTopOfEachOther([unwrapped as Layer]);
    });

    const composition = LayerM.composer.composeVertically(compositions);

    return LayerM.lift(composition);
  }

  /**
   * Stack multiple layers on top of each other
   * @param layers The layers to stack
   * @returns A new LayerM instance representing the horizontal stack
   */
  public static hStack(layers: LayerM[]): LayerM {
    const unwrappedLayers = layers.map(l => l.unwrap());
    const composition = LayerM.composer.onTopOfEachOther(unwrappedLayers);

    return LayerM.lift(composition);
  }

  public static overlay(layers: LayerM[]): LayerM {
    const unwrappedLayers = layers.map(l => l.unwrap());
    const composition = LayerM.composer.onTopOfEachOther(unwrappedLayers);
    return LayerM.lift(composition);
  }

  /**
   * Apply padding to this layer
   * @param padding The padding to apply { top, right, bottom, left }
   * @returns A new LayerM instance with padding applied
   */
  public pad(padding: {
    top?: number;
    right?: number;
    bottom?: number;
    left?: number;
  }): LayerM {
    if (this.composition) {
      // If we have a composition, pad it
      const paddedComposition = LayerM.composer.pad(this.composition, padding);
      return LayerM.lift(paddedComposition);
    } else {
      // If we just have a layer, create a simple composition and pad it
      const simpleComposition = LayerM.composer.onTopOfEachOther([this.layer]);
      const paddedComposition = LayerM.composer.pad(simpleComposition, padding);
      return LayerM.lift(paddedComposition);
    }
  }

  /**
   * Render this layer to a target layer
   * @param target The target layer to render to
   */
  public renderTo(target: Layer): void {
    if (this.composition) {
      // If we have a composition, render it
      LayerM.composer.renderComposition(this.composition, target);
    } else {
      target.clear();
      target.setSize(this.layer.width, this.layer.height);
      this.layer.transferTo(target, 0, 0);
    }
  }

  /**
   * Returns true if the underlying layer or any layer in the composition is visible
   */
  public isVisible(): boolean {
    if (this.composition) {
      // If we have a composition, check if any layer is visible
      return this.composition.layers.some(layer => layer.isVisible);
    } else {
      // If we just have a layer, return its visibility
      return this.layer.isVisible;
    }
  }
}
