import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib';
import type { PdfFormAction } from '../types';

const MAX_HIERARCHY_DEPTH = 64;

export function decodePdfString(v: unknown): string | null {
  return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : null;
}

export function resolvePdfDict(doc: PDFDocument, value: unknown): PDFDict | null {
  if (value instanceof PDFDict) return value;
  if (value instanceof PDFRef) {
    const lookedUp = doc.context.lookup(value);
    return lookedUp instanceof PDFDict ? lookedUp : null;
  }
  return null;
}

/**
 * Resolves the complete, dot-separated AcroForm field name (`parent.child.leaf`) by walking
 * up the `/Parent` chain with strict cycle and depth protection.
 */
export function getFullyQualifiedFieldName(dict: PDFDict, doc: PDFDocument): string | null {
  const segments: string[] = [];
  const visited = new Set<PDFDict>();
  let current: PDFDict | null = dict;
  let depth = 0;

  while (current && !visited.has(current) && depth < MAX_HIERARCHY_DEPTH) {
    visited.add(current);
    depth++;
    const rawT = current.lookup(PDFName.of('T'));
    const t = decodePdfString(rawT);
    if (t !== null && t.length > 0) {
      // Avoid duplicating identical consecutive /T when a non-standard generator copies /T onto a child widget
      if (segments.length === 0 || segments[0] !== t) {
        segments.unshift(t);
      }
    }
    const rawParent = current.get(PDFName.of('Parent')) ?? current.lookup(PDFName.of('Parent'));
    current = resolvePdfDict(doc, rawParent);
  }

  if (depth >= MAX_HIERARCHY_DEPTH || (current && visited.has(current))) {
    // Cyclic or excessively deep /Parent hierarchy detected: reject safely
    return null;
  }

  return segments.length > 0 ? segments.join('.') : null;
}

/**
 * Resolves target field names for `/Hide` (`/T`) and `/ResetForm` (`/Fields`).
 * Supports single strings, single indirect field/widget dictionary references (`PDFRef`/`PDFDict`),
 * and arrays mixing strings and indirect dictionary references.
 * Returns `null` if any target entry is invalid, unresolvable, or cyclic.
 */
function resolveActionTargetNames(value: unknown, doc: PDFDocument): string[] | null {
  const singleText = decodePdfString(value);
  if (singleText !== null) {
    return singleText.length > 0 ? [singleText] : null;
  }

  const singleDict = resolvePdfDict(doc, value);
  if (singleDict) {
    const fqName = getFullyQualifiedFieldName(singleDict, doc);
    return fqName ? [fqName] : null;
  }

  if (!(value instanceof PDFArray)) return null;

  const names: string[] = [];
  for (let i = 0; i < value.size(); i++) {
    const rawItem = value.get(i);
    const lookedUp = value.lookup(i);
    const text = decodePdfString(lookedUp);
    if (text !== null) {
      if (text.length === 0) return null;
      if (!names.includes(text)) names.push(text);
      continue;
    }
    const targetDict = resolvePdfDict(doc, rawItem) ?? resolvePdfDict(doc, lookedUp);
    if (targetDict) {
      const fqName = getFullyQualifiedFieldName(targetDict, doc);
      if (!fqName) return null;
      if (!names.includes(fqName)) names.push(fqName);
      continue;
    }
    return null;
  }
  return names;
}

/**
 * Finds the most specific activation action dictionary for a widget or field dictionary.
 * Checks direct `/A` and `/AA` (`/U` Mouse Up, `/D` Mouse Down) on the widget first,
 * then walks up `/Parent` dictionaries with cycle protection.
 */
function resolveEffectiveActionDict(widget: PDFDict, doc: PDFDocument): PDFDict | null {
  const visited = new Set<PDFDict>();
  let current: PDFDict | null = widget;
  let depth = 0;

  while (current && !visited.has(current) && depth < MAX_HIERARCHY_DEPTH) {
    visited.add(current);
    depth++;

    const directA = resolvePdfDict(doc, current.get(PDFName.of('A')) ?? current.lookup(PDFName.of('A')));
    if (directA) return directA;

    const aa = resolvePdfDict(doc, current.get(PDFName.of('AA')) ?? current.lookup(PDFName.of('AA')));
    if (aa) {
      const mouseUp = resolvePdfDict(doc, aa.get(PDFName.of('U')) ?? aa.lookup(PDFName.of('U')));
      if (mouseUp) return mouseUp;
      const mouseDown = resolvePdfDict(doc, aa.get(PDFName.of('D')) ?? aa.lookup(PDFName.of('D')));
      if (mouseDown) return mouseDown;
    }

    const rawParent = current.get(PDFName.of('Parent')) ?? current.lookup(PDFName.of('Parent'));
    current = resolvePdfDict(doc, rawParent);
  }

  return null;
}

