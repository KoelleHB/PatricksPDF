import React, { useState, useRef, useEffect } from 'react';
import { TextOverlayItem, TextColor } from '../types';
import {
  Trash2,
  Copy,
  Type,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  AlignCenterHorizontal,
  Sparkles,
} from 'lucide-react';

interface TextOverlayProps {
  item: TextOverlayItem;
  isSelected: boolean;
  containerWidth: number;
  containerHeight: number;
  zoomLevel?: number;
  onSelect: (id: string) => void;
  onUpdate: (updated: TextOverlayItem) => void;
  onCommitUpdate?: (updated: TextOverlayItem, actionName: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (item: TextOverlayItem) => void;
}

export const TextOverlay: React.FC<TextOverlayProps> = ({
  item,
  isSelected,
  containerWidth,
  containerHeight,
  zoomLevel = 100,
  onSelect,
  onUpdate,
  onCommitUpdate,
  onDelete,
  onDuplicate,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const elementRef = useRef<HTMLDivElement>(null);

  const latestItemRef = useRef<TextOverlayItem>(item);
  latestItemRef.current = item;
  const initialItemRef = useRef<TextOverlayItem | null>(null);

  // Dragging tracking
  const dragRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
  });

  // Calculate pixel positions from percentages without unscaled offsets
  const pixelX = (item.xPercent / 100) * containerWidth;
  const pixelY = (item.yPercent / 100) * containerHeight;

  // Font size calculation: match PDF export script multiplier (1.25x for script Caveat font)
  const fontMultiplier = item.fontFamily === 'script' ? 1.25 : 1.0;
  const effectiveFontSize = item.fontSize * fontMultiplier;
  const scaledFontSize = effectiveFontSize * (zoomLevel / 100);

  // Stable references for window drag listeners
  const onMoveRef = useRef<((e: PointerEvent) => void) | undefined>(undefined);
  const onUpRef = useRef<((e: PointerEvent) => void) | undefined>(undefined);

  onMoveRef.current = (e: PointerEvent) => {
    if (!dragRef.current.isDragging) return;
    e.preventDefault();

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    const newPixelX = Math.max(0, Math.min(containerWidth - 10, dragRef.current.initialX + dx));
    const newPixelY = Math.max(0, Math.min(containerHeight - 10, dragRef.current.initialY + dy));

    const newXPercent = (newPixelX / containerWidth) * 100;
    const newYPercent = (newPixelY / containerHeight) * 100;

    onUpdate({
      ...latestItemRef.current,
      xPercent: Math.round(newXPercent * 100) / 100,
      yPercent: Math.round(newYPercent * 100) / 100,
    });
  };

