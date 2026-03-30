import { Chapter, NovelMetadata } from '../types';

declare const chrome: any;

/**
 * List of CORS proxies to rotate through in Web Mode.
 * 1. corsproxy.io: Generally faster and more permissive.
 * 2. allorigins.win: Good fallback.
 */
const PROXY_GENERATORS = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://thingproxy.freeboard.io/fetch/${url}`,
  // Additional fallbacks
  (url: string) => `https://cors-anywhere.herokuapp.com/${url}`,
  (url: string) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}` // JSON wrapped fallback
];

/**
 * Detects if running as a Chrome Extension
 */
const isExtension = (): boolean => {
  return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
};

/**
 * Decodes buffer to string, robustly handling charset detection (UTF-8 vs GBK)
 */
const decodeBuffer = (buffer: ArrayBuffer, contentType: string | null): string => {
  // 1. Initial decode as UTF-8 to parse ASCII-compatible headers/meta
  const utf8Decoder = new TextDecoder('utf-8');
  const text = utf8Decoder.decode(buffer);
  
  // Helper to try decoding with a specific charset
  const tryDecode = (charset: string): string | null => {
    try {
      const decoder = new TextDecoder(charset);
      return decoder.decode(buffer);
    } catch (e) {
      console.warn(`Failed to decode as ${charset}`, e);
      return null;
    }
  };

  // 2. Priority: Check Content-Type header
  if (contentType) {
    const headerCharsetMatch = contentType.match(/charset=([a-zA-Z0-9-]+)/i);
    if (headerCharsetMatch && headerCharsetMatch[1]) {
      const cs = headerCharsetMatch[1].toLowerCase();
      if (cs === 'gbk' || cs === 'gb2312' || cs === 'gb18030') {
        const res = tryDecode('gbk'); // 'gbk' decoder usually handles gb2312/gb18030 in browsers
        if (res) return res;
      }
    }
  }

  // 3. Secondary: Check HTML Meta tags in the initially decoded text
  // Matches <meta charset="gbk"> or <meta http-equiv="..." content="...; charset=gbk">
  const metaCharsetMatch = text.match(/charset=["']?([a-zA-Z0-9-]+)["']?/i);
  if (metaCharsetMatch && metaCharsetMatch[1]) {
    const cs = metaCharsetMatch[1].toLowerCase();
    if (cs === 'gbk' || cs === 'gb2312' || cs === 'gb18030') {
      const res = tryDecode('gbk');
      if (res) return res;
    }
  }

  // 4. Fallback Heuristic: If UTF-8 result has many replacement chars, try GBK
  // This handles cases where headers are missing or wrong
  // \uFFFD is the replacement character
  const utf8Errors = (text.match(/\uFFFD/g) || []).length;
  if (utf8Errors > 0) {
    const gbkText = tryDecode('gbk');
    if (gbkText) {
      const gbkErrors = (gbkText.match(/\uFFFD/g) || []).length;
      // If GBK produces significantly fewer errors (or zero), it's likely the correct one
      if (gbkErrors < utf8Errors) {
        return gbkText;
      }
    }
  }
  
  return text;
};

/**
 * Helper to fetch raw HTML via proxy or direct if extension
 * Retries on 429 errors (Too Many Requests), 408 (Timeout) and Network Errors.
 * Rotates proxies on failure in Web Mode.
 */
async function fetchHtml(url: string, validator?: (doc: Document) => boolean): Promise<Document> {
  const MAX_RETRIES = 8;
  const BASE_DELAY_MS = 1000; 

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let fetchUrl = url;
    let isJsonWrapped = false;

    // Proxy Selection Logic
    if (!isExtension()) {
      // Rotate proxy based on attempt count
      const proxyGen = PROXY_GENERATORS[attempt % PROXY_GENERATORS.length];
      fetchUrl = proxyGen(url);
      isJsonWrapped = fetchUrl.includes('allorigins.win/get');
    }

    try {
      const response = await fetch(fetchUrl);
      
      // Handle 429 Too Many Requests
      if (response.status === 429) {
        throw new Error("429 Too Many Requests");
      }
      // Handle 408 Request Timeout
      if (response.status === 408) {
        throw new Error("408 Request Timeout");
      }

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
      }
      
      let text = '';
      if (isJsonWrapped) {
        const json = await response.json();
        text = json.contents;
      } else {
        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get('content-type');
        text = decodeBuffer(buffer, contentType);
      }
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');

      if (validator && !validator(doc)) {
        throw new Error("Validation failed (e.g. proxy returned error page or CAPTCHA)");
      }

      return doc;

    } catch (error: any) {
      if (attempt < MAX_RETRIES) {
        // Exponential backoff + jitter
        const delay = BASE_DELAY_MS * (attempt + 1) + (Math.random() * 500);
        
        const proxyName = !isExtension() ? `Proxy ${(attempt % PROXY_GENERATORS.length) + 1}` : 'Direct';
        console.warn(`Fetch issue (${error.message}) for ${url} using ${proxyName}. Retrying in ${Math.round(delay)}ms... (Attempt ${attempt + 1}/${MAX_RETRIES})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // If loop is exhausted or non-retriable error occurred
      if (attempt === MAX_RETRIES) {
        console.error(`Final fetch error for ${url} after ${MAX_RETRIES} retries:`, error);
        throw error;
      }
      
      // Propagate other errors immediately
      throw error; 
    }
  }
  throw new Error("Fetch failed unexpectedly");
}

