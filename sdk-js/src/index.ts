/**
 * NeuralOps JavaScript/TypeScript SDK
 *
 * Zero-dependency observability for AI agents in Node.js.
 *
 * Usage:
 *   import neuralops from 'neuralops-sdk'
 *
 *   const ctx = neuralops.init({
 *     endpoint: 'https://neuralops-api-cmgf.onrender.com',
 *     service: 'my-agent',
 *   })
 *
 *   const result = await neuralops.traceAsync('plan_step', async (span) => {
 *     const response = await openai.chat.completions.create(...)
 *     span.attributes.model = 'gpt-4o'
 *     return response
 *   })
 */

import { randomUUID } from 'crypto'
import * as https from 'https'
import * as http from 'http'

// ── Types ──────────────────────────────────────────────────────────────────

export type SpanStatus = 'ok' | 'error' | 'timeout' | 'hallucination'

export interface CostAttribution {
  model: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  estimatedUsd: number
  provider: string
}

export interface Span {
  spanId: string
  traceId: string
  parentSpanId?: string
  causalChainId: string
  agentId: string
  agentFramework: string
  serviceName: string
  operationName: string
  startedAt: string
  endedAt?: string
  durationMs?: number
  status: SpanStatus
  errorMessage?: string
  attributes: Record<string, unknown>
  // LLM-specific
  model?: string
  provider?: string
  systemPrompt?: string
  userPrompt?: string
  responseText?: string
  cost?: CostAttribution
  // Tool-specific
  toolName?: string
  toolInput?: Record<string, unknown>
  toolOutput?: unknown
  toolError?: string
}

export interface AgentContext {
  causalChainId: string
  traceId: string
  agentId: string
  agentFramework: string
  serviceName: string
  sessionId: string
  child(agentId: string, framework?: string): AgentContext
  toHeaders(): Record<string, string>
}

export interface InitOptions {
  endpoint?: string
  service?: string
  agentId?: string
  framework?: string
  batchSize?: number
  flushIntervalMs?: number
}

// ── Model pricing (USD per 1M tokens) ─────────────────────────────────────

const MODEL_PRICING: Record<string, { input: number; output: number; provider: string }> = {
  'gpt-4o':              { input: 5.00,  output: 15.00, provider: 'openai' },
  'gpt-4o-mini':         { input: 0.15,  output: 0.60,  provider: 'openai' },
  'gpt-4-turbo':         { input: 10.00, output: 30.00, provider: 'openai' },
  'claude-opus-4-6':     { input: 15.00, output: 75.00, provider: 'anthropic' },
  'claude-sonnet-4-6':   { input: 3.00,  output: 15.00, provider: 'anthropic' },
  'claude-haiku-4-5':    { input: 0.25,  output: 1.25,  provider: 'anthropic' },
  'gemini-1.5-pro':      { input: 3.50,  output: 10.50, provider: 'google' },
  'gemini-1.5-flash':    { input: 0.075, output: 0.30,  provider: 'google' },
  'llama-3-70b':         { input: 0.90,  output: 0.90,  provider: 'meta' },
  'mistral-large':       { input: 4.00,  output: 12.00, provider: 'mistral' },
  'mistral-small':       { input: 1.00,  output: 3.00,  provider: 'mistral' },
}

export function estimateCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
): CostAttribution {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-4o']
  const estimatedUsd =
    (promptTokens * pricing.input) / 1_000_000 +
    (completionTokens * pricing.output) / 1_000_000

  return {
    model,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedUsd: Math.round(estimatedUsd * 1e8) / 1e8,
    provider: pricing.provider,
  }
}

// ── Context ────────────────────────────────────────────────────────────────

