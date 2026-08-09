import { useState, useEffect, useCallback } from 'react';
import { LiveAlert } from './types';

/**
 * Counts up smoothly from 0 to end target value on mount
 */
export function useCountUp(end: number, duration = 1000, decimals = 0): string {
  const [count, setCount] = useState<number>(0);

  useEffect(() => {
    let startTimestamp: number | null = null;
    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);

      // Ease out cubic
      const easeOutProgress = 1 - Math.pow(1 - progress, 3);
      setCount(easeOutProgress * end);

      if (progress < 1) {
        animationFrameId = window.requestAnimationFrame(step);
      }
    };

    animationFrameId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [end, duration]);

  return count.toFixed(decimals);
}

/**
 * Custom fetch hook with loading, error, data states and refetch trigger
 */
export function useFetch<T>(fetcher: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err: any) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    execute();
  }, deps);

  return { data, loading, error, refetch: execute };
}

/**
 * WebSocket alert hook with automatic simulation fallback when offline
 */
export function useWebSocketAlerts(wsUrl: string = 'ws://localhost:8000/ws/alerts') {
  const [alerts, setAlerts] = useState<LiveAlert[]>([]);

  const addAlert = useCallback((newAlert: LiveAlert) => {
    setAlerts((prev) => {
      // Keep max 3 toasts visible at a time
      const updated = [...prev, newAlert];
      if (updated.length > 3) {
        return updated.slice(updated.length - 3);
      }
      return updated;
    });
  }, []);

  const removeAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let fallbackInterval: NodeJS.Timeout | null = null;
    let isWsConnected = false;

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        isWsConnected = true;
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const alert: LiveAlert = {
            id: `alt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
            operation_name: payload.operation_name || 'llm_eval_step',
            agent_id: payload.agent_id || 'planner-agent',
            duration_ms: payload.duration_ms || 420,
            status: payload.status || 'error',
            timestamp: new Date().toISOString(),
            message: payload.message || 'Drift threshold exceeded (>5% error rate)',
          };
          addAlert(alert);
        } catch (e) {
          console.error('Error parsing WS message:', e);
        }
      };

      ws.onerror = () => {
        isWsConnected = false;
      };
    } catch (e) {
      isWsConnected = false;
    }

    // Fallback simulation: trigger periodic alerts every 14 seconds if WS not connected
    fallbackInterval = setInterval(() => {
      if (!isWsConnected) {
        const sampleOps = ['execute_sql_query', 'llm_generate_summary', 'vector_embedding_search', 'llm_critic_verify'];
        const sampleAgents = ['planner-agent', 'researcher-agent', 'writer-agent', 'critic-agent'];
        const sampleStatuses: ('ok' | 'error' | 'hallucination')[] = ['error', 'hallucination', 'ok'];

        const randomOp = sampleOps[Math.floor(Math.random() * sampleOps.length)];
        const randomAgent = sampleAgents[Math.floor(Math.random() * sampleAgents.length)];
        const randomStatus = sampleStatuses[Math.floor(Math.random() * sampleStatuses.length)];

        addAlert({
          id: `alt_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          operation_name: randomOp,
          agent_id: randomAgent,
          duration_ms: Math.floor(140 + Math.random() * 850),
          status: randomStatus,
          timestamp: new Date().toISOString(),
          message: randomStatus === 'error' ? 'High latency z-score anomaly' : randomStatus === 'hallucination' ? 'Faithfulness score below 0.50' : 'Span completed',
        });
      }
    }, 14000);

    return () => {
      if (ws) ws.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [wsUrl, addAlert]);

  return { alerts, removeAlert };
}