/**
 * Resolves relative URLs to absolute URLs
 */
function resolveUrl(base: string, relative: string): string {
  try {
    return new URL(relative, base).href;
  } catch (e) {
    return relative;
  }
}

/**
 * Helper to find the main content container in a chapter document
 */
function getContentElement(doc: Document): Element | null {
  return doc.querySelector('.article-content') ||
         doc.querySelector('#content') ||
         doc.querySelector('.content') ||
         doc.querySelector('#text') ||
         doc.querySelector('.chapter_content') ||
         doc.querySelector('#chaptercontent') ||
         doc.querySelector('.chapter-content') ||
         doc.querySelector('#chapter-content') ||
         doc.querySelector('.read-content') ||
         doc.querySelector('.txtnav') ||
         doc.querySelector('.book_content') ||
         doc.querySelector('#BookText') ||
         doc.querySelector('#htmlContent') ||
         doc.querySelector('#nr1') ||
         doc.querySelector('.yd_text2') ||
         doc.querySelector('article');
}

/**
 * Fetches the Table of Contents from 52shuku.net (and similar structures)
 */
export const fetchTableOfContents = async (url: string): Promise<{ metadata: NovelMetadata; chapters: Chapter[] }> => {
  const doc = await fetchHtml(url);

  // 1. Attempt to find Title
  let title = doc.querySelector('h1')?.textContent?.trim() || 'Unknown Title';
  const author = doc.querySelector('.author')?.textContent?.trim() || 
                 doc.querySelector('meta[name="author"]')?.getAttribute('content') || 
                 'Unknown Author';

  // 2. Attempt to find Chapter Links
  // Specific for 52shuku: .m-box or .article-content or .list
  let chapterAnchors = Array.from(doc.querySelectorAll('a'));
  
  const listContainer = doc.querySelector('ul.list') || 
                        doc.querySelector('.m-box') || 
                        doc.querySelector('.article-content') ||
                        doc.querySelector('.catalog'); // Common catalog class

  if (listContainer) {
    chapterAnchors = Array.from(listContainer.querySelectorAll('a'));
  } else {
     // Fallback filter
     chapterAnchors = chapterAnchors.filter(a => {
      const href = a.getAttribute('href');
      const text = a.textContent?.trim();
      return href && text && (href.includes('.html') || href.includes('_')) && !href.includes('index');
    });
  }

  const chapters: Chapter[] = chapterAnchors.map((a, index) => ({
    id: index + 1,
    title: a.textContent?.trim() || `Chapter ${index + 1}`,
    url: resolveUrl(url, a.getAttribute('href') || ''),
    status: 'pending'
  }));

  // Deduplicate by URL
  const uniqueChapters = chapters.filter((v, i, a) => a.findIndex(t => t.url === v.url) === i);

  if (uniqueChapters.length === 0) {
    throw new Error("No chapters found. The website structure might not be supported or the proxy returned an empty page.");
  }

  return {
    metadata: {
      title,
      author,
      chapterCount: uniqueChapters.length
    },
    chapters: uniqueChapters
  };
};

/**
 * Fetches content for a single chapter
 */
export const fetchChapterContent = async (chapter: Chapter): Promise<string> => {
  try {
    const doc = await fetchHtml(chapter.url, (d) => !!getContentElement(d));
    
    // Heuristic for content extraction
    let contentElement = getContentElement(doc);
    
    if (!contentElement) {
       // Check if it might be a proxy error page or Cloudflare challenge
       const pageText = doc.body?.innerText || "";
       if (pageText.includes('Cloudflare') || pageText.includes('Checking your browser')) {
         throw new Error("Blocked by Cloudflare/CAPTCHA");
       }
       throw new Error("Could not locate content container. The website structure might be unsupported or the proxy returned an invalid page.");
    }

    // Clone to remove unwanted elements (ads, scripts, pagination links)
    const clone = contentElement.cloneNode(true) as HTMLElement;
    
    // Cleanup
    const junkSelectors = ['script', 'style', '.ads', '.pagelist', 'a', 'div[align="center"]', '.share'];
    junkSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    let text = clone.innerText || clone.textContent || "";
    
    // Formatting
    text = text.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n\n');
    
    return text;
  } catch (error) {
    console.error(`Error fetching chapter ${chapter.id}`, error);
    throw error;
  }
};