function parseDeclarativeActionDict(action: PDFDict, doc: PDFDocument): PdfFormAction | undefined {
  // Chained action lists (/Next) are intentionally not executed
  if (action.has(PDFName.of('Next'))) return undefined;
  const kind = action.lookup(PDFName.of('S'));
  if (kind === PDFName.of('Hide')) {
    const rawT = action.get(PDFName.of('T')) ?? action.lookup(PDFName.of('T'));
    const targets = resolveActionTargetNames(rawT, doc);
    const flag = action.lookup(PDFName.of('H'));
    if (targets && targets.length > 0 && (!flag || flag instanceof PDFBool)) {
      return {
        type: 'hide',
        targets,
        hide: flag instanceof PDFBool ? flag.asBoolean() : true,
      };
    }
  } else if (kind === PDFName.of('ResetForm')) {
    const raw = action.get(PDFName.of('Fields')) ?? action.lookup(PDFName.of('Fields'));
    const fields = raw === undefined ? [] : resolveActionTargetNames(raw, doc);
    const flags = action.lookup(PDFName.of('Flags'));
    if (fields && (!flags || flags instanceof PDFNumber)) {
      return {
        type: 'reset',
        fields,
        exclude: flags instanceof PDFNumber && (flags.asNumber() & 1) !== 0,
      };
    }
  }
  return undefined;
}

/**
 * Collects all widget/field `(ref, dict)` pairs from both page `/Annots` and `AcroForm /Fields`
 * with cycle and depth protection.
 */
export function collectAcroFormObjects(doc: PDFDocument): Array<{ ref: PDFRef | null; dict: PDFDict }> {
  const results: Array<{ ref: PDFRef | null; dict: PDFDict }> = [];
  const seenDicts = new Set<PDFDict>();

  const addEntry = (rawRef: unknown, dict: PDFDict) => {
    if (seenDicts.has(dict)) return;
    seenDicts.add(dict);
    results.push({ ref: rawRef instanceof PDFRef ? rawRef : null, dict });
  };

  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const rawRef = annots.get(i);
      const dict = resolvePdfDict(doc, rawRef) ?? resolvePdfDict(doc, annots.lookup(i));
      if (dict) addEntry(rawRef, dict);
    }
  }

  const walkFieldTree = (arr: PDFArray, depth: number, visitedArrays: Set<PDFArray>) => {
    if (depth >= MAX_HIERARCHY_DEPTH || visitedArrays.has(arr)) return;
    visitedArrays.add(arr);
    for (let i = 0; i < arr.size(); i++) {
      const rawRef = arr.get(i);
      const dict = resolvePdfDict(doc, rawRef) ?? resolvePdfDict(doc, arr.lookup(i));
      if (!dict) continue;
      addEntry(rawRef, dict);
      const kids = dict.lookup(PDFName.of('Kids'));
      if (kids instanceof PDFArray) {
        walkFieldTree(kids, depth + 1, visitedArrays);
      }
    }
  };

  const acroForm = resolvePdfDict(doc, doc.catalog.lookup(PDFName.of('AcroForm')));
  const rootFields = acroForm?.lookup(PDFName.of('Fields'));
  if (rootFields instanceof PDFArray) {
    walkFieldTree(rootFields, 0, new Set<PDFArray>());
  }

  return results;
}

