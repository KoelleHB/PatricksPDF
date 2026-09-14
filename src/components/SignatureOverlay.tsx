import React, { useState, useRef, useEffect } from 'react';
import { SignatureItem } from '../types';
import {
  Trash2,
  Copy,
  Maximize2,
  Minimize2,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  AlignCenterHorizontal,
  Layers,
  Sparkles,
} from 'lucide-react';

interface SignatureOverlayProps {
  signature: SignatureItem;
  isSelected: boolean;
  containerWidth: number;
  containerHeight: number;
  onSelect: (id: string) => void;
  onUpdate: (updated: SignatureItem) => void;
  onCommitUpdate?: (updated: SignatureItem, actionName: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (sig: SignatureItem) => void;
}

export const SignatureOverlay: React.FC<SignatureOverlayProps> = ({
  signature,
  isSelected,
  containerWidth,
  containerHeight,
  onSelect,
  onUpdate,
  onCommitUpdate,
  onDelete,
  onDuplicate,
}) => {
  const [showTools, setShowTools] = useState(false);
  const elementRef = useRef<HTMLDivElement>(null);

  // Keep a ref to latest signature so pointerup handlers have current values
  const latestSignatureRef = useRef<SignatureItem>(signature);
  latestSignatureRef.current = signature;

  // Snapshot before drag/resize to detect if an action actually changed values
  const initialSigRef = useRef<SignatureItem | null>(null);

  // Dragging & Resizing tracking refs
  const dragRef = useRef<{
    isDragging: boolean;
    isResizing: boolean;
    handle: string | null;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    initialW: number;
    initialH: number;
  }>({
    isDragging: false,
    isResizing: false,
    handle: null,
    startX: 0,
    startY: 0,
    initialX: 0,
    initialY: 0,
    initialW: 0,
    initialH: 0,
  });

  // Calculate pixel positions from percentages
  const pixelX = (signature.xPercent / 100) * containerWidth;
  const pixelY = (signature.yPercent / 100) * containerHeight;
  const pixelW = (signature.widthPercent / 100) * containerWidth;
  const pixelH = pixelW / signature.aspectRatio;

  // Start dragging signature
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect(signature.id);

    initialSigRef.current = { ...signature };

    dragRef.current = {
      isDragging: true,
      isResizing: false,
      handle: null,
      startX: e.clientX,
      startY: e.clientY,
      initialX: pixelX,
      initialY: pixelY,
      initialW: pixelW,
      initialH: pixelH,
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // Start resizing via a corner handle
  const handleResizePointerDown = (handle: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    onSelect(signature.id);

    initialSigRef.current = { ...signature };

    dragRef.current = {
      isDragging: false,
      isResizing: true,
      handle,
      startX: e.clientX,
      startY: e.clientY,
      initialX: pixelX,
      initialY: pixelY,
      initialW: pixelW,
      initialH: pixelH,
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!dragRef.current.isDragging && !dragRef.current.isResizing) return;
    e.preventDefault();

    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;

    if (dragRef.current.isDragging) {
      let newPixelX = dragRef.current.initialX + dx;
      let newPixelY = dragRef.current.initialY + dy;

      // Bound within container
      newPixelX = Math.max(0, Math.min(containerWidth - pixelW, newPixelX));
      newPixelY = Math.max(0, Math.min(containerHeight - pixelH, newPixelY));

      const newXPercent = (newPixelX / containerWidth) * 100;
      const newYPercent = (newPixelY / containerHeight) * 100;

      onUpdate({
        ...signature,
        xPercent: Math.round(newXPercent * 100) / 100,
        yPercent: Math.round(newYPercent * 100) / 100,
      });
    } else if (dragRef.current.isResizing) {
      const { handle, initialX, initialY, initialW } = dragRef.current;
      let newPixelW = initialW;
      let newPixelX = initialX;
      let newPixelY = initialY;

      if (handle === 'se' || handle === 'e') {
        newPixelW = Math.max(30, Math.min(containerWidth - initialX, initialW + dx));
      } else if (handle === 'sw') {
        const potentialW = initialW - dx;
        if (potentialW >= 30 && initialX + dx >= 0) {
          newPixelW = potentialW;
          newPixelX = initialX + dx;
        }
      } else if (handle === 'nw') {
        const potentialW = initialW - dx;
        if (potentialW >= 30 && initialX + dx >= 0) {
          newPixelW = potentialW;
          newPixelX = initialX + dx;
          const newH = newPixelW / signature.aspectRatio;
          newPixelY = initialY + (dragRef.current.initialH - newH);
        }
      } else if (handle === 'ne') {
        const potentialW = initialW + dx;
        if (potentialW >= 30 && initialX + potentialW <= containerWidth) {
          newPixelW = potentialW;
          const newH = newPixelW / signature.aspectRatio;
          newPixelY = initialY + (dragRef.current.initialH - newH);
        }
      }

      const newWidthPercent = Math.min(95, Math.max(5, (newPixelW / containerWidth) * 100));
      const newXPercent = (newPixelX / containerWidth) * 100;
      const newYPercent = (newPixelY / containerHeight) * 100;

      onUpdate({
        ...signature,
        widthPercent: Math.round(newWidthPercent * 100) / 100,
        xPercent: Math.round(newXPercent * 100) / 100,
        yPercent: Math.round(newYPercent * 100) / 100,
      });
    }
  };

  const handlePointerUp = () => {
    const wasDragging = dragRef.current.isDragging;
    const wasResizing = dragRef.current.isResizing;

    dragRef.current.isDragging = false;
    dragRef.current.isResizing = false;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);

    // If position or dimensions changed, commit the action to undo/redo history
    if (initialSigRef.current && latestSignatureRef.current) {
      const init = initialSigRef.current;
      const current = latestSignatureRef.current;

      if (wasDragging) {
        const hasMoved =
          Math.abs(init.xPercent - current.xPercent) > 0.05 ||
          Math.abs(init.yPercent - current.yPercent) > 0.05;
        if (hasMoved && onCommitUpdate) {
          onCommitUpdate(current, 'Move signature');
        }
      } else if (wasResizing) {
        const hasResized =
          Math.abs(init.widthPercent - current.widthPercent) > 0.05 ||
          Math.abs(init.xPercent - current.xPercent) > 0.05 ||
          Math.abs(init.yPercent - current.yPercent) > 0.05;
        if (hasResized && onCommitUpdate) {
          onCommitUpdate(current, 'Resize signature');
        }
      }
    }
    initialSigRef.current = null;
  };

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  // Nudge functions for micro adjustments
  const nudge = (dxP: number, dyP: number) => {
    const updated = {
      ...signature,
      xPercent: Math.max(0, Math.min(100 - signature.widthPercent, signature.xPercent + dxP)),
      yPercent: Math.max(0, Math.min(95, signature.yPercent + dyP)),
    };
    if (onCommitUpdate) {
      onCommitUpdate(updated, 'Nudge signature');
    } else {
      onUpdate(updated);
    }
  };

  const setPresetWidth = (wP: number) => {
    const updated = {
      ...signature,
      widthPercent: Math.min(95, Math.max(5, wP)),
    };
    if (onCommitUpdate) {
      onCommitUpdate(updated, 'Scale signature');
    } else {
      onUpdate(updated);
    }
  };

  const centerHorizontally = () => {
    const centeredX = Math.max(0, (100 - signature.widthPercent) / 2);
    const updated = {
      ...signature,
      xPercent: Math.round(centeredX * 10) / 10,
    };
    if (onCommitUpdate) {
      onCommitUpdate(updated, 'Center signature');
    } else {
      onUpdate(updated);
    }
  };

  return (
    <div
      ref={elementRef}
      id={`sig-overlay-${signature.id}`}
      data-signature-overlay="true"
      style={{
        left: `${pixelX}px`,
        top: `${pixelY}px`,
        width: `${pixelW}px`,
        height: `${pixelH}px`,
        opacity: signature.opacity,
        touchAction: 'none',
      }}
      className={`absolute select-none cursor-move group transition-shadow pointer-events-auto ${
        isSelected
          ? 'z-30 ring-2 ring-blue-600 ring-offset-1 shadow-lg bg-blue-50/15'
          : 'z-20 hover:ring-1 hover:ring-blue-400/70'
      }`}
      onPointerDown={handlePointerDown}
    >
      {/* Transparent Signature Image */}
      <img
        src={signature.transparentDataUrl}
        alt={signature.name}
        className="w-full h-full object-contain pointer-events-none drop-shadow-xs"
        draggable={false}
      />

      {/* When selected: resize handles with large touch targets */}
      {isSelected && (
        <>
          {/* NW Handle */}
          <div
            onPointerDown={handleResizePointerDown('nw')}
            className="absolute -top-3.5 -left-3.5 w-8 h-8 flex items-center justify-center cursor-nwse-resize z-20"
          >
            <div className="w-3.5 h-3.5 bg-white border-2 border-blue-600 rounded-full shadow-md hover:scale-125 transition-transform" />
          </div>

          {/* NE Handle */}
          <div
            onPointerDown={handleResizePointerDown('ne')}
            className="absolute -top-3.5 -right-3.5 w-8 h-8 flex items-center justify-center cursor-nesw-resize z-20"
          >
            <div className="w-3.5 h-3.5 bg-white border-2 border-blue-600 rounded-full shadow-md hover:scale-125 transition-transform" />
          </div>

          {/* SE Handle (Primary resize corner) */}
          <div
            onPointerDown={handleResizePointerDown('se')}
            className="absolute -bottom-3.5 -right-3.5 w-9 h-9 flex items-center justify-center cursor-nwse-resize z-20"
          >
            <div className="w-4 h-4 bg-blue-600 border-2 border-white rounded-full shadow-md hover:scale-125 transition-transform" />
          </div>

          {/* SW Handle */}
          <div
            onPointerDown={handleResizePointerDown('sw')}
            className="absolute -bottom-3.5 -left-3.5 w-8 h-8 flex items-center justify-center cursor-nesw-resize z-20"
          >
            <div className="w-3.5 h-3.5 bg-white border-2 border-blue-600 rounded-full shadow-md hover:scale-125 transition-transform" />
          </div>

          {/* Selected Badge & Quick floating toolbar */}
          <div
            className="absolute -top-10 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-slate-900 text-white px-2 py-1 rounded-lg shadow-xl text-xs z-30 whitespace-nowrap"
            onPointerDown={(e) => e.stopPropagation()}
          >
            <span className="font-semibold text-[11px] text-blue-300">
              {Math.round(signature.widthPercent)}% width
            </span>
            <span className="text-slate-500">|</span>
            <button
              onClick={() => setShowTools(!showTools)}
              className="px-1.5 py-0.5 rounded hover:bg-slate-800 text-slate-200 flex items-center gap-1 text-[11px]"
              title="Toggle precise nudge & scale controls"
            >
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Tools</span>
            </button>
            <button
              onClick={() => onDuplicate(signature)}
              className="p-1 rounded hover:bg-slate-800 text-slate-300 hover:text-white"
              title="Duplicate signature"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDelete(signature.id)}
              className="p-1 rounded hover:bg-red-900/60 text-red-300 hover:text-red-200"
              title="Delete signature"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Extended Mobile & Touch Tools Panel */}
          {showTools && (
            <div
              className="absolute -bottom-28 sm:-bottom-24 left-1/2 -translate-x-1/2 bg-white text-slate-900 p-2 rounded-xl shadow-2xl border border-slate-200 z-40 flex flex-col gap-1.5 w-64 animate-in fade-in zoom-in duration-100"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 border-b border-slate-100 pb-1">
                <span>Precision Controls</span>
                <span className="text-blue-600 font-mono">
                  X:{Math.round(signature.xPercent)}% Y:{Math.round(signature.yPercent)}%
                </span>
              </div>

              {/* Nudge arrow buttons */}
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                  <button
                    onClick={() => nudge(-0.5, 0)}
                    className="p-1.5 rounded hover:bg-white active:bg-slate-200 text-slate-700"
                    title="Nudge Left"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => nudge(0, -0.5)}
                    className="p-1.5 rounded hover:bg-white active:bg-slate-200 text-slate-700"
                    title="Nudge Up"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => nudge(0, 0.5)}
                    className="p-1.5 rounded hover:bg-white active:bg-slate-200 text-slate-700"
                    title="Nudge Down"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => nudge(0.5, 0)}
                    className="p-1.5 rounded hover:bg-white active:bg-slate-200 text-slate-700"
                    title="Nudge Right"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Center & Scale shortcuts */}
                <div className="flex items-center gap-1">
                  <button
                    onClick={centerHorizontally}
                    className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
                    title="Center on Page"
                  >
                    <AlignCenterHorizontal className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setPresetWidth(18)}
                    className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
                  >
                    S
                  </button>
                  <button
                    onClick={() => setPresetWidth(28)}
                    className="px-2 py-1 rounded-lg bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs font-medium"
                  >
                    M
                  </button>
                  <button
                    onClick={() => setPresetWidth(42)}
                    className="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium"
                  >
                    L
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
