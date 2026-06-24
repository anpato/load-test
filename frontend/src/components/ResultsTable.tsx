import { useCallback, useRef, useState } from 'react';
import type { URLResult, VitalKey } from '../lib/types';
import {
  VITAL_THRESHOLDS,
  VITAL_META,
  getVitalRating,
  ratingCssColor,
  ratingLabel,
  formatVital,
} from '../lib/types';

interface Props {
  results: Record<string, URLResult>;
}

const VITALS: VitalKey[] = ['lcp', 'fcp', 'cls', 'ttfb'];

function avg(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function RatingPill({ rating }: { rating: 'good' | 'needs-improvement' | 'poor' }) {
  const color = ratingCssColor(rating);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full font-semibold text-[10.5px]"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      {ratingLabel(rating)}
    </span>
  );
}

type SortKey = 'url' | 'lcp' | 'fcp' | 'cls' | 'ttfb';

const INITIAL_WIDTHS = [300, 120, 120, 120, 120];

function useColumnResize(initialWidths: number[]) {
  const [widths, setWidths] = useState(initialWidths);
  const dragging = useRef<{ col: number; startX: number; startW: number } | null>(null);

  const onMouseDown = useCallback((col: number, e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = { col, startX: e.clientX, startW: widths[col] };

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const delta = ev.clientX - dragging.current.startX;
      const newW = Math.max(60, dragging.current.startW + delta);
      setWidths((prev) => prev.map((w, i) => (i === dragging.current!.col ? newW : w)));
    };

    const onUp = () => {
      dragging.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [widths]);

  return { widths, onMouseDown };
}

export default function ResultsTable({ results }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('url');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const { widths, onMouseDown } = useColumnResize(INITIAL_WIDTHS);

  const rows = Object.values(results);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'url') {
      cmp = a.url.localeCompare(b.url);
    } else {
      cmp = a[sortKey].p75 - b[sortKey].p75;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const summaryRow: Record<VitalKey, number> = {
    lcp: avg(rows.map((r) => r.lcp.p75)),
    fcp: avg(rows.map((r) => r.fcp.p75)),
    cls: avg(rows.map((r) => r.cls.p75)),
    ttfb: avg(rows.map((r) => r.ttfb.p75)),
  };

  const allGood = VITALS.every((v) => getVitalRating(v, summaryRow[v]) === 'good');

  function exportJson() {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'results.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="text-subtle ml-1 text-[10px]">↕</span>;
    return <span className="text-accent ml-1 text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  const columns = [
    { key: 'url' as SortKey, label: 'Route' },
    ...VITALS.map((v) => ({ key: v as SortKey, label: `${VITAL_META[v].label} p75` })),
  ];

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-subtle text-[13px] font-mono">
        No results available.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="font-bold text-[22px] tracking-tight text-fg">Results</span>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full font-semibold text-[11px] ${allGood ? 'bg-accent-soft text-accent' : 'text-bad'}`}
            style={allGood ? undefined : { background: 'color-mix(in srgb, var(--color-bad) 12%, transparent)' }}
          >
            {allGood ? 'Passed' : 'Thresholds breached'}
          </span>
          <span className="font-mono text-[12px] text-subtle">{rows.length} routes</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportJson}
            className="h-[34px] px-3 text-[13px] text-fg bg-s2 border border-border rounded-[4px] hover:bg-border transition-colors font-medium"
          >
            Export JSON
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {VITALS.map((v) => {
          const val = summaryRow[v];
          const rating = getVitalRating(v, val);
          const thresh = VITAL_THRESHOLDS[v];
          const pct = Math.min((val / thresh.needsImprovement) * 100, 100);
          const color = ratingCssColor(rating);
          const meta = VITAL_META[v];
          return (
            <div key={v} className="bg-surface border border-border rounded-[8px] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono font-bold text-[12px] tracking-wide text-fg">{meta.label}</span>
                <RatingPill rating={rating} />
              </div>
              <div className="flex items-baseline gap-1.5 mb-3">
                <span className="font-mono font-semibold text-[28px] text-fg">{formatVital(v, val)}</span>
                <span className="text-[11px] text-subtle">p75</span>
              </div>
              <div className="h-[6px] bg-s2 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="font-mono text-[10.5px] text-subtle">{meta.good}</span>
                <span className="font-mono text-[10.5px] text-subtle">{meta.poor}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-surface border border-border rounded-[8px] overflow-hidden overflow-x-auto">
        <table style={{ minWidth: widths.reduce((a, b) => a + b, 0) }} className="w-full border-collapse">
          <thead>
            <tr className="bg-s2 border-b border-border">
              {columns.map((col, ci) => (
                <th
                  key={col.key}
                  style={{ width: widths[ci], minWidth: 60 }}
                  className="relative p-0"
                >
                  <div
                    onClick={() => handleSort(col.key)}
                    className={`px-3 py-2.5 font-semibold text-[11px] text-muted uppercase tracking-wide cursor-pointer select-none hover:text-fg transition-colors whitespace-nowrap ${ci > 0 ? 'text-right' : 'text-left'}`}
                  >
                    {col.label}
                    <SortIcon col={col.key} />
                  </div>
                  {ci < columns.length - 1 && (
                    <div
                      onMouseDown={(e) => onMouseDown(ci, e)}
                      className="absolute top-0 right-0 w-[5px] h-full cursor-col-resize hover:bg-accent/30 active:bg-accent/50 transition-colors z-10"
                    />
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.url} className={`border-b border-border last:border-b-0 ${i % 2 !== 0 ? 'bg-s2/40' : ''}`}>
                <td
                  style={{ width: widths[0] }}
                  className="px-3 py-2.5 font-mono text-[13px] text-fg truncate max-w-0"
                  title={row.url}
                >
                  {row.url}
                </td>
                {VITALS.map((v, vi) => {
                  const val = row[v].p75;
                  const color = ratingCssColor(getVitalRating(v, val));
                  return (
                    <td
                      key={v}
                      style={{ width: widths[vi + 1], color }}
                      className="px-3 py-2.5 font-mono text-[13px] text-right"
                    >
                      {formatVital(v, val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-s2 border-t-2 border-bs">
              <td className="px-3 py-2.5 font-semibold text-[11px] text-muted uppercase tracking-wide">Average</td>
              {VITALS.map((v) => {
                const val = summaryRow[v];
                const color = ratingCssColor(getVitalRating(v, val));
                return (
                  <td key={v} style={{ color }} className="px-3 py-2.5 font-mono text-[13px] text-right">
                    {formatVital(v, val)}
                  </td>
                );
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
