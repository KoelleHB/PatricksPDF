import React, { useState, useMemo } from 'react';
import { X, Search, ChevronRight, Bookmark, ExternalLink } from 'lucide-react';
import { PdfOutlineItem } from '../types';

interface TableOfContentsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  outline: PdfOutlineItem[];
  currentPage: number;
  onSelectPage: (pageNum: number) => void;
}

export const TableOfContentsDrawer: React.FC<TableOfContentsDrawerProps> = ({
  isOpen,
  onClose,
  outline,
  currentPage,
  onSelectPage,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  // Recursive search filter
  const filteredOutline = useMemo(() => {
    if (!searchQuery.trim()) return outline;
    const query = searchQuery.toLowerCase();

    function filterNodes(nodes: PdfOutlineItem[]): PdfOutlineItem[] {
      const result: PdfOutlineItem[] = [];
      for (const node of nodes) {
        const matchesSelf = node.title.toLowerCase().includes(query);
        const filteredChildren = node.items ? filterNodes(node.items) : [];
        if (matchesSelf || filteredChildren.length > 0) {
          result.push({
            ...node,
            items: filteredChildren.length > 0 ? filteredChildren : undefined,
          });
        }
      }
      return result;
    }

    return filterNodes(outline);
  }, [outline, searchQuery]);

  if (!isOpen) return null;

  const renderItem = (item: PdfOutlineItem, depth: number = 0) => {
    const isCurrent = item.targetPage === currentPage;

    return (
      <div key={item.id} className="flex flex-col">
        <button
          onClick={() => {
            if (item.targetPage) {
              onSelectPage(item.targetPage);
              onClose();
            } else if (item.url) {
              window.open(item.url, '_blank', 'noopener,noreferrer');
            }
          }}
          style={{ paddingLeft: `${Math.max(12, depth * 18 + 12)}px` }}
          className={`flex items-center justify-between gap-2 py-2 pr-3 text-left rounded-lg transition-colors cursor-pointer group ${
            isCurrent
              ? 'bg-blue-50 text-blue-700 font-medium'
              : 'text-slate-700 hover:bg-slate-100/80 hover:text-slate-900'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Bookmark
              className={`w-3.5 h-3.5 shrink-0 ${
                isCurrent ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
              }`}
            />
            <span className="text-xs sm:text-sm truncate">{item.title}</span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {item.targetPage && (
              <span
                className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${
                  isCurrent
                    ? 'bg-blue-200/70 text-blue-900 font-bold'
                    : 'bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-slate-700'
                }`}
              >
                p. {item.targetPage}
              </span>
            )}
            {item.url && (
              <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-blue-500" />
            )}
            <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-500" />
          </div>
        </button>

        {item.items && item.items.length > 0 && (
          <div className="flex flex-col border-l border-slate-200/70 ml-4 my-0.5">
            {item.items.map((child) => renderItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Table of Contents"
      className="fixed inset-0 z-50 flex"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
      />

      {/* Drawer Panel */}
      <div className="relative w-full max-w-sm bg-white shadow-2xl h-full flex flex-col z-10 animate-in slide-in-from-left duration-250">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-200 bg-slate-50/75">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-semibold text-slate-900">Table of Contents</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        {outline.length > 4 && (
          <div className="p-3 border-b border-slate-100">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter chapters or sections..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition"
              />
            </div>
          </div>
        )}

        {/* Content List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-0.5">
          {filteredOutline.length > 0 ? (
            filteredOutline.map((item) => renderItem(item, 0))
          ) : (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center text-slate-400">
              <Bookmark className="w-8 h-8 stroke-1 text-slate-300 mb-2" />
              <p className="text-xs font-medium text-slate-600">
                {searchQuery ? 'No matching chapters found' : 'No Table of Contents in document'}
              </p>
              <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                {searchQuery
                  ? 'Try a different keyword or search query.'
                  : 'You can still click internal links inside the document or use page navigation.'}
              </p>
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-500 flex items-center justify-between">
          <span>{outline.length} top-level chapters</span>
          <span>Current: p. {currentPage}</span>
        </div>
      </div>
    </div>
  );
};
