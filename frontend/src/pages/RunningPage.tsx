import { useCallback, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import LiveDashboard from '../components/LiveDashboard';
import { useMetricsStream } from '../hooks/useMetricsStream';
import { getRun, stopRun } from '../lib/api';

export default function RunningPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const { snapshots, history, logs, connected, disconnect } =
    useMetricsStream(runId ?? null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!runId) return;

    pollRef.current = setInterval(async () => {
      try {
        const r = await getRun(runId);
        if (r.status === 'finished' || r.status === 'error' || r.status === 'breached') {
          clearInterval(pollRef.current);
          disconnect();
          navigate(`/results/${runId}`, { replace: true });
        }
      } catch {
        clearInterval(pollRef.current);
      }
    }, 3000);

    return () => clearInterval(pollRef.current);
  }, [runId, navigate, disconnect]);

  const handleStop = useCallback(async () => {
    if (runId) {
      await stopRun(runId);
      disconnect();
      navigate(`/results/${runId}`, { replace: true });
    }
  }, [runId, disconnect, navigate]);

  if (!runId) return null;

  return (
    <LiveDashboard
      snapshots={snapshots}
      history={history}
      logs={logs}
      connected={connected}
      onStop={handleStop}
    />
  );
}
