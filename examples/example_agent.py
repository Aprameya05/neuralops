"""
Example: instrumenting a multi-step agent with NeuralOps SDK.

This shows:
  - init() once at startup
  - @trace on agent functions
  - trace_llm_call for LLM calls with cost tracking
  - trace_tool_call for tool invocations
  - context propagation to a sub-agent

Run this after `docker compose up -d` to see traces in the dashboard.
"""

import asyncio
import os

import httpx

import neuralops

# ── 1. Initialize once at startup ────────────────────────────────────────

ctx = neuralops.init(
    endpoint=os.environ.get("NEURALOPS_ENDPOINT", "http://localhost:8000"),
    service="example-agent",
    agent_id="planner-agent-01",
    framework="custom",
)


# ── 2. Instrument an LLM call ────────────────────────────────────────────

async def call_llm(system: str, user: str, model: str = "gpt-4o-mini") -> str:
    """Wrapper around any LLM — replace with your actual client."""
    async with neuralops.trace_llm_call(model, system_prompt=system, user_prompt=user) as span:
        # Simulate LLM call — replace with real openai/anthropic call
        await asyncio.sleep(0.1)
        response = f"[simulated response to: {user[:50]}]"
        span.response_text = response
        # If you have a real response, pass raw_response to get exact token counts:
        # span.cost = neuralops.estimate_cost(model, raw_response=response.model_dump())
    return response


# ── 3. Instrument a tool call ────────────────────────────────────────────

async def web_search(query: str) -> str:
    """Example tool — web search."""
    async with neuralops.trace_tool_call("web_search", {"query": query}) as span:
        await asyncio.sleep(0.05)  # simulate network call
        result = f"[search results for: {query}]"
        span.tool_output = result
    return result


# ── 4. Instrument the full agent step ────────────────────────────────────

@neuralops.trace("plan_and_execute")
async def plan_and_execute(user_query: str) -> str:
    """Full agent reasoning step — plan, search, answer."""

    # Step 1: Plan
    plan = await call_llm(
        system="You are a planning agent. Break the query into steps.",
        user=user_query,
    )

    # Step 2: Search
    search_results = await web_search(user_query)

    # Step 3: Synthesize
    answer = await call_llm(
        system="You are a synthesis agent. Answer based on the search results.",
        user=f"Query: {user_query}\nSearch results: {search_results}\nPlan: {plan}",
    )

    return answer


# ── 5. Sub-agent with context propagation ────────────────────────────────

@neuralops.trace("sub_agent_verify")
async def verify(answer: str) -> bool:
    """A sub-agent that verifies the main agent's answer."""
    result = await call_llm(
        system="You are a fact-checker. Reply YES if the answer is reasonable, NO otherwise.",
        user=answer,
        model="gpt-4o-mini",
    )
    return "yes" in result.lower()


# ── 6. Main ──────────────────────────────────────────────────────────────

async def main() -> None:
    print(f"NeuralOps SDK initialized. Causal chain: {ctx.causal_chain_id}")
    print("Dashboard: http://localhost:3000\n")

    queries = [
        "What are the latest breakthroughs in quantum computing?",
        "How does transformer attention actually work?",
        "What is the current state of fusion energy research?",
    ]

    for query in queries:
        print(f"Running agent on: {query}")
        answer = await plan_and_execute(query)
        verified = await verify(answer)
        print(f"  Answer: {answer}")
        print(f"  Verified: {verified}\n")

    print(f"\nAll spans sent to NeuralOps.")
    print(f"Replay this session: http://localhost:3000/replay/{ctx.causal_chain_id}")


if __name__ == "__main__":
    asyncio.run(main())