function createContext(options: {
  causalChainId?: string
  traceId?: string
  agentId?: string
  agentFramework?: string
  serviceName?: string
  sessionId?: string
}): AgentContext {
  const ctx: AgentContext = {
    causalChainId: options.causalChainId ?? randomUUID(),
    traceId: options.traceId ?? randomUUID(),
    agentId: options.agentId ?? 'unknown',
    agentFramework: options.agentFramework ?? 'unknown',
    serviceName: options.serviceName ?? 'unknown',
    sessionId: options.sessionId ?? randomUUID(),

    child(agentId: string, framework = 'unknown'): AgentContext {
      return createContext({
        causalChainId: ctx.causalChainId, // same chain
        traceId: randomUUID(),
        agentId,
        agentFramework: framework,
        serviceName: ctx.serviceName,
        sessionId: ctx.sessionId,
      })
    },

    toHeaders(): Record<string, string> {
      return {
        'x-neuralops-causal-chain-id': ctx.causalChainId,
        'x-neuralops-trace-id': ctx.traceId,
        'x-neuralops-session-id': ctx.sessionId,
        'x-neuralops-agent-id': ctx.agentId,
      }
    },
  }
  return ctx
}

// ── Exporter ───────────────────────────────────────────────────────────────

class SpanExporter {
  private queue: Span[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly endpoint: string,
    private readonly batchSize: number,
    private readonly flushIntervalMs: number,
  ) {
    this.timer = setInterval(() => this.flush(), flushIntervalMs)
    if (this.timer.unref) this.timer.unref() // don't keep process alive
  }

  enqueue(span: Span): void {
    this.queue.push(span)
    if (this.queue.length >= this.batchSize) {
      this.flush()
    }
  }

  flush(): void {
    if (this.queue.length === 0) return
    const batch = this.queue.splice(0)
    this._send(batch).catch(() => {}) // fire and forget
  }

  private async _send(batch: Span[]): Promise<void> {
    const url = new URL(`${this.endpoint}/v1/ingest`)
    const body = JSON.stringify(batch.map(this._toWire))
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }
    const lib = url.protocol === 'https:' ? https : http
    await new Promise<void>((resolve) => {
      const req = lib.request(options, (res) => {
        res.resume()
        resolve()
      })
      req.on('error', () => resolve())
      req.setTimeout(5000, () => { req.destroy(); resolve() })
      req.write(body)
      req.end()
    })
  }

  private _toWire(span: Span): Record<string, unknown> {
    return {
      span_id: span.spanId,
      trace_id: span.traceId,
      parent_span_id: span.parentSpanId,
      causal_chain_id: span.causalChainId,
      agent_id: span.agentId,
      agent_framework: span.agentFramework,
      service_name: span.serviceName,
      operation_name: span.operationName,
      started_at: span.startedAt,
      ended_at: span.endedAt,
      duration_ms: span.durationMs,
      status: span.status,
      error_message: span.errorMessage,
      model: span.model,
      provider: span.provider,
      user_prompt: span.userPrompt,
      system_prompt: span.systemPrompt,
      response_text: span.responseText,
      cost: span.cost ? {
        model: span.cost.model,
        prompt_tokens: span.cost.promptTokens,
        completion_tokens: span.cost.completionTokens,
        total_tokens: span.cost.totalTokens,
        estimated_usd: span.cost.estimatedUsd,
        provider: span.cost.provider,
      } : undefined,
      tool_name: span.toolName,
      tool_input: span.toolInput,
      tool_output: span.toolOutput,
      tool_error: span.toolError,
      attributes: span.attributes,
    }
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.flush()
  }
}

// ── Global state ───────────────────────────────────────────────────────────

let _exporter: SpanExporter | null = null
let _ctx: AgentContext | null = null

// ── Public API ─────────────────────────────────────────────────────────────

export function init(options: InitOptions = {}): AgentContext {
  const {
    endpoint = 'http://localhost:8000',
    service = 'unknown',
    agentId,
    framework = 'unknown',
    batchSize = 100,
    flushIntervalMs = 2000,
  } = options

  _exporter = new SpanExporter(endpoint, batchSize, flushIntervalMs)
  _ctx = createContext({
    agentId: agentId ?? randomUUID(),
    agentFramework: framework,
    serviceName: service,
  })
  return _ctx
}

