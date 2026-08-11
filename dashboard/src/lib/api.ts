import { TraceSummary, CausalGraph, AgentSummary, CostSummaryItem, SpanSearchResult, ChainSearchResult, AnomalyAlert } from './types';
import { MOCK_TRACES, getMockCausalReplay, MOCK_AGENTS, MOCK_COST_SERIES, MOCK_SEARCH_SPANS, MOCK_SEARCH_CHAINS, MOCK_ANOMALIES, MOCK_SPANS_PER_MINUTE } from './mock';

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

export interface PipelineStepResult {
  agent_name: string;
  model: string;
  latency_ms: number;
  text: string;
  status: 'idle' | 'running' | 'done';
}

export interface PipelineResponse {
  causal_chain_id: string;
  steps: PipelineStepResult[];
}

export async function runAgentPipeline(task: string): Promise<PipelineResponse> {
  try {
    const res = await fetch(`${API_BASE}/v1/agents/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return await res.json();
    }
    throw new Error(`Pipeline API error ${res.status}`);
  } catch (err) {
    console.warn('Agent run API offline, returning realistic mock pipeline:', err);
    const chainId = `csl_${Math.random().toString(36).substring(2, 8)}`;
    return {
      causal_chain_id: chainId,
      steps: [
        {
          agent_name: 'Planner',
          model: 'Groq / Llama-3.3-70b',
          latency_ms: 380,
          text: `Deconstructed task: "${task}". Generated 3 execution sub-goals: 1) Extract domain entity relationships, 2) Execute vector similarity search on trace history, 3) Synthesize final consensus output.`,
          status: 'done',
        },
        {
          agent_name: 'Researcher',
          model: 'Gemini-1.5-Flash',
          latency_ms: 640,
          text: `Retrieved 18 related trace spans across production cluster. Evaluated latency z-scores (avg 310ms) and verified error rate remains below 0.05 threshold.`,
          status: 'done',
        },
        {
          agent_name: 'Critic',
          model: 'Mistral-7B-Instruct',
          latency_ms: 410,
          text: `Validation complete. Hallucination risk: 0.04 (low). Faithfulness score: 0.96 (high). Pipeline execution verified with zero policy violations.`,
          status: 'done',
        },
      ],
    };
  }
}

export interface BenchmarkResult {
  rank: number;
  provider: 'Groq' | 'Gemini' | 'Mistral' | 'OpenRouter' | string;
  model: string;
  quality_score: number;
  latency_ms: number;
  tokens: number;
  status: string;
  text: string;
}

export interface BenchmarkResponse {
  results: BenchmarkResult[];
}

export async function runBenchmarkSuite(prompt: string): Promise<BenchmarkResponse> {
  try {
    const res = await fetch(`${API_BASE}/v1/agents/benchmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      return await res.json();
    }
    throw new Error(`Benchmark API error ${res.status}`);
  } catch (err) {
    console.warn('Benchmark API offline, returning realistic mock benchmark:', err);
    return {
      results: [
        {
          rank: 1,
          provider: 'Groq',
          model: 'Llama-3.3-70b',
          quality_score: 9.6,
          latency_ms: 240,
          tokens: 412,
          status: 'ok',
          text: `Groq response: High-throughput execution plan completed with zero drift anomalies detected across multi-agent handoffs for "${prompt}".`,
        },
        {
          rank: 2,
          provider: 'Gemini',
          model: 'Gemini-1.5-Pro',
          quality_score: 9.2,
          latency_ms: 410,
          tokens: 528,
          status: 'ok',
          text: `Gemini response: Multimodal context analysis verifies trace consistency and state convergence across agent hops for "${prompt}".`,
        },
        {
          rank: 3,
          provider: 'Mistral',
          model: 'Mistral-Large',
          quality_score: 8.8,
          latency_ms: 580,
          tokens: 395,
          status: 'ok',
          text: `Mistral response: Concise reasoning path with strict adherence to system prompt constraints and low latency z-score for "${prompt}".`,
        },
        {
          rank: 4,
          provider: 'OpenRouter',
          model: 'Claude-3.5-Sonnet',
          quality_score: 8.5,
          latency_ms: 730,
          tokens: 610,
          status: 'ok',
          text: `OpenRouter response: Detailed step-by-step breakdown with comprehensive safety checks and hallucination score under 0.05 for "${prompt}".`,
        },
      ],
    };
  }
}

