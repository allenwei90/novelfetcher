import React, { useEffect, useRef } from 'react';
import { Chapter } from '../types';

interface ChapterListProps {
  chapters: Chapter[];
}

const ChapterList: React.FC<ChapterListProps> = ({ chapters }) => {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the first loading chapter
  useEffect(() => {
    if (listRef.current) {
      const loadingEl = listRef.current.querySelector('.chapter-loading');
      if (loadingEl) {
        loadingEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [chapters]);

  return (
    <div className="flex flex-col gap-2" ref={listRef}>
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Detected Chapters <span className="text-slate-600">({chapters.length})</span>
        </h3>
        {chapters.length > 0 && (
          <span className="text-[10px] text-slate-500">
             Scroll to see more
          </span>
        )}
      </div>
      
      <div className="grid grid-cols-2 gap-2 pb-4">
        {chapters.map((chapter) => (
          <div 
            key={chapter.id} 
            className={`
              relative p-2 rounded-lg border text-xs transition-all duration-200 group
              ${chapter.status === 'completed' 
                ? 'bg-emerald-900/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-900/20' 
                : ''}
              ${chapter.status === 'loading' 
                ? 'chapter-loading bg-blue-900/10 border-blue-500/30 text-blue-400 animate-pulse ring-1 ring-blue-500/50' 
                : ''}
              ${chapter.status === 'error' 
                ? 'bg-red-900/10 border-red-500/30 text-red-400' 
                : ''}
              ${chapter.status === 'pending' 
                ? 'bg-surface border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200' 
                : ''}
            `}
            title={chapter.title}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium flex-1">
                <span className="opacity-50 mr-1 text-[10px]">{chapter.id}.</span>
                {chapter.title}
              </span>
              
              <div className="shrink-0">
                {chapter.status === 'completed' && (
                  <span className="text-emerald-500 text-sm font-bold drop-shadow-md">✓</span>
                )}
                {chapter.status === 'loading' && (
                  <svg className="animate-spin h-3 w-3 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                )}
                {chapter.status === 'error' && <span className="text-red-500">!</span>}
              </div>
            </div>
            
            {/* Hover tooltip for full title if needed */}
            <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-transparent group-hover:ring-white/10 pointer-events-none"></div>
          </div>
        ))}
      </div>

      {chapters.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-slate-600 bg-surface/30 rounded-xl border border-dashed border-slate-700/50">
          <span className="text-2xl mb-2 opacity-50">📂</span>
          <p className="text-xs">No chapters found.</p>
          <p className="text-[10px] opacity-70 mt-1">Paste a URL above to begin.</p>
        </div>
      )}
    </div>
  );
};

export default ChapterList;