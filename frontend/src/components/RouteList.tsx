import { useState } from 'react';

type UrlSource = 'crawled' | 'manual' | 'sitemap';

interface RouteListProps {
  urls: string[];
  selectedUrls: string[];
  onSelectionChange: (urls: string[]) => void;
}

function inferSource(url: string): UrlSource {
  if (url.includes('sitemap')) return 'sitemap';
  return 'crawled';
}

export function RouteList({ urls, selectedUrls, onSelectionChange }: RouteListProps) {
  const [filter, setFilter] = useState('');

  const filtered = filter
    ? urls.filter((u) => u.toLowerCase().includes(filter.toLowerCase()))
    : urls;

  const allFilteredSelected = filtered.length > 0 && filtered.every((u) => selectedUrls.includes(u));

  function toggleAll() {
    if (allFilteredSelected) {
      onSelectionChange(selectedUrls.filter((u) => !filtered.includes(u)));
    } else {
      const next = Array.from(new Set([...selectedUrls, ...filtered]));
      onSelectionChange(next);
    }
  }

  function toggleUrl(url: string) {
    if (selectedUrls.includes(url)) {
      onSelectionChange(selectedUrls.filter((u) => u !== url));
    } else {
      onSelectionChange([...selectedUrls, url]);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter URLs..."
          className="flex-1 h-[38px] px-3 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[13.5px] outline-none focus:border-accent focus:bg-surface"
        />
        <button
          type="button"
          onClick={toggleAll}
          disabled={filtered.length === 0}
          className="shrink-0 bg-s2 border border-border text-fg h-[38px] px-4 rounded-[4px] font-semibold hover:border-bs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {allFilteredSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      <div className="font-semibold text-[12px] text-muted">
        {selectedUrls.length} of {urls.length} selected
        {filter && ` · showing ${filtered.length} filtered`}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-border rounded-[4px] px-4 py-8 text-center text-[13px] text-subtle">
          {urls.length === 0 ? 'No routes discovered yet.' : 'No routes match your filter.'}
        </div>
      ) : (
        <ul className="max-h-96 overflow-y-auto space-y-1">
          {filtered.map((url) => {
            const source = inferSource(url);
            const checked = selectedUrls.includes(url);
            return (
              <li
                key={url}
                className={`flex items-center gap-3 w-full p-[11px_13px] bg-s2 border rounded-[4px] cursor-pointer text-left ${checked ? 'border-accent' : 'border-border'}`}
                onClick={() => toggleUrl(url)}
              >
                <span
                  className={`shrink-0 flex items-center justify-center w-[18px] h-[18px] rounded-[5px] border ${
                    checked
                      ? 'bg-accent text-accent-fg border-accent'
                      : 'bg-surface border-bs'
                  }`}
                  onClick={(e) => { e.stopPropagation(); toggleUrl(url); }}
                >
                  {checked && (
                    <svg width="10" height="8" viewBox="0 0 10 8" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <span className="flex-1 font-mono text-[13px] text-fg truncate" title={url}>
                  {url}
                </span>
                {source === 'crawled' && (
                  <span className="shrink-0 text-accent bg-accent-soft text-[11px] font-semibold px-[9px] py-1 rounded-full">
                    crawled
                  </span>
                )}
                {source === 'sitemap' && (
                  <span className="shrink-0 text-muted bg-s2 border border-border text-[11px] font-semibold px-[9px] py-1 rounded-full">
                    sitemap
                  </span>
                )}
                {source === 'manual' && (
                  <span className="shrink-0 text-muted bg-s2 border border-border text-[11px] font-semibold px-[9px] py-1 rounded-full">
                    manual
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
