import { Fragment, useCallback, useEffect, useState } from 'react';
import { listRuns, getRun } from '../lib/api';
import type { Run, VitalKey, URLResult } from '../lib/types';
import {
  VITAL_META,
  formatVital,
  getVitalRating,
  ratingCssColor,
  ratingLabel,
} from '../lib/types';

const VITALS: VitalKey[] = ['lcp', 'fcp', 'cls', 'ttfb'];

function runHost(r: Run): string {
  try { return new URL((r.urls || [])[0]).host; } catch { return ''; }
}

function shortRoute(path: string, allPaths: string[]): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= 2) return path || '/';
  const lastSeg = segments[segments.length - 1];
  const isUnique = allPaths.filter((p) => p.endsWith('/' + lastSeg)).length === 1;
  if (isUnique) return '.../' + lastSeg;
  const last2 = segments.slice(-2).join('/');
  return '.../' + last2;
}

function deltaSign(delta: number): 'better' | 'worse' | 'same' {
  if (Math.abs(delta) < 0.001) return 'same';
  return delta < 0 ? 'better' : 'worse';
}

function formatDelta(delta: number, key: VitalKey): string {
  const prefix = delta > 0 ? '+' : '';
  if (key === 'cls') return prefix + delta.toFixed(3);
  return prefix + Math.round(delta) + 'ms';
}

