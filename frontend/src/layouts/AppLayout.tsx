import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useWizard } from '../contexts/WizardContext';
import HistoryDrawer from '../components/HistoryDrawer';

const STEPS: { path: string; label: string }[] = [
  { path: '/', label: 'Discover Routes' },
  { path: '/select', label: 'Select Routes' },
  { path: '/auth', label: 'Authentication' },
  { path: '/config', label: 'Configure Test' },
  { path: '/running', label: 'Running' },
  { path: '/results', label: 'Results' },
];

function stepIndex(pathname: string): number {
  if (pathname === '/') return 0;
  return STEPS.findIndex((s) => s.path !== '/' && pathname.startsWith(s.path));
}

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

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { isSPA, framework } = useWizard();
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

  const [showHistory, setShowHistory] = useState(false);

  const currentIdx = stepIndex(location.pathname);
  const isWizardRoute = currentIdx >= 0;
  const maxStepRef = useRef(0);
  useEffect(() => {
    if (currentIdx >= 0) maxStepRef.current = Math.max(maxStepRef.current, currentIdx);
  }, [currentIdx]);
  const maxStepIndex = Math.max(maxStepRef.current, currentIdx);

  return (
    <div className="min-h-screen bg-bg">
      <header className="sticky top-0 z-40 h-[60px] bg-surface border-b border-border flex items-center">
        <div className="max-w-[1120px] mx-auto px-7 w-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-[26px] h-[26px] bg-accent rounded-[7px] flex items-center justify-center flex-shrink-0 cursor-pointer"
              onClick={() => navigate('/')}
            >
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
              onClick={() => navigate('/compare')}
              className="h-[34px] px-3 flex items-center gap-2 rounded-[4px] border border-border bg-s2 text-fg text-[13px] hover:bg-border transition-colors"
            >
              Compare
            </button>
            <button
              onClick={() => setShowHistory(true)}
              className="h-[34px] px-3 flex items-center gap-2 rounded-[4px] border border-border bg-s2 text-fg text-[13px] hover:bg-border transition-colors"
            >
              <span className="w-[6px] h-[6px] rounded-full bg-accent flex-shrink-0" />
              Run History
            </button>
          </div>
        </div>
      </header>

      {isWizardRoute && (
        <nav className="h-[58px] bg-surface border-b border-border hidden sm:flex items-center">
          <div className="max-w-[1120px] mx-auto px-7 w-full flex items-center gap-0 overflow-x-auto">
            {STEPS.map((s, i) => {
              const isActive = i === currentIdx;
              const isCompleted = i < currentIdx;
              const isReachable = i <= maxStepIndex;
              return (
                <div key={s.path} className="flex items-center">
                  {i > 0 && (
                    <div className="w-[22px] h-px bg-border flex-shrink-0" />
                  )}
                  <button
                    onClick={() => isReachable && navigate(s.path)}
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
      )}

      {isWizardRoute && (
        <div className="sm:hidden bg-surface border-b border-border px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted font-mono">
              Step {currentIdx + 1} / {STEPS.length}
            </span>
            <span className="text-[13px] text-fg font-semibold">
              {STEPS[currentIdx]?.label}
            </span>
          </div>
          <div className="h-1 bg-border rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-300"
              style={{ width: `${((currentIdx + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      <main className="max-w-[1120px] mx-auto px-7 py-6 space-y-6">
        <Outlet />
      </main>

      {showHistory && (
        <HistoryDrawer onClose={() => setShowHistory(false)} />
      )}
    </div>
  );
}
