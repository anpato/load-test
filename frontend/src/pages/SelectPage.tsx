import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { RouteList } from '../components/RouteList';
import { useWizard } from '../contexts/WizardContext';

export default function SelectPage() {
  const navigate = useNavigate();
  const { allUrls, selectedUrls, setSelectedUrls, authConfig } = useWizard();

  useEffect(() => {
    if (allUrls.length === 0) navigate('/', { replace: true });
  }, [allUrls.length, navigate]);

  if (allUrls.length === 0) return null;

  return (
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
          onClick={() => navigate('/')}
          className="h-[38px] px-4 text-fg bg-s2 border border-border rounded-[5px] text-[13px] hover:bg-border transition-colors"
        >
          Back
        </button>
        <button
          onClick={() => navigate(authConfig.type !== 'none' ? '/config' : '/auth')}
          disabled={selectedUrls.length === 0}
          className="h-[38px] px-4 bg-accent text-accent-fg rounded-[5px] text-[13px] font-medium hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          Continue ({selectedUrls.length} selected)
        </button>
      </div>
    </div>
  );
}