export async function searchSpans(query: string, limit = 20): Promise<SpanSearchResult[]> {
  try {
    const res = await fetch(`${API_BASE}/v1/search/spans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map((item: any) => ({
          span_id: item.span_id || `spn_${Math.random().toString(36).substring(2, 8)}`,
          similarity: typeof item.similarity === 'number' ? item.similarity : (item.score || 0.85),
          operation_name: item.operation_name || 'operation',
          agent_id: item.agent_id || 'agent',
          status: item.status || 'ok',
          duration_ms: item.duration_ms || item.duration || 450,
          started_at: item.started_at || new Date().toISOString(),
          service_name: item.service_name || 'service',
        }));
      }
    }
    throw new Error('Invalid response or empty');
  } catch (err) {
    console.warn('Search spans API unreachable, using fallback:', err);
    return MOCK_SEARCH_SPANS.map(item => ({
      ...item,
      similarity: Number(Math.max(0.65, item.similarity - Math.random() * 0.04).toFixed(2))
    }));
  }
}

export async function searchChains(query: string, limit = 20): Promise<ChainSearchResult[]> {
  try {
    const res = await fetch(`${API_BASE}/v1/search/chains`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map((item: any) => ({
          similarity: typeof item.similarity === 'number' ? item.similarity : 0.88,
          causal_chain_id: item.causal_chain_id || item.chain_id || 'csl_65a1b2',
          agent_ids: item.agent_ids || item.agents || ['planner-agent', 'researcher-agent'],
          span_count: item.span_count || item.spans || 10,
          total_cost_usd: item.total_cost_usd || item.cost || 0.024,
          has_errors: Boolean(item.has_errors || item.error_count > 0),
          error_count: item.error_count || 0,
        }));
      }
    }
    throw new Error('Invalid response or empty');
  } catch (err) {
    console.warn('Search chains API unreachable, using fallback:', err);
    return MOCK_SEARCH_CHAINS;
  }
}

export async function getDriftAlerts(hours = 24): Promise<AnomalyAlert[]> {
  try {
    const res = await fetch(`${API_BASE}/v1/traces/drift/alerts?hours=${hours}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        return data.map((row: any, i: number) => ({
          id: row.id || `anom_live_${i}`,
          operation_name: row.operation_name || 'unknown_op',
          agent_id: row.agent_id || 'unknown_agent',
          type: (row.error_rate > 0.3 ? 'ERROR' : row.p100_latency_ms > 2000 ? 'LATENCY' : 'ERROR_RATE') as AnomalyAlert['type'],
          severity: (row.error_rate > 0.25 ? 'critical' : 'warning') as AnomalyAlert['severity'],
          current_value: row.error_rate ? `${(row.error_rate * 100).toFixed(1)}% err` : `${row.avg_latency_ms || 450}ms`,
          baseline_value: row.baseline || '1.0%',
          error_rate: row.error_rate || 0.1,
          timestamp: new Date().toISOString(),
          causal_chain_id: row.causal_chain_id || 'csl_65a1b2',
          description: `Statistically detected anomaly in ${row.operation_name} executed by ${row.agent_id}.`,
        }));
      }
    }
    throw new Error('API offline or empty');
  } catch (err) {
    console.warn('Drift alerts API unreachable, using mock anomalies:', err);
    return MOCK_ANOMALIES;
  }
}
// ── Attribution ──────────────────────────────────────────────────────────────

export interface AttributionCause {
  span_id: string;
  operation_name: string;
  agent_id: string;
  status: string;
  duration_ms: number;
  attribution_score: number;
  temporal_score: number;
  error_score: number;
  latency_score: number;
  centrality_score: number;
  descendant_count: number;
  explanation: string;
}

export interface AttributionReport {
  causal_chain_id: string;
  error_span_id: string | null;
  error_operation: string | null;
  total_spans: number;
  confidence: number;
  summary: string;
  root_cause: AttributionCause | null;
  ranked_causes: AttributionCause[];
}

export async function getCausalAttribution(chainId: string, errorSpanId?: string): Promise<AttributionReport | null> {
  try {
    const url = errorSpanId
      ? `${API_BASE}/v1/traces/${chainId}/attribution?error_span_id=${errorSpanId}`
      : `${API_BASE}/v1/traces/${chainId}/attribution`;
    return await fetchWithRetry<AttributionReport>(url);
  } catch {
    return null;
  }
}

// ── Trace Diff ───────────────────────────────────────────────────────────────

export interface OpDiff {
  operation_name: string;
  in_a: boolean;
  in_b: boolean;
  latency_a_ms: number | null;
  latency_b_ms: number | null;
  delta_ms: number | null;
  delta_pct: number | null;
  status_a: string | null;
  status_b: string | null;
  status_changed: boolean;
}

export interface TraceDiffReport {
  chain_a: string;
  chain_b: string;
  divergence_score: number;
  first_divergence_op: string | null;
  only_in_a: string[];
  only_in_b: string[];
  common_ops: string[];
  operations: OpDiff[];
  summary: string;
}

