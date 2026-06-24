import { useState } from 'react';
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

type SortKey =
  | 'url'
  | 'lcp_p50' | 'lcp_p75' | 'lcp_p95'
  | 'fcp_p50' | 'fcp_p75' | 'fcp_p95'
  | 'cls_p50' | 'cls_p75' | 'cls_p95'
  | 'ttfb_p50' | 'ttfb_p75' | 'ttfb_p95';

const VITALS: VitalKey[] = ['lcp', 'fcp', 'cls', 'ttfb'];

function avg(vals: number[]): number {
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function getRowValue(row: URLResult, sortKey: SortKey): number | string {
  if (sortKey === 'url') return row.url;
  const [vital, pct] = sortKey.split('_') as [VitalKey, 'p50' | 'p75' | 'p95'];
  return row[vital][pct];
}

function RatingPill({ rating }: { rating: 'good' | 'needs-improvement' | 'poor' }) {
  const color = ratingCssColor(rating);
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full font-semibold text-[10.5px]"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
      }}
    >
      {ratingLabel(rating)}
    </span>
  );
}

export default function ResultsTable({ results }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('url');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

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
    const av = getRowValue(a, sortKey);
    const bv = getRowValue(b, sortKey);
    let cmp = 0;
    if (typeof av === 'string' && typeof bv === 'string') {
      cmp = av.localeCompare(bv);
    } else {
      cmp = (av as number) - (bv as number);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const summaryRow: Record<VitalKey, Record<string, number>> = {
    lcp: { p50: avg(rows.map((r) => r.lcp.p50)), p75: avg(rows.map((r) => r.lcp.p75)), p95: avg(rows.map((r) => r.lcp.p95)) },
    fcp: { p50: avg(rows.map((r) => r.fcp.p50)), p75: avg(rows.map((r) => r.fcp.p75)), p95: avg(rows.map((r) => r.fcp.p95)) },
    cls: { p50: avg(rows.map((r) => r.cls.p50)), p75: avg(rows.map((r) => r.cls.p75)), p95: avg(rows.map((r) => r.cls.p95)) },
    ttfb: { p50: avg(rows.map((r) => r.ttfb.p50)), p75: avg(rows.map((r) => r.ttfb.p75)), p95: avg(rows.map((r) => r.ttfb.p95)) },
  };

  const allGood = VITALS.every(
    (v) => getVitalRating(v, summaryRow[v].p75) === 'good'
  );

  function exportJson() {
    const blob = new Blob([JSON.stringify(results, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'results.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col)
      return <span className="text-subtle ml-1 text-[10px]">↕</span>;
    return (
      <span className="text-accent ml-1 text-[10px]">
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    );
  }

  function HeaderCell({ label, col }: { label: string; col: SortKey }) {
    return (
      <div
        onClick={() => handleSort(col)}
        className="px-3 py-2.5 font-semibold text-[11px] text-muted uppercase tracking-wide cursor-pointer select-none hover:text-fg transition-colors whitespace-nowrap"
      >
        {label}
        <SortIcon col={col} />
      </div>
    );
  }

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
          <span className="font-bold text-[22px] tracking-tight text-fg">
            Results
          </span>
          <span
            className={`inline-flex items-center px-2.5 py-0.5 rounded-full font-semibold text-[11px] ${
              allGood
                ? 'bg-accent-soft text-accent'
                : 'text-bad'
            }`}
            style={
              allGood
                ? undefined
                : {
                    background:
                      'color-mix(in srgb, var(--color-bad) 12%, transparent)',
                  }
            }
          >
            {allGood ? 'Passed' : 'Thresholds breached'}
          </span>
          <span className="font-mono text-[12px] text-subtle">
            {rows.length} routes
          </span>
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
          const val = summaryRow[v].p75;
          const rating = getVitalRating(v, val);
          const thresh = VITAL_THRESHOLDS[v];
          const pct = Math.min((val / thresh.needsImprovement) * 100, 100);
          const color = ratingCssColor(rating);
          const meta = VITAL_META[v];
          return (
            <div
              key={v}
              className="bg-surface border border-border rounded-[8px] p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono font-bold text-[12px] tracking-wide text-fg">
                  {meta.label}
                </span>
                <RatingPill rating={rating} />
              </div>
              <div className="flex items-baseline gap-1.5 mb-3">
                <span className="font-mono font-semibold text-[28px] text-fg">
                  {formatVital(v, val)}
                </span>
                <span className="text-[11px] text-subtle">p75</span>
              </div>
              <div className="h-[6px] bg-s2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: color }}
                />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="font-mono text-[10.5px] text-subtle">
                  {meta.good}
                </span>
                <span className="font-mono text-[10.5px] text-subtle">
                  {meta.poor}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="bg-surface border border-border rounded-[8px] overflow-hidden">
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] bg-s2 border-b border-border">
          <HeaderCell label="Route" col="url" />
          {VITALS.map((v) => (
            <HeaderCell
              key={`${v}_p75`}
              label={`${VITAL_META[v].label} p75`}
              col={`${v}_p75` as SortKey}
            />
          ))}
        </div>

        {sorted.map((row, i) => (
          <div
            key={row.url}
            className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr] border-b border-border last:border-b-0 ${
              i % 2 === 0 ? '' : 'bg-s2/40'
            }`}
          >
            <div
              className="px-3 py-2.5 font-mono text-[13px] text-fg truncate"
              title={row.url}
            >
              {row.url}
            </div>
            {VITALS.map((v) => {
              const val = row[v].p75;
              const rating = getVitalRating(v, val);
              const color = ratingCssColor(rating);
              return (
                <div
                  key={v}
                  className="px-3 py-2.5 font-mono text-[13px] text-right"
                  style={{ color }}
                >
                  {formatVital(v, val)}
                </div>
              );
            })}
          </div>
        ))}

        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] bg-s2 border-t-2 border-bs">
          <div className="px-3 py-2.5 font-semibold text-[11px] text-muted uppercase tracking-wide">
            Average
          </div>
          {VITALS.map((v) => {
            const val = summaryRow[v].p75;
            const rating = getVitalRating(v, val);
            const color = ratingCssColor(rating);
            return (
              <div
                key={v}
                className="px-3 py-2.5 font-mono text-[13px] text-right"
                style={{ color }}
              >
                {formatVital(v, val)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
