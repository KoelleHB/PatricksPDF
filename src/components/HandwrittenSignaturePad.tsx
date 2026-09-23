import React, { useRef, useEffect, useState, useCallback } from 'react';
import { RotateCcw, Trash2, PenTool, Check } from 'lucide-react';
import {
  Stroke,
  DrawPoint,
  PenStyle,
  computePointWidth,
  drawStrokeOnContext,
  exportStrokesToPng,
} from '../utils/smoothSignature';
import { ProcessedImageResult } from '../utils/imageProcessor';

interface HandwrittenSignaturePadProps {
  onSignatureChange: (result: ProcessedImageResult | null) => void;
  initialColor?: string;
  initialPenStyle?: PenStyle;
}

const INK_COLORS = [
  { id: '#09090b', name: 'Black', bgClass: 'bg-zinc-900', ringClass: 'ring-zinc-900' },
  { id: '#1e3a8a', name: 'Legal Blue', bgClass: 'bg-blue-900', ringClass: 'ring-blue-900' },
  { id: '#0f2942', name: 'Dark Navy', bgClass: 'bg-slate-900', ringClass: 'ring-slate-900' },
  { id: '#1e293b', name: 'Charcoal', bgClass: 'bg-slate-800', ringClass: 'ring-slate-800' },
];

