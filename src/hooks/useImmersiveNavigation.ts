import { useState, useEffect, useRef, useCallback } from 'react';

interface UseImmersiveNavigationOptions {
  /** If true, navigation controls are fixed and cannot auto-hide (e.g. tools/modals active). */
  isPinned?: boolean;
  /** Scroll container element */
  scrollElement?: HTMLElement | null;
  /** Optional callback fired when visibility state transitions */
  onVisibilityChange?: (isVisible: boolean) => void;
}

export function useImmersiveNavigation({
  isPinned = false,
  scrollElement = null,
  onVisibilityChange,
}: UseImmersiveNavigationOptions) {
  const [internalVisible, setInternalVisible] = useState(true);
  const lastScrollTopRef = useRef<number>(0);
  const scrollDistanceRef = useRef<number>(0);
  const onVisibilityChangeRef = useRef(onVisibilityChange);
  onVisibilityChangeRef.current = onVisibilityChange;

  const effectiveVisible = isPinned || internalVisible;

  // Notify parent of effective visibility changes only when changed
  const lastReportedVisibleRef = useRef<boolean>(effectiveVisible);
  useEffect(() => {
    if (lastReportedVisibleRef.current !== effectiveVisible) {
      lastReportedVisibleRef.current = effectiveVisible;
      onVisibilityChangeRef.current?.(effectiveVisible);
    }
  }, [effectiveVisible]);

  // Handle scroll listener on the PDF viewer container
  useEffect(() => {
    if (!scrollElement) return;

    let ticking = false;

    const handleScroll = () => {
      if (ticking) return;
      ticking = true;

      window.requestAnimationFrame(() => {
        ticking = false;
        if (isPinned) return;

        const currentScrollTop = scrollElement.scrollTop;
        const delta = currentScrollTop - lastScrollTopRef.current;

        // If at the very top, always show controls
        if (currentScrollTop <= 20) {
          setInternalVisible(true);
          lastScrollTopRef.current = currentScrollTop;
          scrollDistanceRef.current = 0;
          return;
        }

        // Accumulate directional scroll distance
        if (
          (delta > 0 && scrollDistanceRef.current < 0) ||
          (delta < 0 && scrollDistanceRef.current > 0)
        ) {
          scrollDistanceRef.current = 0;
        }
        scrollDistanceRef.current += delta;

        // Scrolling down by more than 25px: hide controls
        if (scrollDistanceRef.current > 25) {
          setInternalVisible(false);
        }
        // Scrolling up significantly (more than 40px): bring controls back smoothly
        else if (scrollDistanceRef.current < -40) {
          setInternalVisible(true);
        }

        lastScrollTopRef.current = currentScrollTop;
      });
    };

    scrollElement.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      scrollElement.removeEventListener('scroll', handleScroll);
    };
  }, [scrollElement, isPinned]);

  const showControls = useCallback(() => {
    setInternalVisible(true);
  }, []);

  const hideControls = useCallback(() => {
    if (!isPinned) {
      setInternalVisible(false);
    }
  }, [isPinned]);

  const toggleControls = useCallback(() => {
    if (isPinned) {
      setInternalVisible(true);
      return;
    }
    setInternalVisible((prev) => !prev);
  }, [isPinned]);

  const handleDocumentTap = useCallback(() => {
    toggleControls();
  }, [toggleControls]);

  return {
    isControlsVisible: effectiveVisible,
    showControls,
    hideControls,
    toggleControls,
    handleDocumentTap,
  };
}
