import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import ResultsTable from '../components/ResultsTable';
import LogPanel from '../components/LogPanel';
import { useWizard } from '../contexts/WizardContext';
import { getRun, rerunTest, deleteRun } from '../lib/api';
import type { Run } from '../lib/types';

function statusBadge(status: string) {
  switch (status) {
    case 'finished':
      return 'bg-accent-soft text-accent';
    case 'breached':
      return 'bg-warn/10 text-warn';
    case 'error':
      return 'bg-bad/10 text-bad';
    default:
      return 'bg-s2 text-muted border border-border';
  }
}

function statusLabel(status: string) {
  if (status === 'breached') return 'thresholds breached';
  return status;
}

export default function ResultsPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { loadRunIntoWizard, resetWizard, authConfig, setError } = useWizard();
  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuthPrompt, setShowAuthPrompt] = useState(false);

  useEffect(() => {
    if (!runId) return;
    setLoading(true);
    getRun(runId)
      .then(setRun)
      .catch(() => setRun(null))
      .finally(() => setLoading(false));
  }, [runId]);

  const handleRerun = useCallback(
    async (authJsonOverride?: string) => {
      if (!runId) return;
      setError(null);
      setShowAuthPrompt(false);
      try {
        const options: { authJson?: string } = {};
        if (authJsonOverride !== undefined) {
          options.authJson = authJsonOverride;
        }
        const { runId: newId } = await rerunTest(
          runId,
          Object.keys(options).length > 0 ? options : undefined
        );
        navigate(`/running/${newId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to re-run test');
      }
    },
    [runId, navigate, setError]
  );

  const handleRerunClick = useCallback(() => {
    if (run?.config?.authJson) {
      setShowAuthPrompt(true);
    } else {
      handleRerun();
    }
  }, [run, handleRerun]);

  if (loading) {
    return <div className="text-[13px] text-muted">Loading results...</div>;
  }

  if (!run) {
    return <div className="text-[13px] text-bad">Run not found.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-semibold text-fg">
            {run.name || 'Test Results'}
          </h2>
          {run.tags && run.tags.length > 0 && (
            <div className="flex gap-1">
              {run.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 text-[10px] font-medium bg-accent-soft text-accent rounded-full">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className={`px-2 py-0.5 text-[11px] font-medium rounded-[4px] ${statusBadge(run.status)}`}>
          {statusLabel(run.status)}
        </span>
      </div>
      {run.name && (
        <div className="text-[12px] text-muted font-mono">{run.id}</div>
      )}
      {run.error && (
        <div className="p-3 bg-bad/10 border border-bad/20 text-bad rounded-[5px] text-[13px]">
          {run.error}
        </div>
      )}
      <ResultsTable results={run.results || {}} />

      {run.logs && run.logs.length > 0 && (
        <LogPanel logs={run.logs} />
      )}

      {showAuthPrompt && (
        <div className="p-4 border border-border rounded-[8px] bg-surface space-y-3">
          <p className="text-[13px] text-fg">
            This test used <strong>{JSON.parse(run.config.authJson!).type}</strong> auth.
            Use current credentials instead?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleRerun()}
              className="h-[34px] px-3 text-[12px] text-fg bg-s2 border border-border rounded-[4px] hover:bg-border transition-colors"
            >
              Use Original
            </button>
            {authConfig.type !== 'none' ? (
              <button
                onClick={() => handleRerun(JSON.stringify(authConfig))}
                className="h-[34px] px-3 text-[12px] bg-accent text-accent-fg rounded-[4px] hover:opacity-90 transition-opacity"
              >
                Use Current
              </button>
            ) : (
              <button
                onClick={() => navigate('/auth')}
                className="h-[34px] px-3 text-[12px] bg-accent text-accent-fg rounded-[4px] hover:opacity-90 transition-opacity"
              >
                Configure Auth
              </button>
            )}
            <button
              onClick={() => setShowAuthPrompt(false)}
              className="h-[34px] px-3 text-[12px] text-muted hover:text-fg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleRerunClick}
          className="h-[38px] px-4 bg-accent text-accent-fg rounded-[5px] text-[13px] font-medium hover:opacity-90 transition-opacity"
        >
          Re-run This Test
        </button>
        <button
          onClick={() => {
            loadRunIntoWizard(run);
            navigate('/config');
          }}
          className="h-[38px] px-4 text-fg bg-s2 border border-border rounded-[5px] text-[13px] hover:bg-border transition-colors"
        >
          Edit & Re-run
        </button>
        <button
          onClick={() => {
            resetWizard();
            navigate('/');
          }}
          className="h-[38px] px-4 text-fg bg-s2 border border-border rounded-[5px] text-[13px] hover:bg-border transition-colors"
        >
          New Test
        </button>
        <button
          onClick={async () => {
            if (runId) {
              await deleteRun(runId);
              resetWizard();
              navigate('/');
            }
          }}
          className="h-[38px] px-4 text-bad bg-s2 border border-border rounded-[5px] text-[13px] hover:bg-bad/10 transition-colors"
        >
          Delete
        </button>
      </div>
    </div>
  );
}
