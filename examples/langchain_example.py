"""
Example: NeuralOps + LangChain auto-instrumentation.

Zero code changes to your existing LangChain app.
Just add the callback handler and every LLM call is traced.

Install:
    pip install neuralops-observability langchain-core langchain-openai
"""

import os
import asyncio

import neuralops
from neuralops.integrations.langchain import NeuralOpsCallbackHandler

# Initialize NeuralOps once
ctx = neuralops.init(
    endpoint=os.environ.get("NEURALOPS_ENDPOINT", "http://localhost:8000"),
    service="langchain-app",
    agent_id="langchain-agent",
    framework="langchain",
)

handler = NeuralOpsCallbackHandler(ctx)

# ── Example 1: Simple LLM call ────────────────────────────────────────────

def example_simple_llm():
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import HumanMessage

    llm = ChatOpenAI(model="gpt-4o-mini")

    # Just add callbacks=[handler] — that's it
    response = llm.invoke(
        [HumanMessage(content="What is observability in 2 sentences?")],
        config={"callbacks": [handler]},
    )
    print(response.content)


# ── Example 2: Chain ──────────────────────────────────────────────────────

def example_chain():
    from langchain_openai import ChatOpenAI
    from langchain_core.prompts import ChatPromptTemplate

    prompt = ChatPromptTemplate.from_template("Answer concisely: {question}")
    llm = ChatOpenAI(model="gpt-4o-mini")
    chain = prompt | llm

    response = chain.invoke(
        {"question": "What is the CAP theorem?"},
        config={"callbacks": [handler]},
    )
    print(response.content)
    print(f"\nReplay: http://localhost:3000/replay/{ctx.causal_chain_id}")


if __name__ == "__main__":
    print("Running LangChain examples with NeuralOps instrumentation...")
    example_simple_llm()
    example_chain()
