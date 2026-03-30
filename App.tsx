import React, { useState, useCallback, useRef, useEffect } from 'react';
import { fetchTableOfContents, fetchChapterContent } from './services/scraperService';
import { Chapter, NovelMetadata, ScrapeStatus, ScrapeProgress } from './types';
import ChapterList from './components/ChapterList';

declare const chrome: any;

const DEFAULT_URL = 'https://www.52shuku.net/yanqing/30_b/bkbPq.html';

export default function App() {
  const [url, setUrl] = useState('');
  const [metadata, setMetadata] = useState<NovelMetadata | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [status, setStatus] = useState<ScrapeStatus>(ScrapeStatus.IDLE);
  const [progress, setProgress] = useState<ScrapeProgress>({ total: 0, current: 0, errors: 0 });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs: any) => {
        if (tabs[0]?.url) {
          setUrl(tabs[0].url);
        }
      });
    } else {
      setUrl(DEFAULT_URL);
    }
  }, []);

  const handleFetchTOC = async () => {
    if (!url) return;
    setStatus(ScrapeStatus.FETCHING_TOC);
    setChapters([]);
    setMetadata(null);
    setErrorMsg(null);

    try {
      const data = await fetchTableOfContents(url);
      setMetadata(data.metadata);
      setChapters(data.chapters);
      setStatus(ScrapeStatus.IDLE);
      setProgress({ total: data.chapters.length, current: 0, errors: 0 });
    } catch (error: any) {
      console.error(error);
      setStatus(ScrapeStatus.ERROR);
      setErrorMsg(error.message || "Failed to fetch table of contents");
    }
  };

  const downloadTxt = () => {
    if (chapters.length === 0) return;
    
    const content = chapters
      .filter(c => c.status === 'completed' && c.content)
      .map(c => `${c.title}\n\n${c.content}\n\n${'='.repeat(20)}\n\n`)
      .join('');

    const header = metadata ? `Title: ${metadata.title}\nAuthor: ${metadata.author}\nSource: ${url}\n\n` : '';
    const blob = new Blob([header + content], { type: 'text/plain;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    
    if (typeof chrome !== 'undefined' && chrome.downloads) {
      chrome.downloads.download({
        url: blobUrl,
        filename: `${metadata?.title || 'novel'}.txt`,
        saveAs: true
      });
    } else {
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${metadata?.title || 'novel'}.txt`;
      link.click();
    }
  };

  const handleStartScraping = useCallback(async () => {
    if (chapters.length === 0) return;
    
    setStatus(ScrapeStatus.FETCHING_CONTENT);
    abortControllerRef.current = new AbortController();

    // Concurrent batch processing for faster downloads
    const BATCH_SIZE = 8; 
    
    const pendingChapters = chapters.filter(c => c.status === 'pending');
    let currentChapters = [...chapters];

    for (let i = 0; i < pendingChapters.length; i += BATCH_SIZE) {
      if (abortControllerRef.current?.signal.aborted) break;

      const batch = pendingChapters.slice(i, i + BATCH_SIZE);
      
      // Mark batch as loading immutably
      setChapters(prev => prev.map(ch => 
        batch.some(c => c.id === ch.id) ? { ...ch, status: 'loading' } : ch
      ));

      await Promise.all(batch.map(async (chapter) => {
        try {
          const content = await fetchChapterContent(chapter);
          setChapters(prev => prev.map(ch => 
            ch.id === chapter.id ? { ...ch, content, status: 'completed' } : ch
          ));
          setProgress(prev => ({ ...prev, current: prev.current + 1 }));
        } catch (e) {
          setChapters(prev => prev.map(ch => 
            ch.id === chapter.id ? { ...ch, status: 'error' } : ch
          ));
          setProgress(prev => ({ ...prev, errors: prev.errors + 1 }));
        }
      }));

      // Delay between batches to avoid rate limits and Cloudflare blocks
      // Using a longer delay with jitter since we increased the batch size to 8
      const delay = 1000 + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    setStatus(ScrapeStatus.COMPLETED);
  }, [chapters]);

  const progressPercentage = metadata?.chapterCount ? Math.round((progress.current / metadata.chapterCount) * 100) : 0;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background text-slate-200">
      {/* Navbar / Header */}
      <div className="px-4 py-3 bg-surface border-b border-slate-700 shadow-md shrink-0 flex items-center justify-between">
        <h1 className="text-lg font-bold text-white flex items-center gap-2 tracking-tight">
          <span className="text-xl">📖</span>
          <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">NovelFetcher</span>
        </h1>
        <div className="flex items-center gap-2">
           <div className={`w-2 h-2 rounded-full ${status === ScrapeStatus.FETCHING_CONTENT ? 'bg-secondary animate-pulse' : 'bg-slate-600'}`}></div>
        </div>
      </div>

      {/* Main Controls Area */}
      <div className="p-4 space-y-4 shrink-0 bg-background">
        {/* URL Input */}
        <div className="flex gap-2">
          <div className="relative flex-1 group">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full bg-surface border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all"
              placeholder="Paste novel table of contents URL..."
            />
            <div className="absolute inset-y-0 right-2 flex items-center pointer-events-none text-slate-500">
              <span className="text-[10px]">↵</span>
            </div>
          </div>
          <button
            onClick={handleFetchTOC}
            disabled={status === ScrapeStatus.FETCHING_TOC || status === ScrapeStatus.FETCHING_CONTENT}
            className="bg-primary hover:bg-indigo-600 active:scale-95 text-white px-4 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-500/20"
          >
            {status === ScrapeStatus.FETCHING_TOC ? 'Loading...' : 'Fetch'}
          </button>
        </div>

        {/* Error Message */}
        {errorMsg && (
          <div className="bg-red-500/10 border border-red-500/50 text-red-400 p-3 rounded-lg text-xs">
            {errorMsg}
          </div>
        )}

        {/* Novel Info Card */}
        {metadata && (
          <div className="bg-surface rounded-xl p-4 border border-slate-700 shadow-lg relative overflow-hidden">
             {/* Background Decoration */}
             <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>

             <div className="flex justify-between items-start mb-3 relative z-10">
                <div className="flex-1 min-w-0 pr-4">
                   <h2 className="font-bold text-sm text-white truncate leading-tight mb-1" title={metadata.title}>{metadata.title}</h2>
                   <p className="text-xs text-slate-400 flex items-center gap-2">
                     <span>👤 {metadata.author}</span>
                     <span>•</span>
                     <span>📑 {metadata.chapterCount} Chapters</span>
                   </p>
                </div>
                
                <div className="flex gap-2 shrink-0">
                  {status === ScrapeStatus.FETCHING_CONTENT ? (
                    <button 
                      onClick={() => abortControllerRef.current?.abort()} 
                      className="bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/50 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                    >
                      Stop
                    </button>
                  ) : (
                    <button 
                      onClick={handleStartScraping}
                      disabled={chapters.length === 0 || chapters.every(c => c.status === 'completed')}
                      className="bg-secondary hover:bg-emerald-600 text-white px-3 py-1.5 rounded-md text-xs font-bold shadow-lg shadow-emerald-500/20 transition-all active:scale-95 flex items-center gap-1"
                    >
                      {progress.current > 0 ? 'Resume' : 'Download All'}
                    </button>
                  )}
                </div>
             </div>

             {/* Progress Bar */}
             <div className="relative z-10">
                <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                  <span>Progress</span>
                  <span className={progressPercentage === 100 ? 'text-secondary font-bold' : ''}>{progressPercentage}%</span>
                </div>
                <div className="w-full bg-slate-900/50 rounded-full h-2 overflow-hidden border border-slate-700/50">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${progressPercentage === 100 ? 'bg-secondary' : 'bg-primary'}`}
                    style={{ width: `${progressPercentage}%` }}
                  >
                    {status === ScrapeStatus.FETCHING_CONTENT && (
                      <div className="w-full h-full bg-white/20 animate-progress-shine"></div>
                    )}
                  </div>
                </div>
             </div>
             
             {/* Action Row */}
             <div className="flex gap-2 mt-4 relative z-10">
               <button 
                 onClick={downloadTxt}
                 disabled={progress.current === 0}
                 className="flex-1 bg-slate-700/50 hover:bg-slate-700 border border-slate-600 text-slate-300 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-50"
               >
                 💾 Save TXT
               </button>
             </div>
          </div>
        )}
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden relative bg-slate-900/50">
        <div className="absolute inset-0 overflow-y-auto p-4 custom-scrollbar">
          <ChapterList chapters={chapters} />
        </div>
      </div>
    </div>
  );
}