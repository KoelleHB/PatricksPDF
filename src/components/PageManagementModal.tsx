import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  RotateCw,
  RotateCcw,
  Trash2,
  Copy,
  Plus,
  ArrowLeft,
  ArrowRight,
  FilePlus2,
  FileUp,
  LayoutGrid,
  Check,
  AlertCircle,
  Loader2,
  GripVertical,
  Rotate3D,
  Sparkles,
} from 'lucide-react';
import { PdfDocumentState, PageSpec } from '../types';
import { getPageInfoList, renderPageThumbnail } from '../utils/pdfEngine';
import { loadPdfJsDoc } from '../utils/pdfEngine';

interface PageManagementModalProps {
  isOpen: boolean;
  pdfState: PdfDocumentState;
  currentPage: number;
  onClose: () => void;
  onApplyChanges: (newPages: PageSpec[]) => Promise<void>;
  onJumpToPage: (pageNumber: number) => void;
}

export const PageManagementModal: React.FC<PageManagementModalProps> = ({
  isOpen,
  pdfState,
  currentPage,
  onClose,
  onApplyChanges,
  onJumpToPage,
}) => {
  const [pages, setPages] = useState<PageSpec[]>([]);
  const [initialPages, setInitialPages] = useState<PageSpec[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [isLoadingPages, setIsLoadingPages] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [draggedPageIndex, setDraggedPageIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  // Blank Page Options modal / popover
  const [showAddBlankDialog, setShowAddBlankDialog] = useState(false);
  const [blankPageSize, setBlankPageSize] = useState<'match' | 'a4' | 'letter'>('match');
  const [blankOrientation, setBlankOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [blankInsertPosition, setBlankInsertPosition] = useState<'end' | 'after-selected'>('after-selected');

  // Import PDF file input ref
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize page specifications from document whenever modal opens or document changes
  useEffect(() => {
    if (!isOpen || !pdfState.arrayBuffer) return;

    let isCancelled = false;
    setIsLoadingPages(true);
    setErrorMessage(null);

    const initPages = async () => {
      try {
        const pageInfos = await getPageInfoList(pdfState.arrayBuffer!);
        if (isCancelled) return;

        const specs: PageSpec[] = pageInfos.map((info, idx) => ({
          id: `page-orig-${idx}-${Date.now()}`,
          source: 'existing',
          originalPageIndex: idx,
          rotationAngle: info.rotation,
          rotationDelta: 0,
          width: info.width,
          height: info.height,
          aspectRatio: info.aspectRatio,
        }));

        setPages(specs);
        setInitialPages(specs);

        // Select the active page from the viewer initially
        const currentSpec = specs[currentPage - 1];
        if (currentSpec) {
          setSelectedPageId(currentSpec.id);
        }

        // Render thumbnails for each original page
        const thumbs: Record<string, string> = {};
        for (let i = 0; i < specs.length; i++) {
          if (isCancelled) break;
          try {
            const thumbUrl = await renderPageThumbnail(pdfState.arrayBuffer!, i + 1, 260);
            thumbs[specs[i].id] = thumbUrl;
            setThumbnails((prev) => ({ ...prev, [specs[i].id]: thumbUrl }));
          } catch (err) {
            console.warn(`Could not render thumbnail for page ${i + 1}:`, err);
          }
        }
      } catch (err: any) {
        if (!isCancelled) {
          console.error('Failed to load page info for page manager:', err);
          setErrorMessage('Could not load page list. Please try again.');
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingPages(false);
        }
      }
    };

    initPages();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, pdfState.arrayBuffer, currentPage]);

  // Determine if pages have been modified relative to initial document state
  const isDirty = React.useMemo(() => {
    if (pages.length !== initialPages.length) return true;
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const init = initialPages[i];
      if (!init) return true;
      if (p.source !== init.source) return true;
      if (p.originalPageIndex !== init.originalPageIndex) return true;
      if (p.rotationAngle !== init.rotationAngle) return true;
      if (p.rotationDelta !== init.rotationDelta) return true;
    }
    return false;
  }, [pages, initialPages]);

  // Rotate a single page in 90° steps
  const handleRotatePage = (id: string, stepDegrees: number) => {
    setPages((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        const newAngle = ((p.rotationAngle + stepDegrees) % 360 + 360) % 360;
        const newDelta = ((p.rotationDelta + stepDegrees) % 360 + 360) % 360;
        return {
          ...p,
          rotationAngle: newAngle,
          rotationDelta: newDelta,
        };
      })
    );
  };

  // Rotate all pages in the document +90°
  const handleRotateAll = (stepDegrees: number = 90) => {
    setPages((prev) =>
      prev.map((p) => {
        const newAngle = ((p.rotationAngle + stepDegrees) % 360 + 360) % 360;
        const newDelta = ((p.rotationDelta + stepDegrees) % 360 + 360) % 360;
        return {
          ...p,
          rotationAngle: newAngle,
          rotationDelta: newDelta,
        };
      })
    );
  };

  // Move page position in list (reordering)
  const handleMovePage = (currentIndex: number, direction: 'left' | 'right') => {
    const targetIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= pages.length) return;

    setPages((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(currentIndex, 1);
      updated.splice(targetIndex, 0, moved);
      return updated;
    });
  };

  // Duplicate a page
  const handleDuplicatePage = (pageIndex: number) => {
    const target = pages[pageIndex];
    if (!target) return;

    const newId = `page-dup-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const duplicated: PageSpec = {
      ...target,
      id: newId,
    };

    // Copy cached thumbnail
    if (thumbnails[target.id]) {
      setThumbnails((prev) => ({ ...prev, [newId]: thumbnails[target.id] }));
    }

    setPages((prev) => {
      const updated = [...prev];
      updated.splice(pageIndex + 1, 0, duplicated);
      return updated;
    });
    setSelectedPageId(newId);
  };

  // Delete a page (requires at least 1 page remaining in the document)
  const handleDeletePage = (id: string) => {
    if (pages.length <= 1) {
      setErrorMessage('A PDF document must have at least one page. Cannot delete the only remaining page.');
      return;
    }

    setErrorMessage(null);
    setPages((prev) => prev.filter((p) => p.id !== id));
    if (selectedPageId === id) {
      setSelectedPageId(null);
    }
  };

  // Add a blank page
  const handleAddBlankPageConfirm = () => {
    let width = 595.28; // Default A4 portrait
    let height = 841.89;

    if (blankPageSize === 'match') {
      width = pdfState.pageWidth || 595.28;
      height = pdfState.pageHeight || 841.89;
    } else if (blankPageSize === 'letter') {
      width = 612.0;
      height = 792.0;
    } else if (blankPageSize === 'a4') {
      width = 595.28;
      height = 841.89;
    }

    // Apply orientation
    if (blankOrientation === 'landscape' && width < height) {
      const tmp = width;
      width = height;
      height = tmp;
    } else if (blankOrientation === 'portrait' && width > height) {
      const tmp = width;
      width = height;
      height = tmp;
    }

    const newId = `page-blank-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const blankSpec: PageSpec = {
      id: newId,
      source: 'blank',
      originalPageIndex: -1,
      rotationAngle: 0,
      rotationDelta: 0,
      width,
      height,
      aspectRatio: width / height,
    };

    // Generate a simple white blank thumbnail
    const blankCanvas = document.createElement('canvas');
    blankCanvas.width = 240;
    blankCanvas.height = Math.round(240 / (width / height));
    const ctx = blankCanvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, blankCanvas.width, blankCanvas.height);
      // subtle page border
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, blankCanvas.width - 2, blankCanvas.height - 2);
    }
    setThumbnails((prev) => ({ ...prev, [newId]: blankCanvas.toDataURL() }));

    setPages((prev) => {
      const updated = [...prev];
      if (blankInsertPosition === 'after-selected' && selectedPageId) {
        const selectedIdx = updated.findIndex((p) => p.id === selectedPageId);
        if (selectedIdx !== -1) {
          updated.splice(selectedIdx + 1, 0, blankSpec);
          return updated;
        }
      }
      // Otherwise append at the end
      updated.push(blankSpec);
      return updated;
    });

    setSelectedPageId(newId);
    setShowAddBlankDialog(false);
  };

  // Import pages from another PDF file
  const handleImportPdfFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    setErrorMessage(null);

    try {
      const fileBuffer = await file.arrayBuffer();
      const pdfJsDoc = await loadPdfJsDoc(fileBuffer);
      const numImported = pdfJsDoc.numPages;

      if (numImported === 0) {
        throw new Error('No pages found in the selected PDF file.');
      }

      const importedSpecs: PageSpec[] = [];
      const newThumbs: Record<string, string> = {};

      for (let i = 1; i <= numImported; i++) {
        const page = await pdfJsDoc.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });
        const id = `page-import-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`;

        importedSpecs.push({
          id,
          source: 'imported',
          originalPageIndex: -1,
          rotationAngle: ((page.rotate % 360) + 360) % 360,
          rotationDelta: 0,
          width: viewport.width,
          height: viewport.height,
          aspectRatio: viewport.width / viewport.height,
          sourceBuffer: fileBuffer,
          sourceDocPageIndex: i - 1,
          sourceFileName: file.name,
        });

        // Render thumbnail
        try {
          const thumbUrl = await renderPageThumbnail(fileBuffer, i, 240);
          newThumbs[id] = thumbUrl;
        } catch {
          // Fallback
        }
      }

      setThumbnails((prev) => ({ ...prev, ...newThumbs }));
      setPages((prev) => [...prev, ...importedSpecs]);
      if (importedSpecs.length > 0) {
        setSelectedPageId(importedSpecs[0].id);
      }
    } catch (err: any) {
      console.error('Failed to import PDF pages:', err);
      setErrorMessage(`Failed to import "${file.name}": ${err?.message || 'Invalid or password-protected PDF.'}`);
    } finally {
      setIsImporting(false);
      e.target.value = '';
    }
  };

  // Drag and drop reordering
  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedPageIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedPageIndex === null || draggedPageIndex === targetIndex) {
      setDraggedPageIndex(null);
      setDragOverIndex(null);
      return;
    }

    setPages((prev) => {
      const updated = [...prev];
      const [moved] = updated.splice(draggedPageIndex, 1);
      updated.splice(targetIndex, 0, moved);
      return updated;
    });

    setDraggedPageIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedPageIndex(null);
    setDragOverIndex(null);
  };

  // Commit and apply all page modifications
  const handleApply = async () => {
    if (pages.length === 0) {
      setErrorMessage('Cannot save an empty document. Please keep at least one page.');
      return;
    }

    setIsApplying(true);
    setErrorMessage(null);

    try {
      await onApplyChanges(pages);
      onClose();
    } catch (err: any) {
      console.error('Error applying page management changes:', err);
      setErrorMessage(err?.message || 'Failed to apply page modifications. Please try again.');
    } finally {
      setIsApplying(false);
    }
  };

  // Reset to initial document pages
  const handleReset = () => {
    setPages([...initialPages]);
    setErrorMessage(null);
  };

  // Jump to page when clicking a page card (if not dirty)
  const handleCardClick = (pageNumber: number, id: string) => {
    setSelectedPageId(id);
    if (!isDirty) {
      onJumpToPage(pageNumber);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div
        id="page-management-modal-backdrop"
        className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-hidden"
        onClick={(e) => {
          if (e.target === e.currentTarget && !isApplying) {
            onClose();
          }
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col w-full max-w-5xl h-[92vh] max-h-[860px] overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="page-management-title"
        >
          {/* Modal Header */}
          <div className="shrink-0 px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-9 w-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <LayoutGrid className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 id="page-management-title" className="text-base sm:text-lg font-bold text-slate-900 tracking-tight truncate">
                    Page Management
                  </h2>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 shrink-0">
                    {pages.length} {pages.length === 1 ? 'Page' : 'Pages'}
                  </span>
                  {isDirty && (
                    <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                      Pending Changes
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 truncate hidden sm:block">
                  Add, delete, reorder, and rotate pages in 90° steps
                </p>
              </div>
            </div>

            {/* Quick Action Buttons */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Rotate All Pages 90° Clockwise */}
              <button
                id="btn-rotate-all-pages"
                onClick={() => handleRotateAll(90)}
                disabled={pages.length === 0 || isApplying}
                className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 text-xs font-medium shadow-2xs transition cursor-pointer"
                title="Rotate all pages 90° clockwise"
              >
                <RotateCw className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span className="hidden md:inline">Rotate All</span>
              </button>

              {/* Add Blank Page */}
              <button
                id="btn-open-add-blank-page"
                onClick={() => setShowAddBlankDialog(true)}
                disabled={isApplying}
                className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 text-xs sm:text-sm font-medium shadow-2xs transition cursor-pointer"
                title="Add a new blank page"
              >
                <FilePlus2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Add Blank</span>
              </button>

              {/* Import Pages from another PDF */}
              <button
                id="btn-import-pdf-pages"
                onClick={() => importFileInputRef.current?.click()}
                disabled={isApplying || isImporting}
                className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 text-xs sm:text-sm font-medium shadow-2xs transition cursor-pointer"
                title="Import pages from another PDF file"
              >
                {isImporting ? (
                  <Loader2 className="w-4 h-4 text-blue-600 animate-spin shrink-0" />
                ) : (
                  <FileUp className="w-4 h-4 text-purple-600 shrink-0" />
                )}
                <span className="hidden sm:inline">Import PDF</span>
              </button>

              {/* Hidden file input for importing */}
              <input
                ref={importFileInputRef}
                type="file"
                accept=".pdf,application/pdf"
                className="hidden"
                onChange={handleImportPdfFile}
              />

              {/* Close Button */}
              <button
                id="btn-close-page-manager"
                onClick={onClose}
                disabled={isApplying}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="shrink-0 bg-red-50 border-b border-red-200 px-4 py-2 flex items-center justify-between gap-2 text-xs sm:text-sm text-red-800">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                className="text-red-500 hover:text-red-800 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Main Pages Overview Grid */}
          <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-6 bg-slate-100/70">
            {isLoadingPages ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500 py-12">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
                <p className="text-sm font-medium">Generating page overviews...</p>
              </div>
            ) : pages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500 py-12">
                <p className="text-sm font-medium">No pages currently in this document.</p>
                <button
                  onClick={() => setShowAddBlankDialog(true)}
                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold"
                >
                  Add a Blank Page
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4.5">
                {pages.map((page, index) => {
                  const isCurrent = page.source === 'existing' && page.originalPageIndex === currentPage - 1;
                  const isSelected = selectedPageId === page.id;
                  const thumb = thumbnails[page.id];
                  const rotationDeg = page.rotationDelta || 0;
                  const isDragTarget = dragOverIndex === index;

                  return (
                    <div
                      key={page.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDrop={(e) => handleDrop(e, index)}
                      onDragEnd={handleDragEnd}
                      onClick={() => handleCardClick(index + 1, page.id)}
                      className={`group relative flex flex-col bg-white rounded-xl border transition-all duration-150 shadow-xs hover:shadow-md cursor-pointer select-none overflow-hidden ${
                        isSelected
                          ? 'border-blue-600 ring-2 ring-blue-500/20 shadow-md'
                          : 'border-slate-200 hover:border-slate-300'
                      } ${isDragTarget ? 'scale-102 border-blue-500 bg-blue-50/30' : ''}`}
                    >
                      {/* Top Header of Card */}
                      <div className="flex items-center justify-between px-2.5 py-1.5 bg-slate-50 border-b border-slate-100 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {/* Drag handle */}
                          <div
                            className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 p-0.5"
                            title="Drag to reorder"
                          >
                            <GripVertical className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-semibold text-slate-800 text-[11px] truncate">
                            Page {index + 1}
                          </span>
                        </div>

                        {/* Badges */}
                        <div className="flex items-center gap-1 shrink-0">
                          {isCurrent && (
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-blue-100 text-blue-700">
                              Current
                            </span>
                          )}
                          {page.source === 'blank' && (
                            <span className="text-[10px] font-medium px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-700">
                              Blank
                            </span>
                          )}
                          {page.source === 'imported' && (
                            <span className="text-[10px] font-medium px-1.5 py-0.2 rounded-full bg-purple-100 text-purple-700" title={page.sourceFileName}>
                              Imported
                            </span>
                          )}
                          {page.rotationAngle !== 0 && (
                            <span className="text-[10px] font-mono font-bold px-1 py-0.2 rounded-md bg-amber-100 text-amber-800" title={`Rotated to ${page.rotationAngle}°`}>
                              {page.rotationAngle}°
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Visual Thumbnail Preview Area */}
                      <div className="relative aspect-[3/4] p-3 flex items-center justify-center bg-slate-100/50 overflow-hidden">
                        {thumb ? (
                          <div
                            className="relative max-h-full max-w-full flex items-center justify-center transition-transform duration-200"
                            style={{
                              transform: `rotate(${rotationDeg}deg)`,
                            }}
                          >
                            <img
                              src={thumb}
                              alt={`Thumbnail Page ${index + 1}`}
                              className="max-h-[170px] max-w-[130px] sm:max-h-[190px] sm:max-w-[150px] object-contain rounded-sm shadow-xs border border-slate-200 bg-white"
                              loading="lazy"
                            />
                          </div>
                        ) : (
                          <div className="h-full w-full rounded border border-dashed border-slate-300 flex flex-col items-center justify-center gap-1 text-slate-400 bg-white">
                            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
                            <span className="text-[10px]">Rendering</span>
                          </div>
                        )}

                        {/* Interactive Overlay Click Prompt */}
                        {!isDirty && (
                          <div className="absolute inset-0 bg-blue-600/0 hover:bg-blue-600/10 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                            <span className="px-2 py-1 rounded-md bg-slate-900/80 text-white text-[11px] font-medium shadow-xs">
                              Click to view
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Bottom Controls Bar on Card */}
                      <div
                        className="p-1.5 bg-white border-t border-slate-100 grid grid-cols-5 gap-1 items-center justify-items-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {/* Move Left / Earlier */}
                        <button
                          onClick={() => handleMovePage(index, 'left')}
                          disabled={index === 0}
                          className="p-1 rounded text-slate-600 hover:text-blue-600 hover:bg-slate-100 disabled:opacity-20 disabled:hover:bg-transparent transition cursor-pointer"
                          title="Move page earlier"
                          aria-label="Move page earlier"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                        </button>

                        {/* Rotate 90° Counter-Clockwise */}
                        <button
                          onClick={() => handleRotatePage(page.id, -90)}
                          className="p-1 rounded text-slate-600 hover:text-blue-600 hover:bg-slate-100 transition cursor-pointer"
                          title="Rotate 90° counter-clockwise"
                          aria-label="Rotate 90° counter-clockwise"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </button>

                        {/* Rotate 90° Clockwise */}
                        <button
                          onClick={() => handleRotatePage(page.id, 90)}
                          className="p-1 rounded text-slate-600 hover:text-blue-600 hover:bg-slate-100 transition cursor-pointer"
                          title="Rotate 90° clockwise"
                          aria-label="Rotate 90° clockwise"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>

                        {/* Duplicate Page */}
                        <button
                          onClick={() => handleDuplicatePage(index)}
                          className="p-1 rounded text-slate-600 hover:text-blue-600 hover:bg-slate-100 transition cursor-pointer"
                          title="Duplicate this page"
                          aria-label="Duplicate this page"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>

                        {/* Delete Page */}
                        <button
                          onClick={() => handleDeletePage(page.id)}
                          disabled={pages.length <= 1}
                          className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-20 disabled:hover:bg-transparent transition cursor-pointer"
                          title={pages.length <= 1 ? 'Cannot delete the only page in the document' : 'Delete this page'}
                          aria-label="Delete page"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Move Right / Later button bar */}
                      <div
                        className="px-2 py-1 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => handleMovePage(index, 'left')}
                          disabled={index === 0}
                          className="text-[10px] font-medium text-slate-600 hover:text-blue-600 disabled:opacity-25"
                        >
                          ← Move Left
                        </button>
                        <button
                          onClick={() => handleMovePage(index, 'right')}
                          disabled={index === pages.length - 1}
                          className="text-[10px] font-medium text-slate-600 hover:text-blue-600 disabled:opacity-25"
                        >
                          Move Right →
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="shrink-0 px-4 sm:px-6 py-3 border-t border-slate-200 bg-white flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {isDirty ? (
                <button
                  onClick={handleReset}
                  disabled={isApplying}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs sm:text-sm font-medium text-slate-600 hover:bg-slate-100 active:bg-slate-200 transition cursor-pointer"
                >
                  Reset Changes
                </button>
              ) : (
                <span className="text-xs text-slate-500">
                  Click any page to jump to it directly in the viewer
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                id="btn-cancel-page-manager"
                onClick={onClose}
                disabled={isApplying}
                className="px-3 sm:px-4 py-2 rounded-lg border border-slate-200 text-xs sm:text-sm font-medium text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition cursor-pointer"
              >
                {isDirty ? 'Cancel' : 'Close'}
              </button>

              <button
                id="btn-apply-page-manager"
                onClick={handleApply}
                disabled={!isDirty || isApplying || pages.length === 0}
                className="flex items-center gap-1.5 px-4 sm:px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-45 disabled:hover:bg-blue-600 text-white text-xs sm:text-sm font-semibold shadow-xs transition cursor-pointer"
              >
                {isApplying ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Saving Changes...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4 shrink-0" />
                    <span>Apply Changes ({pages.length} {pages.length === 1 ? 'Page' : 'Pages'})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>

        {/* Add Blank Page Configuration Sub-Modal */}
        {showAddBlankDialog && (
          <div
            className="fixed inset-0 z-60 bg-slate-900/40 backdrop-blur-2xs flex items-center justify-center p-4"
            onClick={() => setShowAddBlankDialog(false)}
          >
            <div
              className="bg-white rounded-xl shadow-xl border border-slate-200 p-5 max-w-sm w-full space-y-4 animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <FilePlus2 className="w-4 h-4 text-emerald-600" />
                  Add Blank Page
                </h3>
                <button
                  onClick={() => setShowAddBlankDialog(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Page Size Option */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Page Dimensions
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'match', label: 'Match Document' },
                    { id: 'a4', label: 'A4' },
                    { id: 'letter', label: 'US Letter' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setBlankPageSize(opt.id as any)}
                      className={`py-2 px-2 rounded-lg text-xs font-medium border text-center transition cursor-pointer ${
                        blankPageSize === opt.id
                          ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Orientation */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Orientation
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'portrait', label: 'Portrait' },
                    { id: 'landscape', label: 'Landscape' },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setBlankOrientation(opt.id as any)}
                      className={`py-2 px-3 rounded-lg text-xs font-medium border text-center transition cursor-pointer ${
                        blankOrientation === opt.id
                          ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Insertion Position */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Insert Position
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setBlankInsertPosition('after-selected')}
                    className={`py-2 px-2 rounded-lg text-xs font-medium border text-center transition cursor-pointer ${
                      blankInsertPosition === 'after-selected'
                        ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    After Current
                  </button>
                  <button
                    type="button"
                    onClick={() => setBlankInsertPosition('end')}
                    className={`py-2 px-2 rounded-lg text-xs font-medium border text-center transition cursor-pointer ${
                      blankInsertPosition === 'end'
                        ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    At End
                  </button>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddBlankDialog(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAddBlankPageConfirm}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs"
                >
                  Insert Page
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AnimatePresence>
  );
};
