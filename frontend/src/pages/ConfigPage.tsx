import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import RunConfig from '../components/RunConfig';
import { HostSwap } from '../components/EnvironmentPicker';
import { useWizard } from '../contexts/WizardContext';
import { createRun } from '../lib/api';
import type { RunConfig as RunConfigType } from '../lib/types';

export default function ConfigPage() {
  const navigate = useNavigate();
  const {
    selectedUrls, setSelectedUrls, setManualUrls, setCrawledUrls,
    authConfig, setAuthConfig, setBaseUrl, setError,
    runName, setRunName, runTags, setRunTags,
    headed, setHeaded,
  } = useWizard();
  const [tagInput, setTagInput] = useState('');

  const latestUrls = useRef(selectedUrls);
  latestUrls.current = selectedUrls;
  const latestAuth = useRef(authConfig);
  latestAuth.current = authConfig;
  const latestName = useRef(runName);
  latestName.current = runName;
  const latestTags = useRef(runTags);
  latestTags.current = runTags;
  const latestHeaded = useRef(headed);
  latestHeaded.current = headed;

  useEffect(() => {
    if (selectedUrls.length === 0) navigate('/', { replace: true });
  }, [selectedUrls.length, navigate]);

  const handleHostSwap = useCallback((newUrls: string[]) => {
    setSelectedUrls(newUrls);
    setManualUrls(newUrls);
    setCrawledUrls([]);
    if (newUrls.length > 0) {
      try {
        const newOrigin = new URL(newUrls[0]).origin;
        setBaseUrl(newOrigin);

        const auth = latestAuth.current;
        if (auth.type === 'cookie' && auth.cookie?.loginUrl) {
          try {
            const loginParsed = new URL(auth.cookie.loginUrl);
            loginParsed.host = new URL(newOrigin).host;
            loginParsed.protocol = new URL(newOrigin).protocol;
            setAuthConfig({
              ...auth,
              cookie: { ...auth.cookie, loginUrl: loginParsed.toString() },
            });
          } catch { /* */ }
        }
      } catch { /* */ }
    }
  }, [setSelectedUrls, setManualUrls, setCrawledUrls, setBaseUrl, setAuthConfig]);

  const handleStartTest = useCallback(
    async (config: RunConfigType) => {
      setError(null);
      try {
        const urls = latestUrls.current;
        const auth = latestAuth.current;
        const authJson =
          auth.type !== 'none' ? JSON.stringify(auth) : undefined;
        const { runId } = await createRun(urls, {
          ...config,
          authJson,
          headed: latestHeaded.current,
        }, latestName.current, latestTags.current);
        navigate(`/running/${runId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start test');
      }
    },
    [navigate, setError]
  );

  const addTag = (value: string) => {
    const tag = value.trim().toLowerCase();
    if (tag && !runTags.includes(tag)) {
      setRunTags([...runTags, tag]);
    }
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(tagInput);
      setTagInput('');
    }
  };

  if (selectedUrls.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-[15px] font-semibold text-fg">
        Configure Load Test
      </h2>

      <div className="border border-border rounded-[8px] bg-surface p-4 space-y-3">
        <label className="block text-[13px] font-semibold text-fg">Test Label</label>
        <input
          type="text"
          value={runName}
          onChange={(e) => setRunName(e.target.value)}
          placeholder="e.g. pre-deploy baseline"
          className="w-full h-[38px] px-3 bg-bg border border-border rounded-[5px] text-[13px] text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="space-y-1.5">
          <label className="block text-[12px] font-medium text-muted">Tags</label>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {runTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent-soft text-accent text-[11px] font-medium rounded-full"
              >
                {tag}
                <button
                  onClick={() => setRunTags(runTags.filter((t) => t !== tag))}
                  className="hover:text-fg transition-colors text-[13px] leading-none"
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            onBlur={() => { if (tagInput.trim()) { addTag(tagInput); setTagInput(''); } }}
            placeholder="Type a tag and press Enter"
            className="w-full h-[34px] px-3 bg-bg border border-border rounded-[5px] text-[12px] text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      <label className="flex items-center gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={headed}
          onChange={(e) => setHeaded(e.target.checked)}
          className="w-4 h-4 rounded border-border accent-accent"
        />
        <span className="text-[13px] text-fg">Headed browser</span>
        <span className="text-[11px] text-muted">— accurate FCP/LCP for streaming SSR</span>
      </label>

      <HostSwap urls={selectedUrls} onSwap={handleHostSwap} />
      <div className="text-[13px] text-muted mb-1">
        Testing {selectedUrls.length} URL{selectedUrls.length !== 1 ? 's' : ''}
      </div>
      <RunConfig
        onStart={handleStartTest}
        onBack={() => navigate(authConfig.type !== 'none' ? '/select' : '/auth')}
      />
    </div>
  );
}
