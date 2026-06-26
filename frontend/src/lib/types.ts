export interface CrawlRequest {
  url: string;
  maxDepth: number;
  maxPages: number;
  authJson?: string;
}

export interface CrawlResponse {
  urls: string[];
  isSPA: boolean;
  framework: string;
}

export interface RouteParam {
  [name: string]: string[];
}

export interface Route {
  pattern: string;
  params: RouteParam;
}

export interface ManualRoutesRequest {
  baseUrl: string;
  routes: Route[];
}

export interface ManualRoutesResponse {
  expandedURLs: string[];
  totalGenerated: number;
  capped: boolean;
}

export interface LoginStep {
  selector: string;
  action: 'fill' | 'click';
  value: string;
  waitFor?: 'networkidle' | 'navigation';
}

export interface AuthConfig {
  type: 'none' | 'cookie' | 'bearer' | 'headers';
  cookie?: {
    loginUrl: string;
    steps: LoginStep[];
  };
  bearer?: {
    token: string;
    tokenUrl?: string;
    tokenField?: string;
    credentials?: Record<string, string>;
  };
  headers?: Record<string, string>;
}

export interface Stage {
  duration: string;
  target: number;
}

export interface RunConfig {
  vus: number;
  duration: string;
  stages: Stage[];
  thinkTime: number;
  testType: 'smoke' | 'load' | 'stress' | 'soak' | 'custom';
  authJson?: string;
  headed?: boolean;
}

export interface VitalMetrics {
  samples: number[];
  p50: number;
  p75: number;
  p95: number;
  min: number;
  max: number;
}

export interface URLResult {
  url: string;
  lcp: VitalMetrics;
  fcp: VitalMetrics;
  cls: VitalMetrics;
  ttfb: VitalMetrics;
  errors: number;
}

export interface Run {
  id: string;
  status: 'pending' | 'running' | 'finished' | 'breached' | 'error';
  name?: string;
  tags?: string[];
  urls: string[];
  config: RunConfig;
  results: Record<string, URLResult>;
  logs?: string[];
  error?: string;
  startedAt: string;
  endedAt?: string;
}

export interface MetricSnapshot {
  URL: string;
  Metric: string;
  Samples: number[];
  P50: number;
  P75: number;
  P95: number;
  Min: number;
  Max: number;
  Timestamp: string;
}

export type TestPreset = 'smoke' | 'load' | 'stress' | 'soak' | 'custom';

export const TEST_PRESETS: Record<
  TestPreset,
  { label: string; description: string; stages: Stage[]; vus: number }
> = {
  smoke: {
    label: 'Smoke',
    description: '1 VU, 1 min — verify the script works',
    stages: [
      { duration: '15s', target: 1 },
      { duration: '45s', target: 1 },
      { duration: '15s', target: 0 },
    ],
    vus: 1,
  },
  load: {
    label: 'Load',
    description: 'Ramp to target VUs, hold 5 min — baseline performance',
    stages: [
      { duration: '1m', target: 5 },
      { duration: '5m', target: 5 },
      { duration: '30s', target: 0 },
    ],
    vus: 5,
  },
  stress: {
    label: 'Stress',
    description: 'Ramp past target — find breaking point',
    stages: [
      { duration: '1m', target: 5 },
      { duration: '3m', target: 10 },
      { duration: '2m', target: 10 },
      { duration: '30s', target: 0 },
    ],
    vus: 10,
  },
  soak: {
    label: 'Soak',
    description: 'Steady load, extended duration — detect memory leaks',
    stages: [
      { duration: '1m', target: 3 },
      { duration: '30m', target: 3 },
      { duration: '30s', target: 0 },
    ],
    vus: 3,
  },
  custom: {
    label: 'Custom',
    description: 'Configure VUs and stages manually',
    stages: [
      { duration: '30s', target: 1 },
      { duration: '1m', target: 1 },
      { duration: '15s', target: 0 },
    ],
    vus: 1,
  },
};

export const VITAL_THRESHOLDS = {
  lcp: { good: 2500, needsImprovement: 4000 },
  fcp: { good: 1800, needsImprovement: 3000 },
  cls: { good: 0.1, needsImprovement: 0.25 },
  ttfb: { good: 800, needsImprovement: 1800 },
} as const;

export type VitalKey = keyof typeof VITAL_THRESHOLDS;

export function getVitalRating(
  key: VitalKey,
  value: number
): 'good' | 'needs-improvement' | 'poor' {
  const t = VITAL_THRESHOLDS[key];
  if (value <= t.good) return 'good';
  if (value <= t.needsImprovement) return 'needs-improvement';
  return 'poor';
}

export type Rating = 'good' | 'needs-improvement' | 'poor';

export function ratingCssColor(rating: Rating): string {
  switch (rating) {
    case 'good':
      return 'var(--color-accent)';
    case 'needs-improvement':
      return 'var(--color-warn)';
    case 'poor':
      return 'var(--color-bad)';
  }
}

export function ratingLabel(rating: Rating): string {
  switch (rating) {
    case 'good':
      return 'Good';
    case 'needs-improvement':
      return 'Needs work';
    case 'poor':
      return 'Poor';
  }
}

export function ratingColor(rating: Rating): string {
  switch (rating) {
    case 'good':
      return 'text-accent';
    case 'needs-improvement':
      return 'text-warn';
    case 'poor':
      return 'text-bad';
  }
}

export function ratingBg(rating: Rating): string {
  switch (rating) {
    case 'good':
      return 'bg-accent-soft';
    case 'needs-improvement':
      return 'bg-warn/10';
    case 'poor':
      return 'bg-bad/10';
  }
}

export function formatVital(key: VitalKey, value: number): string {
  if (key === 'cls') return value.toFixed(3);
  return Math.round(value) + 'ms';
}

export const VITAL_META: Record<
  VitalKey,
  { label: string; good: string; poor: string; unit: string }
> = {
  lcp: { label: 'LCP', good: 'good <2500ms', poor: 'poor >4000ms', unit: 'ms' },
  fcp: { label: 'FCP', good: 'good <1800ms', poor: 'poor >3000ms', unit: 'ms' },
  cls: { label: 'CLS', good: 'good <0.1', poor: 'poor >0.25', unit: '' },
  ttfb: { label: 'TTFB', good: 'good <800ms', poor: 'poor >1800ms', unit: 'ms' },
};

export function parseDuration(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)(s|m|h)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  if (m[2] === 'h') return n * 3600;
  if (m[2] === 'm') return n * 60;
  return n;
}

export function formatDuration(sec: number): string {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? (s ? `${m}m ${s}s` : `${m}m`) : `${s}s`;
}
