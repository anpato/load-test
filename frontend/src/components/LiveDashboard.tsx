import { useRef } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import type { MetricSnapshot, VitalKey } from '../lib/types';
import {
  VITAL_META,
  VITAL_THRESHOLDS,
  formatVital,
  getVitalRating,
  ratingCssColor,
  ratingLabel,
} from '../lib/types';

interface Props {
  snapshots: MetricSnapshot[];
  history: MetricSnapshot[];
  logs: string[];
  connected: boolean;
  onStop: () => void;
}

const VITALS: VitalKey[] = ['lcp', 'fcp', 'cls', 'ttfb'];
const CHART_VITALS: VitalKey[] = ['lcp', 'fcp', 'ttfb'];

const LINE_COLORS = [
  '#22c55e',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
  '#f97316',
  '#14b8a6',
  '#e11d48',
  '#6366f1',
];

function shortPath(url: string): string {
  try {
    const path = new URL(url).pathname;
    const segs = path.split('/').filter(Boolean);
    if (segs.length === 0) return '/';
    return '/' + segs[segs.length - 1];
  } catch {
    return url;
  }
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

function getAvgP75(history: MetricSnapshot[], vital: VitalKey): number | null {
  const matches = history.filter((s) => s.Metric.toLowerCase().includes(vital));
  if (matches.length === 0) return null;
  const byUrl = new Map<string, number>();
  for (const s of matches) byUrl.set(s.URL, s.P75);
  const vals = [...byUrl.values()];
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

interface ChartPoint {
  time: string;
  avg: number | null;
  [url: string]: number | null | string;
}

function buildChartData(
  history: MetricSnapshot[],
  vital: VitalKey,
  urls: string[]
): ChartPoint[] {
  const byTime = new Map<string, Map<string, number>>();
  for (const snap of history) {
    if (!snap.Metric.toLowerCase().includes(vital)) continue;
    const t = snap.Timestamp;
    if (!byTime.has(t)) byTime.set(t, new Map());
    byTime.get(t)!.set(snap.URL, snap.P75);
  }
  const points: ChartPoint[] = [];
  let idx = 0;
  for (const [, urlMap] of byTime) {
    idx++;
    const point: ChartPoint = { time: String(idx), avg: null };
    let sum = 0;
    let count = 0;
    for (const url of urls) {
      const val = urlMap.get(url) ?? null;
      point[url] = val;
      if (val !== null) { sum += val; count++; }
    }
    point.avg = count > 0 ? sum / count : null;
    points.push(point);
  }
  return points;
}

function VitalChart({
  vital,
  history,
  urls,
  colorMap,
}: {
  vital: VitalKey;
  history: MetricSnapshot[];
  urls: string[];
  colorMap: Map<string, string>;
}) {
  const meta = VITAL_META[vital];
  const data = buildChartData(history, vital, urls);

  return (
    <div className="bg-surface border border-border rounded-[8px] p-5">
      <div className="flex items-center justify-between mb-4">
        <span className="font-mono font-bold text-[14px] tracking-wide text-fg">
          {meta.label} p75
        </span>
        <span className="text-[11px] text-subtle font-mono">
          {meta.good} · {meta.poor}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--color-border)"
            strokeOpacity={0.5}
            vertical={false}
          />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: 'var(--color-subtle)' }}
            axisLine={{ stroke: 'var(--color-border)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--color-subtle)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `${Math.round(v)}`}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 12,
              fontFamily: 'var(--font-mono, monospace)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
            }}
            formatter={(value: unknown, name: unknown) => [
              formatVital(vital, Number(value)),
              String(name) === 'avg' ? 'Average' : shortPath(String(name)),
            ]}
            labelFormatter={(label) => `Snapshot ${label}`}
          />
          <Legend
            formatter={(value: string) =>
              value === 'avg' ? 'Average' : shortPath(value)
            }
            wrapperStyle={{
              fontSize: 11,
              fontFamily: 'var(--font-mono, monospace)',
              paddingTop: 8,
              maxHeight: 28,
              overflow: 'hidden',
            }}
            iconType="plainline"
          />
          {urls.map((url) => (
            <Line
              key={url}
              type="monotone"
              dataKey={url}
              stroke={colorMap.get(url) || LINE_COLORS[0]}
              strokeWidth={2}
              dot={false}
              connectNulls
              name={url}
              animationDuration={300}
            />
          ))}
          <Line
            type="monotone"
            dataKey="avg"
            stroke="var(--color-fg)"
            strokeWidth={2.5}
            dot={false}
            connectNulls
            name="avg"
            strokeDasharray="6 3"
            animationDuration={300}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

import LogPanel from './LogPanel';

function useStableColorMap(urls: string[]) {
  const mapRef = useRef(new Map<string, string>());
  for (const url of urls) {
    if (!mapRef.current.has(url)) {
      mapRef.current.set(url, LINE_COLORS[mapRef.current.size % LINE_COLORS.length]);
    }
  }
  return mapRef.current;
}

export default function LiveDashboard({
  snapshots: _snapshots,
  history,
  logs,
  connected,
  onStop,
}: Props) {
  const allUrls = [...new Set(history.map((s) => s.URL).filter(Boolean))].sort();
  const colorMap = useStableColorMap(allUrls);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block rounded-full"
            style={{
              width: 9,
              height: 9,
              background: connected ? 'var(--color-accent)' : 'var(--color-bad)',
              animation: connected ? 'pulse-dot 1.4s infinite' : undefined,
            }}
          />
          <span className="font-bold text-[15px] text-fg">
            {connected ? 'Connected' : 'Connecting...'}
          </span>
          <span className="font-mono text-[12px] text-subtle">
            {allUrls.length} URL{allUrls.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button
          onClick={onStop}
          className="h-[38px] px-4 bg-bad text-white rounded-[4px] font-semibold text-[13px] hover:opacity-90 transition-opacity"
        >
          ■ Stop test
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {VITALS.map((v) => {
          const val = getAvgP75(history, v);
          const rating = val !== null ? getVitalRating(v, val) : 'good';
          const thresh = VITAL_THRESHOLDS[v];
          const pct = val !== null ? Math.min((val / thresh.needsImprovement) * 100, 100) : 0;
          const color = val !== null ? ratingCssColor(rating) : 'var(--color-border)';
          const meta = VITAL_META[v];
          return (
            <div key={v} className="bg-surface border border-border rounded-[8px] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono font-bold text-[12px] tracking-wide text-fg">{meta.label}</span>
                {val !== null && <RatingPill rating={rating} />}
              </div>
              <div className="flex items-baseline gap-1.5 mb-3">
                <span className="font-mono font-semibold text-[28px] text-fg">
                  {val !== null ? formatVital(v, val) : '—'}
                </span>
                <span className="text-[11px] text-subtle">p75</span>
              </div>
              <div className="h-[6px] bg-s2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${pct}%`,
                    background: color,
                    transition: 'width 0.6s ease-out, background 0.3s ease',
                  }}
                />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="font-mono text-[10.5px] text-subtle">{meta.good}</span>
                <span className="font-mono text-[10.5px] text-subtle">{meta.poor}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts + logs side by side on xl, stacked below */}
      <div className="flex flex-col xl:flex-row gap-4">
        <div className="space-y-4 flex-1 min-w-0">
          {CHART_VITALS.map((vital) => (
            <VitalChart key={vital} vital={vital} history={history} urls={allUrls} colorMap={colorMap} />
          ))}
        </div>
        <div className="xl:w-[480px] xl:flex-shrink-0">
          <LogPanel logs={logs} defaultOpen />
        </div>
      </div>
    </div>
  );
}
