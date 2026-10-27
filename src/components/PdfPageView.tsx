import React, { useEffect, useRef, useState, memo } from 'react';
import { Loader2 } from 'lucide-react';
import {
  SignatureItem,
  TextOverlayItem,
  FormFieldItem,
  FormValuesState,
  PdfLinkAnnotation,
} from '../types';
import {
  renderPdfPageToCanvas,
  cancelCanvasRender,
  extractPageLinks,
  renderPdfTextLayer,
  cancelPdfTextLayer,
  highlightPdfTextMatch,
} from '../utils/pdfEngine';
import { SignatureOverlay } from './SignatureOverlay';
import { TextOverlay } from './TextOverlay';
import { InteractiveFormField } from './InteractiveFormField';
import { openPdfExternalLink, isNativeAndroid } from '../utils/nativeBridge';
import { selectionTouchesPdfTextLayer } from '../utils/pdfSelection';

interface PdfPageViewProps {
  pageNumber: number;
  arrayBuffer: ArrayBuffer;
  zoomLevel: number;
  pageWidth: number;
  pageHeight: number;
  signatures: SignatureItem[];
  selectedSignatureId: string | null;
  textOverlays: TextOverlayItem[];
  selectedTextId: string | null;
  formFields: FormFieldItem[];
  formValues: FormValuesState;
  onSelectSignature: (id: string | null) => void;
  onUpdateSignature: (sig: SignatureItem) => void;
  onCommitUpdateSignature?: (sig: SignatureItem, actionName: string) => void;
  onDeleteSignature: (id: string) => void;
  onDuplicateSignature: (sig: SignatureItem) => void;
  onSelectText?: (id: string | null) => void;
  onUpdateText?: (item: TextOverlayItem) => void;
  onCommitUpdateText?: (item: TextOverlayItem, actionName: string) => void;
  onDeleteText?: (id: string) => void;
  onDuplicateText?: (item: TextOverlayItem) => void;
  onFormFieldChange?: (name: string, value: any, isDirectChoice?: boolean) => void;
  onCommitFormField?: (name: string, value: any) => void;
  onResetForm?: () => void;
  onNavigateToPage: (page: number) => void;
  isCurrentPage?: boolean;
  searchHighlight?: { query: string; ordinal: number };
}

