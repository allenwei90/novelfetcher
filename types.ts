export interface Chapter {
  id: number;
  title: string;
  url: string;
  content?: string;
  status: 'pending' | 'loading' | 'completed' | 'error';
}

export interface NovelMetadata {
  title: string;
  author?: string;
  chapterCount: number;
}

export enum ScrapeStatus {
  IDLE = 'IDLE',
  FETCHING_TOC = 'FETCHING_TOC',
  FETCHING_CONTENT = 'FETCHING_CONTENT',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface ScrapeProgress {
  total: number;
  current: number;
  errors: number;
}