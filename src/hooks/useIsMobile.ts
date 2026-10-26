import { useState, useEffect } from 'react';
import { isNativeAndroid } from '../utils/nativeBridge';

/**
 * Returns true if the app is running in the native Android environment (Capacitor/WebView)
 * or on a mobile screen viewport (< 768px).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return isNativeAndroid() || window.innerWidth < 768;
  });

  useEffect(() => {
    const checkIsMobile = () => {
      setIsMobile(isNativeAndroid() || window.innerWidth < 768);
    };

    window.addEventListener('resize', checkIsMobile);
    return () => window.removeEventListener('resize', checkIsMobile);
  }, []);

  return isMobile;
}