export const HandwrittenSignaturePad: React.FC<HandwrittenSignaturePadProps> = ({
  onSignatureChange,
  initialColor = '#09090b',
  initialPenStyle = 'fountain',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [penStyle, setPenStyle] = useState<PenStyle>(initialPenStyle);
  const [inkColor, setInkColor] = useState<string>(initialColor);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);

  // Keep a ref to strokes for fast event handling
  const currentStrokeRef = useRef<DrawPoint[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  strokesRef.current = strokes;

  // Scale multiplier for razor-sharp Retina/High-DPI rendering
  const dprRef = useRef<number>(2.5);

  // Redraw all strokes on the display canvas
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokesRef.current) {
      drawStrokeOnContext(ctx, stroke, inkColor);
    }
  }, [inkColor]);

  // Adjust canvas pixel buffer to match container with supersampling
  const updateCanvasDimensions = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Use at least 2.5x supersampling for ultra-smooth sub-pixel curves
    const dpr = Math.max(2.5, window.devicePixelRatio || 2);
    dprRef.current = dpr;

    const targetWidth = Math.round(rect.width * dpr);
    const targetHeight = Math.round(rect.height * dpr);

    // Only resize buffer if dimensions actually changed to avoid clearing
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      // Scale existing points if canvas was previously initialized
      if (canvas.width > 0 && canvas.height > 0 && strokesRef.current.length > 0) {
        const scaleX = targetWidth / canvas.width;
        const scaleY = targetHeight / canvas.height;
        const scaledStrokes: Stroke[] = strokesRef.current.map((stroke) =>
          stroke.map((p) => ({
            ...p,
            x: p.x * scaleX,
            y: p.y * scaleY,
            width: p.width * ((scaleX + scaleY) / 2),
          }))
        );
        strokesRef.current = scaledStrokes;
        setStrokes(scaledStrokes);
      }

      canvas.width = targetWidth;
      canvas.height = targetHeight;
      redrawCanvas();
    }
  }, [redrawCanvas]);

  // Setup ResizeObserver to maintain precise coordinate matching
  useEffect(() => {
    updateCanvasDimensions();

    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      updateCanvasDimensions();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [updateCanvasDimensions]);

  // Re-export PNG whenever strokes or color change
  useEffect(() => {
    redrawCanvas();

    if (strokes.length === 0) {
      onSignatureChange(null);
      return;
    }

    let isCancelled = false;
    exportStrokesToPng(strokes, inkColor, dprRef.current).then((result) => {
      if (!isCancelled) {
        onSignatureChange(result);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [strokes, inkColor, redrawCanvas, onSignatureChange]);

  // Calculate exact coordinates mapping directly to internal canvas buffer
  const getCanvasCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignored if pointer capture not supported
    }

    const { x, y } = getCanvasCoordinates(e);
    const point: DrawPoint = {
      x,
      y,
      time: Date.now(),
      width: computePointWidth({ x, y, time: Date.now() }, null, penStyle, dprRef.current),
    };

    currentStrokeRef.current = [point];
    setIsDrawing(true);

    const ctx = canvas.getContext('2d');
    if (ctx) {
      drawStrokeOnContext(ctx, [point], inkColor);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasCoordinates(e);
    const stroke = currentStrokeRef.current;
    const prevPoint = stroke[stroke.length - 1] || null;

    // Reject micro-jitter (less than 1.5 canvas pixels movement)
    if (prevPoint && Math.hypot(x - prevPoint.x, y - prevPoint.y) < 1.5) {
      return;
    }

    const point: DrawPoint = {
      x,
      y,
      time: Date.now(),
      width: computePointWidth({ x, y, time: Date.now() }, prevPoint, penStyle, dprRef.current),
    };

    stroke.push(point);

    // Fast incremental draw
    if (stroke.length === 2) {
      drawStrokeOnContext(ctx, stroke, inkColor);
    } else if (stroke.length >= 3) {
      // Redraw only the latest curve segment
      const p0 = stroke[stroke.length - 3];
      const p1 = stroke[stroke.length - 2];
      const p2 = stroke[stroke.length - 1];
      const partialStroke = [p0, p1, p2];
      drawStrokeOnContext(ctx, partialStroke, inkColor);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    e.preventDefault();

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignored
    }

    setIsDrawing(false);

    if (currentStrokeRef.current.length > 0) {
      const newStrokes = [...strokesRef.current, [...currentStrokeRef.current]];
      setStrokes(newStrokes);
      currentStrokeRef.current = [];
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    handlePointerUp(e);
  };

  const handleUndo = () => {
    if (strokes.length === 0) return;
    const newStrokes = strokes.slice(0, -1);
    setStrokes(newStrokes);
  };

  const handleClear = () => {
    setStrokes([]);
    currentStrokeRef.current = [];
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  return (
    <div className="flex flex-col space-y-2.5">
      {/* Top Controls: Pen Style, Ink Color, Undo, Clear */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs bg-slate-50 p-2 rounded-xl border border-slate-200">
        {/* Pen Style Selector */}
        <div className="flex items-center gap-1">
          <span className="text-slate-500 font-medium mr-1 text-[11px] hidden sm:inline">Pen:</span>
          {(
            [
              { id: 'fountain', label: 'Fountain', desc: 'Calligraphic flair' },
              { id: 'gel', label: 'Gel Pen', desc: 'Smooth fluid ink' },
              { id: 'ballpoint', label: 'Fine', desc: 'Clean precise lines' },
            ] as const
          ).map((style) => (
            <button
              key={style.id}
              type="button"
              onClick={() => setPenStyle(style.id)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                penStyle === style.id
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-300 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
              }`}
              title={style.desc}
            >
              {style.label}
            </button>
          ))}
        </div>

        {/* Ink Colors */}
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500 font-medium mr-1 text-[11px] hidden sm:inline">Color:</span>
          {INK_COLORS.map((col) => (
            <button
              key={col.id}
              type="button"
              onClick={() => setInkColor(col.id)}
              className={`w-6 h-6 rounded-full ${col.bgClass} flex items-center justify-center transition transform active:scale-95 ${
                inkColor === col.id ? `ring-2 ring-offset-2 ${col.ringClass} scale-105` : 'opacity-80 hover:opacity-100'
              }`}
              title={col.name}
            >
              {inkColor === col.id && <Check className="w-3 h-3 text-white stroke-3" />}
            </button>
          ))}
        </div>

        {/* Actions: Undo & Clear */}
        <div className="flex items-center gap-1 ml-auto">
          <button
            type="button"
            disabled={strokes.length === 0}
            onClick={handleUndo}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-200/60 disabled:opacity-40 disabled:pointer-events-none transition text-xs font-medium"
            title="Undo Last Stroke"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden xs:inline">Undo</span>
          </button>
          <button
            type="button"
            disabled={strokes.length === 0}
            onClick={handleClear}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-red-600 hover:text-red-700 hover:bg-red-50 disabled:opacity-40 disabled:pointer-events-none transition text-xs font-medium"
            title="Clear Signature Canvas"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear</span>
          </button>
        </div>
      </div>

      {/* Signature Canvas Area with Responsive Container and Signing Line */}
      <div
        ref={containerRef}
        className="relative w-full h-44 sm:h-52 rounded-xl border-2 border-slate-300 bg-white overflow-hidden shadow-inner touch-none select-none cursor-crosshair"
      >
        {/* Subtle Decorative Paper Texture & Signing Baseline Guide */}
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-end pb-7 px-8 select-none">
          <div className="flex items-center gap-2 border-b border-dashed border-slate-300/80 pb-1">
            <span className="text-slate-300 font-serif font-bold text-sm select-none">✕</span>
            <span className="text-[11px] font-sans tracking-wide text-slate-300 select-none">
              Sign above this line
            </span>
          </div>
        </div>

        {/* Empty placeholder prompt when no strokes are drawn */}
        {strokes.length === 0 && !isDrawing && (
          <div className="absolute inset-0 pointer-events-none flex flex-col items-center justify-center text-slate-400 gap-1.5 p-4 select-none">
            <PenTool className="w-6 h-6 stroke-1.5 text-slate-300 animate-pulse" />
            <p className="text-xs sm:text-sm font-medium text-slate-400">
              Draw your signature here with your finger, stylus, or mouse
            </p>
            <p className="text-[11px] text-slate-400/80">
              Smooth handwritten ink with realistic pen flow
            </p>
          </div>
        )}

        {/* High-DPI Interactive Drawing Canvas */}
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          style={{ touchAction: 'none' }}
          className="w-full h-full block relative z-10"
        />
      </div>

      {/* Stroke count & status feedback */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
        <span>
          {strokes.length === 0
            ? 'Touch or drag on the canvas to sign'
            : `${strokes.length} stroke${strokes.length === 1 ? '' : 's'} recorded`}
        </span>
        <span className="text-emerald-700 font-medium">
          {strokes.length > 0 ? '✓ Vector smoothed & ready' : ''}
        </span>
      </div>
    </div>
  );
};
