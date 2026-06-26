import { createContext, useCallback, useContext, useState } from 'react';
import type { AuthConfig as AuthConfigType, Run } from '../lib/types';
import type { ReactNode } from 'react';

interface WizardState {
  baseUrl: string;
  setBaseUrl: (url: string) => void;
  crawledUrls: string[];
  setCrawledUrls: (urls: string[]) => void;
  manualUrls: string[];
  setManualUrls: (urls: string[]) => void;
  selectedUrls: string[];
  setSelectedUrls: (urls: string[] | ((prev: string[]) => string[])) => void;
  isSPA: boolean;
  setIsSPA: (v: boolean) => void;
  framework: string;
  setFramework: (v: string) => void;
  authConfig: AuthConfigType;
  setAuthConfig: (c: AuthConfigType) => void;
  runName: string;
  setRunName: (n: string) => void;
  runTags: string[];
  setRunTags: (t: string[]) => void;
  error: string | null;
  setError: (e: string | null) => void;
  allUrls: string[];
  loadRunIntoWizard: (r: Run) => void;
  resetWizard: () => void;
}

const WizardContext = createContext<WizardState | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [crawledUrls, setCrawledUrls] = useState<string[]>([]);
  const [manualUrls, setManualUrls] = useState<string[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [isSPA, setIsSPA] = useState(false);
  const [framework, setFramework] = useState('');
  const [authConfig, setAuthConfig] = useState<AuthConfigType>({ type: 'none' });
  const [runName, setRunName] = useState('');
  const [runTags, setRunTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const allUrls = [...new Set([...crawledUrls, ...manualUrls])];

  const loadRunIntoWizard = useCallback((r: Run) => {
    const urls = r.urls || [];
    setCrawledUrls([]);
    setManualUrls(urls);
    setSelectedUrls(urls);
    setError(null);
    setRunName(r.name || '');
    setRunTags(r.tags || []);
    if (r.config?.authJson) {
      try {
        setAuthConfig(JSON.parse(r.config.authJson));
      } catch { /* keep current */ }
    }
    if (urls.length > 0) {
      try { setBaseUrl(new URL(urls[0]).origin); } catch { /* keep current */ }
    }
  }, []);

  const resetWizard = useCallback(() => {
    setCrawledUrls([]);
    setManualUrls([]);
    setSelectedUrls([]);
    setIsSPA(false);
    setFramework('');
    setError(null);
    setRunName('');
    setRunTags([]);
  }, []);

  return (
    <WizardContext.Provider value={{
      baseUrl, setBaseUrl,
      crawledUrls, setCrawledUrls,
      manualUrls, setManualUrls,
      selectedUrls, setSelectedUrls,
      isSPA, setIsSPA,
      framework, setFramework,
      authConfig, setAuthConfig,
      runName, setRunName,
      runTags, setRunTags,
      error, setError,
      allUrls,
      loadRunIntoWizard,
      resetWizard,
    }}>
      {children}
    </WizardContext.Provider>
  );
}

export function useWizard(): WizardState {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error('useWizard must be used within WizardProvider');
  return ctx;
}
