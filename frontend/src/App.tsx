import { useCallback, useState } from 'react';
import { CrawlForm } from './components/CrawlForm';
import { ManualRoutes } from './components/ManualRoutes';
import { RouteList } from './components/RouteList';
import { AuthConfig } from './components/AuthConfig';
import RunConfig from './components/RunConfig';
import LiveDashboard from './components/LiveDashboard';
import ResultsTable from './components/ResultsTable';
import { useMetricsStream } from './hooks/useMetricsStream';
import { createRun, getRun, stopRun, rerunTest, listRuns } from './lib/api';
import type {
  AuthConfig as AuthConfigType,
  Run,
  RunConfig as RunConfigType,
} from './lib/types';

type Step =
  | 'discover'
  | 'select'
  | 'auth'
  | 'config'
  | 'running'
  | 'results';

const STEPS: { key: Step; label: string }[] = [
  { key: 'discover', label: 'Discover Routes' },
  { key: 'select', label: 'Select Routes' },
  { key: 'auth', label: 'Authentication' },
  { key: 'config', label: 'Configure Test' },
  { key: 'running', label: 'Running' },
  { key: 'results', label: 'Results' },
];

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

export default function App() {
  const [step, setStepRaw] = useState<Step>('discover');
  const [maxStepIndex, setMaxStepIndex] = useState(0);
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('theme');
    if (saved) {
      const dark = saved === 'dark';
      document.documentElement.classList.toggle('dark', dark);
      return dark;
    }
    return document.documentElement.classList.contains('dark');
  });

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };

  const setStep = (s: Step) => {
    setStepRaw(s);
    const idx = STEPS.findIndex((st) => st.key === s);
    setMaxStepIndex((prev) => Math.max(prev, idx));
  };
  const [baseUrl, setBaseUrl] = useState('');
  const [crawledUrls, setCrawledUrls] = useState<string[]>([]);
  const [manualUrls, setManualUrls] = useState<string[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [isSPA, setIsSPA] = useState(false);
  const [framework, setFramework] = useState('');
  const [authConfig, setAuthConfig] = useState<AuthConfigType>({
    type: 'none',
  });
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pastRuns, setPastRuns] = useState<Run[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const { snapshots, history, logs, connected, disconnect } =
    useMetricsStream(runId);

  const allUrls = [...new Set([...(crawledUrls || []), ...(manualUrls || [])])];

  const handleCrawlResult = useCallback(
    (urls: string[], spa: boolean, fw: string) => {
      setCrawledUrls(urls);
      setIsSPA(spa);
      setFramework(fw);
      if (urls.length > 0) {
        setSelectedUrls(urls);
        setStep('select');
      }
    },
    []
  );

  const handleManualRoutes = useCallback((urls: string[]) => {
    setManualUrls(urls ?? []);
  }, []);

  const handleStartTest = useCallback(
    async (config: RunConfigType) => {
      setError(null);
      try {
        const authJson =
          authConfig.type !== 'none' ? JSON.stringify(authConfig) : undefined;
        const { runId: id } = await createRun(selectedUrls, {
          ...config,
          authJson,
        });
        setRunId(id);
        setStep('running');

        const poll = setInterval(async () => {
          try {
            const r = await getRun(id);
            setRun(r);
            if (r.status === 'finished' || r.status === 'error') {
              clearInterval(poll);
              disconnect();
              setStep('results');
            }
          } catch {
            clearInterval(poll);
          }
        }, 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start test');
      }
    },
    [selectedUrls, authConfig, disconnect]
  );

  const handleStop = useCallback(async () => {
    if (runId) {
      await stopRun(runId);
      disconnect();
      try {
        const r = await getRun(runId);
        setRun(r);
      } catch {
      }
      setStep('results');
    }
  }, [runId, disconnect]);

  const handleRerun = useCallback(
    async (rerunId: string) => {
      setError(null);
      try {
        const { runId: id } = await rerunTest(rerunId);
        setRunId(id);
        setShowHistory(false);
        setStep('running');

        const poll = setInterval(async () => {
          try {
            const r = await getRun(id);
            setRun(r);
            if (r.status === 'finished' || r.status === 'error') {
              clearInterval(poll);
              disconnect();
              setStep('results');
            }
          } catch {
            clearInterval(poll);
          }
        }, 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to re-run test');
      }
    },
    [disconnect]
  );

  const loadHistory = useCallback(async () => {
    try {
      const runs = await listRuns();
      setPastRuns(runs || []);
      setShowHistory(true);
    } catch {
      setPastRuns([]);
      setShowHistory(true);
    }
  }, []);

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 h-[60px] bg-surface border-b border-border flex items-center">
        <div className="max-w-[1120px] mx-auto px-7 w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-[26px] h-[26px] bg-accent rounded-[7px] flex items-center justify-center flex-shrink-0">
              <span className="font-mono text-accent-fg text-[10px] font-bold leading-none">k6</span>
            </div>
            <span className="font-sans font-bold text-[16px] tracking-tight text-fg">
              Web Vitals Load Tester
            </span>
            {isSPA && framework && (
              <span className="px-2 py-0.5 text-[11px] font-medium bg-accent-soft text-accent rounded-[4px] border border-accent/20">
                SPA: {framework}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="h-[34px] w-[34px] flex items-center justify-center rounded-[4px] border border-border bg-s2 text-muted hover:text-fg hover:bg-border transition-colors"
              aria-label="Toggle theme"
            >
              {isDark ? <SunIcon /> : <MoonIcon />}
            </button>
            <button
              onClick={loadHistory}
              className="h-[34px] px-3 flex items-center gap-2 rounded-[4px] border border-border bg-s2 text-fg text-[13px] hover:bg-border transition-colors"
            >
              <span className="w-[6px] h-[6px] rounded-full bg-accent flex-shrink-0" />
              Run History
            </button>
          </div>
        </div>
      </header>

      <nav className="h-[58px] bg-surface border-b border-border hidden sm:flex items-center">
        <div className="max-w-[1120px] mx-auto px-7 w-full flex items-center gap-0 overflow-x-auto">
          {STEPS.map((s, i) => {
            const isActive = s.key === step;
            const isCompleted = i < currentStepIndex;
            const isReachable = i <= maxStepIndex;
            return (
              <div key={s.key} className="flex items-center">
                {i > 0 && (
                  <div className="w-[22px] h-px bg-border flex-shrink-0" />
                )}
                <button
                  onClick={() => isReachable && setStep(s.key)}
                  disabled={!isReachable}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-[5px] transition-colors ${
                    isActive
                      ? 'bg-accent-soft cursor-default'
                      : isCompleted
                        ? 'hover:bg-s2 cursor-pointer'
                        : 'cursor-default'
                  }`}
                >
                  <span
                    className={`w-[22px] h-[22px] rounded-[5px] flex items-center justify-center text-[11px] font-mono font-semibold flex-shrink-0 transition-colors ${
                      isActive
                        ? 'bg-accent text-accent-fg'
                        : isCompleted
                          ? 'bg-accent-soft text-accent border border-accent'
                          : 'border border-border text-subtle'
                    }`}
                  >
                    {isCompleted ? (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span
                    className={`text-[13px] whitespace-nowrap transition-colors ${
                      isActive
                        ? 'text-fg font-semibold'
                        : isCompleted
                          ? 'text-muted'
                          : 'text-subtle'
                    }`}
                  >
                    {s.label}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </nav>

      <div className="sm:hidden bg-surface border-b border-border px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-muted font-mono">
            Step {currentStepIndex + 1} / {STEPS.length}
          </span>
          <span className="text-[13px] text-fg font-semibold">
            {STEPS[currentStepIndex]?.label}
          </span>
        </div>
        <div className="h-1 bg-border rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${((currentStepIndex + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      <main className="max-w-[1120px] mx-auto px-7 py-6 space-y-6">
        {error && (
          <div className="p-3 bg-bad/10 border border-bad/20 text-bad rounded-[5px] text-[13px]">
            {error}
          </div>
        )}

        {step === 'discover' && (
          <div className="space-y-6">
            <section className="space-y-4">
              <h2 className="text-[15px] font-semibold text-fg">
                Auto-Discover Routes
              </h2>
              <CrawlForm
                onResult={handleCrawlResult}
                authJson={authConfig.type !== 'none' ? JSON.stringify(authConfig) : undefined}
              />
            </section>

            <details className="border border-border rounded-[8px] bg-surface p-4 group">
              <summary className="cursor-pointer text-[13px] font-semibold text-muted flex items-center gap-2 select-none">
                <svg className="w-3 h-3 text-subtle transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
                Authenticate before crawling
                {authConfig.type !== 'none' && (
                  <span className="text-[11px] font-semibold px-[9px] py-1 rounded-full text-accent" style={{ background: 'color-mix(in srgb, var(--color-accent) 14%, transparent)' }}>
                    {authConfig.type}
                  </span>
                )}
              </summary>
              <div className="mt-4">
                <p className="text-[12px] text-muted mb-3">
                  Set up authentication so the crawler can discover routes behind login.
                </p>
                <AuthConfig config={authConfig} onChange={setAuthConfig} />
              </div>
            </details>

            <div className="border-t border-border pt-6 space-y-4">
              <h2 className="text-[15px] font-semibold text-fg">
                Manual Routes
              </h2>
              <ManualRoutes
                baseUrl={baseUrl}
                onBaseUrlChange={setBaseUrl}
                onRoutes={handleManualRoutes}
              />
            </div>

            {allUrls.length > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setSelectedUrls(allUrls);
                    setStep('select');
                  }}
                  className="h-[38px] sm:h-[38px] h-[44px] px-4 bg-accent text-accent-fg rounded-[5px] text-[13px] font-medium hover:opacity-90 transition-opacity"
                >
                  Continue with {allUrls.length} routes
                </button>
              </div>
            )}
          </div>
        )}

        {step === 'select' && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-fg">
              Select Routes to Test
            </h2>
            <RouteList
              urls={allUrls}
              selectedUrls={selectedUrls}
              onSelectionChange={setSelectedUrls}
            />
            <div className="flex justify-between">
              <button
                onClick={() => setStep('discover')}
                className="h-[38px] px-4 text-fg bg-s2 border border-border rounded-[5px] text-[13px] hover:bg-border transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep('auth')}
                disabled={selectedUrls.length === 0}
                className="h-[38px] px-4 bg-accent text-accent-fg rounded-[5px] text-[13px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
              >
                Continue ({selectedUrls.length} selected)
              </button>
            </div>
          </div>
        )}

        {step === 'auth' && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-fg">
              Authentication
            </h2>
            <AuthConfig config={authConfig} onChange={setAuthConfig} />
            <div className="flex justify-between">
              <button
                onClick={() => setStep('select')}
                className="h-[38px] px-4 text-fg bg-s2 border border-border rounded-[5px] text-[13px] hover:bg-border transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => setStep('config')}
                className="h-[38px] px-4 bg-accent text-accent-fg rounded-[5px] text-[13px] font-medium hover:opacity-90 transition-opacity"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'config' && (
          <div className="space-y-4">
            <h2 className="text-[15px] font-semibold text-fg">
              Configure Load Test
            </h2>
            <RunConfig onStart={handleStartTest} />
            <div className="flex justify-start">
              <button
                onClick={() => setStep('auth')}
                className="h-[38px] px-4 text-fg bg-s2 border border-border rounded-[5px] text-[13px] hover:bg-border transition-colors"
              >
                Back
              </button>
            </div>
          </div>
        )}

        {step === 'running' && (
          <LiveDashboard
            snapshots={snapshots}
            history={history}
            logs={logs}
            connected={connected}
            onStop={handleStop}
          />
        )}

        {step === 'results' && run && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-fg">
                Test Results
              </h2>
              <span
                className={`px-2 py-0.5 text-[11px] font-medium rounded-[4px] ${
                  run.status === 'finished'
                    ? 'bg-accent-soft text-accent'
                    : 'bg-bad/10 text-bad'
                }`}
              >
                {run.status}
              </span>
            </div>
            {run.error && (
              <div className="p-3 bg-bad/10 border border-bad/20 text-bad rounded-[5px] text-[13px]">
                {run.error}
              </div>
            )}
            <ResultsTable results={run.results || {}} />
            <div className="flex gap-3">
              <button
                onClick={() => handleRerun(run.id)}
                className="h-[38px] px-4 bg-accent text-accent-fg rounded-[5px] text-[13px] font-medium hover:opacity-90 transition-opacity"
              >
                Re-run This Test
              </button>
              <button
                onClick={() => {
                  setRunId(null);
                  setRun(null);
                  setStep('discover');
                }}
                className="h-[38px] px-4 text-fg bg-s2 border border-border rounded-[5px] text-[13px] hover:bg-border transition-colors"
              >
                New Test
              </button>
            </div>
          </div>
        )}
      </main>

      {showHistory && (
        <div
          className="fixed inset-0 bg-black/45 z-50 flex justify-end"
          onClick={(e) => e.target === e.currentTarget && setShowHistory(false)}
        >
          <div className="w-full max-w-[420px] bg-surface border-l border-border h-full overflow-y-auto flex flex-col">
            <div className="sticky top-0 bg-surface border-b border-border px-6 py-4 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold text-fg">
                Run history
              </h2>
              <button
                onClick={() => setShowHistory(false)}
                className="w-[28px] h-[28px] flex items-center justify-center rounded-[4px] text-muted hover:text-fg hover:bg-s2 transition-colors text-lg leading-none"
              >
                &times;
              </button>
            </div>
            <div className="p-5 space-y-3 flex-1">
              {pastRuns.length === 0 ? (
                <p className="text-[13px] text-subtle">No previous runs found.</p>
              ) : (
                pastRuns.map((r) => (
                  <div
                    key={r.id}
                    className="rounded-[8px] border border-border bg-surface p-4 space-y-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-mono text-muted">
                        {r.id.slice(0, 12)}...
                      </span>
                      <span
                        className={`px-2 py-0.5 text-[11px] font-medium rounded-[4px] ${
                          r.status === 'finished'
                            ? 'bg-accent-soft text-accent'
                            : r.status === 'error'
                              ? 'bg-bad/10 text-bad'
                              : r.status === 'running'
                                ? 'bg-accent-soft text-accent'
                                : 'bg-s2 text-muted border border-border'
                        }`}
                      >
                        {r.status}
                      </span>
                    </div>
                    <div className="text-[12px] text-muted font-mono">
                      {r.urls?.length || 0} URLs &middot;{' '}
                      {r.config?.testType || 'custom'} &middot;{' '}
                      {new Date(r.startedAt).toLocaleString()}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setRun(r);
                          setRunId(r.id);
                          setShowHistory(false);
                          setStep('results');
                        }}
                        className="h-[30px] px-3 text-[12px] text-fg bg-s2 border border-border rounded-[4px] hover:bg-border transition-colors"
                      >
                        View
                      </button>
                      <button
                        onClick={() => handleRerun(r.id)}
                        className="h-[30px] px-3 text-[12px] bg-accent text-accent-fg rounded-[4px] hover:opacity-90 transition-opacity"
                      >
                        Re-run
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
