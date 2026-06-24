import { useState } from 'react';
import { crawl, interactiveCrawl } from '../lib/api';

interface CrawlFormProps {
  onResult: (urls: string[], isSPA: boolean, framework: string) => void;
  authJson?: string;
}

export function CrawlForm({ onResult, authJson }: CrawlFormProps) {
  const [url, setUrl] = useState('');
  const [maxDepth, setMaxDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(100);
  const [loading, setLoading] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ isSPA: boolean; framework: string } | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setLoading(true);
    try {
      const res = await crawl({ url, maxDepth, maxPages, authJson });
      setResult({ isSPA: res.isSPA, framework: res.framework });
      onResult(res.urls, res.isSPA, res.framework);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Crawl failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[8px] p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="font-bold text-[15px] text-fg">Auto-discover</span>
        <span className="font-mono text-[11px] text-subtle border border-border rounded-[5px] px-[7px] py-[3px]">
          CRAWLER
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block font-semibold text-[12px] text-muted mb-[7px]">Target URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            required
            className="w-full h-[38px] px-3 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[13.5px] outline-none focus:border-accent focus:bg-surface"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-semibold text-[12px] text-muted mb-[7px]">Max Depth</label>
            <input
              type="number"
              value={maxDepth}
              onChange={(e) => setMaxDepth(Number(e.target.value))}
              min={1}
              max={10}
              className="w-full h-[38px] px-3 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[13.5px] outline-none focus:border-accent focus:bg-surface"
            />
          </div>
          <div>
            <label className="block font-semibold text-[12px] text-muted mb-[7px]">Max Pages</label>
            <input
              type="number"
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              min={1}
              max={1000}
              className="w-full h-[38px] px-3 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[13.5px] outline-none focus:border-accent focus:bg-surface"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <button
            type="submit"
            disabled={loading || browsing || !url}
            className="flex items-center gap-2 bg-transparent text-accent border border-accent rounded-[4px] h-[38px] px-4 font-semibold hover:bg-accent-soft disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span
              className="inline-block w-[7px] h-[7px] rounded-full border-2 border-accent shrink-0"
              style={loading ? { animation: 'pulse-dot 1s ease-in-out infinite' } : undefined}
            />
            {loading ? 'Discovering...' : 'Discover routes'}
          </button>

          <button
            type="button"
            disabled={loading || browsing || !url}
            onClick={async () => {
              setError(null);
              setBrowsing(true);
              try {
                const res = await interactiveCrawl(url, authJson);
                const urls = res.urls || [];
                onResult(urls, false, '');
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Interactive crawl failed');
              } finally {
                setBrowsing(false);
              }
            }}
            className="flex items-center gap-2 bg-s2 border border-border text-fg rounded-[4px] h-[38px] px-4 font-semibold hover:border-bs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-4 h-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
            {browsing ? 'Browse the app, then close the window...' : 'Browse & discover'}
          </button>
        </div>

        {error && (
          <div className="border border-border rounded-[4px] px-3 py-2 text-[13px] text-bad bg-s2">
            {error}
          </div>
        )}

        {result && result.isSPA && (
          <div className="flex items-center gap-2">
            <span className="text-accent bg-accent-soft text-[11px] font-semibold px-[9px] py-1 rounded-full">
              SPA{result.framework ? ` · ${result.framework}` : ''}
            </span>
          </div>
        )}
      </form>
    </div>
  );
}
