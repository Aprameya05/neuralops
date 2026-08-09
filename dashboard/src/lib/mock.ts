import { Span, TraceSummary, AgentSummary, CostSummaryItem, CausalGraph } from './types';

const AGENTS = [
  { id: 'planner-agent', framework: 'LangGraph', service: 'reasoning-svc' },
  { id: 'researcher-agent', framework: 'CrewAI', service: 'search-svc' },
  { id: 'writer-agent', framework: 'AutoGen', service: 'synthesis-svc' },
  { id: 'critic-agent', framework: 'LangGraph', service: 'eval-svc' },
  { id: 'orchestrator', framework: 'Custom', service: 'routing-svc' },
];

const MODELS = ['gpt-4o', 'claude-sonnet-4-6', 'gpt-4o-mini', 'gemini-1.5-flash'];

const TOOLS = ['web_search', 'read_url', 'execute_sql', 'code_interpreter', 'vector_search'];

// Helper for deterministic random seed or simple pseudorandom
function pseudoRandom(seed: number) {
  const x = Math.sin(seed++) * 10000;
  return x - Math.floor(x);
}

// Generate realistic spans for a trace chain
function generateTraceSpans(chainIndex: number): Span[] {
  const now = Date.now();
  const startTimeMs = now - (chainIndex * 7 * 60 * 1000) - Math.floor(pseudoRandom(chainIndex) * 30000);
  const chainId = `csl_${(chainIndex + 101).toString(16)}${Math.random().toString(36).substring(2, 6)}`;
  const traceId = `trc_${Math.random().toString(36).substring(2, 10)}`;

  const numSpans = Math.floor(3 + pseudoRandom(chainIndex + 1) * 10); // 3 to 12 spans
  const spans: Span[] = [];

  let currentTime = startTimeMs;
  let rootSpanId = `spn_root_${chainIndex}`;

  // Chain status
  const rStatus = pseudoRandom(chainIndex + 2);
  const chainStatus = rStatus > 0.85 ? 'error' : rStatus > 0.70 ? 'hallucination' : 'ok';

  // Root Orchestrator span
  const rootAgent = AGENTS[4]; // orchestrator
  const rootDuration = Math.floor(1200 + pseudoRandom(chainIndex + 3) * 3500);

  spans.push({
    span_id: rootSpanId,
    trace_id: traceId,
    parent_span_id: null,
    causal_chain_id: chainId,
    agent_id: rootAgent.id,
    agent_framework: rootAgent.framework,
    service_name: rootAgent.service,
    operation_name: 'orchestrate_workflow',
    started_at: new Date(currentTime).toISOString(),
    ended_at: new Date(currentTime + rootDuration).toISOString(),
    duration_ms: rootDuration,
    status: chainStatus,
    error_message: chainStatus === 'error' ? 'Sub-agent failed to return valid JSON context' : null,
    attributes: JSON.stringify({ workflow: 'deep_research_v2', priority: 'high' }),
  });

  let currentParentId = rootSpanId;
  currentTime += 50;

  for (let i = 1; i < numSpans; i++) {
    const isLlm = i % 2 === 1;
    const isTool = !isLlm;
    const agent = AGENTS[i % AGENTS.length];
    const spanDuration = Math.floor(150 + pseudoRandom(chainIndex * 10 + i) * 1200);

    const spanStatus = (i === numSpans - 1 && chainStatus !== 'ok') ? chainStatus : 'ok';
    const model = isLlm ? MODELS[Math.floor(pseudoRandom(chainIndex + i) * MODELS.length)] : null;
    const promptTokens = isLlm ? Math.floor(300 + pseudoRandom(i) * 2000) : null;
    const completionTokens = isLlm ? Math.floor(100 + pseudoRandom(i + 1) * 800) : null;
    const totalTokens = promptTokens && completionTokens ? promptTokens + completionTokens : null;
    const usd = totalTokens ? (totalTokens * 0.000008 + pseudoRandom(i) * 0.005) : 0.0002;

    const hScore = isLlm ? (spanStatus === 'hallucination' ? 0.78 : Number((pseudoRandom(i + 5) * 0.15).toFixed(2))) : null;
    const fScore = isLlm ? (spanStatus === 'hallucination' ? 0.42 : Number((0.85 + pseudoRandom(i + 6) * 0.14).toFixed(2))) : null;

    const spanId = `spn_${chainIndex}_${i}`;

    spans.push({
      span_id: spanId,
      trace_id: traceId,
      parent_span_id: i > 2 && i % 3 === 0 ? spans[1].span_id : currentParentId,
      causal_chain_id: chainId,
      agent_id: agent.id,
      agent_framework: agent.framework,
      service_name: agent.service,
      operation_name: isLlm ? `llm_generate_${agent.id.replace('-agent', '')}` : `tool_call_${TOOLS[i % TOOLS.length]}`,
      started_at: new Date(currentTime).toISOString(),
      ended_at: new Date(currentTime + spanDuration).toISOString(),
      duration_ms: spanDuration,
      status: spanStatus,
      error_message: spanStatus === 'error' ? `Timeout executing ${TOOLS[i % TOOLS.length]}` : null,

      model,
      provider: isLlm ? (model?.includes('claude') ? 'anthropic' : model?.includes('gemini') ? 'google' : 'openai') : null,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_usd: Number(usd.toFixed(5)),
      hallucination_score: hScore,
      faithfulness_score: fScore,

      system_prompt: isLlm ? `You are a specialized ${agent.id} responsible for analyzing user queries, extracting key entities, and producing structured JSON tasks.` : undefined,
      user_prompt: isLlm ? `Perform comprehensive analysis for query: "Evaluate drift in multi-agent autonomous consensus protocols"` : undefined,
      response_text: isLlm ? `{\n  "status": "completed",\n  "findings": ["Sub-agent latencies increased by 18%", "Confidence interval stable at 94.2%"],\n  "next_action": "trigger_eval"\n}` : undefined,

      tool_name: isTool ? TOOLS[i % TOOLS.length] : null,
      autonomous: isTool ? true : null,
      input_json: isTool ? { query: "SELECT * FROM trace_spans WHERE status='error'", max_results: 50 } : undefined,
      output_json: isTool ? { count: 14, latency_p95: 184.2, status: "success" } : undefined,

      attributes: JSON.stringify({ retry_count: 0, environment: "production" }),
    });

    // Make some nodes parent of subsequent nodes to form tree structure
    if (i % 2 === 1) {
      currentParentId = spanId;
    }
    currentTime += spanDuration + 20;
  }

  return spans;
}