export const PdfPageView = memo<PdfPageViewProps>(({
  pageNumber,
  arrayBuffer,
  zoomLevel,
  pageWidth,
  pageHeight,
  signatures,
  selectedSignatureId,
  textOverlays,
  selectedTextId,
  formFields,
  formValues,
  onSelectSignature,
  onUpdateSignature,
  onCommitUpdateSignature,
  onDeleteSignature,
  onDuplicateSignature,
  onSelectText,
  onUpdateText,
  onCommitUpdateText,
  onDeleteText,
  onDuplicateText,
  onFormFieldChange,
  onCommitFormField,
  onResetForm,
  onNavigateToPage,
  isCurrentPage = false,
  searchHighlight,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  const [isNearViewport, setIsNearViewport] = useState<boolean>(false);
  const [isRendered, setIsRendered] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [links, setLinks] = useState<PdfLinkAnnotation[]>([]);
  const [linkLoadStatus, setLinkLoadStatus] = useState<'idle'|'loading'|'found'|'empty'|'error'>('idle');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [textLayerVersion, setTextLayerVersion] = useState(0);
  const [renderedTextWidth, setRenderedTextWidth] = useState<number | null>(null);
  const lastScrolledSearchRef = useRef('');
  // Search marks are now *inside* the PDF.js selectable text spans.
  // This avoids Android WebView's inaccurate Range.getClientRects() boxes
  // that caused the orange overlay to sit several words to the right.
  useEffect(() => {
    const layer = textLayerRef.current;
    const host = containerRef.current;
    if (!layer || !host || !isNearViewport || renderedTextWidth !== pageWidth) return;

    const phrase = searchHighlight?.query || '';
    const selectedOrdinal = searchHighlight?.ordinal ?? -1;
    const selected = highlightPdfTextMatch(layer, phrase, selectedOrdinal);

    const searchKey = `${phrase}:${pageNumber}:${selectedOrdinal}`;
    if (selected && lastScrolledSearchRef.current !== searchKey) {
      lastScrolledSearchRef.current = searchKey;
      const scrollRoot = host.closest('[data-pdf-scroll-container]');
      if (scrollRoot) {
        const rect = selected.getBoundingClientRect();
        const view = scrollRoot.getBoundingClientRect();
        scrollRoot.scrollTop += rect.top - view.top -
          Math.min(160, scrollRoot.clientHeight * 0.28);
      }
    }
  }, [
    isNearViewport, textLayerVersion, renderedTextWidth, pageWidth,
    searchHighlight?.query, searchHighlight?.ordinal, pageNumber,
  ]);

  // Filter items specific to this page
  const pageSignatures = signatures.filter((s) => s.pageNumber === pageNumber);
  const pageTextOverlays = textOverlays.filter((t) => t.pageNumber === pageNumber);
  const pageFormFields = formFields.filter((f) => f.pageNumber === pageNumber);

  // IntersectionObserver to only render canvas when page is near the viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        // Keep the original text DOM mounted for the duration of an Android
        // range selection, even if dragging a handle scrolls the page offscreen.
        // Destroying/rebuilding its spans makes selection handles jump.
        if (!entry.isIntersecting && isNativeAndroid() &&
            selectionTouchesPdfTextLayer(window.getSelection(), el)) return;
        // Outside selection, retain the existing memory-saving virtualization.
        setIsNearViewport(entry.isIntersecting);
        if (!entry.isIntersecting) {
          setIsRendered(false);
          setIsLoading(false);
        }
      },
      {
        rootMargin: '600px 0px 600px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Extract link annotations once when page becomes near viewport or arrayBuffer changes
  useEffect(() => {
    if (!isNearViewport || !arrayBuffer) return;
    let isCancelled = false;
    setLinkLoadStatus('loading');

    extractPageLinks(arrayBuffer, pageNumber)
      .then((extractedLinks) => {
        if (!isCancelled) {
          setLinks(extractedLinks);
          setLinkLoadStatus(extractedLinks.length > 0 ? 'found' : 'empty');
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          setLinks([]);
          setLinkLoadStatus('error');
          console.warn('Cannot read PDF annotations for page', pageNumber, error);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isNearViewport, arrayBuffer, pageNumber]);

  // Render canvas with smooth debouncing on zoom changes
  useEffect(() => {
    if (!isNearViewport || !arrayBuffer || !canvasRef.current) return;

    let isCancelled = false;
    const canvas = canvasRef.current;

    // Scale multiplier: maintain crisp high-DPI rendering without overloading the GPU
    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const targetScale = Math.max(1.5, (zoomLevel / 100) * dpr);
    // Guard against exceeding maximum canvas dimensions (keep max dimension <= 4096px)
    const basePageDim = Math.max(pageWidth / Math.max(0.1, zoomLevel / 100), pageHeight / Math.max(0.1, zoomLevel / 100)) || 842;
    const maxSafeScale = Math.min(4.0, 4096 / basePageDim);
    const scaleMultiplier = Math.min(maxSafeScale, targetScale);

    // Debounce re-rendering if page is already rendered to allow buttery smooth zoom animations
    const delay = isRendered ? 150 : 0;
    const timer = setTimeout(() => {
      setIsLoading(true);
      renderPdfPageToCanvas(arrayBuffer, pageNumber, canvas, scaleMultiplier)
        .then((dims) => {
          if (!isCancelled && dims) {
            setIsRendered(true);
            setIsLoading(false);
          }
        })
        .catch((err) => {
          if (!isCancelled && err?.name !== 'RenderingCancelledException') {
            console.warn(`Failed to render canvas for page ${pageNumber}:`, err);
            setIsLoading(false);
          }
        });
    }, delay);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
      if (canvas) {
        cancelCanvasRender(canvas);
      }
    };
  }, [isNearViewport, arrayBuffer, pageNumber, zoomLevel]);

  // Only the latest text-layer render is allowed to publish selectable spans.
  // Unmounting an offscreen page or changing zoom invalidates the previous work.
  useEffect(() => {
    const textLayerEl = textLayerRef.current;
    if (!textLayerEl || !isNearViewport || !arrayBuffer) {
      setRenderedTextWidth(null);
      return;
    }

    let cancelled = false;
    setRenderedTextWidth(null);
    cancelPdfTextLayer(textLayerEl);
    const timer = setTimeout(() => {
      void renderPdfTextLayer(arrayBuffer, pageNumber, textLayerEl, pageWidth)
        .then((layer) => {
          if (!cancelled && layer) {
            setRenderedTextWidth(pageWidth);
            setTextLayerVersion((version) => version + 1);
          }
        });
    }, isRendered ? 140 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      cancelPdfTextLayer(textLayerEl);
    };
  }, [isNearViewport, arrayBuffer, pageNumber, pageWidth]);

  return (
    <div
      ref={containerRef}
      id={`pdf-page-${pageNumber}`}
      data-page-number={pageNumber}
      data-pdf-link-status={linkLoadStatus}
      data-pdf-link-count={links.length}
      style={{
        width: `${pageWidth}px`,
        height: `${pageHeight}px`,
      }}
      className={`relative bg-white rounded shadow-md border origin-top shrink-0 transition-shadow ${
        isCurrentPage
          ? 'border-blue-400/80 shadow-lg ring-1 ring-blue-500/20'
          : 'border-slate-300 shadow-sm'
      }`}
    >
      {/* Keep a correctly sized shell for every page, but mount heavy content only nearby. */}
      {isNearViewport ? (
        <>
      {/* Loading placeholder spinner ONLY on initial render before page is first painted */}
      {!isRendered && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-50 text-slate-400 gap-2 z-5">
          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
          <span className="text-xs font-mono">Loading page {pageNumber}...</span>
        </div>
      )}

      {/* Rendered PDF Page Canvas */}
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%' }}
        className="block rounded pointer-events-none"
      />

      {/* Selectable & Markable Text Layer for text copying, marking, and selection */}
      <div
        ref={textLayerRef}
        className="pdf-text-layer-host absolute inset-0 select-text"
        style={{
          width: `${pageWidth}px`,
          height: `${pageHeight}px`,
        } as React.CSSProperties}
        aria-hidden="false"
      />

      {/* Internal & External Link Annotations Layer */}
      {links.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-visible z-10">
          {links.map((link) => (
            <a
              key={link.id}
              data-pdf-link-id={link.id}
              href={link.targetPage ? `#page=${link.targetPage}` : (link.url || '#')}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (link.targetPage) {
                  onNavigateToPage(link.targetPage);
                } else if (link.url) {
                  try {
                    // Android opens links using the native ACTION_VIEW bridge.
                    // Browsers retain normal tab behavior through nativeBridge.
                    openPdfExternalLink(link.url);
                    setLinkError(null);
                  } catch (error: any) {
                    setLinkError(error?.message || 'Could not open web link.');
                  }
                }
              }}
              style={{
                left: `${link.xPercent}%`,
                top: `${link.yPercent}%`,
                width: `${link.widthPercent}%`,
                height: `${link.heightPercent}%`,
              }}
              className="absolute pointer-events-auto cursor-pointer rounded-xs transition-colors bg-blue-500/0 hover:bg-blue-500/15 border border-transparent hover:border-blue-400/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-600"
              title={link.title}
            >
              <span className="sr-only">{link.title}</span>
            </a>
          ))}
        </div>
      )}

      {linkError && (
        <div role="alert" className="absolute z-[40] top-2 left-2 right-2 bg-amber-50 border border-amber-300 rounded p-2 text-sm text-amber-900">
          {linkError}
          <button type="button" onClick={() => setLinkError(null)} className="ml-2 underline">Close</button>
        </div>
      )}

      {/* Native PDF Form Fields Layer (AcroForms) */}
      {pageFormFields.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-visible z-15">
          {pageFormFields.map((field) => (
            <InteractiveFormField
              key={field.id}
              field={field}
              value={formValues[field.name]}
              containerWidth={pageWidth}
              containerHeight={pageHeight}
              zoomLevel={zoomLevel}
              onChange={(name, val, isDirectChoice) => {
                if (onFormFieldChange) onFormFieldChange(name, val, isDirectChoice);
              }}
              onCommitField={(name, val) => {
                if (onCommitFormField) onCommitFormField(name, val);
              }}
              onReset={onResetForm}
            />
          ))}
        </div>
      )}

      {/* Interactive Overlays Layer (Text & Signatures) */}
      <div className="absolute inset-0 pointer-events-none overflow-visible z-20">
        {/* Text Overlays */}
        {pageTextOverlays.map((item) => (
          <TextOverlay
            key={item.id}
            item={item}
            isSelected={item.id === selectedTextId}
            containerWidth={pageWidth}
            containerHeight={pageHeight}
            zoomLevel={zoomLevel}
            onSelect={(id) => {
              if (onSelectText) onSelectText(id);
              onSelectSignature(null);
            }}
            onUpdate={(updated) => {
              if (onUpdateText) onUpdateText(updated);
            }}
            onCommitUpdate={(updated, actionName) => {
              if (onCommitUpdateText) onCommitUpdateText(updated, actionName);
            }}
            onDelete={(id) => {
              if (onDeleteText) onDeleteText(id);
            }}
            onDuplicate={(it) => {
              if (onDuplicateText) onDuplicateText(it);
            }}
          />
        ))}

        {/* Interactive Signatures */}
        {pageSignatures.map((sig) => (
          <SignatureOverlay
            key={sig.id}
            signature={sig}
            isSelected={sig.id === selectedSignatureId}
            containerWidth={pageWidth}
            containerHeight={pageHeight}
            onSelect={(id) => {
              onSelectSignature(id);
              if (onSelectText) onSelectText(null);
            }}
            onUpdate={onUpdateSignature}
            onCommitUpdate={onCommitUpdateSignature}
            onDelete={onDeleteSignature}
            onDuplicate={onDuplicateSignature}
          />
        ))}
      </div>
        </>
      ) : (
        <div className="absolute inset-0 bg-white" aria-hidden="true" />
      )}
    </div>
  );
});

PdfPageView.displayName = 'PdfPageView';
