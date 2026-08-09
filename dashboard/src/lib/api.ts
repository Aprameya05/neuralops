import { TraceSummary, CausalGraph, AgentSummary, CostSummaryItem } from './types';
import { MOCK_TRACES, getMockCausalReplay, MOCK_AGENTS, MOCK_COST_SERIES } from './mock';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function fetchWithRetry<T>(url: string, retries = 3, delay = 200): Promise<T> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, delay));
      return fetchWithRetry<T>(url, retries - 1, delay * 2);
    }
    throw err;
  }
}

export async function getTraces(params?: { agent_id?: string; status?: string; limit?: number; offset?: number }): Promise<TraceSummary[]> {
  try {
    const query = new URLSearchParams();
    if (params?.agent_id) query.append('agent_id', params.agent_id);
    if (params?.status) query.append('status', params.status);
    if (params?.limit) query.append('limit', params.limit.toString());
    if (params?.offset) query.append('offset', params.offset.toString());

    const data = await fetchWithRetry<{ traces: TraceSummary[] }>(`${API_BASE}/v1/traces/?${query.toString()}`);
    if (data && Array.isArray(data.traces) && data.traces.length > 0) {
      return data.traces;
    }
    return MOCK_TRACES;
  } catch (err) {
    console.warn('API unreachable, falling back to mock traces:', err);
    let filtered = [...MOCK_TRACES];
    if (params?.agent_id) {
      filtered = filtered.filter(t => t.agent_ids.includes(params.agent_id!));
    }
    if (params?.status && params.status !== 'all') {
      filtered = filtered.filter(t => t.status === params.status);
    }
    return filtered;
  }
}

export async function getCausalReplay(causalChainId: string): Promise<CausalGraph> {
  try {
    const data = await fetchWithRetry<CausalGraph>(`${API_BASE}/v1/traces/${causalChainId}/replay`);
    if (data && data.root) {
      return data;
    }
    const mock = getMockCausalReplay(causalChainId);
    if (!mock) throw new Error('Not found');
    return mock;
  } catch (err) {
    console.warn(`API unreachable for chain ${causalChainId}, using mock replay:`, err);
    return getMockCausalReplay(causalChainId) || getMockCausalReplay(MOCK_TRACES[0].causal_chain_id)!;
  }
}

export async function getAgentsSummary(): Promise<AgentSummary[]> {
  try {
    const data = await fetchWithRetry<AgentSummary[]>(`${API_BASE}/v1/traces/agents/summary`);
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
    return MOCK_AGENTS;
  } catch (err) {
    console.warn('API unreachable, falling back to mock agents:', err);
    return MOCK_AGENTS;
  }
}

export async function getCostSummary(hours = 24): Promise<CostSummaryItem[]> {
  try {
    const data = await fetchWithRetry<CostSummaryItem[]>(`${API_BASE}/v1/traces/cost/summary?hours=${hours}`);
    if (Array.isArray(data) && data.length > 0) {
      return data;
    }
    return MOCK_COST_SERIES;
  } catch (err) {
    console.warn('API unreachable, falling back to mock cost summary:', err);
    return MOCK_COST_SERIES;
  }
}
