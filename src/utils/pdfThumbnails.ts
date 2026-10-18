import { pdfjsLib } from './pdfWorker';
import { loadPdfJsDoc } from './pdfDocumentLifecycle';

// In-memory cache for rendered thumbnails
let thumbnailCache = new WeakMap<ArrayBuffer, Map<string, string>>();

/**
 * Clears the in-memory thumbnail cache.
 */
export function clearThumbnailCache() {
  thumbnailCache = new WeakMap<ArrayBuffer, Map<string, string>>();
}

/**
 * Renders an individual PDF page as a lightweight high-res thumbnail data URL.
 */
export async function renderPageThumbnail(
  data: ArrayBuffer,
  pageNumber: number,
  targetWidth: number = 240
): Promise<string> {
  const cacheKey = `${pageNumber}-${targetWidth}`;
  const documentThumbnails = thumbnailCache.get(data);
  const cached = documentThumbnails?.get(cacheKey);
  if (cached) return cached;

  const pdfJsDoc = await loadPdfJsDoc(data);
  const page = await pdfJsDoc.getPage(pageNumber);
  const unscaledViewport = page.getViewport({ scale: 1.0 });
  const scale = targetWidth / Math.max(1, unscaledViewport.width);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const renderContext = {
    canvasContext: ctx,
    viewport,
    intent: 'display',
    annotationMode: (pdfjsLib as any).AnnotationMode?.ENABLE_FORMS ?? 2,
    background: 'rgba(255, 255, 255, 1)',
  };

  try {
    await page.render(renderContext).promise;
  } catch (err: any) {
    if (err?.name !== 'RenderingCancelledException') {
      try {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvasContext: ctx,
          viewport,
          annotationMode: 0,
        }).promise;
      } catch {
        // Fallback placeholder
      }
    }
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  const entries = thumbnailCache.get(data) || new Map<string, string>();
  // Bound memory usage even for 400+ page documents.
  if (entries.size >= 64) entries.delete(entries.keys().next().value!);
  entries.set(cacheKey, dataUrl);
  thumbnailCache.set(data, entries);
  return dataUrl;
}

