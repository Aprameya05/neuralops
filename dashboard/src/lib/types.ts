export type SpanStatus = 'ok' | 'error' | 'hallucination';

export interface Span {
  span_id: string;
  trace_id: string;
  parent_span_id: string | null;
  causal_chain_id: string;
  agent_id: string;
  agent_framework: string;
  service_name: string;
  operation_name: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  status: SpanStatus;
  error_message?: string | null;

  // LLM attributes
  model?: string | null;
  provider?: string | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  estimated_usd?: number | null;
  hallucination_score?: number | null;
  faithfulness_score?: number | null;
  system_prompt?: string;
  user_prompt?: string;
  response_text?: string;

  // Tool attributes
  tool_name?: string | null;
  autonomous?: boolean | number | null;
  input_json?: Record<string, any> | string;
  output_json?: Record<string, any> | string;

  // Custom attributes
  attributes?: string | Record<string, any>;
  children?: Span[];
}

export interface TraceSummary {
  causal_chain_id: string;
  started_at: string;
  ended_at: string;
  span_count: number;
  total_duration_ms: number;
  total_cost_usd: number;
  agent_ids: string[];
  error_count: number;
  max_hallucination: number;
  status: SpanStatus;
  spans?: Span[];
}

export interface CausalGraph {
  causal_chain_id: string;
  root: Span;
  total_spans: number;
  total_duration_ms: number;
  total_cost_usd: number;
  agents: string[];
  status: SpanStatus;
}

export interface AgentSummary {
  agent_id: string;
  agent_framework: string;
  service_name: string;
  total_spans: number;
  error_spans: number;
  error_rate: number;
  total_cost_usd: number;
  avg_latency_ms: number;
  last_seen: string;
  total_chains: number;
}

export interface CostSummaryItem {
  agent_id: string;
  model: string;
  hour: string;
  calls: number;
  tokens: number;
  cost_usd: number;
}

export interface LiveAlert {
  id: string;
  operation_name: string;
  agent_id: string;
  duration_ms: number;
  status: SpanStatus;
  timestamp: string;
  message?: string;
}