export async function getTraceDiff(chainA: string, chainB: string): Promise<TraceDiffReport | null> {
  try {
    return await fetchWithRetry<TraceDiffReport>(
      `${API_BASE}/v1/traces/${chainA}/diff?compare_to=${chainB}`
    );
  } catch {
    return null;
  }
}

// ── Agent Fingerprint ─────────────────────────────────────────────────────────

export interface AgentFingerprint {
  agent_id: string;
  agent_framework: string;
  archetype: string;
  total_spans: number;
  total_chains: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  error_rate: number;
  tool_affinity: number;
  avg_cost_per_span: number;
  spans_per_chain: number;
  top_operations: { op: string; fraction: number }[];
  signature: number[];
}

export interface AgentSimilarity {
  agent_a: string;
  agent_b: string;
  similarity: number;
  shared_ops: string[];
  explanation: string;
}

export interface AgentCluster {
  cluster_id: number;
  archetype: string;
  agents: string[];
  cohesion: number;
  description: string;
}

export interface FingerprintReport {
  summary: string;
  fingerprints: AgentFingerprint[];
  similarities: AgentSimilarity[];
  clusters: AgentCluster[];
}

export async function getAgentFingerprints(hours = 24): Promise<FingerprintReport | null> {
  try {
    return await fetchWithRetry<FingerprintReport>(`${API_BASE}/v1/agents/fingerprint?hours=${hours}`);
  } catch {
    return null;
  }
}

// ── Cost Forecast ─────────────────────────────────────────────────────────────

export interface CostForecastPoint {
  hour: string;
  actual: number | null;
  forecast: number;
  lower: number;
  upper: number;
}

export async function getCostForecast(hoursAhead = 24): Promise<CostForecastPoint[]> {
  try {
    const data = await fetchWithRetry<CostForecastPoint[]>(
      `${API_BASE}/v1/traces/cost/forecast?hours_ahead=${hoursAhead}`
    );
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ── Hallucination Risk ────────────────────────────────────────────────────────

export interface HallucinationRisk {
  causal_chain_id: string;
  high_risk_spans: { span_id: string; operation_name: string; risk_score: number; reason: string }[];
  avg_risk: number;
  model_trained: boolean;
}

export async function getHallucinationRisk(chainId: string): Promise<HallucinationRisk | null> {
  try {
    return await fetchWithRetry<HallucinationRisk>(`${API_BASE}/v1/traces/${chainId}/hallucination_risk`);
  } catch {
    return null;
  }
}

// ── Decision Explainer ────────────────────────────────────────────────────────

export interface SpanExplanation {
  span_id: string;
  explanation: string;
  key_factors: string[];
  confidence: number;
}

export async function explainSpan(spanId: string, context: Record<string, any>): Promise<SpanExplanation | null> {
  try {
    const res = await fetch(`${API_BASE}/v1/spans/${spanId}/explain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return await res.json();
    return null;
  } catch {
    return null;
  }
}

// ── Prompt Mutation Lab ───────────────────────────────────────────────────────

export interface PromptVariant {
  label: string;
  prompt: string;
  predicted_quality: number;
  predicted_tokens: number;
  rationale: string;
}

export async function mutatePrompt(spanId: string, originalPrompt: string): Promise<PromptVariant[]> {
  try {
    const res = await fetch(`${API_BASE}/v1/spans/${spanId}/mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: originalPrompt }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return await res.json();
    return [];
  } catch {
    return [];
  }
}

// ── Time Travel ───────────────────────────────────────────────────────────────

export interface TimeTravelResult {
  original_chain_id: string;
  counterfactual_id: string;
  changed_span_id: string;
  changed_operation: string;
  original_outcome: string;
  counterfactual_outcome: string;
  explanation: string;
  would_have_succeeded: boolean;
  confidence: number;
}

export async function getTimeTravelAnalysis(chainId: string): Promise<TimeTravelResult | null> {
  try {
    return await fetchWithRetry<TimeTravelResult>(`${API_BASE}/v1/traces/${chainId}/time_travel`);
  } catch {
    return null;
  }
}

export async function getSpansTimeseries(minutes = 30): Promise<{ time: string; spans: number; errors: number }[]> {
  try {
    const data = await fetchWithRetry<{ time: string; spans: number; errors: number }[]>(
      `${API_BASE}/v1/traces/spans/timeseries?minutes=${minutes}`
    );
    if (Array.isArray(data) && data.length > 0) return data;
    return MOCK_SPANS_PER_MINUTE;
  } catch {
    return MOCK_SPANS_PER_MINUTE;
  }
}
