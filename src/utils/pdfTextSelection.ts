/**
 * PDF.js TextLayerBuilder selection fix, adapted for the independently
 * virtualized text layers in PatricksPDF (pdf.js v4.10). PDF.js adds a
 * movable endOfContent element because Chrome/Android otherwise expands
 * selections to unrelated text when a finger crosses an empty area.
 *
 * This affects native copy/selection only; it never changes PDF bytes.
 */
export function installPdfTextSelection(layer: HTMLDivElement): () => void {
  const end = document.createElement('div');
  end.className = 'endOfContent';
  layer.append(end);
  const controller = new AbortController();
  const { signal } = controller;
  let isPointerDown = false;
  let previousRange: Range | null = null;

  const reset = () => {
    if (end.parentNode !== layer) layer.append(end);
    end.style.width = '';
    end.style.height = '';
    layer.classList.remove('selecting');
    previousRange = null;
  };

  layer.addEventListener('pointerdown', () => {
    isPointerDown = true;
    layer.classList.add('selecting');
  }, { signal });
  document.addEventListener('pointerup', () => {
    isPointerDown = false;
    reset();
  }, { signal });
  document.addEventListener('pointercancel', () => {
    isPointerDown = false;
    reset();
  }, { signal });
  window.addEventListener('blur', () => {
    isPointerDown = false;
    reset();
  }, { signal });
  document.addEventListener('keyup', () => {
    if (!isPointerDown) reset();
  }, { signal });

  document.addEventListener('selectionchange', () => {
    const selection = document.getSelection();
    if (!selection?.rangeCount) {
      reset();
      return;
    }

    let intersecting = false;
    for (let i = 0; i < selection.rangeCount; i++) {
      try {
        if (selection.getRangeAt(i).intersectsNode(layer)) {
          intersecting = true;
          break;
        }
      } catch {
        // A range can become detached while the user scrolls to another page.
      }
    }
    if (!intersecting) {
      reset();
      return;
    }

    layer.classList.add('selecting');
    const range = selection.getRangeAt(0);
    const modifyStart = previousRange &&
      (range.compareBoundaryPoints(Range.END_TO_END, previousRange) === 0 ||
       range.compareBoundaryPoints(Range.START_TO_END, previousRange) === 0);
    let anchor: Node = modifyStart ? range.startContainer : range.endContainer;
    if (anchor.nodeType === Node.TEXT_NODE && anchor.parentNode) {
      anchor = anchor.parentNode;
    }
    const element = anchor instanceof Element ? anchor : anchor.parentElement;
    // Limit the workaround to the layer that owns the native selection.
    if (element && element.closest('.textLayer') === layer &&
        element !== layer && element.parentNode) {
      end.style.width = layer.style.width;
      end.style.height = layer.style.height;
      element.parentNode.insertBefore(end, modifyStart ? element : element.nextSibling);
    }
    previousRange = range.cloneRange();
  }, { signal });

  return () => {
    controller.abort();
    reset();
    end.remove();
  };
}
