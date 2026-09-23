import React, { useState, useRef, useEffect } from 'react';
import { TextOverlayItem, TextColor } from '../types';
import {
  Trash2,
  Copy,
  Type,
  Palette,
  ChevronUp,
  ChevronDown,
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

  const pixelX = (item.xPercent / 100) * containerWidth;
  const pixelY = (item.yPercent / 100) * containerHeight;

  // Stable references for window drag listeners
  const onMoveRef = useRef<(e: PointerEvent) => void>();
  const onUpRef = useRef<(e: PointerEvent) => void>();

  onMoveRef.current = (e: PointerEvent) => {
    if (!dragRef.current.isDragging) return;
    e.preventDefault();

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    const newPixelX = Math.max(0, Math.min(containerWidth - 30, dragRef.current.initialX + dx));
    const newPixelY = Math.max(0, Math.min(containerHeight - 20, dragRef.current.initialY + dy));

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

  // Auto-focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [isEditing]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isEditing) return; // Allow normal cursor placement inside textarea

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

  // Quick font toggles
  const toggleFont = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newFont = item.fontFamily === 'standard' ? 'script' : 'standard';
    const updated = { ...item, fontFamily: newFont as any };
    onUpdate(updated);
    if (onCommitUpdate) onCommitUpdate(updated, 'Change Font');
  };

  const toggleColor = (e: React.MouseEvent) => {
    e.stopPropagation();
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
    const newSize = Math.max(9, Math.min(48, item.fontSize + delta));
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
      className={`absolute cursor-move select-none group transition-shadow pointer-events-auto ${
        isSelected
          ? 'z-30 ring-2 ring-blue-500 ring-offset-1 rounded-lg shadow-lg bg-blue-500/5'
          : 'z-20 hover:ring-1 hover:ring-blue-300 rounded-lg'
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

      {/* Main Text Content or In-place Editor */}
      <div className="p-1.5 min-w-[60px]">
        {isEditing ? (
          <div
            data-text-tools="true"
            onPointerDown={(e) => e.stopPropagation()}
            className="flex flex-col gap-1 bg-white p-2 rounded-xl shadow-2xl border-2 border-blue-500 z-50 pointer-events-auto"
          >
            <textarea
              ref={textareaRef}
              value={item.text}
              onChange={(e) => {
                const val = e.target.value;
                onUpdate({ ...item, text: val });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  setIsEditing(false);
                  if (onCommitUpdate) {
                    onCommitUpdate(item, 'Edit Text');
                  }
                }
              }}
              rows={Math.max(1, item.text.split('\n').length)}
              style={{
                fontSize: `${Math.max(10, Math.round(item.fontSize * (zoomLevel / 100)))}px`,
                lineHeight: 1.25,
              }}
              className={`w-full min-w-[180px] sm:min-w-[240px] bg-slate-50 border border-slate-300 rounded-lg p-2 resize-none focus:outline-hidden focus:ring-2 focus:ring-blue-500 font-medium ${textColorClass} ${textFontClass}`}
              placeholder="Type your text..."
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleFont}
                  className="text-[11px] px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium cursor-pointer"
                >
                  {item.fontFamily === 'script' ? 'Font: Script' : 'Font: Regular'}
                </button>
                <button
                  type="button"
                  onClick={toggleColor}
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
                    onCommitUpdate(item, 'Edit Text');
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
              fontSize: `${Math.max(7, Math.round(item.fontSize * (zoomLevel / 100)))}px`,
              lineHeight: 1.25,
            }}
            className={`whitespace-pre select-none tracking-normal ${textColorClass} ${textFontClass} ${
              item.fontFamily === 'script' ? 'text-[1.25em]' : ''
            }`}
          >
            {item.text || <span className="italic text-slate-400">Empty text (double click)</span>}
          </div>
        )}
      </div>
    </div>
  );
};
