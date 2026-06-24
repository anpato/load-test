import { useCallback, useEffect, useRef, useState } from 'react';
import type { MetricSnapshot } from '../lib/types';

interface StreamState {
  snapshots: MetricSnapshot[];
  history: MetricSnapshot[];
  logs: string[];
  status: string | null;
  connected: boolean;
}

interface WsMessage {
  type: 'metrics' | 'log' | 'status';
  snapshots?: MetricSnapshot[];
  message?: string;
  state?: string;
  error?: string;
}

export function useMetricsStream(runId: string | null) {
  const [state, setState] = useState<StreamState>({
    snapshots: [],
    history: [],
    logs: [],
    status: null,
    connected: false,
  });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!runId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    setState({ snapshots: [], history: [], logs: [], status: null, connected: false });

    const ws = new WebSocket(
      `${protocol}//${window.location.host}/api/runs/${runId}/ws`
    );
    wsRef.current = ws;

    ws.onopen = () => {
      setState((prev) => ({ ...prev, connected: true }));
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);

        switch (msg.type) {
          case 'metrics':
            if (msg.snapshots) {
              setState((prev) => ({
                ...prev,
                snapshots: msg.snapshots!,
                history: [...prev.history, ...msg.snapshots!],
              }));
            }
            break;

          case 'log':
            if (msg.message) {
              setState((prev) => ({
                ...prev,
                logs: [...prev.logs, msg.message!],
              }));
            }
            break;

          case 'status':
            setState((prev) => ({
              ...prev,
              status: msg.state || null,
            }));
            break;
        }
      } catch {
        // skip malformed messages
      }
    };

    ws.onclose = () => {
      setState((prev) => ({ ...prev, connected: false }));
    };

    ws.onerror = () => {
      setState((prev) => ({ ...prev, connected: false }));
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [runId]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
  }, []);

  return { ...state, disconnect };
}