  onUpRef.current = () => {
    if (dragRef.current.isDragging) {
      dragRef.current.isDragging = false;
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);

      if (initialItemRef.current && onCommitUpdate) {
        const moved =
          Math.abs(initialItemRef.current.xPercent - latestItemRef.current.xPercent) > 0.05 ||
          Math.abs(initialItemRef.current.yPercent - latestItemRef.current.yPercent) > 0.05;
        if (moved) {
          onCommitUpdate(latestItemRef.current, 'Move Text');
        }
      }
      initialItemRef.current = null;
    }
  };

  const handleWindowPointerMove = (e: PointerEvent) => {
    onMoveRef.current?.(e);
  };

  const handleWindowPointerUp = (e: PointerEvent) => {
    onUpRef.current?.(e);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
    };
  }, []);

  // Keyboard navigation & micro-nudge listener when text item is selected
  useEffect(() => {
    if (!isSelected || isEditing) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      const step = e.shiftKey ? 1.0 : 0.2; // 1.0% with shift, 0.2% fine nudge
      let dx = 0;
      let dy = 0;

      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDelete(item.id);
        return;
      } else if (e.key === 'Enter') {
        e.preventDefault();
        setIsEditing(true);
        return;
      } else {
        return;
      }

      e.preventDefault();
      const updated: TextOverlayItem = {
        ...latestItemRef.current,
        xPercent: Math.max(0, Math.min(99, Math.round((latestItemRef.current.xPercent + dx) * 100) / 100)),
        yPercent: Math.max(0, Math.min(99, Math.round((latestItemRef.current.yPercent + dy) * 100) / 100)),
      };
      onUpdate(updated);
      if (onCommitUpdate) {
        onCommitUpdate(updated, 'Nudge Text');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelected, isEditing, onDelete, onUpdate, onCommitUpdate]);

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isEditing) return;

    const target = e.target as HTMLElement;
    if (
      target.closest('[data-text-tools]') ||
      target.closest('button') ||
      target.closest('textarea') ||
      target.closest('input')
    ) {
      return;
    }

    e.stopPropagation();
    onSelect(item.id);

    initialItemRef.current = { ...item };

    dragRef.current = {
      isDragging: true,
      startX: e.clientX,
      startY: e.clientY,
      initialX: pixelX,
      initialY: pixelY,
    };

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
  };

  // Nudge functions for micro-adjustments
  const nudge = (dxP: number, dyP: number) => {
    const updated = {
      ...item,
      xPercent: Math.max(0, Math.min(99, Math.round((item.xPercent + dxP) * 100) / 100)),
      yPercent: Math.max(0, Math.min(99, Math.round((item.yPercent + dyP) * 100) / 100)),
    };
    onUpdate(updated);
    if (onCommitUpdate) {
      onCommitUpdate(updated, 'Nudge Text');
    }
  };

  const centerHorizontally = () => {
    const updated = {
      ...item,
      xPercent: 40,
    };
    onUpdate(updated);
    if (onCommitUpdate) {
      onCommitUpdate(updated, 'Center Text');
    }
  };

  // Quick font toggles
  const toggleFont = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newFont = item.fontFamily === 'standard' ? 'script' : 'standard';
    const updated = { ...item, fontFamily: newFont as any };
    onUpdate(updated);
    if (onCommitUpdate) onCommitUpdate(updated, 'Change Font');
  };

  const toggleColor = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    let newColor: TextColor = 'black';
    if (item.color === 'black') newColor = 'blue';
    else if (item.color === 'blue') newColor = 'red';
    else newColor = 'black';
    const updated = { ...item, color: newColor };
    onUpdate(updated);
    if (onCommitUpdate) onCommitUpdate(updated, 'Change Color');
  };

  const changeFontSize = (delta: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const newSize = Math.max(8, Math.min(60, item.fontSize + delta));
    const updated = { ...item, fontSize: newSize };
    onUpdate(updated);
    if (onCommitUpdate) onCommitUpdate(updated, 'Resize Font');
  };

  // Color & font styling classes
  const textColorClass =
    item.color === 'red'
      ? 'text-red-600'
      : item.color === 'blue'
      ? 'text-blue-900'
      : 'text-zinc-950';
  const textFontClass = item.fontFamily === 'script' ? 'font-script' : 'font-sans';

  // Toolbar position: below text if near top edge of page
  const isNearTop = pixelY < 46;
  const toolbarPositionClass = isNearTop ? 'top-full mt-2' : '-top-11';

  return (
    <div
      ref={elementRef}
      id={`text-overlay-${item.id}`}
      data-text-overlay="true"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(item.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setIsEditing(true);
      }}
      onPointerDown={handlePointerDown}
      style={{
        left: `${pixelX}px`,
        top: `${pixelY}px`,
        touchAction: 'none',
      }}
      className={`absolute cursor-move select-none group pointer-events-auto transition-shadow ${
        isSelected
          ? 'z-30 ring-2 ring-blue-500 ring-offset-2 rounded-xs shadow-md bg-blue-500/10'
          : 'z-20 hover:ring-1 hover:ring-blue-400 hover:ring-offset-1 rounded-xs'
      }`}
    >
      {/* Selection Action Toolbar */}
      {isSelected && !isEditing && (
        <div
          data-text-tools="true"
          onPointerDown={(e) => e.stopPropagation()}
          className={`absolute ${toolbarPositionClass} left-0 flex items-center gap-1 bg-slate-900/95 text-white p-1 rounded-xl shadow-xl border border-slate-700/80 backdrop-blur z-50 text-xs whitespace-nowrap animate-in fade-in zoom-in-95 duration-100 pointer-events-auto`}
        >
          {/* Edit text button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium text-[11px] transition flex items-center gap-1 cursor-pointer"
            title="Edit Text"
          >
            <Type className="w-3 h-3" />
            <span>Edit</span>
          </button>

          {/* Font Toggle (Standard vs Script) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleFont(e);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`px-2 py-1 rounded-lg border text-[11px] font-medium transition flex items-center gap-1 cursor-pointer ${
              item.fontFamily === 'script'
                ? 'bg-amber-500/20 border-amber-400/40 text-amber-300 font-script text-xs'
                : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
            }`}
            title="Toggle Regular vs Script Handwriting"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>{item.fontFamily === 'script' ? 'Script' : 'Regular'}</span>
          </button>

          {/* Color Toggle (Black -> Blue -> Red) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleColor(e);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="px-2 py-1 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 transition flex items-center gap-1.5 cursor-pointer"
            title="Toggle Color (Black / Blue / Red)"
          >
            <span
              className={`w-3 h-3 rounded-full border border-white/40 ${
                item.color === 'red'
                  ? 'bg-red-600'
                  : item.color === 'blue'
                  ? 'bg-blue-600'
                  : 'bg-zinc-950'
              }`}
            />
            <span className="text-[11px] text-slate-200 capitalize">{item.color}</span>
          </button>

          {/* Font Size Adjusters */}
          <div className="flex items-center bg-slate-800 rounded-lg border border-slate-700 px-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                changeFontSize(-2, e);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 hover:text-blue-400 text-slate-300 text-xs transition font-bold cursor-pointer"
              title="Smaller font"
            >
              A-
            </button>
            <span className="text-[10px] font-mono px-1 text-slate-400 select-none">{item.fontSize}pt</span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                changeFontSize(2, e);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 hover:text-blue-400 text-slate-300 text-xs transition font-bold cursor-pointer"
              title="Larger font"
            >
              A+
            </button>
          </div>

          <span className="text-slate-600">|</span>

          {/* Toggle Precision Tools */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowTools(!showTools);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={`px-1.5 py-0.5 rounded text-[11px] flex items-center gap-1 transition cursor-pointer ${
              showTools ? 'bg-blue-600 text-white' : 'hover:bg-slate-800 text-slate-300'
            }`}
            title="Toggle precision nudge controls"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>Nudge</span>
          </button>

          <span className="w-px h-3.5 bg-slate-700 mx-0.5" />

          {/* Duplicate */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(item);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Duplicate text"
          >
            <Copy className="w-3 h-3" />
          </button>

          {/* Delete */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition cursor-pointer"
            title="Delete text"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Extended Precision Tools Panel (Nudge / Coordinates) */}
      {isSelected && showTools && !isEditing && (
        <div
          data-text-tools="true"
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute -bottom-24 left-0 bg-white text-slate-900 p-2 rounded-xl shadow-2xl border border-slate-200 z-50 flex flex-col gap-1.5 w-60 animate-in fade-in zoom-in duration-100"
        >
          <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 border-b border-slate-100 pb-1">
            <span>Precision Nudge</span>
            <span className="text-blue-600 font-mono">
              X:{Math.round(item.xPercent * 10) / 10}% Y:{Math.round(item.yPercent * 10) / 10}%
            </span>
          </div>

          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
              <button
                type="button"
                onClick={() => nudge(-0.2, 0)}
                className="p-1.5 rounded hover:bg-white active:bg-slate-200 text-slate-700 cursor-pointer"
                title="Nudge Left"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => nudge(0, -0.2)}
                className="p-1.5 rounded hover:bg-white active:bg-slate-200 text-slate-700 cursor-pointer"
                title="Nudge Up"
              >
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => nudge(0, 0.2)}
                className="p-1.5 rounded hover:bg-white active:bg-slate-200 text-slate-700 cursor-pointer"
                title="Nudge Down"
              >
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => nudge(0.2, 0)}
                className="p-1.5 rounded hover:bg-white active:bg-slate-200 text-slate-700 cursor-pointer"
                title="Nudge Right"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={centerHorizontally}
              className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer flex items-center gap-1 text-[11px] font-medium"
              title="Center on Page"
            >
              <AlignCenterHorizontal className="w-4 h-4" />
              <span>Center</span>
            </button>
          </div>
        </div>
      )}

      {/* Main Text Content or In-place Editor */}
      <div className="p-0 m-0 relative">
        {isEditing ? (
          <div
            data-text-tools="true"
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute top-0 left-0 flex flex-col gap-1.5 bg-white p-2.5 rounded-xl shadow-2xl border-2 border-blue-600 z-50 pointer-events-auto min-w-[260px] sm:min-w-[320px] animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 border-b border-slate-100 pb-1">
              <span>Edit Text</span>
              <span className="text-[10px] text-slate-400 font-mono">Cmd/Ctrl+Enter to save</span>
            </div>
            <textarea
              ref={textareaRef}
              value={item.text}
              onChange={(e) => {
                const val = e.target.value;
                onUpdate({ ...latestItemRef.current, text: val });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  setIsEditing(false);
                  if (onCommitUpdate) {
                    onCommitUpdate(latestItemRef.current, 'Edit Text');
                  }
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setIsEditing(false);
                }
              }}
              rows={Math.max(1, item.text.split('\n').length)}
              style={{
                fontSize: `${Math.max(12, Math.round(scaledFontSize))}px`,
                lineHeight: 1.25,
              }}
              className={`w-full bg-slate-50 border border-slate-300 rounded-lg p-2 resize-none focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-medium ${textColorClass} ${textFontClass}`}
              placeholder="Type your text..."
            />
            <div className="flex items-center justify-between gap-2 pt-0.5">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleFont()}
                  className="text-[11px] px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium cursor-pointer"
                >
                  {item.fontFamily === 'script' ? 'Font: Script' : 'Font: Regular'}
                </button>
                <button
                  type="button"
                  onClick={() => toggleColor()}
                  className="text-[11px] px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium flex items-center gap-1 cursor-pointer"
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      item.color === 'red'
                        ? 'bg-red-600'
                        : item.color === 'blue'
                        ? 'bg-blue-600'
                        : 'bg-black'
                    }`}
                  />
                  <span className="capitalize">{item.color}</span>
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsEditing(false);
                  if (onCommitUpdate) {
                    onCommitUpdate(latestItemRef.current, 'Edit Text');
                  }
                }}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              fontSize: `${scaledFontSize}px`,
              lineHeight: 1.25,
            }}
            className={`whitespace-pre select-none tracking-normal ${textColorClass} ${textFontClass} p-0 m-0`}
          >
            {item.text || <span className="italic text-slate-400 select-none">Empty text (double click)</span>}
          </div>
        )}
      </div>
    </div>
  );
};
