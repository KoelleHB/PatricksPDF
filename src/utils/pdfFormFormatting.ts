import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFString, decodePDFRawStream } from 'pdf-lib';
import type { FormFieldItem, FormFieldType, FormValuesState } from '../types';
import { collectAcroFormObjects, getFullyQualifiedFieldName, readFormActions, resolvePdfDict } from './pdfFormActions';

export interface SupportedFormFormatting {
  numberDecimals?: number;
  sepStyle?: number;
  sumFields?: string[];
}

const MAX_HIERARCHY_DEPTH = 64;

/**
 * Recognizes a deliberately small, complete grammar for Adobe Acrobat standard formatting/calculation.
 * Document scripts are never evaluated dynamically.
 *
 * Adobe Acrobat AFNumber_Format(nDec, sepStyle, negStyle, currStyle, strCurrency, bCurrencyPrepend):
 * - sepStyle = 0: comma thousands, dot decimal -> 1,234.56
 * - sepStyle = 1: no thousands, dot decimal    -> 1234.56
 * - sepStyle = 2: dot thousands, comma decimal -> 1.234,56
 * - sepStyle = 3: no thousands, comma decimal  -> 1234,56
 */
export function parseSupportedFormFormatting(format: string, calculate: string): SupportedFormFormatting {
  const result: SupportedFormFormatting = {};
  const numberMatch =
    /^\s*AFNumber_Format\(\s*([0-6])\s*,\s*([0-3])\s*,\s*0\s*,\s*0\s*,\s*(?:""|'')\s*,\s*(?:true|false)\s*\)\s*;?\s*$/.exec(
      format
    );
  if (numberMatch) {
    result.numberDecimals = Number(numberMatch[1]);
    result.sepStyle = Number(numberMatch[2]);
  }
  const sumMatch =
    /^\s*AFSimple_Calculate\(\s*"SUM"\s*,\s*new\s+Array\s*\(\s*((?:"[^"\\]*"\s*,\s*)*"[^"\\]*"\s*)\)\s*\)\s*;?\s*$/.exec(
      calculate
    );
  if (sumMatch) {
    result.sumFields = [...sumMatch[1].matchAll(/"([^"\\]*)"/g)]
      .map((match) => match[1].trim())
      .filter(Boolean);
  }
  return result;
}

function readJavaScriptActionScript(doc: PDFDocument, actionOrRef: unknown): string {
  const action = resolvePdfDict(doc, actionOrRef);
  if (!action) return '';
  if (action.lookup(PDFName.of('S')) !== PDFName.of('JavaScript') || action.has(PDFName.of('Next'))) {
    return '';
  }
  const script = action.lookup(PDFName.of('JS'));
  if (script instanceof PDFString || script instanceof PDFHexString) {
    return script.decodeText();
  }
  if (script instanceof PDFRawStream) {
    return new TextDecoder().decode(decodePDFRawStream(script).decode());
  }
  return '';
}

function resolveEffectiveFormattingScripts(
  doc: PDFDocument,
  dict: PDFDict
): { formatScript: string; calculateScript: string } {
  const visited = new Set<PDFDict>();
  let current: PDFDict | null = dict;
  let depth = 0;
  let formatScript = '';
  let hasExplicitFormatEntry = false;
  let calculateScript = '';
  let hasExplicitCalculateEntry = false;

  while (current && depth < MAX_HIERARCHY_DEPTH) {
    if (visited.has(current)) break;
    visited.add(current);

    const aa = resolvePdfDict(doc, current.get(PDFName.of('AA')) ?? current.lookup(PDFName.of('AA')));
    if (aa) {
      if (!hasExplicitFormatEntry && aa.has(PDFName.of('F'))) {
        hasExplicitFormatEntry = true;
        formatScript = readJavaScriptActionScript(doc, aa.get(PDFName.of('F')) ?? aa.lookup(PDFName.of('F')));
      }
      if (!hasExplicitCalculateEntry && aa.has(PDFName.of('C'))) {
        hasExplicitCalculateEntry = true;
        calculateScript = readJavaScriptActionScript(doc, aa.get(PDFName.of('C')) ?? aa.lookup(PDFName.of('C')));
      }
    }

    if (hasExplicitFormatEntry && hasExplicitCalculateEntry) break;
    current = resolvePdfDict(doc, current.get(PDFName.of('Parent')) ?? current.lookup(PDFName.of('Parent')));
    depth++;
  }

  return { formatScript, calculateScript };
}

export async function readFormFormatting(bytes: ArrayBuffer): Promise<Map<string, SupportedFormFormatting>> {
  const doc = await PDFDocument.load(bytes.slice(0), {
    ignoreEncryption: true,
    updateMetadata: false,
    throwOnInvalidObject: false,
    capNumbers: true,
  });
  const result = new Map<string, SupportedFormFormatting>();
  const objects = collectAcroFormObjects(doc);

  for (const { ref, dict } of objects) {
    const { formatScript, calculateScript } = resolveEffectiveFormattingScripts(doc, dict);
    if (!formatScript && !calculateScript) continue;

    const parsed = parseSupportedFormFormatting(formatScript, calculateScript);
    if (parsed.numberDecimals === undefined && !parsed.sumFields) continue;

    if (ref) {
      result.set(`${ref.objectNumber}R`, parsed);
      result.set(`${ref.objectNumber}R${ref.generationNumber || ''}`, parsed);
    }

    const fqName = getFullyQualifiedFieldName(dict, doc);
    if (fqName) {
      const existing = result.get(`name:${fqName}`);
      result.set(`name:${fqName}`, {
        numberDecimals: parsed.numberDecimals ?? existing?.numberDecimals,
        sepStyle: parsed.sepStyle ?? existing?.sepStyle,
        sumFields: parsed.sumFields ?? existing?.sumFields,
      });
    }
  }

  return result;
}

/**
 * Parses a numeric value according to Adobe Acrobat's sepStyle rules while preventing
 * silent misinterpretation of ambiguous or malformed strings.
 *
 * - Empty string / whitespace -> 0
 * - Invalid / ambiguous input -> null
 */
export function parseNumber(value: unknown, sepStyle?: number): number | null {
  if (sepStyle !== undefined && (!Number.isInteger(sepStyle) || sepStyle < 0 || sepStyle > 3)) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value ?? '').trim();
  if (!text) return 0;

  // Reject characters outside optional sign, digits, dot, and comma
  if (!/^[+-]?[\d.,]+$/.test(text) || !/\d/.test(text)) {
    return null;
  }

  const signPrefix = text.startsWith('-') ? '-' : '';
  const unsigned = text.replace(/^[+-]/, '');
  const hasDot = unsigned.includes('.');
  const hasComma = unsigned.includes(',');

  let normalizedUnsigned: string | null = null;

  if (!hasDot && !hasComma) {
    if (/^\d+$/.test(unsigned)) {
      normalizedUnsigned = unsigned;
    }
  } else if (hasDot && hasComma) {
    // When both separators appear, one must form valid 3-digit thousands groups and the other a single decimal part.
    // Neither sepStyle 1 nor sepStyle 3 permits thousands grouping when a sepStyle is explicitly enforced.
    if (sepStyle === 1 || sepStyle === 3) {
      return null;
    }
    const lastDot = unsigned.lastIndexOf('.');
    const lastComma = unsigned.lastIndexOf(',');
    if (lastDot > lastComma) {
      // US style: comma thousands, dot decimal (e.g. 1,234.56)
      if (sepStyle === 2) return null;
      if (/^[1-9]\d{0,2}(?:,\d{3})+\.\d+$/.test(unsigned)) {
        normalizedUnsigned = unsigned.replace(/,/g, '');
      }
    } else {
      // European style: dot thousands, comma decimal (e.g. 1.234,56)
      if (sepStyle === 0) return null;
      if (/^[1-9]\d{0,2}(?:\.\d{3})+,\d+$/.test(unsigned)) {
        normalizedUnsigned = unsigned.replace(/\./g, '').replace(',', '.');
      }
    }
  } else if (hasDot) {
    const parts = unsigned.split('.');
    if (parts.length > 2) {
      // Multiple dots can only be valid 3-digit thousands grouping in sepStyle 2
      if (sepStyle === 2 && /^[1-9]\d{0,2}(?:\.\d{3})+$/.test(unsigned)) {
        normalizedUnsigned = unsigned.replace(/\./g, '');
      }
    } else if (/^(?:\d+\.\d+|\.\d+)$/.test(unsigned)) {
      const isThreeDigitGroupCandidate = /^[1-9]\d{0,2}\.\d{3}$/.test(unsigned);
      if (isThreeDigitGroupCandidate) {
        if (sepStyle === 2) {
          normalizedUnsigned = unsigned.replace('.', '');
        } else if (sepStyle === 0 || sepStyle === 1) {
          normalizedUnsigned = unsigned;
        } else {
          // Ambiguous in sepStyle 3 or when sepStyle is undefined ("1.234": 1234 vs 1.234)
          return null;
        }
      } else {
        normalizedUnsigned = unsigned;
      }
    }
  } else if (hasComma) {
    const parts = unsigned.split(',');
    if (parts.length > 2) {
      // Multiple commas can only be valid 3-digit thousands grouping in sepStyle 0
      if (sepStyle === 0 && /^[1-9]\d{0,2}(?:,\d{3})+$/.test(unsigned)) {
        normalizedUnsigned = unsigned.replace(/,/g, '');
      }
    } else if (/^(?:\d+,\d+|,\d+)$/.test(unsigned)) {
      const isThreeDigitGroupCandidate = /^[1-9]\d{0,2},\d{3}$/.test(unsigned);
      if (isThreeDigitGroupCandidate) {
        if (sepStyle === 0) {
          normalizedUnsigned = unsigned.replace(',', '');
        } else if (sepStyle === 2 || sepStyle === 3) {
          normalizedUnsigned = unsigned.replace(',', '.');
        } else {
          // Ambiguous in sepStyle 1 or when sepStyle is undefined ("1,234": 1234 vs 1.234)
          return null;
        }
      } else {
        normalizedUnsigned = unsigned.replace(',', '.');
      }
    }
  }

  if (normalizedUnsigned === null) {
    return null;
  }

  const num = Number(signPrefix + normalizedUnsigned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Formats a numeric value directly according to Adobe Acrobat AFNumber_Format sepStyle (0..3).
 */
export function formatNumberValue(num: number, decimals: number, sepStyle: number = 0): string {
  if (!Number.isFinite(num)) return String(num);
  const safeDecimals = Math.max(0, Math.min(20, Math.trunc(decimals)));
  const factor = Math.pow(10, safeDecimals);
  const roundedAbs = Math.round((Math.abs(num) + Number.EPSILON) * factor) / factor;
  const isNegative = num < 0 && roundedAbs > 0;
  const fixed = roundedAbs.toFixed(safeDecimals);
  const [rawIntPart, rawFracPart] = fixed.split('.');

  const useGrouping = sepStyle === 0 || sepStyle === 2;
  const groupSeparator = sepStyle === 2 ? '.' : ',';
  const decimalSeparator = sepStyle === 2 || sepStyle === 3 ? ',' : '.';

  const groupedInt = useGrouping
    ? rawIntPart.replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator)
    : rawIntPart;

  const signStr = isNegative ? '-' : '';
  if (safeDecimals === 0 || rawFracPart === undefined) {
    return `${signStr}${groupedInt}`;
  }
  return `${signStr}${groupedInt}${decimalSeparator}${rawFracPart}`;
}

export function formatSupportedNumber(value: string, decimals: number, sepStyle?: number): string {
  if (!value.trim()) return value;
  const effectiveSepStyle = sepStyle ?? 0;
  if (!Number.isInteger(effectiveSepStyle) || effectiveSepStyle < 0 || effectiveSepStyle > 3) {
    return value;
  }
  const parsed = parseNumber(value, sepStyle);
  if (parsed === null) return value;
  return formatNumberValue(parsed, decimals, effectiveSepStyle);
}

function parseFieldNumericValue(raw: unknown, field?: FormFieldItem): number | null {
  if (field?.sepStyle !== undefined) {
    const withFieldStyle = parseNumber(raw, field.sepStyle);
    if (withFieldStyle !== null) return withFieldStyle;
  }
  return parseNumber(raw, undefined);
}

/**
 * Computes acyclic, fully recognized SUM expressions using exact intermediate numeric values
 * and formats results only at presentation/commit time. Unknown or ambiguous values leave the
 * existing sum field unchanged.
 */
export function calculateSupportedForms(values: FormValuesState, fields: FormFieldItem[]): FormValuesState {
  const next: FormValuesState = { ...values };
  const fieldByName = new Map<string, FormFieldItem>();
  for (const f of fields) {
    const existing = fieldByName.get(f.name);
    if (!existing) {
      fieldByName.set(f.name, f);
    } else {
      fieldByName.set(f.name, {
        ...existing,
        numberDecimals: existing.numberDecimals ?? f.numberDecimals,
        sepStyle: existing.sepStyle ?? f.sepStyle,
        sumFields: existing.sumFields ?? f.sumFields,
      });
    }
  }

  const sums = new Map<string, FormFieldItem>();
  for (const [name, f] of fieldByName.entries()) {
    if (f.sumFields && f.sumFields.length > 0) {
      sums.set(name, f);
    }
  }

  const visiting = new Set<string>();
  const done = new Set<string>();
  const computedNumeric = new Map<string, number>();

  const resolveDependencyTargets = (dependency: string): string[] => {
    if (dependency in next || fieldByName.has(dependency)) {
      return [dependency];
    }
    const prefix = `${dependency}.`;
    const childNames = new Set<string>();
    for (const key of Object.keys(next)) {
      if (key.startsWith(prefix)) childNames.add(key);
    }
    for (const key of fieldByName.keys()) {
      if (key.startsWith(prefix)) childNames.add(key);
    }
    return [...childNames];
  };

  const calculate = (name: string): boolean => {
    if (done.has(name)) return true;
    if (visiting.has(name)) return false;
    const field = sums.get(name);
    if (!field?.sumFields) return true;

    visiting.add(name);
    const nums: number[] = [];

    for (const rawDep of field.sumFields) {
      const targets = resolveDependencyTargets(rawDep);
      if (targets.length === 0) {
        visiting.delete(name);
        return false;
      }
      for (const dependency of targets) {
        if (dependency === name) {
          visiting.delete(name);
          return false;
        }
        if (!(dependency in next) && !sums.has(dependency)) {
          visiting.delete(name);
          return false;
        }
        if (!calculate(dependency)) {
          visiting.delete(name);
          return false;
        }
        if (computedNumeric.has(dependency)) {
          nums.push(computedNumeric.get(dependency)!);
        } else {
          const depField = fieldByName.get(dependency);
          const n = parseFieldNumericValue(next[dependency], depField);
          if (n === null) {
            visiting.delete(name);
            return false;
          }
          nums.push(n);
        }
      }
    }

    visiting.delete(name);
    const total = nums.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total)) return false;

    computedNumeric.set(name, total);
    next[name] =
      field.numberDecimals === undefined
        ? String(Number(total.toFixed(12)))
        : formatNumberValue(total, field.numberDecimals, field.sepStyle ?? 0);
    done.add(name);
    return true;
  };

  for (const name of sums.keys()) {
    calculate(name);
  }
  return next;
}

