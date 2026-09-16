import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  ChevronUp,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Maximize2,
  FileText,
  Plus,
  RotateCw,
  Eye,
  EyeOff,
  AlignLeft,
  Loader2,
  Undo2,
  Redo2,
  Type,
  FileCheck2,
  LayoutGrid,
} from 'lucide-react';
import { SignatureItem, PdfDocumentState, TextOverlayItem, FormFieldItem, FormValuesState } from '../types';
import { renderPdfPageToCanvas, cancelCanvasRender, extractPageReflowText, ReflowPageData } from '../utils/pdfEngine';
import { SignatureOverlay } from './SignatureOverlay';
import { TextOverlay } from './TextOverlay';
import { InteractiveFormField } from './InteractiveFormField';

interface PdfViewerProps {
  pdfState: PdfDocumentState;
  signatures: SignatureItem[];
  selectedSignatureId: string | null;
  textOverlays?: TextOverlayItem[];
  selectedTextId?: string | null;
  formFields?: FormFieldItem[];
  formValues?: FormValuesState;
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
  onChangePage: (newPage: number) => void;
  onOpenPageManager?: () => void;
  onOpenSignatureModal: () => void;
  onOpenTextModal?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  undoActionName?: string | null;
  redoActionName?: string | null;
  onUndo?: () => void;
  onRedo?: () => void;
  historyNotice?: { message: string; type: 'undo' | 'redo' } | null;
  onResetForm?: () => void;
  isReaderMode?: boolean;
  onToggleReaderMode?: (enabled: boolean) => void;
}

