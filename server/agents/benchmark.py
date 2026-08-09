"""
NeuralOps Benchmark Arena.

Runs the same prompt across ALL free providers simultaneously,
then scores each response using the CriticAgent.

Output: ranked leaderboard with cost, latency, quality scores.
This is the killer feature — nobody else ships this open source.
"""

from __future__ import annotations

import asyncio
import os
import time
from dataclasses import dataclass, field

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import structlog

import neuralops
from neuralops import router
from neuralops.router import Provider, ProviderConfig, PROVIDERS

log = structlog.get_logger(__name__)


@dataclass
class ProviderResult:
    provider: Provider
    model: str
    content: str
    latency_ms: float
    prompt_tokens: int
    completion_tokens: int
    estimated_usd: float
    error: str | None = None
    quality_score: float | None = None  # filled by critic
    accuracy: float | None = None
    clarity: float | None = None
    completeness: float | None = None


@dataclass
class BenchmarkResult:
    prompt: str
    system: str
    results: list[ProviderResult]
    winner: Provider | None
    total_duration_ms: float

    def leaderboard(self) -> list[ProviderResult]:
        """Rank by quality score desc, then latency asc."""
        successful = [r for r in self.results if r.error is None]
        return sorted(
            successful,
            key=lambda r: (-(r.quality_score or 0), r.latency_ms),
        )

    def summary(self) -> str:
        lines = [f"Benchmark: {self.prompt[:80]}\n"]
        lines.append(f"{'Provider':<14} {'Model':<38} {'Quality':>8} {'Latency':>10} {'Cost':>10}")
        lines.append("-" * 84)
        for r in self.leaderboard():
            lines.append(
                f"{r.provider:<14} {r.model:<38} "
                f"{r.quality_score or 0:>7.1f}/10 "
                f"{r.latency_ms:>8.0f}ms "
                f"{'FREE':>10}"
            )
        if self.winner:
            lines.append(f"\nWinner: {self.winner}")
        return "\n".join(lines)


class BenchmarkArena:
    """
    Run the same prompt across all providers in parallel.

    Usage:
        arena = BenchmarkArena()
        result = await arena.run(
            prompt="Explain transformer attention in 3 sentences.",
            system="You are a concise technical writer.",
        )
        print(result.summary())
    """

    CRITIC_SYSTEM = """You are a strict evaluator. Score the response on:
ACCURACY: <0-10> — factual correctness
CLARITY: <0-10> — ease of understanding  
COMPLETENESS: <0-10> — fully addresses the question
OVERALL: <average>
Respond only in this format. No extra text."""

    def __init__(self) -> None:
        self._ctx = neuralops.init(
            endpoint=os.environ.get("NEURALOPS_ENDPOINT", "http://localhost:8000"),
            service="benchmark-arena",
            agent_id="arena-orchestrator",
            framework="neuralops-native",
        )

    async def run(
        self,
        prompt: str,
        system: str = "You are a helpful, concise assistant.",
        max_tokens: int = 512,
        temperature: float = 0.7,
    ) -> BenchmarkResult:
        """Run all providers in parallel, then score all responses."""
        t0 = time.perf_counter()

        log.info("arena.start", prompt=prompt[:60], providers=len(PROVIDERS))

        # Run all providers simultaneously
        tasks = [
            self._call_provider(config, prompt, system, max_tokens, temperature)
            for config in PROVIDERS
        ]
        results: list[ProviderResult] = await asyncio.gather(*tasks)

        # Score all successful responses using Groq as judge (fast + free)
        successful = [r for r in results if r.error is None]
        score_tasks = [self._score(prompt, r) for r in successful]
        await asyncio.gather(*score_tasks)

        total_ms = (time.perf_counter() - t0) * 1000

        # Pick winner
        ranked = sorted(
            successful,
            key=lambda r: (-(r.quality_score or 0), r.latency_ms),
        )
        winner = ranked[0].provider if ranked else None

        result = BenchmarkResult(
            prompt=prompt,
            system=system,
            results=results,
            winner=winner,
            total_duration_ms=total_ms,
        )

        log.info(
            "arena.complete",
            winner=winner,
            providers_succeeded=len(successful),
            total_ms=round(total_ms, 1),
        )
        return result

    async def _call_provider(
        self,
        config: ProviderConfig,
        prompt: str,
        system: str,
        max_tokens: int,
        temperature: float,
    ) -> ProviderResult:
        api_key = os.environ.get(config.api_key_env, "")
        if not api_key:
            return ProviderResult(
                provider=config.name,
                model=config.model,
                content="",
                latency_ms=0,
                prompt_tokens=0,
                completion_tokens=0,
                estimated_usd=0.0,
                error="No API key configured",
            )

        try:
            async with neuralops.trace_llm_call(
                config.model,
                system_prompt=system,
                user_prompt=prompt,
            ) as span:
                response = await router._call_provider(
                    config=config,
                    messages=[
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    max_tokens=max_tokens,
                    temperature=temperature,
                    api_key=api_key,
                )
                span.response_text = response.content
                span.attributes["arena"] = True
                span.attributes["provider"] = response.provider

            return ProviderResult(
                provider=config.name,
                model=config.model,
                content=response.content,
                latency_ms=response.latency_ms,
                prompt_tokens=response.prompt_tokens,
                completion_tokens=response.completion_tokens,
                estimated_usd=0.0,  # all free
            )

        except Exception as exc:
            log.warning("arena.provider_failed", provider=config.name, error=str(exc))
            return ProviderResult(
                provider=config.name,
                model=config.model,
                content="",
                latency_ms=0,
                prompt_tokens=0,
                completion_tokens=0,
                estimated_usd=0.0,
                error=str(exc),
            )

    async def _score(self, prompt: str, result: ProviderResult) -> None:
        """Score a provider's response using the router's judge."""
        judge_prompt = (
            f"Original question: {prompt}\n\n"
            f"Response to evaluate:\n{result.content[:1000]}"
        )
        try:
            judge_response = await router.chat(
                messages=[{"role": "user", "content": judge_prompt}],
                system=self.CRITIC_SYSTEM,
                max_tokens=128,
                temperature=0.1,
                preferred_provider=Provider.GROQ,
            )
            scores = _parse_scores(judge_response.content)
            result.accuracy     = scores.get("accuracy")
            result.clarity      = scores.get("clarity")
            result.completeness = scores.get("completeness")
            result.quality_score = scores.get("overall")
        except Exception as exc:
            log.warning("arena.scoring_failed", provider=result.provider, error=str(exc))
            result.quality_score = 5.0  # neutral fallback


def _parse_scores(text: str) -> dict[str, float]:
    """Parse score lines from critic output."""
    scores: dict[str, float] = {}
    for line in text.upper().splitlines():
        for key in ("ACCURACY", "CLARITY", "COMPLETENESS", "OVERALL"):
            if line.startswith(key):
                try:
                    num = float(line.split(":")[1].strip().split("/")[0].split()[0])
                    scores[key.lower()] = min(10.0, max(0.0, num))
                except Exception:
                    pass
    return scores


# ── CLI entrypoint ────────────────────────────────────────────────────────

async def main() -> None:
    import sys
    prompt = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else (
        "Explain how transformer self-attention works in exactly 3 sentences."
    )

    arena = BenchmarkArena()
    result = await arena.run(prompt)
    print("\n" + result.summary())
    print(f"\nFull results saved to dashboard causal chain: {arena._ctx.causal_chain_id}")


if __name__ == "__main__":
    asyncio.run(main())