function RunPicker({
  runs,
  selectedId,
  onChange,
  label,
  otherId,
}: {
  runs: Run[];
  selectedId: string | null;
  onChange: (id: string) => void;
  label: string;
  otherId: string | null;
}) {
  return (
    <div className="flex-1 min-w-[240px]">
      <label className="block font-semibold text-[12px] text-muted mb-[7px] uppercase tracking-wide">
        {label}
      </label>
      <select
        value={selectedId ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-[38px] px-3 bg-s2 border border-border rounded-[4px] text-fg font-mono font-medium text-[13.5px] outline-none focus:border-accent focus:bg-surface"
      >
        <option value="">Select a run...</option>
        {runs.map((r) => (
          <option key={r.id} value={r.id} disabled={r.id === otherId}>
            {runHost(r) || r.id.slice(0, 8)} — {r.config?.testType || 'custom'} — {r.urls?.length || 0} URLs — {new Date(r.startedAt).toLocaleString()}
          </option>
        ))}
      </select>
    </div>
  );
}

interface CompareRunsProps {
  onClose: () => void;
  initialRunA?: string;
  initialRunB?: string;
}

export default function CompareRuns({ onClose, initialRunA, initialRunB }: CompareRunsProps) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [runAId, setRunAId] = useState<string | null>(initialRunA ?? null);
  const [runBId, setRunBId] = useState<string | null>(initialRunB ?? null);
  const [runA, setRunA] = useState<Run | null>(null);
  const [runB, setRunB] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listRuns()
      .then((r) => {
        const finished = (r || []).filter((run) => (run.status === 'finished' || run.status === 'error') && run.results && Object.keys(run.results).length > 0);
        setRuns(finished);
      })
      .finally(() => setLoading(false));
  }, []);

  const loadRun = useCallback(async (id: string) => {
    try {
      return await getRun(id);
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (runAId) loadRun(runAId).then(setRunA);
    else setRunA(null);
  }, [runAId, loadRun]);

  useEffect(() => {
    if (runBId) loadRun(runBId).then(setRunB);
    else setRunB(null);
  }, [runBId, loadRun]);

  function urlPath(url: string): string {
    try { return new URL(url).pathname; } catch { return url; }
  }

  function buildPathIndex(run: Run | null): Map<string, URLResult> {
    const map = new Map<string, URLResult>();
    if (!run?.results) return map;
    for (const [url, result] of Object.entries(run.results)) {
      map.set(urlPath(url), result);
    }
    return map;
  }

  const pathIndexA = buildPathIndex(runA);
  const pathIndexB = buildPathIndex(runB);

  const allPaths = (() => {
    const set = new Set<string>();
    for (const k of pathIndexA.keys()) set.add(k);
    for (const k of pathIndexB.keys()) set.add(k);
    return [...set].sort();
  })();

  const getResultByPath = (index: Map<string, URLResult>, path: string): URLResult | null => {
    return index.get(path) ?? null;
  };

  const summaryA: Record<VitalKey, number> = { lcp: 0, fcp: 0, cls: 0, ttfb: 0 };
  const summaryB: Record<VitalKey, number> = { lcp: 0, fcp: 0, cls: 0, ttfb: 0 };
  const countA = runA?.results ? Object.keys(runA.results).length : 0;
  const countB = runB?.results ? Object.keys(runB.results).length : 0;

  if (runA?.results) {
    for (const r of Object.values(runA.results)) {
      for (const v of VITALS) summaryA[v] += r[v].p75;
    }
    if (countA > 0) for (const v of VITALS) summaryA[v] /= countA;
  }
  if (runB?.results) {
    for (const r of Object.values(runB.results)) {
      for (const v of VITALS) summaryB[v] += r[v].p75;
    }
    if (countB > 0) for (const v of VITALS) summaryB[v] /= countB;
  }

  const hasBoth = runA && runB;

  function exportComparison() {
    if (!runA || !runB) return;
    const data = {
      baseline: { id: runA.id, startedAt: runA.startedAt, config: runA.config },
      comparison: { id: runB.id, startedAt: runB.startedAt, config: runB.config },
      summary: Object.fromEntries(VITALS.map((v) => [v, {
        baseline: summaryA[v],
        comparison: summaryB[v],
        delta: summaryB[v] - summaryA[v],
      }])),
      routes: allPaths.map((path) => {
        const a = getResultByPath(pathIndexA, path);
        const b = getResultByPath(pathIndexB, path);
        return {
          path,
          ...Object.fromEntries(VITALS.map((v) => [v, {
            baseline: a ? a[v].p75 : null,
            comparison: b ? b[v].p75 : null,
            delta: a && b ? b[v].p75 - a[v].p75 : null,
          }])),
        };
      }),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `compare-${runA.id.slice(0, 8)}-vs-${runB.id.slice(0, 8)}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-fg">Compare Runs</h2>
        <div className="flex items-center gap-2">
          {hasBoth && (
            <button
              onClick={exportComparison}
              className="h-[34px] px-3 text-[13px] text-fg bg-s2 border border-border rounded-[4px] hover:bg-border transition-colors font-medium"
            >
              Export JSON
            </button>
          )}
          <button
            onClick={onClose}
            className="h-[34px] px-3 text-[13px] text-fg bg-s2 border border-border rounded-[4px] hover:bg-border transition-colors"
          >
            Back
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-[13px] text-muted py-8 text-center">Loading runs...</div>
      ) : runs.length < 2 ? (
        <div className="text-[13px] text-subtle py-8 text-center">
          Need at least 2 finished runs with results to compare.
        </div>
      ) : (
        <>
          <div className="flex gap-4 flex-wrap">
            <RunPicker runs={runs} selectedId={runAId} onChange={setRunAId} label="Baseline (A)" otherId={runBId} />
            <div className="flex items-end pb-2">
              <span className="text-muted text-[13px] font-semibold">vs</span>
            </div>
            <RunPicker runs={runs} selectedId={runBId} onChange={setRunBId} label="Comparison (B)" otherId={runAId} />
          </div>

          {hasBoth && (
            <>
              {runHost(runA!) !== runHost(runB!) && (
                <div className="flex items-center gap-3 text-[12px] font-mono text-muted">
                  <span className="px-2 py-1 bg-s2 border border-border rounded-[4px]">A: {runHost(runA!)}</span>
                  <span>vs</span>
                  <span className="px-2 py-1 bg-s2 border border-border rounded-[4px]">B: {runHost(runB!)}</span>
                  <span className="text-subtle text-[11px]">matched by path</span>
                </div>
              )}
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {VITALS.map((v) => {
                  const valA = summaryA[v];
                  const valB = summaryB[v];
                  const delta = valB - valA;
                  const direction = deltaSign(delta);
                  const ratingA = getVitalRating(v, valA);
                  const ratingB = getVitalRating(v, valB);
                  const colorA = ratingCssColor(ratingA);
                  const colorB = ratingCssColor(ratingB);
                  const meta = VITAL_META[v];

                  return (
                    <div key={v} className="bg-surface border border-border rounded-[8px] p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="font-mono font-bold text-[12px] tracking-wide text-fg">{meta.label}</span>
                        <span
                          className={`font-mono font-semibold text-[11px] px-1.5 py-0.5 rounded ${
                            direction === 'better'
                              ? 'text-accent bg-accent-soft'
                              : direction === 'worse'
                                ? 'text-bad bg-bad/10'
                                : 'text-muted bg-s2'
                          }`}
                        >
                          {formatDelta(delta, v)}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="text-center flex-1">
                          <div className="font-mono font-semibold text-[20px]" style={{ color: colorA }}>
                            {formatVital(v, valA)}
                          </div>
                          <div className="text-[10px] text-subtle mt-0.5">A · {ratingLabel(ratingA)}</div>
                        </div>
                        <div className="text-subtle text-[13px]">→</div>
                        <div className="text-center flex-1">
                          <div className="font-mono font-semibold text-[20px]" style={{ color: colorB }}>
                            {formatVital(v, valB)}
                          </div>
                          <div className="text-[10px] text-subtle mt-0.5">B · {ratingLabel(ratingB)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Per-route table */}
              <div className="bg-surface border border-border rounded-[8px] overflow-hidden overflow-x-auto">
                <table className="w-full border-collapse" style={{ minWidth: 900 }}>
                  <thead>
                    <tr className="bg-s2 border-b border-border">
                      <th className="px-3 py-2.5 text-left font-semibold text-[11px] text-muted uppercase tracking-wide" style={{ minWidth: 200 }}>
                        Route
                      </th>
                      {VITALS.map((v) => (
                        <th key={v} colSpan={3} className="px-1 py-2.5 text-center font-semibold text-[11px] text-muted uppercase tracking-wide border-l border-border">
                          {VITAL_META[v].label} p75
                        </th>
                      ))}
                    </tr>
                    <tr className="bg-s2/60 border-b border-border">
                      <th />
                      {VITALS.map((v) => (
                        <Fragment key={v}>
                          <th className="px-2 py-1.5 text-right font-mono text-[10px] text-subtle border-l border-border">A</th>
                          <th className="px-2 py-1.5 text-right font-mono text-[10px] text-subtle">B</th>
                          <th className="px-2 py-1.5 text-right font-mono text-[10px] text-subtle">Δ</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allPaths.map((path, i) => {
                      const a = getResultByPath(pathIndexA, path);
                      const b = getResultByPath(pathIndexB, path);
                      return (
                        <tr key={path} className={`border-b border-border last:border-b-0 ${i % 2 !== 0 ? 'bg-s2/40' : ''}`}>
                          <td className="px-3 py-2.5 font-mono text-[12px] text-fg truncate max-w-0" style={{ maxWidth: 250 }} title={path}>
                            {shortRoute(path, allPaths)}
                          </td>
                          {VITALS.map((v) => {
                            const valA = a ? a[v].p75 : null;
                            const valB = b ? b[v].p75 : null;
                            const delta = valA != null && valB != null ? valB - valA : null;
                            const direction = delta != null ? deltaSign(delta) : 'same';

                            return (
                              <Fragment key={v}>
                                <td
                                  className="px-2 py-2.5 font-mono text-[12px] text-right border-l border-border"
                                  style={{ color: valA != null ? ratingCssColor(getVitalRating(v, valA)) : undefined }}
                                >
                                  {valA != null ? formatVital(v, valA) : '—'}
                                </td>
                                <td
                                  className="px-2 py-2.5 font-mono text-[12px] text-right"
                                  style={{ color: valB != null ? ratingCssColor(getVitalRating(v, valB)) : undefined }}
                                >
                                  {valB != null ? formatVital(v, valB) : '—'}
                                </td>
                                <td
                                  className={`px-2 py-2.5 font-mono text-[11px] text-right font-semibold ${
                                    direction === 'better'
                                      ? 'text-accent'
                                      : direction === 'worse'
                                        ? 'text-bad'
                                        : 'text-subtle'
                                  }`}
                                >
                                  {delta != null ? formatDelta(delta, v) : '—'}
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-s2 border-t-2 border-bs">
                      <td className="px-3 py-2.5 font-semibold text-[11px] text-muted uppercase tracking-wide">Average</td>
                      {VITALS.map((v) => {
                        const delta = summaryB[v] - summaryA[v];
                        const direction = deltaSign(delta);
                        return (
                          <Fragment key={v}>
                            <td
                              className="px-2 py-2.5 font-mono text-[12px] text-right border-l border-border"
                              style={{ color: countA > 0 ? ratingCssColor(getVitalRating(v, summaryA[v])) : undefined }}
                            >
                              {countA > 0 ? formatVital(v, summaryA[v]) : '—'}
                            </td>
                            <td
                              className="px-2 py-2.5 font-mono text-[12px] text-right"
                              style={{ color: countB > 0 ? ratingCssColor(getVitalRating(v, summaryB[v])) : undefined }}
                            >
                              {countB > 0 ? formatVital(v, summaryB[v]) : '—'}
                            </td>
                            <td
                              className={`px-2 py-2.5 font-mono text-[11px] text-right font-semibold ${
                                direction === 'better'
                                  ? 'text-accent'
                                  : direction === 'worse'
                                    ? 'text-bad'
                                    : 'text-subtle'
                              }`}
                            >
                              {countA > 0 && countB > 0 ? formatDelta(delta, v) : '—'}
                            </td>
                          </Fragment>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

