import { useState } from 'react';
import { expandRoutes } from '../lib/api';
import type { Route } from '../lib/types';
import { ensureProtocol } from '../lib/url';

interface ManualRoutesProps {
  baseUrl: string;
  onBaseUrlChange: (url: string) => void;
  onRoutes: (urls: string[]) => void;
}

interface RouteEntry {
  pattern: string;
  params: Record<string, string>;
}

function extractParams(pattern: string): string[] {
  const matches = pattern.match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g);
  return matches ? matches.map((m) => m.slice(1)) : [];
}

export function ManualRoutes({ baseUrl, onBaseUrlChange, onRoutes }: ManualRoutesProps) {
  const [patternInput, setPatternInput] = useState('');
  const [routes, setRoutes] = useState<RouteEntry[]>([]);
  const [expanded, setExpanded] = useState<string[] | null>(null);
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addRoute() {
    const pattern = patternInput.trim();
    if (!pattern) return;
    const params: Record<string, string> = {};
    for (const p of extractParams(pattern)) {
      params[p] = '';
    }
    setRoutes((prev) => [...prev, { pattern, params }]);
    setPatternInput('');
    setExpanded(null);
  }

  function removeRoute(index: number) {
    setRoutes((prev) => prev.filter((_, i) => i !== index));
    setExpanded(null);
  }

  function updateParam(routeIndex: number, paramName: string, value: string) {
    setRoutes((prev) =>
      prev.map((r, i) =>
        i === routeIndex ? { ...r, params: { ...r.params, [paramName]: value } } : r
      )
    );
    setExpanded(null);
  }

  async function handleExpand() {
    setError(null);
    setLoading(true);
    try {
      const apiRoutes: Route[] = routes.map((r) => ({
        pattern: r.pattern,
        params: Object.fromEntries(
          Object.entries(r.params).map(([k, v]) => [
            k,
            v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          ])
        ),
      }));
      const res = await expandRoutes({ baseUrl, routes: apiRoutes });
      setExpanded(res.expandedURLs);
      setCapped(res.capped);
      onRoutes(res.expandedURLs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Expansion failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[8px] p-4">
      <div className="flex items-center justify-between mb-4">
        <span className="font-bold text-[15px] text-fg">Manual routes</span>
        <span className="font-mono text-[11px] text-subtle border border-border rounded-[5px] px-[7px] py-[3px]">
          {routes.length} {routes.length === 1 ? 'pattern' : 'patterns'}
        </span>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block font-semibold text-[12px] text-muted mb-[7px]">Base URL</label>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => onBaseUrlChange(e.target.value)}
            onBlur={() => onBaseUrlChange(ensureProtocol(baseUrl))}
            placeholder="https://example.com"
            className="w-full h-[38px] px-3 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[13.5px] outline-none focus:border-accent focus:bg-surface"
          />
        </div>

        <div>
          <label className="block font-semibold text-[12px] text-muted mb-[7px]">Add route pattern</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={patternInput}
              onChange={(e) => setPatternInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRoute())}
              placeholder="/products/:id"
              className="flex-1 h-[38px] px-3 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[13.5px] outline-none focus:border-accent focus:bg-surface"
            />
            <button
              type="button"
              onClick={addRoute}
              disabled={!patternInput.trim()}
              className="bg-s2 border border-border text-fg h-[38px] px-4 rounded-[4px] font-semibold hover:border-bs disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              Add route
            </button>
          </div>
        </div>

        {routes.length > 0 && (
          <ul className="space-y-2">
            {routes.map((route, ri) => {
              const paramNames = extractParams(route.pattern);
              return (
                <li key={ri} className="space-y-2">
                  <div className="flex items-center justify-between h-[38px] bg-s2 border border-border rounded-[4px] px-[14px]">
                    <span className="font-mono text-[13px] text-fg truncate">{route.pattern}</span>
                    <button
                      type="button"
                      onClick={() => removeRoute(ri)}
                      className="text-subtle hover:text-bad text-[12px] font-semibold shrink-0 ml-3"
                    >
                      Remove
                    </button>
                  </div>
                  {paramNames.map((param) => (
                    <div key={param} className="flex items-center gap-2 pl-3">
                      <span className="font-mono text-[12px] text-muted shrink-0">:{param}</span>
                      <input
                        type="text"
                        value={route.params[param] ?? ''}
                        onChange={(e) => updateParam(ri, param, e.target.value)}
                        placeholder="val1, val2, val3"
                        className="flex-1 h-[34px] px-3 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[12px] outline-none focus:border-accent focus:bg-surface"
                      />
                    </div>
                  ))}
                </li>
              );
            })}
          </ul>
        )}

        {routes.length > 0 && (
          <button
            type="button"
            onClick={handleExpand}
            disabled={loading || !baseUrl}
            className="flex items-center gap-2 bg-accent text-accent-fg h-[38px] px-[18px] rounded-[4px] font-semibold hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading && (
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loading ? 'Expanding...' : 'Expand & preview'}
          </button>
        )}

        {error && (
          <div className="border border-border rounded-[4px] px-3 py-2 text-[13px] text-bad bg-s2">
            {error}
          </div>
        )}

        {expanded && (
          <div className="space-y-2">
            {capped && (
              <div className="border border-border rounded-[4px] px-3 py-2 text-[13px] text-fg bg-s2">
                Results were capped — not all combinations are shown.
              </div>
            )}
            <div className="border border-border rounded-[4px] overflow-hidden">
              <div className="bg-s2 border-b border-border px-[13px] py-[9px] font-semibold text-[12px] text-muted">
                {expanded.length} URL{expanded.length !== 1 ? 's' : ''} expanded
              </div>
              <ul className="max-h-48 overflow-y-auto">
                {expanded.map((url, i) => (
                  <li key={i} className="px-[13px] py-[10px] border-b border-border last:border-b-0 font-mono text-[13px] text-fg truncate">
                    {url}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
