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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);

  const [isNearViewport, setIsNearViewport] = useState<boolean>(false);
  const [isRendered, setIsRendered] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [links, setLinks] = useState<PdfLinkAnnotation[]>([]);

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
        if (entry.isIntersecting) {
          setIsNearViewport(true);
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
    const scaleMultiplier = Math.min(2.5, Math.max(1.5, (zoomLevel / 100) * 1.5));

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
      if (canvas && !isRendered) {
        cancelCanvasRender(canvas);
      }
    };
  }, [isNearViewport, arrayBuffer, pageNumber, zoomLevel]);

  // Render selectable text layer (debounced on zoom/width changes)
  useEffect(() => {
    if (!isNearViewport || !arrayBuffer || !textLayerRef.current) return;

    let isCancelled = false;
    const textLayerEl = textLayerRef.current;

    const delay = isRendered ? 180 : 0;
    const timer = setTimeout(() => {
      renderPdfTextLayer(arrayBuffer, pageNumber, textLayerEl, pageWidth).catch((err) => {
        if (!isCancelled) {
          console.warn(`Failed to render text layer for page ${pageNumber}:`, err);
        }
      });
    }, delay);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
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
        }}
        aria-hidden="false"
      />

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
    </div>
  );
});

PdfPageView.displayName = 'PdfPageView';
