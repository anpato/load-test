import { useEffect, useRef, useState } from 'react';
import type { MetricSnapshot, VitalKey } from '../lib/types';
import {
  VITAL_META,
  getVitalRating,
  ratingCssColor,
  ratingLabel,
  formatVital,
} from '../lib/types';

interface Props {
  snapshots: MetricSnapshot[];
  history: MetricSnapshot[];
  logs: string[];
  connected: boolean;
  onStop: () => void;
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

function Sparkline({
  data,
  rating,
}: {
  data: number[];
  rating: 'good' | 'needs-improvement' | 'poor';
}) {
  const color = ratingCssColor(rating);
  const W = 200;
  const H = 56;
  const PAD = 4;

  if (data.length < 2) {
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 72 }}>
        <line
          x1={PAD}
          y1={H / 2}
          x2={W - PAD}
          y2={H / 2}
          stroke={color}
          strokeWidth="1"
          strokeDasharray="4 3"
          opacity="0.3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    );
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = PAD + (1 - (v - min) / range) * (H - PAD * 2);
    return [x, y] as [number, number];
  });

  const d = points
    .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
    .join(' ');

  const areaD =
    `M${points[0][0]},${H - PAD} ` +
    points.map(([x, y]) => `L${x},${y}`).join(' ') +
    ` L${points[points.length - 1][0]},${H - PAD} Z`;

  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 72 }}>
      <defs>
        <linearGradient id={`grad-${rating}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.12" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
      </defs>
      <path
        d={areaD}
        fill={`url(#grad-${rating})`}
        style={{ transition: 'd 0.3s ease' }}
      />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{ transition: 'd 0.3s ease' }}
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="3"
        fill={color}
        style={{ transition: 'cx 0.3s ease, cy 0.3s ease' }}
      />
      <circle
        cx={lastX}
        cy={lastY}
        r="6"
        fill={color}
        opacity="0.15"
        style={{ transition: 'cx 0.3s ease, cy 0.3s ease' }}
      />
    </svg>
  );
}

function VitalCard({
  vitalKey,
  history,
  currentP75,
}: {
  vitalKey: VitalKey;
  history: MetricSnapshot[];
  currentP75: number | null;
}) {
  const meta = VITAL_META[vitalKey];
  const rating =
    currentP75 !== null ? getVitalRating(vitalKey, currentP75) : 'good';

  const sparkData = history
    .filter((s) => s.Metric.toLowerCase().includes(vitalKey))
    .map((s) => s.P75);

  return (
    <div className="bg-surface border border-border rounded-[8px] p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono font-bold text-[13px] tracking-wide text-fg">
          {meta.label}
        </span>
        <span className="font-mono text-[10.5px] text-subtle">
          {meta.good} · {meta.poor}
        </span>
      </div>

      <div className="flex items-baseline gap-2 mb-1">
        <span className="font-mono font-semibold text-[26px] text-fg">
          {currentP75 !== null ? formatVital(vitalKey, currentP75) : '—'}
        </span>
        <span className="text-[11px] text-subtle">p75</span>
        {currentP75 !== null && <RatingPill rating={rating} />}
      </div>

      <Sparkline data={sparkData} rating={rating} />
    </div>
  );
}

