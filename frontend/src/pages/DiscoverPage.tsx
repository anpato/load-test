import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { CrawlForm } from '../components/CrawlForm';
import { ManualRoutes } from '../components/ManualRoutes';
import { SavedAuthPicker } from '../components/EnvironmentPicker';
import { AuthConfig } from '../components/AuthConfig';
import { useWizard } from '../contexts/WizardContext';

export default function DiscoverPage() {
  const navigate = useNavigate();
  const {
    baseUrl, setBaseUrl,
    setCrawledUrls, setManualUrls,
    selectedUrls, setSelectedUrls,
    setIsSPA, setFramework,
    authConfig, setAuthConfig,
    allUrls,
  } = useWizard();

  const handleCrawlResult = useCallback(
    (urls: string[], spa: boolean, fw: string) => {
      setCrawledUrls(urls);
      setIsSPA(spa);
      setFramework(fw);
      if (urls.length > 0) {
        setSelectedUrls((prev) => {
          const merged = new Set([...prev, ...urls]);
          return [...merged];
        });
        navigate('/select');
      }
    },
    [navigate, setCrawledUrls, setIsSPA, setFramework, setSelectedUrls]
  );

  const handleManualRoutes = useCallback((urls: string[]) => {
    const newUrls = urls ?? [];
    setManualUrls(newUrls);
    if (newUrls.length > 0) {
      setSelectedUrls((prev) => {
        const merged = new Set([...prev, ...newUrls]);
        return [...merged];
      });
    }
  }, [setManualUrls, setSelectedUrls]);

  return (
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
        <div className="mt-4 space-y-3">
          <p className="text-[12px] text-muted">
            Set up authentication so the crawler can discover routes behind login.
          </p>
          <SavedAuthPicker currentAuth={authConfig} onSelect={setAuthConfig} />
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
              if (selectedUrls.length === 0) {
                setSelectedUrls(allUrls);
              }
              navigate('/select');
            }}
            className="h-[38px] sm:h-[38px] h-[44px] px-4 bg-accent text-accent-fg rounded-[5px] text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            Continue with {allUrls.length} routes
          </button>
        </div>
      )}
    </div>
  );
}
