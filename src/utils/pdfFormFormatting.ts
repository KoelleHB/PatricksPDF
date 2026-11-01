import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString, decodePDFRawStream } from 'pdf-lib';
import type { FormFieldItem, FormValuesState } from '../types';

export interface SupportedFormFormatting { numberDecimals?: number; sepStyle?: number; sumFields?: string[] }

// Recognize a deliberately small, complete grammar. Document scripts are never evaluated.
export function parseSupportedFormFormatting(format: string, calculate: string): SupportedFormFormatting {
  const result: SupportedFormFormatting = {};
  const number = /^\s*AFNumber_Format\(\s*([0-6])\s*,\s*([0-4])\s*,\s*0\s*,\s*0\s*,\s*(?:""|'')\s*,\s*true\s*\)\s*;?\s*$/.exec(format);
  if (number) {
    result.numberDecimals = Number(number[1]);
    result.sepStyle = Number(number[2]);
  }
  const sum = /^\s*AFSimple_Calculate\(\s*"SUM"\s*,\s*new\s+Array\s*\(\s*((?:"[^"\\]*"\s*,\s*)*"[^"\\]*"\s*)\)\s*\)\s*;?\s*$/.exec(calculate);
  if (sum) result.sumFields = [...sum[1].matchAll(/"([^"\\]*)"/g)].map(match => match[1]);
  return result;
}

export async function readFormFormatting(bytes: ArrayBuffer): Promise<Map<string, SupportedFormFormatting>> {
  const doc = await PDFDocument.load(bytes.slice(0), { updateMetadata: false });
  const result = new Map<string, SupportedFormFormatting>();
  const decode = (v: unknown): string | null => v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : null;
  const getWidgetFieldName = (widget: PDFDict): string | null => {
    const t = decode(widget.lookup(PDFName.of('T')));
    if (t) return t;
    let parent = widget.lookup(PDFName.of('Parent'));
    while (parent instanceof PDFDict) {
      const pt = decode(parent.lookup(PDFName.of('T')));
      if (pt) return pt;
      parent = parent.lookup(PDFName.of('Parent'));
    }
    return null;
  };
  const readScript = (action: unknown): string => {
    if (!(action instanceof PDFDict) || action.lookup(PDFName.of('S')) !== PDFName.of('JavaScript') || action.has(PDFName.of('Next'))) return '';
    const script = action.lookup(PDFName.of('JS'));
    if (script instanceof PDFString || script instanceof PDFHexString) return script.decodeText();
    if (script instanceof PDFRawStream) return new TextDecoder().decode(decodePDFRawStream(script).decode());
    return '';
  };
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i), widget = annots.lookup(i);
      if (!(ref instanceof PDFRef) || !(widget instanceof PDFDict)) continue;
      const aa = widget.lookup(PDFName.of('AA'));
      if (!(aa instanceof PDFDict)) continue;
      const parsed = parseSupportedFormFormatting(readScript(aa.lookup(PDFName.of('F'))), readScript(aa.lookup(PDFName.of('C'))));
      if (parsed.numberDecimals !== undefined || parsed.sumFields) {
        result.set(`${ref.objectNumber}R${ref.generationNumber || ''}`, parsed);
        const fieldName = getWidgetFieldName(widget);
        if (fieldName) result.set(`name:${fieldName}`, parsed);
      }
    }
  }
  return result;
}

export function parseNumber(value: unknown, sepStyle?: number): number | null {
  const text = String(value ?? '').trim();
  if (!text) return 0;

  // European format (sepStyle 1 or 3): dot as thousands separator, comma as decimal (or space as thousands)
  // e.g. "1.234,50" or "1234,50" or "1 234,50"
  if (sepStyle === 1 || sepStyle === 3 || (!sepStyle && /^[+-]?(?:(?:\d{1,3}(?:[\. ]\d{3})+)|(?:\d+)),\d+$/.test(text))) {
    if (/^[+-]?(?:(?:\d{1,3}(?:[\. ]\d{3})+)|(?:\d+))(?:,\d+)?$/.test(text)) {
      const normalized = text.replace(/[\. ]/g, '').replace(',', '.');
      const num = Number(normalized);
      return Number.isFinite(num) ? num : null;
    }
  }

  // US format: comma as thousands separator, dot as decimal (e.g. "1,234.50" or "1234.50")
  if (/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?$/.test(text)) {
    const num = Number(text.replace(/,/g, ''));
    return Number.isFinite(num) ? num : null;
  }

  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

export function formatSupportedNumber(value: string, decimals: number, sepStyle?: number): string {
  if (!value.trim()) return value;
  const parsed = parseNumber(value, sepStyle);
  if (parsed === null) return value;
  const locale = (sepStyle === 1 || sepStyle === 3) ? 'de-DE' : 'en-US';
  return new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: true }).format(parsed);
}

// Compute only acyclic, fully recognized SUM expressions; unknown values leave the existing result unchanged.
export function calculateSupportedForms(values: FormValuesState, fields: FormFieldItem[]): FormValuesState {
  const next = { ...values };
  const sums = new Map(fields.filter(field => field.sumFields?.length).map(field => [field.name, field]));
  const visiting = new Set<string>(), done = new Set<string>();
  const calculate = (name: string): boolean => {
    if (done.has(name)) return true;
    if (visiting.has(name)) return false;
    const field = sums.get(name);
    if (!field?.sumFields) return true;
    visiting.add(name);
    const nums: number[] = [];
    for (const dependency of field.sumFields) {
      if (!(dependency in next) || !calculate(dependency)) { visiting.delete(name); return false; }
      const depField = fields.find(f => f.name === dependency);
      const n = parseNumber(next[dependency], depField?.sepStyle);
      if (n === null) { visiting.delete(name); return false; }
      nums.push(n);
    }
    visiting.delete(name);
    const total = nums.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total)) return false;
    next[name] = field.numberDecimals === undefined ? String(total) : formatSupportedNumber(String(total), field.numberDecimals, field.sepStyle);
    done.add(name);
    return true;
  };
  for (const name of sums.keys()) calculate(name);
  return next;
}
