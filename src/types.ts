export interface SignatureItem {
  id: string;
  name: string;
  /** Processed PNG with transparent background as data URL */
  transparentDataUrl: string;
  /** Raw PNG bytes for pdf-lib */
  pngBytes: Uint8Array;
  /** Original image data URL (the JPG with white background) */
  originalDataUrl: string;
  /** Page on which this signature is placed (1-based) */
  pageNumber: number;
  /** Horizontal position as percentage of page width (0 - 100) */
  xPercent: number;
  /** Vertical position as percentage of page height (0 - 100) from top */
  yPercent: number;
  /** Width as percentage of page width (5 - 90) */
  widthPercent: number;
  /** Aspect ratio: width / height */
  aspectRatio: number;
  /** Opacity of the signature (0.1 to 1.0) */
  opacity: number;
  /** Rotation angle in degrees (0, 90, 180, 270 or arbitrary) */
  rotation: number;
}

export interface TransparencyOptions {
  /** Threshold for detecting white background (0-255, typically 210-250) */
  threshold: number;
  /** Feather softness for edge anti-aliasing (0 to 50) */
  feather: number;
  /** Ink enhancement mode */
  inkMode: 'preserve' | 'darken' | 'blue-ink' | 'black-ink';
  /** Whether to automatically crop away excessive white padding around the signature */
  autoCrop: boolean;
}

export interface PdfDocumentState {
  file: File | null;
  name: string;
  arrayBuffer: ArrayBuffer | null;
  numPages: number;
  currentPage: number;
  pageWidth: number;
  pageHeight: number;
}

export interface DragState {
  isDragging: boolean;
  isResizing: boolean;
  resizeHandle: 'nw' | 'ne' | 'se' | 'sw' | null;
  startX: number;
  startY: number;
  initialXPercent: number;
  initialYPercent: number;
  initialWidthPercent: number;
  initialAspectRatio: number;
}

export type TextFontFamily = 'standard' | 'script';
export type TextColor = 'black' | 'blue' | 'red';

export interface TextOverlayItem {
  id: string;
  text: string;
  pageNumber: number;
  /** Horizontal position as percentage of page width (0 - 100) */
  xPercent: number;
  /** Vertical position as percentage of page height (0 - 100) from top */
  yPercent: number;
  /** Width as percentage of page width (min ~ 15%) */
  widthPercent: number;
  fontSize: number; // in pt (default: 14)
  fontFamily: TextFontFamily; // 'standard' (Helvetica) or 'script' (Caveat)
  color: TextColor; // 'black' (#09090b), 'blue' (#1e3a8a), or 'red' (#dc2626)
}

export type FormFieldType =
  | 'text'
  | 'checkbox'
  | 'dropdown'
  | 'radio'
  | 'listbox'
  | 'button'
  | 'other';

export interface FormFieldItem {
  id: string;
  name: string;
  type: FormFieldType;
  pageNumber: number;
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  options?: string[]; // for dropdown, listbox, or radio
  value?: string; // option export value (e.g. 'Male' or 'Female' for radio buttons)
  multiline?: boolean; // for textarea (e.g. Notes)
  comb?: boolean; // for comb text fields (e.g. ID with fixed character cells)
  maxLen?: number; // character limit for comb or text fields
  readOnly?: boolean;
}

export type FormValuesState = Record<string, string | boolean | string[]>;

