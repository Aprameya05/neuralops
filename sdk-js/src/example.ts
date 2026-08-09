/**
 * NeuralOps JS SDK — example usage
 *
 * npm install neuralops-sdk
 */

import neuralops, { estimateCost } from 'neuralops-sdk'

async function main() {
  // Initialize once at startup
  const ctx = neuralops.init({
    endpoint: 'https://neuralops-api-cmgf.onrender.com',
    service: 'my-node-agent',
    agentId: 'planner-v1',
    framework: 'custom',
  })

  console.log('Causal chain:', ctx.causalChainId)

  // Trace any async function
  const plan = await neuralops.traceAsync('plan_step', async (span) => {
    span.attributes!.input = 'What is observability?'
    // your code here
    return 'Step 1: Define the problem. Step 2: Instrument. Step 3: Alert.'
  })

  // Trace an LLM call
  const llmTrace = neuralops.traceLlmCall({
    model: 'gpt-4o-mini',
    userPrompt: 'Explain observability in one sentence.',
  })

  try {
    // const response = await openai.chat.completions.create(...)
    const fakeResponse = 'Observability is the ability to understand system state from outputs.'
    llmTrace.end(fakeResponse, { promptTokens: 20, completionTokens: 15 })
  } catch (err) {
    llmTrace.error(String(err))
  }

  // Trace a tool call
  const toolTrace = neuralops.traceToolCall({
    toolName: 'web_search',
    toolInput: { query: 'observability best practices 2026' },
  })
  toolTrace.end(['Result 1', 'Result 2'])

  // Propagate context to sub-agents
  const subCtx = ctx.child('researcher-agent', 'custom')
  console.log('Sub-agent shares chain:', subCtx.causalChainId === ctx.causalChainId)

  // HTTP headers for cross-service propagation
  const headers = ctx.toHeaders()
  console.log('Propagation headers:', headers)

  // Cost estimation
  const cost = estimateCost('gpt-4o', 1200, 340)
  console.log('Estimated cost:', cost.estimatedUsd, 'USD')

  // Flush remaining spans
  neuralops.flush()

  console.log(`\nView replay: https://neuralops.pages.dev/replay/${ctx.causalChainId}`)
}

main().catch(console.error)