// Generate 50 Traces
const MOCK_TRACES_RAW: { summary: TraceSummary; spans: Span[] }[] = Array.from({ length: 50 }, (_, i) => {
  const spans = generateTraceSpans(i);
  const root = spans[0];
  const totalCost = spans.reduce((sum, s) => sum + (s.estimated_usd || 0), 0);
  const totalDuration = spans.reduce((sum, s) => sum + (s.duration_ms || 0), 0);
  const agentIds = Array.from(new Set(spans.map((s) => s.agent_id)));
  const errorCount = spans.filter(s => s.status === 'error').length;
  const maxHallucination = Math.max(...spans.map(s => s.hallucination_score || 0));

  const hasError = spans.some(s => s.status === 'error');
  const hasHallucination = spans.some(s => s.status === 'hallucination');
  const status = hasError ? 'error' : hasHallucination ? 'hallucination' : 'ok';

  return {
    summary: {
      causal_chain_id: root.causal_chain_id,
      started_at: root.started_at,
      ended_at: spans[spans.length - 1].ended_at || root.ended_at || root.started_at,
      span_count: spans.length,
      total_duration_ms: totalDuration,
      total_cost_usd: Number(totalCost.toFixed(5)),
      agent_ids: agentIds,
      error_count: errorCount,
      max_hallucination: Number(maxHallucination.toFixed(2)),
      status,
    },
    spans,
  };
});