/**
 * Pure pdf-lib AcroForm field extraction (used as fallback in pdfEngine and in Node test suites).
 */
export async function extractPdfFormFieldsViaPdfLib(
  pdfBytes: ArrayBuffer
): Promise<{ fields: FormFieldItem[]; initialValues: FormValuesState }> {
  try {
    const copy = pdfBytes.slice(0);
    const pdfDoc = await PDFDocument.load(copy, {
      ignoreEncryption: true,
      updateMetadata: false,
      throwOnInvalidObject: false,
      capNumbers: true,
    });

    const form = pdfDoc.getForm();
    if (!form) return { fields: [], initialValues: {} };

    const acroFields = form.getFields();
    if (!acroFields || acroFields.length === 0) {
      return { fields: [], initialValues: {} };
    }

    const actions = await readFormActions(pdfBytes).catch(() => new Map());
    const formatting = await readFormFormatting(pdfBytes).catch(() => new Map());
    const pages = pdfDoc.getPages();
    const extractedFields: FormFieldItem[] = [];
    const initialValues: FormValuesState = {};

    for (const field of acroFields) {
      const name = field.getName();
      let fieldType: FormFieldType = 'other';
      let options: string[] | undefined = undefined;
      let initialVal: string | boolean | string[] = '';
      let isMultiline = false;

      if ('getText' in field) {
        fieldType = 'text';
        try {
          initialVal = (field as any).getText() || '';
          isMultiline = (field as any).isMultiline ? (field as any).isMultiline() : false;
        } catch {
          initialVal = '';
        }
      } else if ('isChecked' in field) {
        fieldType = 'checkbox';
        try {
          initialVal = (field as any).isChecked() || false;
        } catch {
          initialVal = false;
        }
      } else if ('getOptions' in field && 'isMultiselect' in field) {
        fieldType = 'listbox';
        try {
          options = (field as any).getOptions() || [];
          const selected = (field as any).getSelected() || [];
          initialVal = selected.length > 0 ? selected[0] : (options && options[0]) || '';
        } catch {
          initialVal = '';
        }
      } else if ('getOptions' in field && 'getSelected' in field) {
        try {
          options = (field as any).getOptions() || [];
          initialVal = (field as any).getSelected() || '';
          if ((field as any).isRadioGroup || field.constructor.name.includes('Radio')) {
            fieldType = 'radio';
          } else {
            fieldType = 'dropdown';
          }
        } catch {
          initialVal = '';
        }
      } else if (field.constructor.name.includes('Button') || (field as any).acroField?.getFlags) {
        fieldType = 'button';
      } else {
        continue;
      }

      if (fieldType !== 'button') {
        initialValues[name] = initialVal;
      }

      const widgets = (field as any).acroField?.getWidgets?.() || [];
      for (let wIdx = 0; wIdx < widgets.length; wIdx++) {
        const widget = widgets[wIdx];
        let widgetPageIndex = 0;
        let widgetAnnotId: string | undefined = undefined;

        for (let p = 0; p < pages.length; p++) {
          try {
            const rawAnnots = pages[p].node.Annots();
            const annots = rawAnnots ? pdfDoc.context.lookup(rawAnnots) : null;
            if (annots && typeof (annots as any).size === 'function') {
              for (let j = 0; j < (annots as any).size(); j++) {
                const annotItem = (annots as any).get(j);
                const resolved = pdfDoc.context.lookup(annotItem);
                const widgetRef = (widget as any).ref || (widget as any).dict;
                if (annotItem === widgetRef || resolved === (widget as any).dict) {
                  widgetPageIndex = p;
                  if (annotItem && typeof annotItem.objectNumber === 'number') {
                    widgetAnnotId = `${annotItem.objectNumber}R${annotItem.generationNumber || ''}`;
                  }
                  break;
                }
              }
            }
          } catch {
            // Ignore page annotation resolution error
          }
        }

        const targetPage = pages[widgetPageIndex];
        const mediaBox = targetPage.getMediaBox();
        const cropBox = targetPage.getCropBox();
        const box = cropBox || mediaBox;
        const originX = (box && box.x) || 0;
        const originY = (box && box.y) || 0;
        const boxWidth = (box && box.width) || targetPage.getWidth();
        const boxHeight = (box && box.height) || targetPage.getHeight();

        const rect = widget.getRectangle?.();
        if (!rect) continue;

        const xRel = rect.x - originX;
        const yRel = rect.y - originY;

        const xPercent = (xRel / boxWidth) * 100;
        const yPercent = ((boxHeight - (yRel + rect.height)) / boxHeight) * 100;
        const widthPercent = (rect.width / boxWidth) * 100;
        const heightPercent = (rect.height / boxHeight) * 100;

        let radioOptValue: string | undefined = undefined;
        if (fieldType === 'radio' && options && options[wIdx]) {
          radioOptValue = options[wIdx];
        }

        let initiallyHidden = false;
        try {
          const flagsNum =
            typeof widget.getFlags === 'function'
              ? widget.getFlags()
              : widget.dict?.lookup(PDFName.of('F')) instanceof PDFNumber
                ? (widget.dict.lookup(PDFName.of('F')) as PDFNumber).asNumber()
                : 0;
          // PDF Annotation Flag Bit 2 = Hidden (2), Bit 6 = NoView (32)
          initiallyHidden = (flagsNum & 34) !== 0;
        } catch {
          initiallyHidden = false;
        }

        const matchedAction =
          (widgetAnnotId ? actions.get(widgetAnnotId) : undefined) ?? actions.get(`name:${name}`);
        const matchedFormat =
          (widgetAnnotId ? formatting.get(widgetAnnotId) : undefined) ??
          formatting.get(`name:${name}`);

        extractedFields.push({
          id: `field-${name}-${widgetAnnotId || extractedFields.length}`,
          name,
          type: fieldType,
          pageNumber: widgetPageIndex + 1,
          xPercent: Math.max(0, Math.min(95, xPercent)),
          yPercent: Math.max(0, Math.min(95, yPercent)),
          widthPercent: Math.max(1, Math.min(100, widthPercent)),
          heightPercent: Math.max(1, Math.min(100, heightPercent)),
          options,
          value: radioOptValue,
          multiline: isMultiline,
          readOnly: (field as any).isReadOnly ? (field as any).isReadOnly() : false,
          initiallyHidden,
          action: matchedAction,
          numberDecimals: matchedFormat?.numberDecimals,
          sepStyle: matchedFormat?.sepStyle,
          sumFields: matchedFormat?.sumFields,
          defaultValue: initialVal,
        });
      }
    }

    return { fields: extractedFields, initialValues };
  } catch (err) {
    console.warn('pdf-lib fallback extraction failed:', err);
    return { fields: [], initialValues: {} };
  }
}

