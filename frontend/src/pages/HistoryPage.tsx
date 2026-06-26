import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useWizard } from '../contexts/WizardContext';
import { listRuns, rerunTest, deleteRun } from '../lib/api';
import type { Run } from '../lib/types';

function statusBadge(status: string) {
  switch (status) {
    case 'finished':
      return 'bg-accent-soft text-accent';
    case 'breached':
      return 'bg-warn/10 text-warn';
    case 'error':
      return 'bg-bad/10 text-bad';
    case 'running':
      return 'bg-accent-soft text-accent';
    default:
      return 'bg-s2 text-muted border border-border';
  }
}

function statusLabel(status: string) {
  if (status === 'breached') return 'breached';
  return status;
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const { loadRunIntoWizard, authConfig, setError } = useWizard();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [authPromptRunId, setAuthPromptRunId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    listRuns()
      .then((r) => setRuns(r || []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, []);

  const handleRerun = useCallback(
    async (id: string, authJsonOverride?: string) => {
      setError(null);
      setAuthPromptRunId(null);
      try {
        const options: { authJson?: string } = {};
        if (authJsonOverride !== undefined) {
          options.authJson = authJsonOverride;
        }
        const { runId } = await rerunTest(
          id,
          Object.keys(options).length > 0 ? options : undefined
        );
        navigate(`/running/${runId}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to re-run test');
      }
    },
    [navigate, setError]
  );

  const handleRerunClick = useCallback(
    (r: Run) => {
      if (r.config?.authJson) {
        setAuthPromptRunId(r.id);
      } else {
        handleRerun(r.id);
      }
    },
    [handleRerun]
  );

  const handleDelete = useCallback(async (id: string) => {
    try {
      await deleteRun(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete run');
    }
  }, [setError]);

  const filteredRuns = filter
    ? runs.filter((r) => {
        const q = filter.toLowerCase();
        return (
          (r.name || '').toLowerCase().includes(q) ||
          (r.tags || []).some((t) => t.toLowerCase().includes(q)) ||
          r.id.toLowerCase().includes(q)
        );
      })
    : runs;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-fg">Run History</h2>
        <button
          onClick={() => navigate(-1)}
          className="h-[34px] px-3 text-[12px] text-fg bg-s2 border border-border rounded-[4px] hover:bg-border transition-colors"
        >
          Back
        </button>
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter by name, tag, or ID..."
        className="w-full h-[38px] px-3 bg-bg border border-border rounded-[5px] text-[13px] text-fg placeholder:text-subtle focus:outline-none focus:ring-1 focus:ring-accent"
      />

      {loading ? (
        <p className="text-[13px] text-muted">Loading...</p>
      ) : filteredRuns.length === 0 ? (
        <p className="text-[13px] text-subtle">No runs found.</p>
      ) : (
        <div className="space-y-3">
          {filteredRuns.map((r) => (
            <div
              key={r.id}
              className="rounded-[8px] border border-border bg-surface p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {r.name ? (
                    <span className="text-[13px] font-semibold text-fg">{r.name}</span>
                  ) : (
                    <span className="text-[12px] font-mono text-muted">
                      {r.id.slice(0, 12)}...
                    </span>
                  )}
                  {r.tags && r.tags.length > 0 && (
                    <div className="flex gap-1">
                      {r.tags.map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 text-[10px] font-medium bg-accent-soft text-accent rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className={`px-2 py-0.5 text-[11px] font-medium rounded-[4px] ${statusBadge(r.status)}`}>
                  {statusLabel(r.status)}
                </span>
              </div>
              <div className="text-[12px] text-muted font-mono">
                {r.urls?.length || 0} URLs &middot;{' '}
                {r.config?.testType || 'custom'} &middot;{' '}
                {new Date(r.startedAt).toLocaleString()}
                {r.name && <> &middot; {r.id.slice(0, 8)}</>}
              </div>

              {authPromptRunId === r.id && (
                <div className="p-3 border border-border rounded-[6px] bg-bg space-y-2">
                  <p className="text-[12px] text-fg">
                    This test used auth. Use current credentials?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleRerun(r.id)}
                      className="h-[28px] px-2.5 text-[11px] text-fg bg-s2 border border-border rounded-[4px] hover:bg-border transition-colors"
                    >
                      Use Original
                    </button>
                    {authConfig.type !== 'none' ? (
                      <button
                        onClick={() => handleRerun(r.id, JSON.stringify(authConfig))}
                        className="h-[28px] px-2.5 text-[11px] bg-accent text-accent-fg rounded-[4px] hover:opacity-90 transition-opacity"
                      >
                        Use Current
                      </button>
                    ) : (
                      <button
                        onClick={() => navigate('/auth')}
                        className="h-[28px] px-2.5 text-[11px] bg-accent text-accent-fg rounded-[4px] hover:opacity-90 transition-opacity"
                      >
                        Configure Auth
                      </button>
                    )}
                    <button
                      onClick={() => setAuthPromptRunId(null)}
                      className="h-[28px] px-2.5 text-[11px] text-muted hover:text-fg transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => navigate(`/results/${r.id}`)}
                  className="h-[30px] px-3 text-[12px] text-fg bg-s2 border border-border rounded-[4px] hover:bg-border transition-colors"
                >
                  View
                </button>
                <button
                  onClick={() => {
                    loadRunIntoWizard(r);
                    navigate('/config');
                  }}
                  className="h-[30px] px-3 text-[12px] text-fg bg-s2 border border-border rounded-[4px] hover:bg-border transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleRerunClick(r)}
                  className="h-[30px] px-3 text-[12px] bg-accent text-accent-fg rounded-[4px] hover:opacity-90 transition-opacity"
                >
                  Re-run
                </button>
                <button
                  onClick={() => handleDelete(r.id)}
                  className="h-[30px] px-3 text-[12px] text-bad bg-s2 border border-border rounded-[4px] hover:bg-bad/10 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