function LogPanel({ logs }: { logs: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  function handleScroll() {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(atBottom);
  }

  const filtered = filter
    ? logs.filter((l) => l.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  function lineColor(line: string): string {
    const lower = line.toLowerCase();
    if (lower.includes('setup') || lower.includes('teardown')) {
      return 'var(--color-terminal-dim)';
    }
    return 'var(--color-terminal-text)';
  }

  return (
    <div
      className="rounded-[8px] overflow-hidden"
      style={{
        background: 'var(--color-terminal-bg)',
        border: '1px solid var(--color-terminal-border)',
      }}
    >
      <div
        className="px-3 py-2 flex items-center gap-3 border-b"
        style={{
          background: 'var(--color-terminal-header)',
          borderColor: 'var(--color-terminal-border)',
        }}
      >
        <span
          className="font-mono font-bold text-[12px] shrink-0"
          style={{ color: 'var(--color-terminal-dim)' }}
        >
          k6 output
        </span>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter..."
          className="flex-1 px-2 py-0.5 rounded-[3px] font-mono text-[12px] outline-none min-w-0"
          style={{
            background: 'var(--color-terminal-bg)',
            border: '1px solid var(--color-terminal-border)',
            color: 'var(--color-terminal-input)',
          }}
        />
        <span
          className="font-mono text-[11px] shrink-0"
          style={{ color: 'var(--color-terminal-dim)' }}
        >
          {filtered.length} lines
        </span>
        <button
          onClick={() => setAutoScroll((v) => !v)}
          className="font-mono font-semibold text-[11px] px-2 py-0.5 rounded-full shrink-0 transition-colors"
          style={{
            color: autoScroll
              ? 'var(--color-terminal-accent)'
              : 'var(--color-terminal-dim)',
            background: autoScroll
              ? 'color-mix(in srgb, var(--color-terminal-accent) 12%, transparent)'
              : 'transparent',
          }}
        >
          {autoScroll ? 'Following' : 'Paused'}
        </button>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-[240px] overflow-y-auto p-[10px_13px]"
        style={{ background: 'var(--color-terminal-bg)' }}
      >
        {filtered.length === 0 ? (
          <span
            className="font-mono text-[12.5px]"
            style={{ color: 'var(--color-terminal-muted)' }}
          >
            Waiting for output...
          </span>
        ) : (
          filtered.map((line, i) => (
            <div
              key={i}
              className="font-mono text-[12.5px] leading-relaxed"
              style={{ color: lineColor(line) }}
            >
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function LiveDashboard({
  snapshots,
  history,
  logs,
  connected,
  onStop,
}: Props) {
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null);
  const vitals: VitalKey[] = ['lcp', 'fcp', 'cls', 'ttfb'];

  const allUrls = [...new Set(history.map((s) => s.URL).filter(Boolean))].sort();

  const filteredSnapshots = selectedUrl
    ? snapshots.filter((s) => s.URL === selectedUrl)
    : snapshots;

  const filteredHistory = selectedUrl
    ? history.filter((s) => s.URL === selectedUrl)
    : history;

  function getCurrentP75(key: VitalKey): number | null {
    const matches = filteredSnapshots.filter((s) =>
      s.Metric.toLowerCase().includes(key)
    );
    if (matches.length === 0) return null;
    const total = matches.reduce((sum, s) => sum + s.P75, 0);
    return total / matches.length;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block rounded-full"
            style={{
              width: 9,
              height: 9,
              background: connected
                ? 'var(--color-accent)'
                : 'var(--color-bad)',
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

      {allUrls.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedUrl(null)}
            className={`shrink-0 h-[30px] px-3 rounded-full font-semibold text-[12px] border transition-colors ${
              selectedUrl === null
                ? 'bg-accent-soft text-accent border-accent'
                : 'bg-s2 text-muted border-border hover:border-bs'
            }`}
          >
            All routes
          </button>
          {allUrls.map((url) => {
            const path = url.replace(/^https?:\/\/[^/]+/, '') || '/';
            return (
              <button
                key={url}
                onClick={() => setSelectedUrl(url)}
                className={`shrink-0 h-[30px] px-3 rounded-full font-mono font-medium text-[12px] border transition-colors ${
                  selectedUrl === url
                    ? 'bg-accent-soft text-accent border-accent'
                    : 'bg-s2 text-muted border-border hover:border-bs'
                }`}
              >
                {path}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {vitals.map((key) => (
          <VitalCard
            key={`${key}-${selectedUrl || 'all'}`}
            vitalKey={key}
            history={filteredHistory}
            currentP75={getCurrentP75(key)}
          />
        ))}
      </div>

      <LogPanel logs={logs} />
    </div>
  );
}
