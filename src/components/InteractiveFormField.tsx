import React from 'react';
import { FormFieldItem } from '../types';
import { Check, ChevronDown, RotateCcw } from 'lucide-react';

interface InteractiveFormFieldProps {
  field: FormFieldItem;
  value: any;
  containerWidth: number;
  containerHeight: number;
  zoomLevel?: number;
  onChange: (name: string, val: any, isDirectChoice?: boolean) => void;
  onCommitField?: (name: string, val: any) => void;
  onReset?: () => void;
}

export const InteractiveFormField: React.FC<InteractiveFormFieldProps> = ({
  field,
  value,
  containerWidth,
  containerHeight,
  zoomLevel = 100,
  onChange,
  onCommitField,
  onReset,
}) => {
  const scale = zoomLevel / 100;
  const pixelX = (field.xPercent / 100) * containerWidth;
  const pixelY = (field.yPercent / 100) * containerHeight;
  const pixelW = (field.widthPercent / 100) * containerWidth;
  const pixelH = (field.heightPercent / 100) * containerHeight;

  // 1. Checkbox
  if (field.type === 'checkbox') {
    const isChecked = value === true || value === 'true' || value === 'Yes';
    const boxW = Math.max(6, pixelW);
    const boxH = Math.max(6, pixelH);
    const iconSize = Math.max(5, Math.min(boxW, boxH) * 0.78);

    return (
      <div
        data-form-field
        id={`form-field-${field.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onChange(field.name, !isChecked, true);
        }}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${boxW}px`,
          height: `${boxH}px`,
          borderRadius: `${Math.max(1, Math.min(4, boxH * 0.16))}px`,
          borderWidth: `${Math.max(1, Math.min(2.5, boxH * 0.1))}px`,
        }}
        className="absolute z-20 cursor-pointer pointer-events-auto flex items-center justify-center bg-blue-50/70 hover:bg-blue-100/90 border-blue-500 transition-all shadow-2xs hover:scale-105 active:scale-95"
        title={`Checkbox: ${field.name}`}
      >
        {isChecked && (
          <Check
            style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
            className="text-blue-700 stroke-[3]"
          />
        )}
      </div>
    );
  }

  // 2. Radio Button
  if (field.type === 'radio') {
    const isChecked =
      (value !== undefined && value !== null && value !== '' && String(value) === String(field.value)) ||
      (value === true && field.value === 'Yes');

    const boxW = Math.max(6, pixelW);
    const boxH = Math.max(6, pixelH);
    const size = Math.min(boxW, boxH);
    const dotSize = Math.max(3, size * 0.5);

    return (
      <div
        data-form-field
        id={`form-field-${field.id}`}
        onClick={(e) => {
          e.stopPropagation();
          onChange(field.name, field.value || 'Yes', true);
        }}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${boxW}px`,
          height: `${boxH}px`,
        }}
        className="absolute z-20 cursor-pointer pointer-events-auto flex items-center justify-center"
        title={`Radio: ${field.name} (${field.value || 'Option'})`}
      >
        <div
          style={{
            width: `${size}px`,
            height: `${size}px`,
            borderWidth: `${Math.max(1, Math.min(2.5, size * 0.1))}px`,
          }}
          className="rounded-full flex items-center justify-center bg-blue-50/70 hover:bg-blue-100/90 border-blue-500 transition-all shadow-2xs hover:scale-105 active:scale-95"
        >
          {isChecked && (
            <div
              style={{ width: `${dotSize}px`, height: `${dotSize}px` }}
              className="rounded-full bg-blue-700 shadow-2xs"
            />
          )}
        </div>
      </div>
    );
  }

  // 3. Dropdown / Combobox
  if (field.type === 'dropdown') {
    const boxW = Math.max(16, pixelW);
    const boxH = Math.max(10, pixelH);
    const fontSize = Math.max(6, Math.min(28, boxH * 0.65));
    const chevronSize = Math.max(6, Math.min(16, boxH * 0.5));
    const paddingLeft = Math.max(2, Math.round(boxH * 0.15));
    const paddingRight = chevronSize + Math.max(3, Math.round(boxH * 0.15));

    return (
      <div
        data-form-field
        id={`form-field-${field.id}`}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${boxW}px`,
          height: `${boxH}px`,
        }}
        className="absolute z-20 relative pointer-events-auto"
        title={`Dropdown: ${field.name}`}
      >
        <select
          value={String(value || '')}
          onChange={(e) => {
            e.stopPropagation();
            onChange(field.name, e.target.value, true);
          }}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: `${fontSize}px`,
            paddingLeft: `${paddingLeft}px`,
            paddingRight: `${paddingRight}px`,
            borderRadius: `${Math.max(1, Math.min(4, boxH * 0.15))}px`,
          }}
          className="w-full h-full bg-blue-50/75 hover:bg-blue-100/90 focus:bg-white border border-blue-400 focus:border-blue-600 text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-blue-500/50 cursor-pointer appearance-none font-medium shadow-2xs leading-none"
        >
          {(field.options || []).map((opt) => (
            <option key={opt} value={opt} style={{ fontSize: '12px' }}>
              {opt}
            </option>
          ))}
        </select>
        <ChevronDown
          style={{
            width: `${chevronSize}px`,
            height: `${chevronSize}px`,
            right: `${Math.max(2, Math.round(boxH * 0.1))}px`,
          }}
          className="absolute top-1/2 -translate-y-1/2 text-blue-600 pointer-events-none"
        />
      </div>
    );
  }

  // 4. Listbox (Scrollable Option List)
  if (field.type === 'listbox') {
    const boxW = Math.max(20, pixelW);
    const boxH = Math.max(16, pixelH);
    const optionCount = Math.max(1, (field.options || []).length);
    const itemH = Math.max(10, boxH / Math.min(optionCount, 4));
    const fontSize = Math.max(6, Math.min(16, itemH * 0.65));

    return (
      <div
        data-form-field
        id={`form-field-${field.id}`}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${boxW}px`,
          height: `${boxH}px`,
          borderRadius: `${Math.max(1, Math.min(4, boxH * 0.1))}px`,
        }}
        className="absolute z-20 pointer-events-auto bg-white/95 border border-blue-400/90 shadow-2xs overflow-hidden flex flex-col"
        title={`List: ${field.name}`}
      >
        <div className="overflow-y-auto flex-1 p-0.5 space-y-0.5">
          {(field.options || []).map((opt) => {
            const isSelected = String(value) === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(field.name, opt, true);
                }}
                style={{
                  fontSize: `${fontSize}px`,
                  paddingTop: `${Math.max(1, itemH * 0.08)}px`,
                  paddingBottom: `${Math.max(1, itemH * 0.08)}px`,
                  paddingLeft: `${Math.max(2, itemH * 0.15)}px`,
                  paddingRight: `${Math.max(2, itemH * 0.15)}px`,
                }}
                className={`w-full text-left rounded transition-colors block truncate ${
                  isSelected
                    ? 'bg-blue-600 text-white font-semibold'
                    : 'text-slate-800 hover:bg-blue-50'
                }`}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // 5. Button (e.g. Reset or Action button)
  if (field.type === 'button') {
    const boxW = Math.max(20, pixelW);
    const boxH = Math.max(12, pixelH);
    const fontSize = Math.max(6, Math.min(16, boxH * 0.5));
    const iconSize = Math.max(5, Math.min(14, boxH * 0.45));
    const isReset = field.name.toLowerCase().includes('reset');

    return (
      <div
        data-form-field
        id={`form-field-${field.id}`}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${boxW}px`,
          height: `${boxH}px`,
        }}
        className="absolute z-20 pointer-events-auto"
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isReset && onReset) {
              onReset();
            } else {
              onChange(field.name, 'clicked', true);
            }
          }}
          style={{
            fontSize: `${fontSize}px`,
            borderRadius: `${Math.max(1, Math.min(4, boxH * 0.15))}px`,
          }}
          className="w-full h-full flex items-center justify-center gap-1 px-1 bg-slate-200 hover:bg-slate-300 active:bg-slate-400 text-slate-800 border border-slate-400 font-semibold shadow-2xs transition cursor-pointer"
          title={field.name}
        >
          {isReset && (
            <RotateCcw
              style={{ width: `${iconSize}px`, height: `${iconSize}px` }}
              className="text-slate-600 shrink-0"
            />
          )}
          <span className="truncate">{field.name || 'Action'}</span>
        </button>
      </div>
    );
  }

  // 6. Multiline Text Area (Notes, Comments, Address)
  if (field.multiline || pixelH > 36) {
    const boxW = Math.max(14, pixelW);
    const boxH = Math.max(14, pixelH);
    const fontSize = Math.max(6, Math.min(22, 11.5 * scale));
    const padding = Math.max(2, Math.min(8, 4 * scale));

    return (
      <div
        data-form-field
        id={`form-field-${field.id}`}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${boxW}px`,
          height: `${boxH}px`,
        }}
        className="absolute z-20 pointer-events-auto"
        title={field.name}
      >
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(field.name, e.target.value, false)}
          onBlur={(e) => onCommitField?.(field.name, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: `${fontSize}px`,
            padding: `${padding}px`,
            lineHeight: 1.25,
            borderRadius: `${Math.max(1, Math.min(4, boxH * 0.08))}px`,
          }}
          className="w-full h-full bg-blue-50/70 hover:bg-blue-100/80 focus:bg-white border border-blue-400/80 focus:border-blue-600 text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-blue-500/50 transition-colors font-sans resize-none leading-normal shadow-2xs"
        />
      </div>
    );
  }

  // 7. Comb Text Field (e.g. ID with fixed number of characters/boxes)
  if (field.comb && field.maxLen && field.maxLen > 1) {
    const maxLen = field.maxLen;
    const strVal = String(value ?? '');
    const boxW = Math.max(14, pixelW);
    const boxH = Math.max(8, pixelH);
    const cellWidth = boxW / maxLen;
    const fontSize = Math.max(6, Math.min(28, boxH * 0.7, cellWidth * 0.8));
    const charWidth = fontSize * 0.6;
    const letterSpacing = Math.max(0, cellWidth - charWidth);
    const paddingLeft = Math.max(0, (cellWidth - charWidth) / 2);

    return (
      <div
        data-form-field
        id={`form-field-${field.id}`}
        style={{
          left: `${pixelX}px`,
          top: `${pixelY}px`,
          width: `${boxW}px`,
          height: `${boxH}px`,
        }}
        className="absolute z-20 pointer-events-auto"
        title={field.name}
      >
        <input
          type="text"
          maxLength={maxLen}
          value={strVal}
          onChange={(e) => onChange(field.name, e.target.value, false)}
          onBlur={(e) => onCommitField?.(field.name, e.target.value)}
          onClick={(e) => e.stopPropagation()}
          style={{
            fontSize: `${fontSize}px`,
            letterSpacing: `${letterSpacing}px`,
            paddingLeft: `${paddingLeft}px`,
            lineHeight: `${boxH}px`,
            borderRadius: `${Math.max(1, Math.min(4, boxH * 0.15))}px`,
          }}
          className="w-full h-full bg-blue-50/70 hover:bg-blue-100/80 focus:bg-white border border-blue-400/80 focus:border-blue-600 text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-blue-500/50 transition-colors font-mono font-bold tracking-widest shadow-2xs"
        />
      </div>
    );
  }

  // 8. Standard Single-line Text Input
  const boxW = Math.max(10, pixelW);
  const boxH = Math.max(8, pixelH);
  const fontSize = Math.max(6, Math.min(32, boxH * 0.68));
  const paddingX = Math.max(2, Math.min(8, Math.round(boxH * 0.15)));

  return (
    <div
      data-form-field
      id={`form-field-${field.id}`}
      style={{
        left: `${pixelX}px`,
        top: `${pixelY}px`,
        width: `${boxW}px`,
        height: `${boxH}px`,
      }}
      className="absolute z-20 pointer-events-auto"
      title={field.name}
    >
      <input
        type="text"
        maxLength={field.maxLen}
        value={String(value ?? '')}
        onChange={(e) => onChange(field.name, e.target.value, false)}
        onBlur={(e) => onCommitField?.(field.name, e.target.value)}
        onClick={(e) => e.stopPropagation()}
        style={{
          fontSize: `${fontSize}px`,
          paddingLeft: `${paddingX}px`,
          paddingRight: `${paddingX}px`,
          lineHeight: `${boxH}px`,
          borderRadius: `${Math.max(1, Math.min(4, boxH * 0.15))}px`,
        }}
        className="w-full h-full bg-blue-50/70 hover:bg-blue-100/80 focus:bg-white border border-blue-400/80 focus:border-blue-600 text-slate-900 focus:outline-hidden focus:ring-1 focus:ring-blue-500/50 transition-colors font-sans shadow-2xs"
      />
    </div>
  );
};