export const MOCK_TRACES: TraceSummary[] = MOCK_TRACES_RAW.map(t => t.summary);

export function getMockCausalReplay(chainId: string): CausalGraph | null {
  const found = MOCK_TRACES_RAW.find(t => t.summary.causal_chain_id === chainId) || MOCK_TRACES_RAW[0];
  if (!found) return null;

  // Build tree from flat spans
  const spanMap = new Map<string, Span>();
  found.spans.forEach(s => spanMap.set(s.span_id, { ...s, children: [] }));

  let rootSpan: Span | null = null;
  spanMap.forEach(span => {
    if (!span.parent_span_id || !spanMap.has(span.parent_span_id)) {
      rootSpan = span;
    } else {
      const parent = spanMap.get(span.parent_span_id);
      if (parent) {
        if (!parent.children) parent.children = [];
        parent.children.push(span);
      }
    }
  });

  return {
    causal_chain_id: found.summary.causal_chain_id,
    root: rootSpan || found.spans[0],
    total_spans: found.summary.span_count,
    total_duration_ms: found.summary.total_duration_ms,
    total_cost_usd: found.summary.total_cost_usd,
    agents: found.summary.agent_ids,
    status: found.summary.status,
  };
}

export const MOCK_AGENTS: AgentSummary[] = AGENTS.map((agent, i) => {
  const agentSpans = MOCK_TRACES_RAW.flatMap(t => t.spans).filter(s => s.agent_id === agent.id);
  const totalSpans = agentSpans.length || 85;
  const errorSpans = agentSpans.filter(s => s.status === 'error').length || 4;
  const totalCost = agentSpans.reduce((acc, s) => acc + (s.estimated_usd || 0), 0) || 1.45;
  const avgLatency = Math.round(agentSpans.reduce((acc, s) => acc + s.duration_ms, 0) / totalSpans) || 420;

  return {
    agent_id: agent.id,
    agent_framework: agent.framework,
    service_name: agent.service,
    total_spans: totalSpans,
    error_spans: errorSpans,
    error_rate: Number((errorSpans / totalSpans).toFixed(3)),
    total_cost_usd: Number(totalCost.toFixed(3)),
    avg_latency_ms: avgLatency,
    last_seen: new Date(Date.now() - i * 180000).toISOString(),
    total_chains: Math.floor(totalSpans / 4),
  };
});

export const MOCK_COST_SERIES: CostSummaryItem[] = (() => {
  const items: CostSummaryItem[] = [];
  const now = new Date();

  for (let h = 23; h >= 0; h--) {
    const hourDate = new Date(now.getTime() - h * 3600 * 1000);
    const hourStr = hourDate.toISOString().slice(0, 13) + ':00:00';

    AGENTS.slice(0, 4).forEach((agent, aIdx) => {
      const model = MODELS[aIdx % MODELS.length];
      const calls = Math.floor(12 + pseudoRandom(h * 10 + aIdx) * 45);
      const tokens = calls * Math.floor(400 + pseudoRandom(h + aIdx) * 600);
      const usd = tokens * 0.000006 + pseudoRandom(h) * 0.04;

      items.push({
        agent_id: agent.id,
        model,
        hour: hourStr,
        calls,
        tokens,
        cost_usd: Number(usd.toFixed(4)),
      });
    });
  }
  return items;
})();

export const MOCK_SPANS_PER_MINUTE = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.now() - (29 - i) * 60 * 1000);
  const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  const base = Math.floor(40 + Math.sin(i / 3) * 20 + pseudoRandom(i) * 15);
  return {
    time: timeStr,
    spans: base,
    errors: Math.floor(base * 0.05 * pseudoRandom(i + 10)),
  };
});
