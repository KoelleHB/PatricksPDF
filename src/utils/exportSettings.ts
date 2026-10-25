export type NamingPreset = 'signed' | 'date_prefix' | 'custom_suffix' | 'original';

export interface ExportSettings {
  namingPreset: NamingPreset;
  customSuffix: string;
  defaultFlattenForms: boolean;
}

const STORAGE_KEY = 'patrickspdf_export_settings_v1';

export const DEFAULT_EXPORT_SETTINGS: ExportSettings = {
  namingPreset: 'signed',
  customSuffix: '_bearbeitet',
  defaultFlattenForms: false,
};

export function loadExportSettings(): ExportSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_EXPORT_SETTINGS };
    const parsed = JSON.parse(raw);
    const preset: NamingPreset =
      parsed.namingPreset === 'signed' ||
      parsed.namingPreset === 'date_prefix' ||
      parsed.namingPreset === 'custom_suffix' ||
      parsed.namingPreset === 'original'
        ? parsed.namingPreset
        : DEFAULT_EXPORT_SETTINGS.namingPreset;
    const customSuffix =
      typeof parsed.customSuffix === 'string' && parsed.customSuffix.trim().length > 0
        ? parsed.customSuffix.trim()
        : DEFAULT_EXPORT_SETTINGS.customSuffix;
    const defaultFlattenForms =
      typeof parsed.defaultFlattenForms === 'boolean'
        ? parsed.defaultFlattenForms
        : DEFAULT_EXPORT_SETTINGS.defaultFlattenForms;

    return {
      namingPreset: preset,
      customSuffix,
      defaultFlattenForms,
    };
  } catch {
    return { ...DEFAULT_EXPORT_SETTINGS };
  }
}

export function saveExportSettings(settings: ExportSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

export function buildExportFileName(
  originalPdfName: string,
  settings: ExportSettings,
  pageSubsetSuffix?: string,
  dateOverride?: Date
): string {
  const baseName = originalPdfName.replace(/\.pdf$/i, '').trim() || 'Dokument';
  const subsetTag = pageSubsetSuffix ? `_${pageSubsetSuffix}` : '';

  switch (settings.namingPreset) {
    case 'original':
      return `${baseName}${subsetTag}`;
    case 'date_prefix': {
      const now = dateOverride ?? new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}_${baseName}${subsetTag}`;
    }
    case 'custom_suffix': {
      const rawSuffix = settings.customSuffix.trim() || '_bearbeitet';
      const normalizedSuffix =
        rawSuffix.startsWith('_') || rawSuffix.startsWith('-') ? rawSuffix : `_${rawSuffix}`;
      return `${baseName}${subsetTag}${normalizedSuffix}`;
    }
    case 'signed':
    default:
      return `${baseName}${subsetTag}_unterschrieben`;
  }
}

/**
 * Parses a human-friendly 1-based page range string such as "1-3, 5, 8-10"
 * into sorted, deduplicated 1-based page numbers within [1, maxPages].
 * Returns { pages, error } where error is non-null if syntax or bounds are invalid.
 */
export function parsePageRangeInput(
  input: string,
  maxPages: number
): { pages: number[]; error: string | null } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { pages: [], error: 'Bitte mindestens eine Seite oder einen Bereich eingeben (z. B. 1-3, 5).' };
  }

  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { pages: [], error: 'Ungültige Seitenangabe.' };
  }

  const selected = new Set<number>();

  for (const part of parts) {
    if (/^\d+$/.test(part)) {
      const pageNum = parseInt(part, 10);
      if (pageNum < 1 || pageNum > maxPages) {
        return {
          pages: [],
          error: `Seite ${pageNum} liegt außerhalb des gültigen Bereichs (1–${maxPages}).`,
        };
      }
      selected.add(pageNum);
    } else if (/^(\d+)\s*-\s*(\d+)$/.test(part)) {
      const match = part.match(/^(\d+)\s*-\s*(\d+)$/)!;
      const start = parseInt(match[1], 10);
      const end = parseInt(match[2], 10);
      if (start < 1 || end < 1 || start > maxPages || end > maxPages) {
        return {
          pages: [],
          error: `Bereich ${start}–${end} liegt außerhalb des gültigen Bereichs (1–${maxPages}).`,
        };
      }
      if (start > end) {
        return {
          pages: [],
          error: `Ungültiger Bereich ${start}–${end}: Startseite ist größer als Endseite.`,
        };
      }
      for (let p = start; p <= end; p++) {
        selected.add(p);
      }
    } else {
      return {
        pages: [],
        error: `Ungültiges Format „${part}“. Erlaubt sind Zahlen und Bereiche wie 1-3, 5.`,
      };
    }
  }

  const sorted = Array.from(selected).sort((a, b) => a - b);
  return { pages: sorted, error: null };
}

export function formatPageNumbersToRangeString(pages: number[]): string {
  const sorted = Array.from(new Set(pages)).sort((a, b) => a - b);
  if (sorted.length === 0) return '';

  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    if (current === prev + 1) {
      prev = current;
    } else {
      ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
      start = current;
      prev = current;
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return ranges.join(', ');
}