export async function traceAsync<T>(
  operationName: string,
  fn: (span: Partial<Span>) => Promise<T>,
): Promise<T> {
  const ctx = _ctx
  const span: Partial<Span> = {
    spanId: randomUUID(),
    traceId: ctx?.traceId ?? randomUUID(),
    causalChainId: ctx?.causalChainId ?? randomUUID(),
    agentId: ctx?.agentId ?? 'unknown',
    agentFramework: ctx?.agentFramework ?? 'unknown',
    serviceName: ctx?.serviceName ?? 'unknown',
    operationName,
    startedAt: new Date().toISOString(),
    status: 'ok',
    attributes: {},
  }
  const t0 = Date.now()
  try {
    const result = await fn(span)
    span.status = 'ok'
    return result
  } catch (err) {
    span.status = 'error'
    span.errorMessage = err instanceof Error ? err.message : String(err)
    throw err
  } finally {
    span.endedAt = new Date().toISOString()
    span.durationMs = Date.now() - t0
    _emit(span as Span)
  }
}

export function traceLlmCall(options: {
  model: string
  systemPrompt?: string
  userPrompt?: string
}): {
  end(responseText: string, usage?: { promptTokens: number; completionTokens: number }): void
  error(message: string): void
  span: Partial<Span>
} {
  const ctx = _ctx
  const span: Partial<Span> = {
    spanId: randomUUID(),
    traceId: ctx?.traceId ?? randomUUID(),
    causalChainId: ctx?.causalChainId ?? randomUUID(),
    agentId: ctx?.agentId ?? 'unknown',
    agentFramework: ctx?.agentFramework ?? 'unknown',
    serviceName: ctx?.serviceName ?? 'unknown',
    operationName: `llm.${options.model}`,
    model: options.model,
    systemPrompt: options.systemPrompt,
    userPrompt: options.userPrompt,
    startedAt: new Date().toISOString(),
    status: 'ok',
    attributes: {},
  }
  const t0 = Date.now()

  return {
    span,
    end(responseText, usage) {
      span.responseText = responseText
      span.endedAt = new Date().toISOString()
      span.durationMs = Date.now() - t0
      span.status = 'ok'
      if (usage) {
        span.cost = estimateCost(options.model, usage.promptTokens, usage.completionTokens)
      }
      _emit(span as Span)
    },
    error(message) {
      span.errorMessage = message
      span.endedAt = new Date().toISOString()
      span.durationMs = Date.now() - t0
      span.status = 'error'
      _emit(span as Span)
    },
  }
}

export function traceToolCall(options: {
  toolName: string
  toolInput?: Record<string, unknown>
}): {
  end(output: unknown): void
  error(message: string): void
} {
  const ctx = _ctx
  const span: Partial<Span> = {
    spanId: randomUUID(),
    traceId: ctx?.traceId ?? randomUUID(),
    causalChainId: ctx?.causalChainId ?? randomUUID(),
    agentId: ctx?.agentId ?? 'unknown',
    agentFramework: ctx?.agentFramework ?? 'unknown',
    serviceName: ctx?.serviceName ?? 'unknown',
    operationName: `tool.${options.toolName}`,
    toolName: options.toolName,
    toolInput: options.toolInput,
    startedAt: new Date().toISOString(),
    status: 'ok',
    attributes: {},
  }
  const t0 = Date.now()

  return {
    end(output) {
      span.toolOutput = output
      span.endedAt = new Date().toISOString()
      span.durationMs = Date.now() - t0
      span.status = 'ok'
      _emit(span as Span)
    },
    error(message) {
      span.toolError = message
      span.errorMessage = message
      span.endedAt = new Date().toISOString()
      span.durationMs = Date.now() - t0
      span.status = 'error'
      _emit(span as Span)
    },
  }
}

function _emit(span: Span): void {
  if (_exporter) {
    try { _exporter.enqueue(span) } catch {}
  }
}

export function flush(): void {
  _exporter?.flush()
}

export function getContext(): AgentContext | null {
  return _ctx
}

const neuralops = {
  init,
  traceAsync,
  traceLlmCall,
  traceToolCall,
  estimateCost,
  flush,
  getContext,
}

export default neuralops
