import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import LiveDashboard from '../components/LiveDashboard';
import { useMetricsStream } from '../hooks/useMetricsStream';
import { getRun, stopRun, rerunTest } from '../lib/api';
import { useWizard } from '../contexts/WizardContext';

export default function RunningPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { headed } = useWizard();
  const { snapshots, history, logs, connected, disconnect } =
    useMetricsStream(runId ?? null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    if (!runId) return;

    pollRef.current = setInterval(async () => {
      try {
        const r = await getRun(runId);
        if (r.status === 'finished' || r.status === 'error' || r.status === 'breached') {
          clearInterval(pollRef.current);
          disconnect();
          if (!stopped) {
            navigate(`/results/${runId}`, { replace: true });
          }
        }
      } catch {
        clearInterval(pollRef.current);
      }
    }, 3000);

    return () => clearInterval(pollRef.current);
  }, [runId, navigate, disconnect, stopped]);

  const handleStop = useCallback(async () => {
    if (runId) {
      setStopped(true);
      await stopRun(runId);
    }
  }, [runId]);

  const handleRerun = useCallback(async () => {
    if (runId) {
      const { runId: newId } = await rerunTest(runId, { headed });
      setStopped(false);
      navigate(`/running/${newId}`, { replace: true });
    }
  }, [runId, headed, navigate]);

  if (!runId) return null;

  return (
    <LiveDashboard
      snapshots={snapshots}
      history={history}
      logs={logs}
      connected={connected}
      stopped={stopped}
      onStop={handleStop}
      onRerun={handleRerun}
    />
  );
}
