import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
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
  Check,
  Search,
} from 'lucide-react';
import {
  SignatureItem,
  PdfDocumentState,
  TextOverlayItem,
  FormFieldItem,
  FormValuesState,
  PdfOutlineItem,
  PageInfo,
} from '../types';
import {
  extractPageReflowText,
  extractDocumentOutline,
  getPageInfoList,
  loadPdfJsDoc,
  ReflowPageData,
} from '../utils/pdfEngine';
import { PdfPageView } from './PdfPageView';
import { TableOfContentsDrawer } from './TableOfContentsDrawer';
import { TextSelectionToolbar } from './TextSelectionToolbar';
import { PdfSearchPanel } from './PdfSearchPanel';
import { isNativeAndroid } from '../utils/nativeBridge';
import { computeFitWidthZoom } from '../utils/pdfZoom';
import { selectionTouchesPdfTextLayer } from '../utils/pdfSelection';
import type { PdfSearchHit } from '../utils/pdfSearch';
import { extractViewportPageSnapshot, type ViewportPageSnapshot } from '../utils/pdfPlacement';
import { MobileReaderTopBar } from './mobile/MobileReaderTopBar';
import { MobileFloatingPill } from './mobile/MobileFloatingPill';
import { MobilePageGridBottomSheet } from './mobile/MobilePageGridBottomSheet';
import { useImmersiveNavigation } from '../hooks/useImmersiveNavigation';

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
  onRegisterViewportSnapshotGetter?: (getter: (() => ViewportPageSnapshot | null) | null) => void;
  isMobile?: boolean;
  isToolActive?: boolean;
  isSaved?: boolean;
  onBack?: () => void;
  onQuickPrint?: () => void;
  onQuickShare?: () => void;
  onOpenFile?: () => void;
  onOpenRecent?: () => void;
  onOpenDiagnostics?: () => void;
  onControlsVisibilityChange?: (isVisible: boolean) => void;
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
  onRegisterViewportSnapshotGetter,
  isMobile = false,
  isToolActive = false,
  isSaved = true,
  onBack,
  onQuickPrint,
  onQuickShare,
  onOpenFile,
  onOpenRecent,
  onOpenDiagnostics,
  onControlsVisibilityChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const pageContainersRef = useRef<{ [pageNum: number]: HTMLDivElement | null }>({});

  const [renderedDimensions, setRenderedDimensions] = useState<{ width: number; height: number }>({
    width: pdfState.pageWidth || 595,
    height: pdfState.pageHeight || 842,
  });
  const [pageInfos, setPageInfos] = useState<PageInfo[]>([]);
  const [focusedPageSize, setFocusedPageSize] = useState<{
    document: ArrayBuffer; pageNumber: number; width: number;
  } | null>(null);

  // Resolve the focused page directly: do not wait for metadata for hundreds
  // of other pages before fitting an individual landscape/portrait page.
  useEffect(() => {
    const data = pdfState.arrayBuffer;
    if (!data) return;
    let cancelled = false;
    loadPdfJsDoc(data)
      .then((doc) => doc.getPage(pdfState.currentPage))
      .then((page) => {
        if (!cancelled) {
          setFocusedPageSize({
            document: data,
            pageNumber: pdfState.currentPage,
            width: page.getViewport({ scale: 1 }).width,
          });
        }
      })
      .catch((err) => console.warn('Could not determine focused page width:', err));
    return () => { cancelled = true; };
  }, [pdfState.arrayBuffer, pdfState.currentPage]);

  // Every page has its own dimensions and rotation. Load metadata independently
  // from canvas rendering so mixed A4/landscape documents lay out correctly.
  useEffect(() => {
    let cancelled = false;
    setPageInfos([]);
    if (!pdfState.arrayBuffer) return;
    getPageInfoList(pdfState.arrayBuffer).then((infos) => {
      if (!cancelled) setPageInfos(infos);
    }).catch((err) => console.warn('Page metadata unavailable:', err));
    return () => { cancelled = true; };
  }, [pdfState.arrayBuffer]);

  // Calculate fit-width zoom percentage based on current container or window width
  const calculateFitWidthZoom = useCallback(
    (pageNumber: number = pdfState.currentPage, customWidth?: number) => {
      const container = containerRef.current;
      const clientWidth =
        customWidth || (container && container.clientWidth > 0 ? container.clientWidth : window.innerWidth);
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;
      // Account for container padding (p-4 = 32px on mobile, p-8 = 64px on desktop) + comfortable breathing room
      const horizontalMargin = isMobile ? 32 : 72;
      const availableWidth = clientWidth - horizontalMargin;
      const pageWidth = pageInfos[pageNumber - 1]?.width;
      const focusedWidth = focusedPageSize?.document === pdfState.arrayBuffer &&
        focusedPageSize.pageNumber === pageNumber ? focusedPageSize.width : undefined;
      const baseWidth = pageWidth || focusedWidth || pdfState.pageWidth || renderedDimensions.width || 595;

      return computeFitWidthZoom(availableWidth, baseWidth);
    },
    [pdfState.currentPage, pdfState.arrayBuffer, pdfState.pageWidth, pageInfos, focusedPageSize, renderedDimensions.width]
  );

  // Calculate fit-page zoom percentage so the entire page fits both width and height with margins
  const calculateFitPageZoom = useCallback(
    (pageNumber: number = pdfState.currentPage, customWidth?: number, customHeight?: number) => {
      const container = containerRef.current;
      const clientWidth =
        customWidth || (container && container.clientWidth > 0 ? container.clientWidth : (typeof window !== 'undefined' ? window.innerWidth : 800));
      const clientHeight =
        customHeight || (container && container.clientHeight > 0 ? container.clientHeight : (typeof window !== 'undefined' ? window.innerHeight : 600));

      const isMobileDevice = typeof window !== 'undefined' && window.innerWidth < 768;
      const horizontalMargin = isMobileDevice ? 24 : 64;
      const verticalMargin = isMobileDevice ? 48 : 64;

      const availableWidth = Math.max(100, clientWidth - horizontalMargin);
      const availableHeight = Math.max(100, clientHeight - verticalMargin);

      const pageInfo = pageInfos[pageNumber - 1];
      const focusedWidth =
        focusedPageSize?.document === pdfState.arrayBuffer &&
        focusedPageSize.pageNumber === pageNumber
          ? focusedPageSize.width
          : undefined;
      const baseWidth = pageInfo?.width || focusedWidth || pdfState.pageWidth || renderedDimensions.width || 595;
      const baseHeight = pageInfo?.height || pdfState.pageHeight || renderedDimensions.height || 842;

      const scaleX = (availableWidth / baseWidth) * 100;
      const scaleY = (availableHeight / baseHeight) * 100;
      const fitZoom = Math.min(scaleX, scaleY);

      return Math.min(500, Math.max(35, Math.round(fitZoom)));
    },
    [pdfState.currentPage, pdfState.arrayBuffer, pdfState.pageWidth, pdfState.pageHeight, pageInfos, focusedPageSize, renderedDimensions.width, renderedDimensions.height]
  );

  // Always open in "fit page" (Ganze Seite) mode by default, centered on page 1
  const [isFitWidthMode, setIsFitWidthMode] = useState<boolean>(false);
  const [isZoomMenuOpen, setIsZoomMenuOpen] = useState<boolean>(false);
  const zoomMenuRef = useRef<HTMLDivElement>(null);

  const [zoomLevel, setZoomLevel] = useState<number>(() => {
    if (typeof window === 'undefined') return 100;
    const isMobileDevice = window.innerWidth < 768;
    const horizontalMargin = isMobileDevice ? 24 : 64;
    const verticalMargin = isMobileDevice ? 48 : 64;
    const availableWidth = Math.max(100, window.innerWidth - horizontalMargin);
    const availableHeight = Math.max(100, window.innerHeight - verticalMargin);
    const baseWidth = pdfState.pageWidth || 595;
    const baseHeight = pdfState.pageHeight || 842;
    const scaleX = (availableWidth / baseWidth) * 100;
    const scaleY = (availableHeight / baseHeight) * 100;
    return Math.min(500, Math.max(35, Math.round(Math.min(scaleX, scaleY))));
  });

  // Reflow mode must be declared before search navigation callbacks.
  const [isReflowMode, setIsReflowMode] = useState<boolean>(false);

  // Table of Contents state
  const [outline, setOutline] = useState<PdfOutlineItem[]>([]);
  const [isTocOpen, setIsTocOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const [activeSearchMatch, setActiveSearchMatch] = useState<{
    pageNumber: number; query: string; ordinal: number;
  } | null>(null);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setActiveSearchMatch(null);
  }, []);

  const handleSearchHit = useCallback((hit: PdfSearchHit, phrase: string) => {
    setActiveSearchMatch({ pageNumber: hit.pageNumber, query: phrase, ordinal: hit.ordinal });
    if (isReflowMode) {
      setIsReflowMode(false);
      // Restore the ordinary page DOM before positioning the search result.
      onChangePage(hit.pageNumber);
      requestAnimationFrame(() => scrollToPageRef.current?.(hit.pageNumber));
    } else {
      scrollToPageRef.current?.(hit.pageNumber);
    }
  }, [isReflowMode, onChangePage]);

  const scrollToPageRef = useRef<((page: number) => void) | null>(null);

  // Ctrl/Cmd+F searches the PDF text instead of the surrounding browser UI.
  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setIsSearchOpen(true);
      } else if (event.key === 'Escape' && isSearchOpen) {
        closeSearch();
      }
    };
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, [isSearchOpen, closeSearch]);

  // Reflow Text state and cache
  const [reflowData, setReflowData] = useState<ReflowPageData | null>(null);
  const [isLoadingReflow, setIsLoadingReflow] = useState<boolean>(false);
  const reflowCache = useRef<Map<number, ReflowPageData>>(new Map());

  // Zoom Anchor representation: pins a normalized coordinate within a page to a viewport position
  interface ZoomAnchor {
    pageNumber: number;
    pctX: number;
    pctY: number;
    viewportX: number;
    viewportY: number;
  }

  // References to avoid stale closures in event listeners
  const zoomLevelRef = useRef<number>(zoomLevel);
  zoomLevelRef.current = zoomLevel;

  const currentPageRef = useRef<number>(pdfState.currentPage);
  currentPageRef.current = pdfState.currentPage;

  const numPagesRef = useRef<number>(pdfState.numPages);
  numPagesRef.current = pdfState.numPages;

  const onChangePageRef = useRef(onChangePage);
  onChangePageRef.current = onChangePage;

  // Android's native selection handles can temporarily collapse or move their
  // DOM endpoints. Keep a short, side-effect-free grace period so a momentary
  // selectionchange does not trigger a fit-width zoom or focus re-render.
  const lastPdfSelectionAtRef = useRef(0);
  const hasNativePdfSelection = useCallback(() => {
    if (!isNativeAndroid()) return false;
    const active = selectionTouchesPdfTextLayer(
      window.getSelection(), containerRef.current,
    );
    if (active) lastPdfSelectionAtRef.current = Date.now();
    return active ||
      (lastPdfSelectionAtRef.current > 0 &&
       Date.now() - lastPdfSelectionAtRef.current < 600);
  }, []);

  useEffect(() => {
    if (!isNativeAndroid()) return;
    const recordSelection = () => {
      if (selectionTouchesPdfTextLayer(window.getSelection(), containerRef.current)) {
        lastPdfSelectionAtRef.current = Date.now();
      }
    };
    document.addEventListener('selectionchange', recordSelection);
    return () => document.removeEventListener('selectionchange', recordSelection);
  }, []);

  const isScrollingProgrammaticallyRef = useRef(false);
  const lastReportedPageRef = useRef<number>(pdfState.currentPage);
  const pendingZoomAnchorRef = useRef<ZoomAnchor | null>(null);

  // Capture the document page and intra-page offset at a given viewport coordinate
  const captureZoomAnchor = useCallback((viewportX: number, viewportY: number): ZoomAnchor | null => {
    const container = containerRef.current;
    if (!container) return null;
    const containerRect = container.getBoundingClientRect();
    const absoluteTargetY = containerRect.top + viewportY;
    const absoluteTargetX = containerRect.left + viewportX;

    let targetPageNum = currentPageRef.current || 1;
    let bestDistance = Infinity;

    for (let p = 1; p <= numPagesRef.current; p++) {
      const el = pageContainersRef.current[p];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (absoluteTargetY >= r.top && absoluteTargetY <= r.bottom) {
        targetPageNum = p;
        bestDistance = 0;
        break;
      }
      const pageMidY = (r.top + r.bottom) / 2;
      const dist = Math.abs(absoluteTargetY - pageMidY);
      if (dist < bestDistance) {
        bestDistance = dist;
        targetPageNum = p;
      }
    }

    const targetEl = pageContainersRef.current[targetPageNum];
    if (!targetEl) {
      return {
        pageNumber: targetPageNum,
        pctX: 0.5,
        pctY: 0.5,
        viewportX,
        viewportY,
      };
    }

    const pageRect = targetEl.getBoundingClientRect();
    const pctX = pageRect.width > 0
      ? Math.max(0, Math.min(1, (absoluteTargetX - pageRect.left) / pageRect.width))
      : 0.5;
    const pctY = pageRect.height > 0
      ? Math.max(0, Math.min(1, (absoluteTargetY - pageRect.top) / pageRect.height))
      : 0.5;

    return {
      pageNumber: targetPageNum,
      pctX,
      pctY,
      viewportX,
      viewportY,
    };
  }, []);

  // Provide live viewport page & visible area snapshot for centered signature/text placement
  const getViewportSnapshot = useCallback((): ViewportPageSnapshot | null => {
    const container = containerRef.current;
    if (!container || isReflowMode) return null;
    const containerRect = container.getBoundingClientRect();
    const pageRects: Array<{ pageNumber: number; rect: DOMRect }> = [];
    for (let p = 1; p <= numPagesRef.current; p++) {
      const el = pageContainersRef.current[p];
      if (!el) continue;
      pageRects.push({
        pageNumber: p,
        rect: el.getBoundingClientRect(),
      });
    }
    return extractViewportPageSnapshot(containerRect, pageRects, currentPageRef.current || 1);
  }, [isReflowMode]);

  useEffect(() => {
    if (!onRegisterViewportSnapshotGetter) return;
    onRegisterViewportSnapshotGetter(getViewportSnapshot);
    return () => {
      onRegisterViewportSnapshotGetter(null);
    };
  }, [onRegisterViewportSnapshotGetter, getViewportSnapshot]);

  // Automatically reset to "fit page" (Ganze Seite) mode and cleanly center page 1 whenever a new file is opened
  const lastOpenedDocRef = useRef<string>('');
  useEffect(() => {
    const docId = pdfState.name || String(pdfState.arrayBuffer?.byteLength || '');
    if (!docId) return;

    if (lastOpenedDocRef.current !== docId) {
      lastOpenedDocRef.current = docId;
      setIsFitWidthMode(false);

      if (pdfState.pageWidth && pdfState.pageHeight) {
        setRenderedDimensions({
          width: pdfState.pageWidth,
          height: pdfState.pageHeight,
        });
      }

      // Immediately apply fit-page zoom for page 1
      const initialFit = calculateFitPageZoom(1);
      setZoomLevel(initialFit);

      // Cleanly reset container scroll position to top
      if (containerRef.current) {
        containerRef.current.scrollTop = 0;
        containerRef.current.scrollLeft = 0;
      }
      if (pdfState.currentPage !== 1) {
        onChangePage(1);
      }

      // Re-measure after layout has rendered to ensure exact pixel fit and centering
      const timer = setTimeout(() => {
        const measuredFit = calculateFitPageZoom(1);
        if (measuredFit) {
          setZoomLevel(measuredFit);
        }
        if (containerRef.current) {
          containerRef.current.scrollTop = 0;
          containerRef.current.scrollLeft = 0;
        }
      }, 75);

      return () => clearTimeout(timer);
    }
  }, [pdfState.name, pdfState.arrayBuffer, pdfState.pageWidth, pdfState.pageHeight, pdfState.currentPage, calculateFitPageZoom, onChangePage]);

  // When the reading focus moves to a page of different width, recompute
  // automatically, preserving the reading line rather than jumping to page 1.
  useEffect(() => {
    if (!isFitWidthMode || isReflowMode || hasNativePdfSelection()) return;
    const fitZoom = calculateFitWidthZoom(pdfState.currentPage);
    if (fitZoom === zoomLevelRef.current) return;
    const container = containerRef.current;
    if (container) {
      const readingY = Math.min(220, container.clientHeight * 0.35);
      pendingZoomAnchorRef.current = captureZoomAnchor(container.clientWidth / 2, readingY);
    }
    setZoomLevel(fitZoom);
  }, [isFitWidthMode, isReflowMode, pdfState.currentPage, calculateFitWidthZoom, captureZoomAnchor, hasNativePdfSelection]);

  // Keep view fitted to width on screen resize or mobile rotation if fit-width mode is active
  useEffect(() => {
    if (!isFitWidthMode) return;

    const handleResize = () => {
      // Android selection handles can cause visualViewport/layout fluctuations.
      // Never change the PDF's text geometry in the middle of a range drag.
      if (hasNativePdfSelection()) return;
      if (containerRef.current) {
        const centerX = containerRef.current.clientWidth / 2;
        const centerY = containerRef.current.clientHeight / 2;
        pendingZoomAnchorRef.current = captureZoomAnchor(centerX, centerY);
      }
      const fitZoom = calculateFitWidthZoom();
      setZoomLevel(fitZoom);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isFitWidthMode, calculateFitWidthZoom, captureZoomAnchor, hasNativePdfSelection]);

  // Close zoom preset dropdown when clicking outside or pressing Escape
  useEffect(() => {
    if (!isZoomMenuOpen) return;
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (zoomMenuRef.current && !zoomMenuRef.current.contains(e.target as Node)) {
        setIsZoomMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsZoomMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isZoomMenuOpen]);

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

  // Scroll to target page (continuous vertical rolling with precision offset and settle-lock)
  const scrollToPage = useCallback(
    (pageNum: number, behavior: ScrollBehavior = 'auto') => {
      const boundedPage = Math.max(1, Math.min(pdfState.numPages, pageNum));
      const targetEl = pageContainersRef.current[boundedPage];
      const container = containerRef.current;

      if (targetEl && container) {
        isScrollingProgrammaticallyRef.current = true;
        lastReportedPageRef.current = boundedPage;
        currentPageRef.current = boundedPage;
        onChangePage(boundedPage);

        const containerRect = container.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const currentScrollTop = container.scrollTop;
        const targetScrollTop = Math.max(0, currentScrollTop + (targetRect.top - containerRect.top) - 16);

        // For large jump distances (> 2500px, common in long documents), use instant jump to avoid browser clamp/stall
        const distance = Math.abs(targetScrollTop - currentScrollTop);
        const actualBehavior = behavior === 'smooth' && distance > 2500 ? 'auto' : behavior;

        container.scrollTo({
          top: targetScrollTop,
          behavior: actualBehavior,
        });

        if (actualBehavior === 'auto') {
          setTimeout(() => {
            isScrollingProgrammaticallyRef.current = false;
          }, 150);
        } else {
          // Monitor for scroll completion instead of an arbitrary timer
          let lastTop = container.scrollTop;
          let settledFrames = 0;
          const checkScrollEnd = () => {
            if (!containerRef.current) {
              isScrollingProgrammaticallyRef.current = false;
              return;
            }
            const currentTop = containerRef.current.scrollTop;
            if (Math.abs(currentTop - lastTop) < 2) {
              settledFrames++;
            } else {
              settledFrames = 0;
              lastTop = currentTop;
            }
            if (settledFrames >= 4) {
              isScrollingProgrammaticallyRef.current = false;
            } else {
              requestAnimationFrame(checkScrollEnd);
            }
          };
          requestAnimationFrame(checkScrollEnd);
          // Safety failsafe
          setTimeout(() => {
            isScrollingProgrammaticallyRef.current = false;
          }, 3500);
        }
      } else {
        onChangePage(boundedPage);
      }
    },
    [pdfState.numPages, onChangePage]
  );

  scrollToPageRef.current = (page: number) => scrollToPage(page, 'auto');

  // Sync external page changes (e.g. Undo/Redo or page reordering)
  useEffect(() => {
    if (isScrollingProgrammaticallyRef.current) return;
    if (lastReportedPageRef.current === pdfState.currentPage) {
      return;
    }
    lastReportedPageRef.current = pdfState.currentPage;
    scrollToPage(pdfState.currentPage, 'auto');
  }, [pdfState.currentPage, scrollToPage]);

  // Track currently visible page during continuous vertical scrolling
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const visiblePages = new Map<number, Element>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const page = Number(entry.target.getAttribute('data-page-number'));
          if (entry.isIntersecting) visiblePages.set(page, entry.target);
          else visiblePages.delete(page);
        }
        if (isScrollingProgrammaticallyRef.current || pinchRef.current?.active) return;

        // PDF.js text positions must remain fixed while Android selection
        // handles are dragged. Avoid auto page focus / fit-width changes.
        if (hasNativePdfSelection()) return;

        let candidatePage = 0;
        let bestScore = -Infinity;
        const rootRect = container.getBoundingClientRect();
        const readingLine = rootRect.top + Math.min(220, rootRect.height * 0.35);

        // IntersectionObserver only reports *changed* entries. Keep the small
        // visible set so a stale threshold event cannot steal reading focus.
        for (const [page, element] of visiblePages) {
          const rect = element.getBoundingClientRect();
          const intersection = Math.max(0, Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top));
          if (intersection <= 0) continue;
          const coversLine = rect.top <= readingLine && rect.bottom >= readingLine;
          const score = (coversLine ? 100 : 0) + intersection / Math.max(1, rect.height);
          if (score > bestScore) {
            bestScore = score;
            candidatePage = page;
          }
        }

        if (candidatePage > 0 && candidatePage !== currentPageRef.current) {
          lastReportedPageRef.current = candidatePage;
          currentPageRef.current = candidatePage;
          onChangePageRef.current(candidatePage);
        }
      },
      {
        root: container,
        threshold: [0.1, 0.3, 0.5, 0.8],
      }
    );

    for (let p = 1; p <= pdfState.numPages; p++) {
      const el = pageContainersRef.current[p];
      if (el) observer.observe(el);
    }

    return () => observer.disconnect();
  }, [pdfState.numPages, hasNativePdfSelection]);

  // Restore exact scroll position after zoomLevel changes using the captured anchor
  useLayoutEffect(() => {
    if (!pendingZoomAnchorRef.current || !containerRef.current) return;
    const anchor = pendingZoomAnchorRef.current;
    pendingZoomAnchorRef.current = null;

    const targetEl = pageContainersRef.current[anchor.pageNumber];
    const container = containerRef.current;
    if (!targetEl || !container) return;

    // Suppress scroll listener and observer while adjusting position
    isScrollingProgrammaticallyRef.current = true;

    // Clear hardware transform from contentWrapper
    const wrapper = contentWrapperRef.current;
    if (wrapper) {
      wrapper.style.transform = 'none';
      wrapper.style.transformOrigin = '';
      wrapper.style.willChange = '';
      wrapper.style.transition = '';
    }

    const containerRect = container.getBoundingClientRect();
    const pageRect = targetEl.getBoundingClientRect();

    // Calculate delta between where the anchor point rendered and where it should be in the viewport
    const currentAnchorScreenX = pageRect.left + anchor.pctX * pageRect.width;
    const currentAnchorScreenY = pageRect.top + anchor.pctY * pageRect.height;

    const desiredAnchorScreenX = containerRect.left + anchor.viewportX;
    const desiredAnchorScreenY = containerRect.top + anchor.viewportY;

    const deltaX = currentAnchorScreenX - desiredAnchorScreenX;
    const deltaY = currentAnchorScreenY - desiredAnchorScreenY;

    container.scrollLeft = Math.max(0, Math.round(container.scrollLeft + deltaX));
    container.scrollTop = Math.max(0, Math.round(container.scrollTop + deltaY));

    const unlockTimer = setTimeout(() => {
      isScrollingProgrammaticallyRef.current = false;
    }, 150);

    return () => clearTimeout(unlockTimer);
  }, [zoomLevel]);

  // Touch Pinch-to-Zoom, Safari Gestures, and Trackpad Ctrl+Wheel Zoom
  const pinchRef = useRef<{
    active: boolean;
    startDist: number;
    startZoom: number;
    anchor: ZoomAnchor | null;
    focalX: number;
    focalY: number;
    focalContentX: number;
    focalContentY: number;
    startMidX: number;
    startMidY: number;
    currentScale: number;
    panX: number;
    panY: number;
  }>({
    active: false,
    startDist: 0,
    startZoom: 100,
    anchor: null,
    focalX: 0,
    focalY: 0,
    focalContentX: 0,
    focalContentY: 0,
    startMidX: 0,
    startMidY: 0,
    currentScale: 1,
    panX: 0,
    panY: 0,
  });

  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const zoomPillRef = useRef<HTMLDivElement>(null);
  const rafPinchRef = useRef<number | null>(null);
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleTouchStart = (e: TouchEvent) => {
      // 1. Double-tap detection for single finger
      if (e.touches.length === 1) {
        // Native selection handles are not DOM children of the text layer.
        // Their touch events may target the scroll container instead; never
        // misinterpret the second handle touch as a double-tap zoom.
        if (hasNativePdfSelection()) {
          lastTapRef.current = { time: 0, x: 0, y: 0 };
          return;
        }
        const touch = e.touches[0];
        const now = Date.now();
        const dist = Math.hypot(touch.clientX - lastTapRef.current.x, touch.clientY - lastTapRef.current.y);
        const timeDiff = now - lastTapRef.current.time;

        if (timeDiff < 300 && dist < 35) {
          const target = e.target as HTMLElement;
          if (
            !target.closest('[data-signature-overlay]') &&
            !target.closest('[data-text-overlay]') &&
            !target.closest('[data-form-field]') &&
            // Double-tap belongs to native word selection on PDF text.
            // Intercepting it for zoom was causing selection to jump.
            !target.closest('.textLayer') &&
            !target.closest('[data-pdf-link]') &&
            !target.closest('button') &&
            !target.closest('textarea') &&
            !target.closest('input') &&
            !target.closest('a')
          ) {
            e.preventDefault();
            const rect = container.getBoundingClientRect();
            const touchX = touch.clientX - rect.left;
            const touchY = touch.clientY - rect.top;
            pendingZoomAnchorRef.current = captureZoomAnchor(touchX, touchY);

            if (zoomLevelRef.current < 180) {
              setIsFitWidthMode(false);
              setZoomLevel(250);
            } else {
              setIsFitWidthMode(true);
              const fitZoom = calculateFitWidthZoom();
              setZoomLevel(fitZoom);
            }
            lastTapRef.current = { time: 0, x: 0, y: 0 };
            return;
          }
        }
        lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY };
      }

      if (e.touches.length === 2) {
        // Two fingers: Pinch to zoom
        e.preventDefault();
        isScrollingProgrammaticallyRef.current = true;
        const p1 = e.touches[0];
        const p2 = e.touches[1];
        const dist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
        const midX = (p1.clientX + p2.clientX) / 2;
        const midY = (p1.clientY + p2.clientY) / 2;
        const rect = container.getBoundingClientRect();

        const focalX = midX - rect.left;
        const focalY = midY - rect.top;
        const focalContentX = container.scrollLeft + focalX;
        const focalContentY = container.scrollTop + focalY;

        const anchor = captureZoomAnchor(focalX, focalY);

        pinchRef.current = {
          active: true,
          startDist: Math.max(10, dist),
          startZoom: zoomLevelRef.current,
          anchor,
          focalX,
          focalY,
          focalContentX,
          focalContentY,
          startMidX: midX,
          startMidY: midY,
          currentScale: 1,
          panX: 0,
          panY: 0,
        };

        const wrapper = contentWrapperRef.current;
        if (wrapper) {
          wrapper.style.transformOrigin = `${focalContentX}px ${focalContentY}px`;
          wrapper.style.willChange = 'transform';
          wrapper.style.transition = 'none';
        }
        container.style.scrollBehavior = 'auto';
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchRef.current.active) {
        e.preventDefault();
        const p1 = e.touches[0];
        const p2 = e.touches[1];
        const dist = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY);
        const rawScale = dist / pinchRef.current.startDist;
        const startZoom = pinchRef.current.startZoom;

        // Clamp scale so effective zoom stays cleanly within bounds [35%, 500%]
        const minScale = 35 / startZoom;
        const maxScale = 500 / startZoom;
        const scale = Math.min(maxScale, Math.max(minScale, rawScale));

        const midX = (p1.clientX + p2.clientX) / 2;
        const midY = (p1.clientY + p2.clientY) / 2;
        const panX = midX - pinchRef.current.startMidX;
        const panY = midY - pinchRef.current.startMidY;

        pinchRef.current.currentScale = scale;
        pinchRef.current.panX = panX;
        pinchRef.current.panY = panY;

        // Apply hardware-accelerated GPU transform on animation frame (zero React re-renders during gesture)
        if (!rafPinchRef.current) {
          rafPinchRef.current = requestAnimationFrame(() => {
            rafPinchRef.current = null;
            if (!pinchRef.current.active) return;
            const wrapper = contentWrapperRef.current;
            if (wrapper) {
              const s = pinchRef.current.currentScale;
              const px = pinchRef.current.panX;
              const py = pinchRef.current.panY;
              wrapper.style.transform = `translate3d(${px}px, ${py}px, 0) scale(${s})`;
            }
            if (zoomPillRef.current) {
              const livePercent = Math.round(startZoom * pinchRef.current.currentScale);
              zoomPillRef.current.textContent = `${livePercent}%`;
              zoomPillRef.current.style.opacity = '1';
            }
          });
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2 && pinchRef.current.active) {
        pinchRef.current.active = false;
        if (rafPinchRef.current) {
          cancelAnimationFrame(rafPinchRef.current);
          rafPinchRef.current = null;
        }

        if (zoomPillRef.current) {
          zoomPillRef.current.style.opacity = '0';
        }

        const {
          startZoom,
          currentScale,
          anchor,
          panX,
          panY,
        } = pinchRef.current;

        const rawFinalZoom = Math.round(startZoom * currentScale);
        const finalZoom = Math.min(500, Math.max(35, rawFinalZoom));

        container.style.scrollBehavior = '';

        if (Math.abs(finalZoom - startZoom) >= 2 && anchor) {
          setIsFitWidthMode(false);
          // Set the pending anchor with pan offset so useLayoutEffect restores position exactly
          pendingZoomAnchorRef.current = {
            ...anchor,
            viewportX: anchor.viewportX + panX,
            viewportY: anchor.viewportY + panY,
          };
          setZoomLevel(finalZoom);
        } else {
          // No significant zoom change: reset GPU transform
          const wrapper = contentWrapperRef.current;
          if (wrapper) {
            wrapper.style.transform = 'none';
            wrapper.style.transformOrigin = '';
            wrapper.style.willChange = '';
            wrapper.style.transition = '';
          }
          isScrollingProgrammaticallyRef.current = false;
        }
      }
    };

    // Trackpad pinch-to-zoom (emits wheel events with ctrlKey: true)
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const currentZoom = zoomLevelRef.current;
        const factor = -e.deltaY * 0.35;
        const newZoom = Math.min(500, Math.max(35, Math.round(currentZoom + factor)));
        if (newZoom !== currentZoom) {
          setIsFitWidthMode(false);
          const rect = container.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;
          pendingZoomAnchorRef.current = captureZoomAnchor(mouseX, mouseY);
          setZoomLevel(newZoom);
        }
      }
    };

    // Safari gestures
    const handleGestureStart = (e: any) => {
      e.preventDefault();
      isScrollingProgrammaticallyRef.current = true;
      const rect = container.getBoundingClientRect();
      const focalX = (e.clientX || rect.width / 2) - rect.left;
      const focalY = (e.clientY || rect.height / 2) - rect.top;
      const anchor = captureZoomAnchor(focalX, focalY);

      pinchRef.current.active = true;
      pinchRef.current.startZoom = zoomLevelRef.current;
      pinchRef.current.currentScale = 1;
      pinchRef.current.anchor = anchor;
      pinchRef.current.focalX = focalX;
      pinchRef.current.focalY = focalY;
      pinchRef.current.focalContentX = container.scrollLeft + focalX;
      pinchRef.current.focalContentY = container.scrollTop + focalY;

      const wrapper = contentWrapperRef.current;
      if (wrapper) {
        wrapper.style.transformOrigin = `${pinchRef.current.focalContentX}px ${pinchRef.current.focalContentY}px`;
        wrapper.style.willChange = 'transform';
        wrapper.style.transition = 'none';
      }
    };

    const handleGestureChange = (e: any) => {
      e.preventDefault();
      if (pinchRef.current.active) {
        const startZoom = pinchRef.current.startZoom;
        const scale = Math.min(500 / startZoom, Math.max(35 / startZoom, e.scale));
        pinchRef.current.currentScale = scale;
        const wrapper = contentWrapperRef.current;
        if (wrapper) {
          wrapper.style.transform = `scale(${scale})`;
        }
        if (zoomPillRef.current) {
          zoomPillRef.current.textContent = `${Math.round(startZoom * scale)}%`;
          zoomPillRef.current.style.opacity = '1';
        }
      }
    };

    const handleGestureEnd = (e: any) => {
      e.preventDefault();
      if (pinchRef.current.active) {
        pinchRef.current.active = false;
        if (zoomPillRef.current) zoomPillRef.current.style.opacity = '0';
        const finalZoom = Math.min(
          500,
          Math.max(35, Math.round(pinchRef.current.startZoom * (pinchRef.current.currentScale || 1)))
        );
        if (Math.abs(finalZoom - pinchRef.current.startZoom) >= 2 && pinchRef.current.anchor) {
          setIsFitWidthMode(false);
          pendingZoomAnchorRef.current = pinchRef.current.anchor;
          setZoomLevel(finalZoom);
        } else {
          const wrapper = contentWrapperRef.current;
          if (wrapper) {
            wrapper.style.transform = 'none';
            wrapper.style.transformOrigin = '';
            wrapper.style.willChange = '';
            wrapper.style.transition = '';
          }
          isScrollingProgrammaticallyRef.current = false;
        }
      }
    };

    // Keyboard zoom shortcuts (Ctrl/Cmd +, -, 0)
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        handleZoomIn();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        handleZoomOut();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        handleFitWidth();
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);
    container.addEventListener('wheel', handleWheel, { passive: false });
    container.addEventListener('gesturestart', handleGestureStart as any, { passive: false });
    container.addEventListener('gesturechange', handleGestureChange as any, { passive: false });
    container.addEventListener('gestureend', handleGestureEnd as any, { passive: false });
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
      container.removeEventListener('gesturestart', handleGestureStart as any);
      container.removeEventListener('gesturechange', handleGestureChange as any);
      container.removeEventListener('gestureend', handleGestureEnd as any);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [captureZoomAnchor, hasNativePdfSelection]);

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
  const handleZoomIn = () => {
    setIsFitWidthMode(false);
    if (containerRef.current) {
      const centerX = containerRef.current.clientWidth / 2;
      const centerY = containerRef.current.clientHeight / 2;
      pendingZoomAnchorRef.current = captureZoomAnchor(centerX, centerY);
    }
    setZoomLevel((prev) => Math.min(500, prev + 25));
  };

  const handleZoomOut = () => {
    setIsFitWidthMode(false);
    if (containerRef.current) {
      const centerX = containerRef.current.clientWidth / 2;
      const centerY = containerRef.current.clientHeight / 2;
      pendingZoomAnchorRef.current = captureZoomAnchor(centerX, centerY);
    }
    setZoomLevel((prev) => Math.max(35, prev - 25));
  };

  const handleResetZoom = () => {
    setIsFitWidthMode(false);
    if (containerRef.current) {
      const centerX = containerRef.current.clientWidth / 2;
      const centerY = containerRef.current.clientHeight / 2;
      pendingZoomAnchorRef.current = captureZoomAnchor(centerX, centerY);
    }
    setZoomLevel(100);
  };

  const handleSelectZoomPreset = (targetZoom: number) => {
    setIsFitWidthMode(false);
    if (containerRef.current) {
      const centerX = containerRef.current.clientWidth / 2;
      const centerY = containerRef.current.clientHeight / 2;
      pendingZoomAnchorRef.current = captureZoomAnchor(centerX, centerY);
    }
    setZoomLevel(Math.min(500, Math.max(35, targetZoom)));
    setIsZoomMenuOpen(false);
  };

  const handlePageDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (
      target.closest('[data-signature-overlay]') ||
      target.closest('[data-text-overlay]') ||
      target.closest('[data-form-field]') ||
      target.closest('[data-pdf-link]') ||
      target.closest('.textLayer') ||
      target.closest('button') ||
      target.closest('textarea') ||
      target.closest('input') ||
      target.closest('a')
    ) {
      return;
    }

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    pendingZoomAnchorRef.current = captureZoomAnchor(mouseX, mouseY);

    if (zoomLevel < 180) {
      setIsFitWidthMode(false);
      setZoomLevel(250);
    } else {
      setIsFitWidthMode(true);
      const fitZoom = calculateFitWidthZoom();
      setZoomLevel(fitZoom);
    }
  };

  const handleFitWidth = () => {
    setIsFitWidthMode(true);
    if (containerRef.current) {
      const centerX = containerRef.current.clientWidth / 2;
      const centerY = containerRef.current.clientHeight / 2;
      pendingZoomAnchorRef.current = captureZoomAnchor(centerX, centerY);
    }
    const fitZoom = calculateFitWidthZoom();
    setZoomLevel(fitZoom);
  };

  const handleFitPage = useCallback(() => {
    setIsFitWidthMode(false);
    if (!containerRef.current) return;
    const centerX = containerRef.current.clientWidth / 2;
    const centerY = containerRef.current.clientHeight / 2;
    pendingZoomAnchorRef.current = captureZoomAnchor(centerX, centerY);

    const fitPageZoom = calculateFitPageZoom(pdfState.currentPage);
    setZoomLevel(fitPageZoom);
    if (containerRef.current) {
      containerRef.current.scrollLeft = 0;
    }
  }, [calculateFitPageZoom, captureZoomAnchor, pdfState.currentPage]);

  // Mobile Page Grid Bottom Sheet state
  const [isMobilePageGridOpen, setIsMobilePageGridOpen] = useState(false);

  // Determine whether tools/modals or internal overlays are currently active to pin controls
  const isPinned = Boolean(
    isToolActive ||
    isSearchOpen ||
    isTocOpen ||
    isMobilePageGridOpen ||
    selectedSignatureId !== null ||
    selectedTextId !== null
  );

  const { isControlsVisible, handleDocumentTap } = useImmersiveNavigation({
    isPinned,
    scrollElement: containerRef.current,
    onVisibilityChange: onControlsVisibilityChange,
  });

  const handleContainerClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isInteractive = Boolean(
      target.closest('[data-signature-overlay]') ||
      target.closest('[data-text-overlay]') ||
      target.closest('[data-form-field]') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('a')
    );

    if (!isInteractive) {
      onSelectSignature(null);
      if (onSelectText) onSelectText(null);
      handleDocumentTap();
    }
  };

  const pageWidth = Math.round(renderedDimensions.width * (zoomLevel / 100));
  const pageHeight = Math.round(renderedDimensions.height * (zoomLevel / 100));

  return (
    <div className="flex flex-col flex-1 h-full min-h-0 bg-slate-100/90 relative">
      {/* Mobile Reader Top Bar (Frosted glass with back, doc title, metadata, search, grid, overflow menu) */}
      {!isReaderMode && isMobile && (
        <MobileReaderTopBar
          pdfState={pdfState}
          isVisible={isControlsVisible}
          isSaved={isSaved}
          onBack={onBack || (() => {})}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={onUndo}
          onRedo={onRedo}
          onToggleSearch={() => (isSearchOpen ? closeSearch() : setIsSearchOpen(true))}
          isSearchActive={isSearchOpen}
          onTogglePageGrid={() => setIsMobilePageGridOpen((prev) => !prev)}
          onOpenToc={() => setIsTocOpen(true)}
          onToggleReflow={() => setIsReflowMode((prev) => !prev)}
          isReflowActive={isReflowMode}
          onQuickPrint={onQuickPrint}
          onQuickShare={onQuickShare}
          onOpenFile={onOpenFile}
          onOpenRecent={onOpenRecent}
          onOpenDiagnostics={onOpenDiagnostics}
        />
      )}

      {/* Real-time floating zoom pill badge during pinch gestures */}
      <div
        ref={zoomPillRef}
        className="fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 z-50 pointer-events-none bg-slate-900/90 text-white text-xs font-mono font-semibold px-3.5 py-1.5 rounded-full shadow-lg border border-slate-700/60 backdrop-blur-sm opacity-0 transition-opacity duration-150 flex items-center gap-2 select-none"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
        <span>100%</span>
      </div>

      {/* Top Floating Page Navigation & Zoom Toolbar (hidden in Reader Mode and on Mobile) */}
      {!isReaderMode && !isMobile && (
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
              disabled={zoomLevel <= 35}
              className="p-1 rounded-md text-slate-600 hover:bg-white hover:shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              title="Zoom Out (-25%) [Ctrl -]"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            {/* Quick-Select Zoom Preset Dropdown */}
            <div className="relative" ref={zoomMenuRef}>
              <button
                type="button"
                onClick={() => setIsZoomMenuOpen((prev) => !prev)}
                className={`text-xs font-mono font-semibold px-1.5 py-0.5 rounded-md transition flex items-center gap-0.5 cursor-pointer ${
                  isZoomMenuOpen
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-700 hover:bg-white hover:text-blue-600 hover:shadow-xs'
                }`}
                title="Zoom Preset Menu (Up to 500%)"
                aria-expanded={isZoomMenuOpen}
              >
                <span>{zoomLevel}%</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>

              {isZoomMenuOpen && (
                <div
                  className="absolute left-0 mt-1.5 w-44 bg-white/95 backdrop-blur-md rounded-xl shadow-2xl border border-slate-200 py-1.5 z-50 text-xs animate-in fade-in zoom-in-95 duration-100 divide-y divide-slate-100"
                  role="menu"
                >
                  <div className="py-1">
                    <div className="px-2.5 py-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Page Fit
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        handleFitWidth();
                        setIsZoomMenuOpen(false);
                      }}
                      className={`w-full px-2.5 py-1.5 text-left flex items-center justify-between hover:bg-slate-100 transition cursor-pointer ${
                        isFitWidthMode ? 'text-blue-600 font-semibold bg-blue-50/70' : 'text-slate-700'
                      }`}
                    >
                      <span>Fit Width</span>
                      {isFitWidthMode && <Check className="w-3.5 h-3.5 text-blue-600" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        handleFitPage();
                        setIsZoomMenuOpen(false);
                      }}
                      className="w-full px-2.5 py-1.5 text-left flex items-center justify-between hover:bg-slate-100 text-slate-700 transition cursor-pointer"
                    >
                      <span>Fit Page</span>
                    </button>
                  </div>

                  <div className="py-1">
                    <div className="px-2.5 py-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Presets (35% – 500%)
                    </div>
                    {[50, 75, 100, 125, 150, 200, 300, 400, 500].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleSelectZoomPreset(preset)}
                        className={`w-full px-2.5 py-1 text-left flex items-center justify-between hover:bg-slate-100 transition cursor-pointer ${
                          zoomLevel === preset && !isFitWidthMode
                            ? 'text-blue-600 font-semibold bg-blue-50/70'
                            : 'text-slate-700'
                        }`}
                      >
                        <span className="font-mono">{preset}%</span>
                        {zoomLevel === preset && !isFitWidthMode && (
                          <Check className="w-3.5 h-3.5 text-blue-600" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleZoomIn}
              disabled={zoomLevel >= 500}
              className="p-1 rounded-md text-slate-600 hover:bg-white hover:shadow-xs disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer"
              title="Zoom In (+25%) [Ctrl +]"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <span className="w-px h-3.5 bg-slate-300 mx-0.5" />
            <button
              id="viewer-fit-width-btn"
              onClick={handleFitWidth}
              className={`px-1.5 py-0.5 rounded-md text-[11px] transition whitespace-nowrap cursor-pointer ${
                isFitWidthMode
                  ? 'bg-blue-600 text-white font-semibold shadow-xs'
                  : 'text-slate-600 hover:bg-white hover:shadow-xs hover:text-slate-900 font-medium'
              }`}
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

            {/* Full-document search: also available via Ctrl/Cmd+F */}
            <button
              id="viewer-search-btn"
              type="button"
              onClick={() => isSearchOpen ? closeSearch() : setIsSearchOpen(true)}
              className={`px-1.5 sm:px-2 py-0.5 rounded-md text-[11px] font-medium hover:bg-white hover:text-blue-600 transition flex items-center gap-1 cursor-pointer ${isSearchOpen ? 'text-blue-600 bg-blue-50' : 'text-slate-700'}`}
              title="Im gesamten PDF suchen (Strg+F)"
              aria-label="PDF durchsuchen"
              aria-expanded={isSearchOpen}
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Suchen</span>
            </button>

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

          <button
            onClick={() => isSearchOpen ? closeSearch() : setIsSearchOpen(true)}
            className="flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-slate-300 hover:text-white hover:bg-white/15"
            title="PDF durchsuchen (Strg+F)"
            aria-label="PDF durchsuchen"
          >
            <Search className="w-3.5 h-3.5" />
          </button>

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

      {isSearchOpen && pdfState.arrayBuffer && (
        <PdfSearchPanel
          arrayBuffer={pdfState.arrayBuffer}
          onClose={closeSearch}
          onNavigate={handleSearchHit}
        />
      )}

      {/* Main PDF Scrollable Workspace with Continuous Page Rolling */}
      <div
        ref={containerRef}
        data-pdf-scroll-container="true"
        onClick={handleContainerClick}
        onMouseDown={handleMouseDown}
        className={`flex-1 min-h-0 overflow-y-auto overflow-x-auto relative touch-pan-x touch-pan-y overscroll-contain scroll-auto ${
          isSpacePressed || isMousePanning ? 'cursor-grabbing select-none' : 'cursor-default'
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
          <div
            ref={contentWrapperRef}
            onDoubleClick={handlePageDoubleClick}
            className="w-fit min-w-full min-h-full flex flex-col items-center justify-start p-4 sm:p-8 pb-32 space-y-6"
          >
            {Array.from({ length: pdfState.numPages }, (_, i) => i + 1).map((pageNum) => {
              const pageInfo = pageInfos[pageNum - 1];
              const pageScale = zoomLevel / 100;
              const thisPageWidth = Math.round((pageInfo?.width || renderedDimensions.width) * pageScale);
              const thisPageHeight = Math.round((pageInfo?.height || renderedDimensions.height) * pageScale);
              return (
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
                  pageWidth={thisPageWidth}
                  pageHeight={thisPageHeight}
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
                  searchHighlight={activeSearchMatch?.pageNumber === pageNum ? activeSearchMatch : undefined}
                />
                {/* Subtle page indicator between pages */}
                <div className="mt-2 text-[10px] font-mono text-slate-400 select-none">
                  Page {pageNum} of {pdfState.numPages}
                </div>
              </div>
              );
            })}
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
      {/* Android supplies a native selection/copy toolbar. Rendering a second
          React toolbar on every selectionchange interferes with drag handles
          and creates duplicate copy actions. Keep it for desktop only. */}
      {!isNativeAndroid() && <TextSelectionToolbar />}

      {/* Mobile Floating Pill (Quick page navigation + Zoom % / Reset to Fit Page) */}
      {isMobile && !isReaderMode && (
        <MobileFloatingPill
          currentPage={pdfState.currentPage}
          numPages={pdfState.numPages}
          zoomLevel={zoomLevel}
          isVisible={isControlsVisible}
          onPrevPage={() => scrollToPage(pdfState.currentPage - 1, 'smooth')}
          onNextPage={() => scrollToPage(pdfState.currentPage + 1, 'smooth')}
          onResetToFitPage={handleFitPage}
          onOpenPageGrid={() => setIsMobilePageGridOpen(true)}
        />
      )}

      {/* Mobile Page Grid Bottom Sheet */}
      {isMobile && (
        <MobilePageGridBottomSheet
          isOpen={isMobilePageGridOpen}
          pdfState={pdfState}
          currentPage={pdfState.currentPage}
          onClose={() => setIsMobilePageGridOpen(false)}
          onSelectPage={(pageNum) => scrollToPage(pageNum, 'smooth')}
          onOpenFullPageManager={onOpenPageManager}
        />
      )}
    </div>
  );
};