// Only interpret declarative PDF actions. Never execute embedded JavaScript.
export async function readFormActions(bytes: ArrayBuffer): Promise<Map<string, PdfFormAction>> {
  const actions = new Map<string, PdfFormAction>();
  const doc = await PDFDocument.load(bytes.slice(0), { updateMetadata: false });

  const entries = collectAcroFormObjects(doc);
  // Track field-level actions: if multiple widgets of the same field define conflicting actions,
  // only widget-ref keys are used and the ambiguous field-name fallback is omitted.
  const fieldNameActions = new Map<string, PdfFormAction | 'CONFLICT'>();

  for (const { ref, dict } of entries) {
    const fqName = getFullyQualifiedFieldName(dict, doc);
    const actionDict = resolveEffectiveActionDict(dict, doc);
    if (!actionDict) continue;

    const parsed = parseDeclarativeActionDict(actionDict, doc);
    if (!parsed) {
      // If a widget has an explicit unsupported action, mark conflict on field-name fallback
      if (fqName) fieldNameActions.set(fqName, 'CONFLICT');
      continue;
    }

    if (ref) {
      actions.set(`${ref.objectNumber}R`, parsed);
      actions.set(`${ref.objectNumber}R${ref.generationNumber || ''}`, parsed);
    }

    if (fqName) {
      const existing = fieldNameActions.get(fqName);
      if (!existing) {
        fieldNameActions.set(fqName, parsed);
      } else if (existing !== 'CONFLICT' && JSON.stringify(existing) !== JSON.stringify(parsed)) {
        fieldNameActions.set(fqName, 'CONFLICT');
      }
    }
  }

  for (const [fqName, act] of fieldNameActions.entries()) {
    if (act !== 'CONFLICT') {
      actions.set(`name:${fqName}`, act);
    }
  }

  return actions;
}

/**
 * Resolves the effective visibility of a form field given dynamic `formVisibility` overrides
 * and the field's initial `/F` Hidden/NoView state (`initiallyHidden`).
 * Uses most-specific hierarchical prefix matching (`a.b.c` > `a.b` > `a`).
 */
export function isFormFieldVisible(
  field: { name: string; initiallyHidden?: boolean },
  formVisibility?: Record<string, boolean>
): boolean {
  if (formVisibility) {
    if (Object.prototype.hasOwnProperty.call(formVisibility, field.name)) {
      return Boolean(formVisibility[field.name]);
    }
    let bestKey: string | undefined;
    for (const key of Object.keys(formVisibility)) {
      if (field.name.startsWith(`${key}.`)) {
        if (!bestKey || key.length > bestKey.length) {
          bestKey = key;
        }
      }
    }
    if (bestKey !== undefined) {
      return Boolean(formVisibility[bestKey]);
    }
  }
  return !field.initiallyHidden;
}

/**
 * Applies a declarative `/Hide` action to `currentVisibility` and determines whether
 * the effective visibility state of the document actually changed.
 * When a field returns to its original `initiallyHidden` state, its override entry is
 * canonicalized so returning to the initial visibility state restores `isSaved`.
 */
export function applyHideActionToVisibility(
  currentVisibility: Record<string, boolean>,
  action: { targets: string[]; hide: boolean },
  formFields: Array<{ name: string; initiallyHidden?: boolean }> = []
): { nextVisibility: Record<string, boolean>; changed: boolean } {
  const desiredVisible = !action.hide;
  const nextVisibility: Record<string, boolean> = { ...currentVisibility };

  for (const target of action.targets) {
    if (!target) continue;
    // Remove more-specific child overrides under `target.` so the parent action applies uniformly
    const prefix = `${target}.`;
    for (const key of Object.keys(nextVisibility)) {
      if (key.startsWith(prefix)) {
        delete nextVisibility[key];
      }
    }

    const matchedFields = formFields.filter(
      (f) => f.name === target || f.name.startsWith(prefix)
    );

    if (
      matchedFields.length > 0 &&
      matchedFields.every((f) => Boolean(!f.initiallyHidden) === desiredVisible)
    ) {
      delete nextVisibility[target];
    } else {
      nextVisibility[target] = desiredVisible;
    }
  }

  let changed = false;
  if (formFields.length > 0) {
    for (const f of formFields) {
      if (isFormFieldVisible(f, nextVisibility) !== isFormFieldVisible(f, currentVisibility)) {
        changed = true;
        break;
      }
    }
  }

  if (!changed) {
    // Also check if any target without a corresponding entry in `formFields` changed
    const unmatchedTargets = action.targets.filter(
      (t) => !formFields.some((f) => f.name === t || f.name.startsWith(`${t}.`))
    );
    for (const t of unmatchedTargets) {
      const prevVal = Object.prototype.hasOwnProperty.call(currentVisibility, t)
        ? currentVisibility[t]
        : true;
      const nextVal = Object.prototype.hasOwnProperty.call(nextVisibility, t)
        ? nextVisibility[t]
        : true;
      if (prevVal !== nextVal) {
        changed = true;
        break;
      }
    }
  }

  if (!changed) {
    return { nextVisibility: currentVisibility, changed: false };
  }

  return { nextVisibility, changed: true };
}