export const PdfViewer: React.FC<PdfViewerProps> = ({
  pdfState,
  signatures,
  selectedSignatureId,
  textOverlays = [],
  selectedTextId = null,
  formFields = [],
  formValues = {},
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
  onChangePage,
  onOpenPageManager,
  onOpenSignatureModal,
  onOpenTextModal,
  canUndo = false,
  canRedo = false,
  undoActionName = null,
  redoActionName = null,
  onUndo,
  onRedo,
  historyNotice,
  isReaderMode = false,
  onToggleReaderMode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [renderedDimensions, setRenderedDimensions] = useState<{ width: number; height: number }>({
    width: pdfState.pageWidth || 595,
    height: pdfState.pageHeight || 842,
  });

  // Reflow Text state and cache
  const [isReflowMode, setIsReflowMode] = useState<boolean>(false);
  const [reflowData, setReflowData] = useState<ReflowPageData | null>(null);
  const [isLoadingReflow, setIsLoadingReflow] = useState<boolean>(false);
  const reflowCache = useRef<Map<number, ReflowPageData>>(new Map());

  // Gestures: Swipe for page turning & Pinch-to-zoom
  const [swipeOffset, setSwipeOffset] = useState<number>(0);
  const [isSwiping, setIsSwiping] = useState<boolean>(false);

  // References to keep event listeners up-to-date without recreation
  const zoomLevelRef = useRef<number>(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  const currentPageRef = useRef<number>(pdfState.currentPage);
  currentPageRef.current = pdfState.currentPage;

  const numPagesRef = useRef<number>(pdfState.numPages);
  numPagesRef.current = pdfState.numPages;

  const onChangePageRef = useRef(onChangePage);
  onChangePageRef.current = onChangePage;

  const isReaderModeRef = useRef(isReaderMode);
  isReaderModeRef.current = isReaderMode;

  const onToggleReaderModeRef = useRef(onToggleReaderMode);
  onToggleReaderModeRef.current = onToggleReaderMode;

  const wheelAccumulatorRef = useRef<number>(0);
  const prevPageRef = useRef<number>(pdfState.currentPage);

  // Load reflowable text when reflow mode is active or page changes
  useEffect(() => {
    if (!isReflowMode || !pdfState || !pdfState.arrayBuffer) return;

    const pageNum = pdfState.currentPage;
    const cached = reflowCache.current.get(pageNum);
    if (cached) {
      setReflowData(cached);
      return;
    }

    let isCancelled = false;
    setIsLoadingReflow(true);

    extractPageReflowText(pdfState.arrayBuffer, pageNum)
      .then((data) => {
        if (!isCancelled) {
          reflowCache.current.set(pageNum, data);
          setReflowData(data);
          setIsLoadingReflow(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.warn('Reflow extraction error:', err);
          setIsLoadingReflow(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isReflowMode, pdfState?.currentPage, pdfState?.arrayBuffer]);

  const swipeRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    directionLocked: 'horizontal' | 'vertical' | 'scroll' | null;
    active: boolean;
  }>({
    startX: 0,
    startY: 0,
    startTime: 0,
    directionLocked: null,
    active: false,
  });

  const pinchRef = useRef<{
    active: boolean;
    startDist: number;
    startZoom: number;
  }>({
    active: false,
    startDist: 0,
    startZoom: 100,
  });

  const pinchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Pan Tool (Hand) and drag-to-pan states
  const [isPanToolActive, setIsPanToolActive] = useState<boolean>(false);
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const [isMousePanning, setIsMousePanning] = useState<boolean>(false);
  const mousePanRef = useRef<{
    isPanning: boolean;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    hasDragged: boolean;
  }>({
    isPanning: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    hasDragged: false,
  });

  // Smooth entrance transition on page turn
  useEffect(() => {
    if (pdfState.currentPage !== prevPageRef.current) {
      const dir = pdfState.currentPage > prevPageRef.current ? 1 : -1;
      prevPageRef.current = pdfState.currentPage;
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
        containerRef.current.scrollLeft = 0;
      }
      setSwipeOffset(dir * 32);
      const raf = requestAnimationFrame(() => {
        setSwipeOffset(0);
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [pdfState.currentPage]);

  // Attach non-passive touch listeners for reliable pinch-to-zoom and swiping
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Two fingers: Pinch to zoom
      if (e.touches.length === 2) {
        e.preventDefault();
        swipeRef.current.active = false;
        setIsSwiping(false);
        setSwipeOffset(0);

        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        pinchRef.current = {
          active: true,
          startDist: Math.max(10, d),
          startZoom: zoomLevelRef.current,
        };
        return;
      }

      // One finger: Swipe to turn page
      if (e.touches.length === 1) {
        const target = e.target as HTMLElement | null;
        // Do NOT initiate page swipe if touching a signature overlay, text overlay, or form input
        if (
          target &&
          (target.closest('[data-signature-overlay]') ||
            target.closest('[data-text-overlay]') ||
            target.closest('[data-form-field]'))
        ) {
          swipeRef.current.directionLocked = 'scroll';
          return;
        }

        swipeRef.current = {
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          startTime: Date.now(),
          directionLocked: null,
          active: false,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      // Handle Pinch to Zoom
      if (e.touches.length === 2 && pinchRef.current.active) {
        e.preventDefault();
        const currentDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const scale = currentDist / pinchRef.current.startDist;
        const newZoom = Math.min(250, Math.max(35, Math.round(pinchRef.current.startZoom * scale)));
        setZoomLevel(newZoom);
        return;
      }

      // Handle Page Swiping: Up/Down vertical page turns
      if (e.touches.length === 1 && !pinchRef.current.active) {
        const dx = e.touches[0].clientX - swipeRef.current.startX;
        const dy = e.touches[0].clientY - swipeRef.current.startY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        // Determine direction lock if not yet locked
        if (swipeRef.current.directionLocked === null) {
          if (absDy > 8 || absDx > 8) {
            const canTurnPages = numPagesRef.current > 1;
            const isVerticallyScrollable =
              container ? container.scrollHeight > container.clientHeight + 20 : false;

            // Intent is vertical swipe for page turn (reading downwards)
            if (canTurnPages && absDy > absDx * 1.15 && absDy > 10) {
              if (isVerticallyScrollable) {
                // If zoomed in vertically, only turn page when reached the top or bottom boundary
                const atTop = container.scrollTop <= 6 && dy > 0;
                const atBottom =
                  container.scrollTop >=
                    container.scrollHeight - container.clientHeight - 6 && dy < 0;
                if (atTop || atBottom) {
                  swipeRef.current.directionLocked = 'vertical';
                  swipeRef.current.active = true;
                  setIsSwiping(true);
                } else {
                  swipeRef.current.directionLocked = 'scroll';
                }
              } else {
                // Not vertically scrollable: vertical swipe is 100% a page turn!
                swipeRef.current.directionLocked = 'vertical';
                swipeRef.current.active = true;
                setIsSwiping(true);
              }
            } else {
              // Predominantly horizontal scrolling or normal scrolling
              swipeRef.current.directionLocked = 'scroll';
            }
          }
        }

        if (swipeRef.current.directionLocked === 'vertical') {
          e.preventDefault();
          const cur = currentPageRef.current;
          const total = numPagesRef.current;

          let calculatedOffset = 0;
          if (dy < 0) {
            // Swiping upwards -> Turn downwards to NEXT page
            if (cur >= total) {
              calculatedOffset = dy * 0.18; // Rubber-band bounce at last page
            } else {
              calculatedOffset = dy * 0.6;
            }
          } else {
            // Swiping downwards -> Turn upwards to PREVIOUS page
            if (cur <= 1) {
              calculatedOffset = dy * 0.18; // Rubber-band bounce at page 1
            } else {
              calculatedOffset = dy * 0.6;
            }
          }

          setSwipeOffset(calculatedOffset);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (pinchRef.current.active && e.touches.length < 2) {
        pinchRef.current.active = false;
        if (pinchTimeoutRef.current) clearTimeout(pinchTimeoutRef.current);
      }

      if (swipeRef.current.directionLocked === 'vertical') {
        const touch = e.changedTouches[0];
        const dy = (touch ? touch.clientY : 0) - swipeRef.current.startY;
        const dt = Math.max(1, Date.now() - swipeRef.current.startTime);
        const speed = Math.abs(dy) / dt;
        const threshold = 45;
        const cur = currentPageRef.current;
        const total = numPagesRef.current;

        if (dy < -threshold || (dy < -20 && speed > 0.35)) {
          // Swiped up -> NEXT PAGE (reading downwards)
          if (cur < total) {
            onChangePageRef.current(cur + 1);
            if (containerRef.current) containerRef.current.scrollTop = 0;
          }
        } else if (dy > threshold || (dy > 20 && speed > 0.35)) {
          // Swiped down -> PREVIOUS PAGE (reading upwards)
          if (cur > 1) {
            onChangePageRef.current(cur - 1);
            if (containerRef.current) containerRef.current.scrollTop = 0;
          }
        }

        setSwipeOffset(0);
        setIsSwiping(false);
        swipeRef.current.active = false;
        swipeRef.current.directionLocked = null;
      }
    };

    const handleWheel = (e: WheelEvent) => {
      // Trackpad pinch-to-zoom (ctrl + wheel)
      if (e.ctrlKey) {
        e.preventDefault();
        const factor = -e.deltaY * 0.35;
        setZoomLevel((prev) => Math.min(250, Math.max(35, Math.round(prev + factor))));
      } else if (e.shiftKey && container) {
        // Shift + vertical wheel -> horizontal scroll
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      } else if (container && numPagesRef.current > 1) {
        // Natural downward scrolling: turn to next page when reached bottom
        const isAtBottom =
          container.scrollTop + container.clientHeight >= container.scrollHeight - 8;
        const isAtTop = container.scrollTop <= 8;

        if (e.deltaY > 0 && isAtBottom && currentPageRef.current < numPagesRef.current) {
          wheelAccumulatorRef.current += e.deltaY;
          if (wheelAccumulatorRef.current > 60) {
            wheelAccumulatorRef.current = 0;
            onChangePageRef.current(currentPageRef.current + 1);
            container.scrollTop = 0;
          }
        } else if (e.deltaY < 0 && isAtTop && currentPageRef.current > 1) {
          wheelAccumulatorRef.current += e.deltaY;
          if (wheelAccumulatorRef.current < -60) {
            wheelAccumulatorRef.current = 0;
            onChangePageRef.current(currentPageRef.current - 1);
            container.scrollTop = container.scrollHeight;
          }
        } else {
          wheelAccumulatorRef.current = 0;
        }
      }
    };

    // Window listeners for mouse drag-to-pan, spacebar hand tool, and arrow keys
    const handleMouseMove = (e: MouseEvent) => {
      if (!mousePanRef.current.isPanning) return;
      const c = containerRef.current;
      if (!c) return;

      const dx = e.clientX - mousePanRef.current.startX;
      const dy = e.clientY - mousePanRef.current.startY;

      if (Math.hypot(dx, dy) > 3) {
        mousePanRef.current.hasDragged = true;
      }

      c.scrollLeft = mousePanRef.current.scrollLeft - dx;
      c.scrollTop = mousePanRef.current.scrollTop - dy;
    };

    const handleMouseUp = () => {
      if (mousePanRef.current.isPanning) {
        mousePanRef.current.isPanning = false;
        setIsMousePanning(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName || '';
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(activeTag)) return;

      // Escape key exits Reader Mode
      if (e.key === 'Escape') {
        if (isReaderModeRef.current && onToggleReaderModeRef.current) {
          onToggleReaderModeRef.current(false);
          return;
        }
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsSpacePressed(true);
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        setIsPanToolActive((prev) => !prev);
        return;
      }

      const c = containerRef.current;
      if (!c) return;

      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        const isAtBottom = c.scrollTop + c.clientHeight >= c.scrollHeight - 10;
        if (isAtBottom && currentPageRef.current < numPagesRef.current) {
          e.preventDefault();
          onChangePageRef.current(currentPageRef.current + 1);
          c.scrollTop = 0;
          return;
        }
        c.scrollTop += 80;
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        const isAtTop = c.scrollTop <= 10;
        if (isAtTop && currentPageRef.current > 1) {
          e.preventDefault();
          onChangePageRef.current(currentPageRef.current - 1);
          c.scrollTop = c.scrollHeight;
          return;
        }
        c.scrollTop -= 80;
      } else if (e.key === 'ArrowLeft') {
        c.scrollLeft -= 60;
      } else if (e.key === 'ArrowRight') {
        c.scrollLeft += 60;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);
    container.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
      if (pinchTimeoutRef.current) clearTimeout(pinchTimeoutRef.current);
    };
  }, []);

  // Re-render PDF page to canvas when arrayBuffer or currentPage changes
  useEffect(() => {
    let isCancelled = false;

    const render = async () => {
      if (!pdfState.arrayBuffer || !canvasRef.current) return;

      setIsLoadingPage(true);
      try {
        // Scale multiplier of 2.0 ensures razor-sharp rendering on Retina and high-DPI screens
        const dims = await renderPdfPageToCanvas(
          pdfState.arrayBuffer,
          pdfState.currentPage,
          canvasRef.current,
          2.0
        );

        if (!isCancelled && dims) {
          setRenderedDimensions({
            width: dims.width,
            height: dims.height,
          });
        }
      } catch (err: any) {
        if (!isCancelled && err?.name !== 'RenderingCancelledException') {
          console.error('Failed to render PDF page:', err);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingPage(false);
        }
      }
    };

    render();

    return () => {
      isCancelled = true;
      if (canvasRef.current) {
        cancelCanvasRender(canvasRef.current);
      }
    };
  }, [pdfState.arrayBuffer, pdfState.currentPage]);

  // Auto-fit to width if viewport is smaller than document on initial load
  const hasAutoFitRef = useRef(false);
  useEffect(() => {
    if (!hasAutoFitRef.current && containerRef.current && renderedDimensions.width > 0) {
      const padding = window.innerWidth < 640 ? 24 : 48;
      const availableWidth = containerRef.current.clientWidth - padding;
      if (availableWidth > 0 && availableWidth < renderedDimensions.width) {
        const calculatedZoom = Math.max(
          35,
          Math.min(100, Math.round((availableWidth / renderedDimensions.width) * 100))
        );
        setZoomLevel(calculatedZoom);
      }
      hasAutoFitRef.current = true;
    }
  }, [renderedDimensions.width]);

  // Zoom controls
  const handleZoomIn = () => setZoomLevel((z) => Math.min(220, z + 20));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(40, z - 20));
  const handleResetZoom = () => setZoomLevel(100);

  const handleFitWidth = useCallback(() => {
    if (!containerRef.current || renderedDimensions.width <= 0) return;
    const padding = window.innerWidth < 640 ? 24 : 48;
    const availableWidth = containerRef.current.clientWidth - padding;
    if (availableWidth > 0) {
      const calculatedZoom = Math.max(
        35,
        Math.min(220, Math.round((availableWidth / renderedDimensions.width) * 100))
      );
      setZoomLevel(calculatedZoom);
    }
  }, [renderedDimensions.width]);

  const handleFitPage = useCallback(() => {
    if (!containerRef.current || renderedDimensions.width <= 0 || renderedDimensions.height <= 0) return;
    const paddingX = window.innerWidth < 640 ? 24 : 48;
    const paddingY = window.innerWidth < 640 ? 64 : 80;
    const availableWidth = containerRef.current.clientWidth - paddingX;
    const availableHeight = containerRef.current.clientHeight - paddingY;
    if (availableWidth > 0 && availableHeight > 0) {
      const zoomX = (availableWidth / renderedDimensions.width) * 100;
      const zoomY = (availableHeight / renderedDimensions.height) * 100;
      const calculatedZoom = Math.max(
        35,
        Math.min(220, Math.round(Math.min(zoomX, zoomY)))
      );
      setZoomLevel(calculatedZoom);
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
        containerRef.current.scrollLeft = 0;
      }
    }
  }, [renderedDimensions.width, renderedDimensions.height]);

  // Handle mouse down on workspace for drag-to-pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 && e.button !== 1) return;

    const target = e.target as HTMLElement;
    const isInteractive = target.closest(
      'input, textarea, select, button, [data-signature-overlay], [data-text-overlay], [data-form-field]'
    );

    const isZoomed =
      zoomLevel > 100 ||
      (containerRef.current
        ? containerRef.current.scrollWidth > containerRef.current.clientWidth + 10 ||
          containerRef.current.scrollHeight > containerRef.current.clientHeight + 10
        : false);

    if (e.button === 1 || isSpacePressed || isPanToolActive || (isZoomed && !isInteractive)) {
      if (!isInteractive || isPanToolActive || isSpacePressed || e.button === 1) {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;
        mousePanRef.current = {
          isPanning: true,
          startX: e.clientX,
          startY: e.clientY,
          scrollLeft: container.scrollLeft,
          scrollTop: container.scrollTop,
          hasDragged: false,
        };
        setIsMousePanning(true);
      }
    }
  };

  // Deselect active signature and text when clicking background
  const handleContainerClick = (e: React.MouseEvent) => {
    if (mousePanRef.current.hasDragged) {
      mousePanRef.current.hasDragged = false;
      return;
    }
    if (e.target === containerRef.current || (e.target as HTMLElement).tagName === 'CANVAS') {
      onSelectSignature(null);
      if (onSelectText) onSelectText(null);
    }
  };

  // Filter items for current page
  const pageSignatures = signatures.filter((s) => s.pageNumber === pdfState.currentPage);
  const pageTextOverlays = textOverlays.filter((t) => t.pageNumber === pdfState.currentPage);
  const pageFormFields = formFields.filter((f) => f.pageNumber === pdfState.currentPage);

  const isZoomed =
    zoomLevel > 100 ||
    (containerRef.current
      ? containerRef.current.scrollWidth > containerRef.current.clientWidth + 10 ||
        containerRef.current.scrollHeight > containerRef.current.clientHeight + 10
      : false);

  const pageWidth = Math.round(renderedDimensions.width * (zoomLevel / 100));
  const pageHeight = Math.round(renderedDimensions.height * (zoomLevel / 100));

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 bg-slate-100 relative">
      {/* Top Floating Page Navigation & Zoom Toolbar (hidden in Reader Mode) */}
      {!isReaderMode && (
        <div className="shrink-0 bg-white/95 backdrop-blur border-b border-slate-200 px-2.5 sm:px-6 py-1.5 sm:py-2 flex items-center justify-between gap-1.5 sm:gap-2 shadow-xs z-10 overflow-x-auto no-scrollbar">
          {/* Left: Zoom Buttons, Reflow & Responsive Fit */}
          <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 shrink-0">
            {/* Eye Symbol (Reader Mode Toggle) replacing hand tool */}
            <button
              id="viewer-reader-mode-btn"
              onClick={() => onToggleReaderMode && onToggleReaderMode(true)}
              className="p-1 rounded-md text-slate-700 hover:bg-white hover:text-blue-600 hover:shadow-xs transition flex items-center gap-1 cursor-pointer"
              title="Enter Reader Mode: Turn off all headers and toolbars for a clean, distraction-free reading experience (Esc to exit)"
            >
              <Eye className="w-4 h-4" />
            </button>
            <span className="w-px h-3.5 bg-slate-300 mx-0.5" />
            <button
              onClick={handleZoomOut}
              className="p-1 rounded-md text-slate-600 hover:bg-white hover:shadow-xs transition cursor-pointer"
              title="Zoom Out (-20%)"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetZoom}
              className="text-xs font-mono font-semibold px-1 sm:px-1.5 text-slate-700 hover:text-blue-600 transition cursor-pointer"
              title="Reset Zoom to 100%"
            >
              {zoomLevel}%
            </button>
            <button
              onClick={handleZoomIn}
              className="p-1 rounded-md text-slate-600 hover:bg-white hover:shadow-xs transition cursor-pointer"
              title="Zoom In (+20%)"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <span className="w-px h-3.5 bg-slate-300 mx-0.5" />
            <button
              onClick={handleFitWidth}
              className="px-1.5 py-0.5 rounded-md text-[11px] font-medium text-slate-600 hover:bg-white hover:shadow-xs hover:text-slate-900 transition whitespace-nowrap cursor-pointer"
              title="Fit Page Width to Screen"
            >
              Fit Width
            </button>
            <button
              onClick={handleFitPage}
              className="p-1 rounded-md text-slate-600 hover:bg-white hover:shadow-xs hover:text-slate-900 transition cursor-pointer"
              title="Fit Entire Page in View"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <span className="w-px h-3.5 bg-slate-300 mx-0.5" />
            {/* Quick Reflow Text Toggle */}
            <button
              id="viewer-reflow-btn"
              onClick={() => setIsReflowMode((prev) => !prev)}
              className={`px-1.5 sm:px-2 py-0.5 rounded-md text-[11px] font-medium transition whitespace-nowrap flex items-center gap-1 cursor-pointer ${
                isReflowMode
                  ? 'bg-amber-100 text-amber-900 border border-amber-300 font-semibold'
                  : 'text-slate-600 hover:bg-white hover:shadow-xs hover:text-slate-900'
              }`}
              title={
                isReflowMode
                  ? 'Reflow active. Click to restore original fixed PDF page layout.'
                  : 'Reflow Text: Wrap and reflow PDF text dynamically to screen width when zoomed'
              }
            >
              <AlignLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isReflowMode ? 'Original' : 'Reflow'}</span>
            </button>
          </div>

          {/* Right: Page Turn Control, Undo/Redo, Add Text, Add Signature, and Pages Button */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Page Turn Control (Up/Down logic for downward reading flow, directly left of the undo/redo control) */}
            <div className="flex items-center gap-0.5 sm:gap-1 bg-white p-0.5 rounded-lg border border-slate-200 shadow-2xs">
              <button
                id="prev-page-btn"
                disabled={pdfState.currentPage <= 1 || isLoadingPage}
                onClick={() => onChangePage(pdfState.currentPage - 1)}
                className="py-1 sm:py-1.5 px-0.5 sm:px-1 rounded-md hover:bg-slate-50 disabled:opacity-35 disabled:hover:bg-transparent text-slate-700 transition cursor-pointer"
                title="Previous Page (Scroll Up)"
              >
                <ChevronUp className="w-4 h-4" />
              </button>

              <span
                id="page-indicator"
                className="text-xs sm:text-sm font-semibold text-slate-700 px-1 sm:px-1.5 py-0.5 select-none whitespace-nowrap"
              >
                Page <span className="text-blue-600 font-mono font-bold">{pdfState.currentPage}</span> of{' '}
                <span className="font-mono font-bold">{pdfState.numPages}</span>
              </span>

              <button
                id="next-page-btn"
                disabled={pdfState.currentPage >= pdfState.numPages || isLoadingPage}
                onClick={() => onChangePage(pdfState.currentPage + 1)}
                className="py-1 sm:py-1.5 px-0.5 sm:px-1 rounded-md hover:bg-slate-50 disabled:opacity-35 disabled:hover:bg-transparent text-slate-700 transition cursor-pointer"
                title="Next Page (Scroll Down)"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {/* Undo & Redo Controls */}
            <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
              <button
                id="viewer-undo-btn"
                disabled={!canUndo}
                onClick={onUndo}
                className="p-1.5 rounded-md text-slate-700 hover:bg-white hover:shadow-xs disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none transition flex items-center gap-1 cursor-pointer"
                title={
                  canUndo
                    ? `Undo ${undoActionName ? `"${undoActionName}"` : ''} (Ctrl+Z)`
                    : 'Nothing to undo'
                }
              >
                <Undo2 className="w-4 h-4" />
                <span className="sr-only sm:not-sr-only text-[11px] font-medium pr-0.5 hidden lg:inline text-slate-600">
                  Undo
                </span>
              </button>
              <button
                id="viewer-redo-btn"
                disabled={!canRedo}
                onClick={onRedo}
                className="p-1.5 rounded-md text-slate-700 hover:bg-white hover:shadow-xs disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:shadow-none transition flex items-center gap-1 cursor-pointer"
                title={
                  canRedo
                    ? `Redo ${redoActionName ? `"${redoActionName}"` : ''} (Ctrl+Y)`
                    : 'Nothing to redo'
                }
              >
                <Redo2 className="w-4 h-4" />
                <span className="sr-only sm:not-sr-only text-[11px] font-medium pr-0.5 hidden lg:inline text-slate-600">
                  Redo
                </span>
              </button>
            </div>

            {/* Add Text shortcut button (hidden on mobile, visible on desktop) */}
            {onOpenTextModal && (
              <button
                id="viewer-add-text-btn"
                onClick={onOpenTextModal}
                className="hidden sm:flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-medium shadow-2xs transition cursor-pointer"
                title="Add text overlay (Regular or Script font)"
              >
                <Type className="w-4 h-4 text-blue-600" />
                <span>Add Text</span>
              </button>
            )}

            {/* Add Signature shortcut button (hidden on mobile, visible on desktop) */}
            <button
              id="viewer-add-sig-btn"
              onClick={onOpenSignatureModal}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs sm:text-sm font-medium shadow-xs transition cursor-pointer"
              title="Add signature"
            >
              <Plus className="w-4 h-4" />
              <span>Add Signature</span>
            </button>

            {/* Pages button: in desktop view, sits only in the toolbar at the far right, after the add signature button (hidden on mobile) */}
            {onOpenPageManager && (
              <button
                id="desktop-manage-pages-btn"
                onClick={onOpenPageManager}
                className="hidden sm:flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 text-xs sm:text-sm font-semibold shadow-2xs transition cursor-pointer shrink-0"
                title="Page Controls: Add, delete, reorder, and rotate pages in 90° steps"
              >
                <LayoutGrid className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Pages</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Small Floating Controller Appearing in Reader Mode to Switch Back */}
      {isReaderMode && (
        <aside
          aria-label="Reader mode controls"
          id="floating-reader-mode-controls"
          className="fixed top-4 right-4 z-50 flex items-center gap-1.5 sm:gap-2 bg-slate-900/90 text-white p-1.5 sm:px-3 sm:py-1.5 rounded-full shadow-2xl backdrop-blur-md border border-white/20 animate-in fade-in duration-200"
        >
          {/* Small floating button to switch back */}
          <button
            id="floating-exit-reader-btn"
            onClick={() => onToggleReaderMode && onToggleReaderMode(false)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-xs font-semibold shadow-xs transition cursor-pointer"
            title="Exit Reader Mode and restore headers and toolbars (Esc)"
          >
            <EyeOff className="w-3.5 h-3.5" />
            <span>Exit</span>
          </button>

          <span className="w-px h-3.5 bg-white/20" />

          {/* Up / Down Page Navigation */}
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => onChangePage(pdfState.currentPage - 1)}
              disabled={pdfState.currentPage <= 1 || isLoadingPage}
              className="p-1 rounded-full hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
              title="Previous Page (Up)"
            >
              <ChevronUp className="w-3.5 h-3.5 text-slate-200" />
            </button>
            <span className="text-[11px] font-mono font-medium px-1 text-slate-200 select-none">
              {pdfState.currentPage} / {pdfState.numPages}
            </span>
            <button
              onClick={() => onChangePage(pdfState.currentPage + 1)}
              disabled={pdfState.currentPage >= pdfState.numPages || isLoadingPage}
              className="p-1 rounded-full hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
              title="Next Page (Down)"
            >
              <ChevronDown className="w-3.5 h-3.5 text-slate-200" />
            </button>
          </div>

          <span className="w-px h-3.5 bg-white/20" />

          {/* Reflow toggle in Reader mode */}
          <button
            onClick={() => setIsReflowMode((prev) => !prev)}
            className={`flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-full text-xs font-medium transition cursor-pointer ${
              isReflowMode
                ? 'bg-amber-400 text-slate-950 font-semibold'
                : 'text-slate-300 hover:text-white hover:bg-white/15'
            }`}
            title={
              isReflowMode
                ? 'Viewing reflowable text. Click for original layout.'
                : 'Reflow Text: Wrap text to screen width on high zoom'
            }
          >
            <AlignLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isReflowMode ? 'Original' : 'Reflow'}</span>
          </button>
        </aside>
      )}

      {/* Main PDF Scrollable Workspace */}
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        onMouseDown={handleMouseDown}
        className={`flex-1 min-h-0 overflow-auto relative select-none touch-auto overscroll-contain ${
          isPanToolActive || isSpacePressed
            ? isMousePanning
              ? 'cursor-grabbing'
              : 'cursor-grab'
            : isZoomed
              ? isMousePanning
                ? 'cursor-grabbing'
                : 'cursor-grab'
              : 'cursor-default'
        }`}
      >
        {/* Loading Spinner */}
        {isLoadingPage && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 backdrop-blur-xs">
            <div className="flex flex-col items-center gap-2 bg-white px-5 py-3 rounded-2xl shadow-xl border border-slate-200">
              <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
              <span className="text-xs font-semibold text-slate-700">Rendering Page {pdfState.currentPage}...</span>
            </div>
          </div>
        )}

        {/* Reflow Text View (when Reflow is enabled) */}
        {isReflowMode ? (
          <div className="w-full max-w-3xl mx-auto p-4 sm:p-8 pb-32">
            {isLoadingReflow ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-500">
                <Loader2 className="w-7 h-7 text-amber-600 animate-spin" />
                <span className="text-sm font-medium">Extracting and reflowing document text...</span>
              </div>
            ) : reflowData && reflowData.paragraphs.length > 0 ? (
              <div className="bg-white rounded-xl shadow-md border border-slate-200 p-6 sm:p-10 space-y-5 transition-all">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 text-xs text-slate-400">
                  <span>Page {pdfState.currentPage} of {pdfState.numPages} (Reflow Text Mode)</span>
                  <button
                    onClick={() => setIsReflowMode(false)}
                    className="text-blue-600 hover:underline cursor-pointer font-medium"
                  >
                    View Original Layout
                  </button>
                </div>
                <div
                  className="leading-relaxed text-slate-800 space-y-4 select-text"
                  style={{
                    fontSize: `${Math.max(15, Math.min(32, Math.round(17 * (zoomLevel / 100))))}px`,
                    lineHeight: '1.75',
                  }}
                >
                  {reflowData.paragraphs.map((p, idx) =>
                    p.isHeading ? (
                      <h3
                        key={idx}
                        className="font-bold text-slate-900 tracking-tight pt-2"
                        style={{
                          fontSize: `${Math.max(18, Math.min(38, Math.round(21 * (zoomLevel / 100))))}px`,
                        }}
                      >
                        {p.text}
                      </h3>
                    ) : (
                      <p key={idx} className="font-normal text-slate-800">
                        {p.text}
                      </p>
                    )
                  )}
                </div>

                {pdfState.numPages > 1 && (
                  <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
                    <button
                      disabled={pdfState.currentPage <= 1}
                      onClick={() => onChangePage(pdfState.currentPage - 1)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-30 text-xs font-medium text-slate-700 cursor-pointer"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>Previous Page</span>
                    </button>
                    <span className="text-xs font-mono text-slate-500">
                      {pdfState.currentPage} / {pdfState.numPages}
                    </span>
                    <button
                      disabled={pdfState.currentPage >= pdfState.numPages}
                      onClick={() => onChangePage(pdfState.currentPage + 1)}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-30 text-xs font-medium text-white cursor-pointer"
                    >
                      <span>Next Page</span>
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-md border border-slate-200 p-8 text-center space-y-3">
                <p className="text-slate-600 text-sm font-medium">
                  No extractable text found on page {pdfState.currentPage} (this page may be a scanned image or photo).
                </p>
                <button
                  onClick={() => setIsReflowMode(false)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 cursor-pointer"
                >
                  Return to Page View
                </button>
              </div>
            )}
          </div>
        ) : (
          /* Centering wrapper that allows full horizontal and vertical pan without clipping or cutoff */
          <div className="w-fit min-w-full min-h-full flex flex-col items-center justify-start p-4 sm:p-8 pb-40 sm:pb-44 pointer-events-none">
            {/* Scaled PDF Page Container with strict aspect ratio preservation and vertical swipe translation */}
            <motion.div
              animate={{
                y: swipeOffset,
              }}
              transition={
                isSwiping
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 450, damping: 35, mass: 0.8 }
              }
              style={{
                width: `${pageWidth}px`,
                height: `${pageHeight}px`,
              }}
              className="relative bg-white rounded shadow-xl border border-slate-300 origin-top shrink-0 select-none will-change-transform pointer-events-auto"
            >
              {/* Rendered PDF Page Canvas */}
              <canvas
                ref={canvasRef}
                style={{ width: '100%', height: '100%' }}
                className="block rounded"
              />

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

              {/* Interactive Overlays Layer (Text & Signatures - Unified non-blocking container) */}
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
            </motion.div>

            {/* Downward Reading Flow indicator & next page jump */}
            {pdfState.numPages > 1 && (
              <div className="mt-6 mb-2 pointer-events-auto flex flex-col items-center">
                {pdfState.currentPage < pdfState.numPages ? (
                  <button
                    onClick={() => {
                      onChangePage(pdfState.currentPage + 1);
                      if (containerRef.current) containerRef.current.scrollTop = 0;
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/95 hover:bg-white text-slate-700 hover:text-blue-600 shadow-sm border border-slate-200 text-xs font-semibold transition hover:shadow cursor-pointer"
                    title="Continue reading downward: Go to next page"
                  >
                    <span>Continue downward to Page {pdfState.currentPage + 1}</span>
                    <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                  </button>
                ) : (
                  <div className="text-[11px] text-slate-400 font-medium select-none">
                    End of Document ({pdfState.numPages} {pdfState.numPages === 1 ? 'Page' : 'Pages'})
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
