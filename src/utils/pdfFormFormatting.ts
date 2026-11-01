import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRawStream, PDFRef, PDFString, decodePDFRawStream } from 'pdf-lib';
import type { FormFieldItem, FormValuesState } from '../types';

export interface SupportedFormFormatting { numberDecimals?: number; sumFields?: string[] }

// Recognize a deliberately small, complete grammar. Document scripts are never evaluated.
export function parseSupportedFormFormatting(format: string, calculate: string): SupportedFormFormatting {
  const result: SupportedFormFormatting = {};
  const number = /^\s*AFNumber_Format\(\s*([0-6])\s*,\s*0\s*,\s*0\s*,\s*0\s*,\s*(?:""|'')\s*,\s*true\s*\)\s*;?\s*$/.exec(format);
  if (number) result.numberDecimals = Number(number[1]);
  const sum = /^\s*AFSimple_Calculate\(\s*"SUM"\s*,\s*new\s+Array\s*\(\s*((?:"[^"\\]*"\s*,\s*)*"[^"\\]*"\s*)\)\s*\)\s*;?\s*$/.exec(calculate);
  if (sum) result.sumFields = [...sum[1].matchAll(/"([^"\\]*)"/g)].map(match => match[1]);
  return result;
}

export async function readFormFormatting(bytes: ArrayBuffer): Promise<Map<string, SupportedFormFormatting>> {
  const doc = await PDFDocument.load(bytes.slice(0), { updateMetadata: false });
  const result = new Map<string, SupportedFormFormatting>();
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
      if (parsed.numberDecimals !== undefined || parsed.sumFields) result.set(`${ref.objectNumber}R${ref.generationNumber || ''}`, parsed);
    }
  }
  return result;
}

function parseNumber(value: unknown): number | null {
  const text = String(value ?? '').trim();
  if (!text) return 0;
  if (!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

export function formatSupportedNumber(value: string, decimals: number): string {
  if (!value.trim()) return value;
  const parsed = parseNumber(value);
  if (parsed === null) return value;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: true }).format(parsed);
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
      const n = parseNumber(next[dependency]);
      if (n === null) { visiting.delete(name); return false; }
      nums.push(n);
    }
    visiting.delete(name);
    const total = nums.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total)) return false;
    next[name] = field.numberDecimals === undefined ? String(total) : formatSupportedNumber(String(total), field.numberDecimals);
    done.add(name);
    return true;
  };
  for (const name of sums.keys()) calculate(name);
  return next;
}
