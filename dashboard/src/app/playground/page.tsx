'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Terminal, CheckCircle2, Clock, ArrowRight, Bot, Cpu, Sparkles } from 'lucide-react';
import { runAgentPipeline, PipelineResponse, PipelineStepResult } from '@/lib/api';
import { formatDuration } from '@/lib/utils';

interface AgentCardState {
  name: string;
  model: string;
  role: string;
  status: 'idle' | 'running' | 'done';
}

export default function PlaygroundPage() {
  const [taskPrompt, setTaskPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [pipelineOutput, setPipelineOutput] = useState<PipelineResponse | null>(null);
  const [visibleSteps, setVisibleSteps] = useState<PipelineStepResult[]>([]);

  const [agentCards, setAgentCards] = useState<AgentCardState[]>([
    {
      name: 'Planner',
      model: 'Groq / Llama-3.3-70b',
      role: 'Deconstructs prompt into execution plan & goals',
      status: 'idle',
    },
    {
      name: 'Researcher',
      model: 'Gemini-1.5-Flash',
      role: 'Queries telemetry trace history & computes z-scores',
      status: 'idle',
    },
    {
      name: 'Critic',
      model: 'Mistral-7B-Instruct',
      role: 'Evaluates hallucination risk & faithfulness confidence',
      status: 'idle',
    },
  ]);

  const handleRunPipeline = async () => {
    if (!taskPrompt.trim() || isRunning) return;

    setIsRunning(true);
    setPipelineOutput(null);
    setVisibleSteps([]);

    // Set step 1 (Planner) running
    setAgentCards((prev) => [
      { ...prev[0], status: 'running' },
      { ...prev[1], status: 'idle' },
      { ...prev[2], status: 'idle' },
    ]);

    try {
      const response = await runAgentPipeline(taskPrompt);
      setPipelineOutput(response);

      // Simulate sequential step updates for realistic live streaming
      // Step 1: Planner done -> Researcher running
      await new Promise((r) => setTimeout(r, 600));
      setVisibleSteps([response.steps[0]]);
      setAgentCards((prev) => [
        { ...prev[0], status: 'done' },
        { ...prev[1], status: 'running' },
        { ...prev[2], status: 'idle' },
      ]);

      // Step 2: Researcher done -> Critic running
      await new Promise((r) => setTimeout(r, 800));
      setVisibleSteps([response.steps[0], response.steps[1]]);
      setAgentCards((prev) => [
        { ...prev[0], status: 'done' },
        { ...prev[1], status: 'done' },
        { ...prev[2], status: 'running' },
      ]);

      // Step 3: Critic done -> All complete
      await new Promise((r) => setTimeout(r, 700));
      setVisibleSteps(response.steps);
      setAgentCards((prev) => [
        { ...prev[0], status: 'done' },
        { ...prev[1], status: 'done' },
        { ...prev[2], status: 'done' },
      ]);
    } catch (err) {
      console.error('Failed to run pipeline', err);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="p-8 max-w-7xl mx-auto space-y-8"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Terminal className="w-5 h-5 text-[#6366f1]" />
            <h1 className="text-2xl font-bold tracking-tight text-[#f5f5f5]">Agent Playground</h1>
          </div>
          <p className="text-xs text-[#737373] mt-1">
            Run live multi-agent pipelines and watch spans appear in real time
          </p>
        </div>

        <div className="flex items-center gap-2 bg-[#0f0f0f] border border-[#1a1a1a] px-3 py-1.5 rounded-full text-xs text-[#818cf8] font-mono">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Multi-Agent Orchestrator</span>
        </div>
      </div>

      {/* Input Area */}
      <div className="space-y-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[#737373]">
          Pipeline Task Prompt
        </label>
        <textarea
          rows={4}
          value={taskPrompt}
          onChange={(e) => setTaskPrompt(e.target.value)}
          placeholder="Ask anything — the planner, researcher, and critic agents will handle it..."
          className="w-full bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-4 text-sm text-[#f5f5f5] placeholder-[#404040] focus:outline-none focus:border-[#6366f1] transition-colors resize-none font-mono"
        />
      </div>

      {/* Three Agent Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {agentCards.map((agent, i) => {
          const isCurrentRunning = agent.status === 'running';
          const isDone = agent.status === 'done';

          return (
            <motion.div
              key={agent.name}
              animate={{
                borderColor: isCurrentRunning ? '#6366f1' : '#1a1a1a',
                scale: isCurrentRunning ? 1.01 : 1,
              }}
              transition={{ duration: 0.2 }}
              className={`p-5 rounded-2xl bg-[#0f0f0f] border transition-colors flex flex-col justify-between relative overflow-hidden ${
                isCurrentRunning ? 'shadow-[0_0_15px_rgba(99,102,241,0.15)]' : ''
              }`}
            >
              {/* Subtle pulsing background bar when running */}
              {isCurrentRunning && (
                <div className="absolute top-0 left-0 right-0 h-1 bg-[#6366f1] animate-pulse" />
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm text-[#f5f5f5]">{agent.name}</span>
                  <div className="flex items-center gap-1.5 font-mono text-xs">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isDone
                          ? 'bg-[#10b981]'
                          : isCurrentRunning
                          ? 'bg-[#6366f1] animate-ping'
                          : 'bg-[#404040]'
                      }`}
                    />
                    <span
                      className={
                        isDone
                          ? 'text-[#10b981]'
                          : isCurrentRunning
                          ? 'text-[#6366f1] font-bold'
                          : 'text-[#737373]'
                      }
                    >
                      {agent.status}
                    </span>
                  </div>
                </div>

                <div className="text-xs font-mono text-[#818cf8] mb-2">{agent.model}</div>
                <div className="text-xs text-[#737373]">{agent.role}</div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Run Pipeline Button */}
      <div>
        <button
          onClick={handleRunPipeline}
          disabled={isRunning || !taskPrompt.trim()}
          className={`flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-mono text-xs font-bold uppercase tracking-wider transition-all shadow-lg ${
            isRunning || !taskPrompt.trim()
              ? 'bg-[#141414] text-[#404040] border border-[#1a1a1a] cursor-not-allowed'
              : 'bg-[#6366f1] text-white hover:bg-[#4f46e5] shadow-[#6366f130] cursor-pointer'
          }`}
        >
          <Play className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
          <span>{isRunning ? 'Orchestrating Pipeline...' : 'Run Pipeline'}</span>
        </button>
      </div>

      {/* Live Output Panel (Plan, Research, Critique) */}
      <AnimatePresence>
        {visibleSteps.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.3 }}
            className="space-y-6 pt-4 border-t border-[#1a1a1a]"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#f5f5f5]">Live Telemetry Outputs</h2>
              <span className="text-xs font-mono text-[#737373]">
                {visibleSteps.length} of 3 steps completed
              </span>
            </div>

            <div className="space-y-4">
              {visibleSteps.map((step, idx) => (
                <motion.div
                  key={step.agent_name + idx}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.3 }}
                  className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6 space-y-3"
                >
                  <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-lg bg-[#6366f115] border border-[#6366f130] flex items-center justify-center text-[#6366f1]">
                        <Bot className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-semibold text-sm text-[#f5f5f5]">
                        {step.agent_name} Agent Output
                      </span>
                      <span className="text-xs font-mono text-[#818cf8] px-2 py-0.5 rounded bg-[#141414] border border-[#1a1a1a]">
                        {step.model}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-xs font-mono text-[#737373]">
                      <div className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-[#10b981]" />
                        <span>{formatDuration(step.latency_ms)}</span>
                      </div>
                      <CheckCircle2 className="w-4 h-4 text-[#10b981]" />
                    </div>
                  </div>

                  <div className="font-mono text-xs text-[#f5f5f5] bg-[#141414] p-4 rounded-xl leading-relaxed whitespace-pre-wrap">
                    {step.text}
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Bottom Causal Chain ID Link */}
            {pipelineOutput && visibleSteps.length === 3 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.2 }}
                className="bg-[#0f0f0f] border border-[#6366f140] rounded-2xl p-5 flex items-center justify-between shadow-[0_0_20px_rgba(99,102,241,0.1)]"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-[#6366f115] border border-[#6366f130] flex items-center justify-center text-[#6366f1]">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs text-[#737373] font-mono">Causal Chain Trace Recorded</div>
                    <div className="font-mono text-sm font-bold text-[#6366f1]">
                      {pipelineOutput.causal_chain_id}
                    </div>
                  </div>
                </div>

                <Link
                  href={`/replay/${pipelineOutput.causal_chain_id}`}
                  className="flex items-center gap-2 bg-[#6366f1] text-white px-4 py-2 rounded-xl text-xs font-mono font-medium hover:bg-[#4f46e5] transition-colors shadow-md shadow-[#6366f130]"
                >
                  <span>Inspect Causal Replay Graph</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
