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
} from '../utils/pdfEngine';
import { SignatureOverlay } from './SignatureOverlay';
import { TextOverlay } from './TextOverlay';
import { InteractiveFormField } from './InteractiveFormField';

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
  const [textLayerVersion, setTextLayerVersion] = useState(0);
  const [renderedTextWidth, setRenderedTextWidth] = useState<number | null>(null);
  const [searchRectangles, setSearchRectangles] = useState<Array<{
    x: number; y: number; width: number; height: number; active: boolean;
  }>>([]);
  const lastScrolledSearchRef = useRef('');

  // Create visual highlights without rewriting PDF.js text or interfering with
  // native Android selection handles. Range boxes also support split text runs.
  useEffect(() => {
    const layer = textLayerRef.current;
    const host = containerRef.current;
    const phrase = searchHighlight?.query.trim();
    if (!isNearViewport || !layer || !host || !phrase || renderedTextWidth !== pageWidth) {
      setSearchRectangles([]);
      return;
    }

    const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current: Node | null;
    while ((current = walker.nextNode())) {
      if (current.textContent) nodes.push(current as Text);
    }
    const combined = nodes.map((node) => node.textContent || '').join('');
    const lowercase = combined.toLowerCase();
    const needle = phrase.toLowerCase();
    const offsets: number[] = [];
    let offset = 0;
    for (const node of nodes) {
      offsets.push(offset);
      offset += (node.textContent || '').length;
    }

    const rects: Array<{ x: number; y: number; width: number; height: number; active: boolean }> = [];
    const layerRect = layer.getBoundingClientRect();
    const scaleX = layerRect.width > 0 ? layer.offsetWidth / layerRect.width : 1;
    const scaleY = layerRect.height > 0 ? layer.offsetHeight / layerRect.height : 1;
    let cursor = 0;
    let ordinal = 0;
    let selectedTop: number | null = null;
    while (cursor < lowercase.length) {
      const at = lowercase.indexOf(needle, cursor);
      if (at < 0) break;
      const active = ordinal === searchHighlight?.ordinal;
      if (ordinal < 32 || active) {
        const startIndex = offsets.findIndex((from, i) => from <= at && at < from + (nodes[i].textContent?.length || 0));
        const endOffset = at + needle.length - 1;
        const endIndex = offsets.findIndex((from, i) => from <= endOffset && endOffset < from + (nodes[i].textContent?.length || 0));
        if (startIndex >= 0 && endIndex >= 0) {
          const range = document.createRange();
          range.setStart(nodes[startIndex], at - offsets[startIndex]);
          range.setEnd(nodes[endIndex], endOffset + 1 - offsets[endIndex]);
          const boxes = Array.from(range.getClientRects()).slice(0, 8);
          for (const box of boxes) {
            if (box.width < 1 || box.height < 1) continue;
            rects.push({
              x: (box.left - layerRect.left) * scaleX,
              y: (box.top - layerRect.top) * scaleY,
              width: box.width * scaleX,
              height: box.height * scaleY,
              active,
            });
            if (active && selectedTop === null) selectedTop = box.top;
          }
          range.detach();
        }
      }
      ordinal++;
      cursor = at + Math.max(1, needle.length);
    }
    setSearchRectangles(rects);

    const searchKey = `${phrase}:${pageNumber}:${searchHighlight?.ordinal}`;
    if (selectedTop !== null && lastScrolledSearchRef.current !== searchKey) {
      lastScrolledSearchRef.current = searchKey;
      const scrollRoot = host.closest('[data-pdf-scroll-container]');
      if (scrollRoot) {
        const scrollRect = scrollRoot.getBoundingClientRect();
        scrollRoot.scrollTop += selectedTop - scrollRect.top -
          Math.min(160, scrollRoot.clientHeight * 0.28);
      }
    }
  }, [isNearViewport, textLayerVersion, renderedTextWidth, pageWidth, searchHighlight?.query, searchHighlight?.ordinal, pageNumber]);

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
        // Unmount offscreen canvases and text layers to release GPU/DOM memory.
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

    extractPageLinks(arrayBuffer, pageNumber).then((extractedLinks) => {
      if (!isCancelled) {
        setLinks(extractedLinks);
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
        className="textLayer select-text"
        style={{
          width: `${pageWidth}px`,
          height: `${pageHeight}px`,
          // PDF.js sets this to the precise viewport.scale used for this page.
          // Do not overwrite it with a rounded/global zoom value.
        } as React.CSSProperties}
        aria-hidden="false"
      />

      {/* Selected PDF search hit. Pointer events remain on the original text layer. */}
      {searchRectangles.length > 0 && (
        <div className="absolute inset-0 z-[6] pointer-events-none overflow-hidden" aria-hidden="true">
          {searchRectangles.map((rect, index) => (
            <div
              key={index}
              className={rect.active ? 'absolute bg-orange-400/55 ring-1 ring-orange-600/70 rounded-[2px]' : 'absolute bg-yellow-300/45 rounded-[2px]'}
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            />
          ))}
        </div>
      )}

      {/* Internal & External Link Annotations Layer */}
      {links.length > 0 && (
        <div className="absolute inset-0 pointer-events-none overflow-visible z-10">
          {links.map((link) => (
            <a
              key={link.id}
              href={link.url || '#'}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (link.targetPage) {
                  onNavigateToPage(link.targetPage);
                } else if (link.url) {
                  window.open(link.url, '_blank', 'noopener,noreferrer');
                }
              }}
              style={{
                left: `${link.xPercent}%`,
                top: `${link.yPercent}%`,
                width: `${link.widthPercent}%`,
                height: `${link.heightPercent}%`,
              }}
              className="absolute pointer-events-auto cursor-pointer rounded-xs transition-colors bg-blue-500/0 hover:bg-blue-500/15 border border-transparent hover:border-blue-400/50"
              title={link.title}
            >
              <span className="sr-only">{link.title}</span>
            </a>
          ))}
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
