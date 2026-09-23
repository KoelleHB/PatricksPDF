import * as pdfjsLib from 'pdfjs-dist';

// Configure worker with defensive fallback
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
} catch (e) {
  console.warn('Failed to resolve workerSrc via import.meta.url, falling back to CDN worker:', e);
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
}

export { pdfjsLib };
