import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Plus,
  Eye,
  EyeOff,
  AlignLeft,
  Loader2,
  Undo2,
  Redo2,
  Type,
  LayoutGrid,
  BookOpen,
} from 'lucide-react';
import {
  SignatureItem,
  PdfDocumentState,
  TextOverlayItem,
  FormFieldItem,
  FormValuesState,
  PdfOutlineItem,
} from '../types';
import {
  extractPageReflowText,
  extractDocumentOutline,
  ReflowPageData,
} from '../utils/pdfEngine';
import { PdfPageView } from './PdfPageView';
import { TableOfContentsDrawer } from './TableOfContentsDrawer';
import { TextSelectionToolbar } from './TextSelectionToolbar';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const pageContainersRef = useRef<{ [pageNum: number]: HTMLDivElement | null }>({});

  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [renderedDimensions, setRenderedDimensions] = useState<{ width: number; height: number }>({
    width: pdfState.pageWidth || 595,
    height: pdfState.pageHeight || 842,
  });

  // Table of Contents state
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [isTocOpen, setIsTocOpen] = useState<boolean>(false);

  // Reflow Text state and cache
  const [isReflowMode, setIsReflowMode] = useState<boolean>(false);
  const [reflowData, setReflowData] = useState<ReflowPageData | null>(null);
  const [isLoadingReflow, setIsLoadingReflow] = useState<boolean>(false);
  const reflowCache = useRef<Map<number, ReflowPageData>>(new Map());

  // References to avoid stale closures in event listeners
  const zoomLevelRef = useRef<number>(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  const currentPageRef = useRef<number>(pdfState.currentPage);
  currentPageRef.current = pdfState.currentPage;

  const numPagesRef = useRef<number>(pdfState.numPages);
  numPagesRef.current = pdfState.numPages;

  const onChangePageRef = useRef(onChangePage);
  onChangePageRef.current = onChangePage;

  const isScrollingProgrammaticallyRef = useRef(false);

  // Mouse pan state
  const [isMousePanning, setIsMousePanning] = useState<boolean>(false);
  const [isSpacePressed, setIsSpacePressed] = useState<boolean>(false);
  const panStartRef = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number }>({
    x: 0,
    y: 0,
    scrollLeft: 0,
    scrollTop: 0,
  });

  // Extract Document Outline (TOC) on load
  useEffect(() => {
    if (!pdfState.arrayBuffer) return;
    let isCancelled = false;

    extractDocumentOutline(pdfState.arrayBuffer).then((extracted) => {
      if (!isCancelled) {
        setOutline(extracted);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [pdfState.arrayBuffer]);

  // Load reflowable text when reflow mode is active or current page changes
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
      .catch(() => {
        if (!isCancelled) {
          setIsLoadingReflow(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isReflowMode, pdfState.currentPage, pdfState.arrayBuffer]);

  // Smooth scroll to target page (continuous vertical rolling)
  const scrollToPage = useCallback(
    (pageNum: number, behavior: ScrollBehavior = 'smooth') => {
      const boundedPage = Math.max(1, Math.min(pdfState.numPages, pageNum));
      const targetEl = pageContainersRef.current[boundedPage];
      if (targetEl && containerRef.current) {
        isScrollingProgrammaticallyRef.current = true;
        targetEl.scrollIntoView({ behavior, block: 'start' });
        onChangePage(boundedPage);

        // Release programmatic lock after animation completes
        setTimeout(() => {
          isScrollingProgrammaticallyRef.current = false;
        }, 500);
      } else {
        onChangePage(boundedPage);
      }
    },
    [pdfState.numPages, onChangePage]
  );

  // Sync external page changes (e.g. Undo/Redo or page reordering)
  useEffect(() => {
    if (isScrollingProgrammaticallyRef.current) return;
    const targetEl = pageContainersRef.current[pdfState.currentPage];
    if (targetEl && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      // Only scroll if outside the comfortable visible window
      const isVisible =
        targetRect.top < containerRect.bottom - 80 && targetRect.bottom > containerRect.top + 80;
      if (!isVisible) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, [pdfState.currentPage]);

  // Track currently visible page during continuous vertical scrolling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (isScrollingProgrammaticallyRef.current) return;

        let bestPage = 0;
        let maxRatio = 0;

        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
            maxRatio = entry.intersectionRatio;
            const pNum = Number(entry.target.getAttribute('data-page-number'));
            if (pNum) bestPage = pNum;
          }
        }

        if (bestPage > 0 && bestPage !== currentPageRef.current) {
          onChangePageRef.current(bestPage);
        }
      },
      {
        root: container,
        threshold: [0.15, 0.4, 0.6, 0.85],
      }
    );

    for (let p = 1; p <= pdfState.numPages; p++) {
      const el = pageContainersRef.current[p];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [pdfState.numPages]);

  // Touch Pinch-to-Zoom, Safari Gestures, and Trackpad Ctrl+Wheel Zoom
  const pinchRef = useRef<{
    active: boolean;
    startDist: number;
    startZoom: number;
    centerX: number;
    centerY: number;
    startScrollLeft: number;
    startScrollTop: number;
  }>({
    active: false,
    startDist: 0,
    startZoom: 100,
    centerX: 0,
    centerY: 0,
    startScrollLeft: 0,
    startScrollTop: 0,
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        // Two fingers: Pinch to zoom
        e.preventDefault();
        const p1 = e.touches[0];
        const p2 = e.touches[1];
        const dist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
        const midX = (p1.clientX + p2.clientX) / 2;
        const midY = (p1.clientY + p2.clientY) / 2;
        const rect = container.getBoundingClientRect();

        pinchRef.current = {
          active: true,
          startDist: Math.max(10, dist),
          startZoom: zoomLevelRef.current,
          centerX: midX - rect.left,
          centerY: midY - rect.top,
          startScrollLeft: container.scrollLeft,
          startScrollTop: container.scrollTop,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current.active) {
        e.preventDefault();
        const p1 = e.touches[0];
        const p2 = e.touches[1];
        const dist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
        const scale = dist / pinchRef.current.startDist;
        const newZoom = Math.min(
          250,
          Math.max(35, Math.round(pinchRef.current.startZoom * scale))
        );

        if (newZoom !== zoomLevelRef.current) {
          const zoomRatio = newZoom / pinchRef.current.startZoom;
          container.scrollLeft =
            (pinchRef.current.startScrollLeft + pinchRef.current.centerX) * zoomRatio -
            pinchRef.current.centerX;
          container.scrollTop =
            (pinchRef.current.startScrollTop + pinchRef.current.centerY) * zoomRatio -
            pinchRef.current.centerY;
          setZoomLevel(newZoom);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        pinchRef.current.active = false;
      }
    };

    // Trackpad pinch-to-zoom (emits wheel events with ctrlKey: true)
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const currentZoom = zoomLevelRef.current;
        const factor = -e.deltaY * 0.4;
        const newZoom = Math.min(250, Math.max(35, Math.round(currentZoom + factor)));
        if (newZoom !== currentZoom) {
          const rect = container.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          const zoomRatio = newZoom / currentZoom;
          container.scrollLeft = (container.scrollLeft + mouseX) * zoomRatio - mouseX;
          container.scrollTop = (container.scrollTop + mouseY) * zoomRatio - mouseY;
          setZoomLevel(newZoom);
        }
      }
    };

    // Safari gestures
    const handleGestureStart = (e: any) => {
      e.preventDefault();
      pinchRef.current.active = true;
      pinchRef.current.startZoom = zoomLevelRef.current;
    };

    const handleGestureChange = (e: any) => {
      e.preventDefault();
      if (pinchRef.current.active) {
        const newZoom = Math.min(
          250,
          Math.max(35, Math.round(pinchRef.current.startZoom * e.scale))
        );
        setZoomLevel(newZoom);
      }
    };

    const handleGestureEnd = (e: any) => {
      e.preventDefault();
      pinchRef.current.active = false;
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('gesturestart', handleGestureStart as any, { passive: false });
    container.addEventListener('gesturechange', handleGestureChange as any, { passive: false });
    container.addEventListener('gestureend', handleGestureEnd as any, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('gesturestart', handleGestureStart as any);
      container.removeEventListener('gesturechange', handleGestureChange as any);
      container.removeEventListener('gestureend', handleGestureEnd as any);
    };
  }, []);

  // Spacebar pan detection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.code === 'Space' && !e.repeat && !isSpacePressed) {
        e.preventDefault();
        setIsSpacePressed(true);
      } else if (e.key === 'Escape') {
        if (isTocOpen) {
          setIsTocOpen(false);
        } else if (isReaderMode && onToggleReaderMode) {
          onToggleReaderMode(false);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setIsMousePanning(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isSpacePressed, isTocOpen, isReaderMode, onToggleReaderMode]);

  // Mouse pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('[data-signature-overlay]') ||
      target.closest('[data-text-overlay]') ||
      target.closest('[data-form-field]') ||
      target.closest('button') ||
      target.closest('a')
    ) {
      return;
    }

    if (e.button === 1 || isSpacePressed) {
      e.preventDefault();
      setIsMousePanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: containerRef.current?.scrollLeft || 0,
        scrollTop: containerRef.current?.scrollTop || 0,
      };
    }
  };

  useEffect(() => {
    if (!isMousePanning) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      containerRef.current.scrollLeft = panStartRef.current.scrollLeft - dx;
      containerRef.current.scrollTop = panStartRef.current.scrollTop - dy;
    };

    const handleMouseUp = () => {
      setIsMousePanning(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isMousePanning]);

  // Zoom helpers
  const handleZoomIn = () => setZoomLevel((prev) => Math.min(250, prev + 20));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(35, prev - 20));
  const handleResetZoom = () => setZoomLevel(100);

  const handleFitWidth = () => {
    if (!containerRef.current) return;
    const padding = 48;
    const availableWidth = containerRef.current.clientWidth - padding;
    if (availableWidth > 0 && renderedDimensions.width > 0) {
      const calculatedZoom = Math.round((availableWidth / renderedDimensions.width) * 100);
      setZoomLevel(Math.min(200, Math.max(35, calculatedZoom)));
    }
  };

  const handleFitPage = () => {
    if (!containerRef.current) return;
    const padding = 64;
    const availableHeight = containerRef.current.clientHeight - padding;
    if (availableHeight > 0 && renderedDimensions.height > 0) {
      const calculatedZoom = Math.round((availableHeight / renderedDimensions.height) * 100);
      setZoomLevel(Math.min(150, Math.max(35, calculatedZoom)));
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      !target.closest('[data-signature-overlay]') &&
      !target.closest('[data-text-overlay]') &&
      !target.closest('button') &&
      !target.closest('a')
    ) {
      onSelectSignature(null);
      if (onSelectText) onSelectText(null);
    }
  };

  const pageWidth = Math.round(renderedDimensions.width * (zoomLevel / 100));
  const pageHeight = Math.round(renderedDimensions.height * (zoomLevel / 100));

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 bg-slate-100 relative">
      {/* Top Floating Page Navigation & Zoom Toolbar (hidden in Reader Mode) */}
      {!isReaderMode && (
        <div className="shrink-0 bg-white/95 backdrop-blur border-b border-slate-200 px-2.5 sm:px-6 py-1.5 sm:py-2 flex items-center justify-between gap-1.5 sm:gap-2 shadow-xs z-30 overflow-x-auto no-scrollbar">
          {/* Left: Eye (Reader Mode), Zoom, TOC, Reflow */}
          <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200 shrink-0">
            {/* Eye Symbol (Reader Mode Toggle) */}
            <button
              id="viewer-reader-mode-btn"
              onClick={() => onToggleReaderMode && onToggleReaderMode(true)}
              className="p-1 rounded-md text-slate-700 hover:bg-white hover:text-blue-600 hover:shadow-xs transition flex items-center gap-1 cursor-pointer"
              title="Enter Reader Mode: Turn off all headers and toolbars for a clean reading experience (Esc to exit)"
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

            {/* Table of Contents Button */}
            <button
              id="viewer-toc-btn"
              onClick={() => setIsTocOpen(true)}
              className="px-1.5 sm:px-2 py-0.5 rounded-md text-[11px] font-medium text-slate-700 hover:bg-white hover:shadow-xs hover:text-blue-600 transition whitespace-nowrap flex items-center gap-1 cursor-pointer"
              title="Table of Contents: Jump to chapters or sections"
            >
              <BookOpen className="w-3.5 h-3.5 text-blue-600" />
              <span className="hidden sm:inline">Contents</span>
            </button>

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
                  : 'Reflow Text: Wrap and reflow PDF text dynamically to screen width'
              }
            >
              <AlignLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isReflowMode ? 'Original' : 'Reflow'}</span>
            </button>
          </div>

          {/* Right: Page Turn Control, Undo/Redo, Add Text, Add Signature, and Pages Button */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Page Turn Control (Up/Down logic for downward reading flow, directly left of undo/redo) */}
            <div className="flex items-center gap-0.5 sm:gap-1 bg-white p-0.5 rounded-lg border border-slate-200 shadow-2xs">
              <button
                id="prev-page-btn"
                disabled={pdfState.currentPage <= 1}
                onClick={() => scrollToPage(pdfState.currentPage - 1)}
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
                disabled={pdfState.currentPage >= pdfState.numPages}
                onClick={() => scrollToPage(pdfState.currentPage + 1)}
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
              onClick={() => scrollToPage(pdfState.currentPage - 1)}
              disabled={pdfState.currentPage <= 1}
              className="p-1 rounded-full hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
              title="Previous Page (Up)"
            >
              <ChevronUp className="w-3.5 h-3.5 text-slate-200" />
            </button>
            <span className="text-[11px] font-mono font-medium px-1 text-slate-200 select-none">
              {pdfState.currentPage} / {pdfState.numPages}
            </span>
            <button
              onClick={() => scrollToPage(pdfState.currentPage + 1)}
              disabled={pdfState.currentPage >= pdfState.numPages}
              className="p-1 rounded-full hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent transition cursor-pointer"
              title="Next Page (Down)"
            >
              <ChevronDown className="w-3.5 h-3.5 text-slate-200" />
            </button>
          </div>

          <span className="w-px h-3.5 bg-white/20" />

          {/* Table of Contents trigger in Reader mode */}
          <button
            onClick={() => setIsTocOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-slate-300 hover:text-white hover:bg-white/15 transition cursor-pointer"
            title="Table of Contents: Jump to chapters"
          >
            <BookOpen className="w-3.5 h-3.5 text-blue-400" />
            <span className="hidden sm:inline">Contents</span>
          </button>

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
                : 'Reflow Text: Wrap text to screen width'
            }
          >
            <AlignLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{isReflowMode ? 'Original' : 'Reflow'}</span>
          </button>
        </aside>
      )}

      {/* Main PDF Scrollable Workspace with Continuous Page Rolling */}
      <div
        ref={containerRef}
        onClick={handleContainerClick}
        onMouseDown={handleMouseDown}
        className={`flex-1 min-h-0 overflow-y-auto overflow-x-auto relative select-none touch-pan-x touch-pan-y overscroll-contain ${
          pinchRef.current?.active ? 'scroll-auto' : 'scroll-smooth'
        } ${
          isSpacePressed || isMousePanning ? (isMousePanning ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        }`}
      >
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
                  <span>
                    Page {pdfState.currentPage} of {pdfState.numPages} (Reflow Text Mode)
                  </span>
                  <button
                    onClick={() => setIsReflowMode(false)}
                    className="text-blue-600 hover:underline cursor-pointer font-medium"
                  >
                    View Original Layout
                  </button>
                </div>
                {/* Refined Reflow Typography: restrained headings, comfortable line-height, no crazy bolding */}
                <div className="space-y-4 select-text">
                  {reflowData.paragraphs.map((p, idx) =>
                    p.isHeading ? (
                      <h3
                        key={idx}
                        className="font-semibold text-slate-900 tracking-tight mt-6 mb-2"
                        style={{
                          fontSize: `${Math.max(16, Math.min(22, Math.round(18 * (zoomLevel / 100))))}px`,
                        }}
                      >
                        {p.text}
                      </h3>
                    ) : (
                      <p
                        key={idx}
                        className="font-normal text-slate-700 leading-relaxed"
                        style={{
                          fontSize: `${Math.max(14, Math.min(18, Math.round(16 * (zoomLevel / 100))))}px`,
                          lineHeight: '1.75',
                        }}
                      >
                        {p.text}
                      </p>
                    )
                  )}
                </div>

                {pdfState.numPages > 1 && (
                  <div className="pt-6 border-t border-slate-100 flex items-center justify-between">
                    <button
                      disabled={pdfState.currentPage <= 1}
                      onClick={() => scrollToPage(pdfState.currentPage - 1)}
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
                      onClick={() => scrollToPage(pdfState.currentPage + 1)}
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
          /* Continuous Vertical Page Roll Stack - Seamless downward scrolling without manual boundary stops */
          <div className="w-fit min-w-full min-h-full flex flex-col items-center justify-start p-4 sm:p-8 pb-32 space-y-6">
            {Array.from({ length: pdfState.numPages }, (_, i) => i + 1).map((pageNum) => (
              <div
                key={pageNum}
                ref={(el) => {
                  pageContainersRef.current[pageNum] = el;
                }}
                data-page-number={pageNum}
                className="flex flex-col items-center"
              >
                <PdfPageView
                  pageNumber={pageNum}
                  arrayBuffer={pdfState.arrayBuffer!}
                  zoomLevel={zoomLevel}
                  pageWidth={pageWidth}
                  pageHeight={pageHeight}
                  signatures={signatures}
                  selectedSignatureId={selectedSignatureId}
                  textOverlays={textOverlays}
                  selectedTextId={selectedTextId}
                  formFields={formFields}
                  formValues={formValues}
                  onSelectSignature={onSelectSignature}
                  onUpdateSignature={onUpdateSignature}
                  onCommitUpdateSignature={onCommitUpdateSignature}
                  onDeleteSignature={onDeleteSignature}
                  onDuplicateSignature={onDuplicateSignature}
                  onSelectText={onSelectText}
                  onUpdateText={onUpdateText}
                  onCommitUpdateText={onCommitUpdateText}
                  onDeleteText={onDeleteText}
                  onDuplicateText={onDuplicateText}
                  onFormFieldChange={onFormFieldChange}
                  onCommitFormField={onCommitFormField}
                  onResetForm={onResetForm}
                  onNavigateToPage={scrollToPage}
                  isCurrentPage={pageNum === pdfState.currentPage}
                />
                {/* Subtle page indicator between pages */}
                <div className="mt-2 text-[10px] font-mono text-slate-400 select-none">
                  Page {pageNum} of {pdfState.numPages}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Table of Contents Drawer */}
      <TableOfContentsDrawer
        isOpen={isTocOpen}
        onClose={() => setIsTocOpen(false)}
        outline={outline}
        currentPage={pdfState.currentPage}
        onSelectPage={(targetPage) => scrollToPage(targetPage)}
      />

      {/* Floating Toolbar for Selected/Marked Text */}
      <TextSelectionToolbar />
    </div>
  );
};
