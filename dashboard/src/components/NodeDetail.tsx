'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Cpu, Wrench, Activity, AlertCircle, Copy, Check } from 'lucide-react';
import { Span } from '@/lib/types';
import { formatCost, formatDuration, formatJsonSyntax, copyToClipboard } from '@/lib/utils';

interface NodeDetailProps {
  span: Span | null;
}

export default function NodeDetail({ span }: NodeDetailProps) {
  const [openPrompt, setOpenPrompt] = useState<string | null>('response');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!span) {
    return (
      <div className="h-full flex items-center justify-center p-12 text-[#737373] text-sm font-mono bg-[#080808]">
        Select a causal node from the tree on the left to inspect detailed traces.
      </div>
    );
  }

  const isLlm = Boolean(span.model || span.operation_name.includes('llm') || span.operation_name.includes('generate'));
  const isTool = Boolean(span.tool_name || span.operation_name.includes('tool'));

  const toggleSection = (section: string) => {
    setOpenPrompt((prev) => (prev === section ? null : section));
  };

  const handleCopyText = async (text: string, field: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={span.span_id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
        className="p-6 space-y-6 overflow-y-auto max-h-[calc(100vh-140px)] bg-[#080808]"
      >
        {/* Top Header Badge & Operation Title */}
        <div className="flex items-start justify-between border-b border-[#1a1a1a] pb-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                  isLlm
                    ? 'bg-[#6366f115] text-[#818cf8] border-[#6366f130]'
                    : isTool
                    ? 'bg-[#8b5cf615] text-[#c084fc] border-[#8b5cf630]'
                    : 'bg-[#141414] text-[#737373] border-[#1a1a1a]'
                }`}
              >
                {isLlm ? <Cpu className="w-3.5 h-3.5" /> : isTool ? <Wrench className="w-3.5 h-3.5" /> : <Activity className="w-3.5 h-3.5" />}
                {isLlm ? 'LLM Span' : isTool ? 'Tool Span' : 'Agent Step'}
              </span>
              <span className="font-mono text-xs text-[#737373]">ID: {span.span_id}</span>
            </div>
            <h2 className="text-lg font-bold text-[#f5f5f5] tracking-tight">{span.operation_name}</h2>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                span.status === 'error'
                  ? 'bg-[#ef4444]'
                  : span.status === 'hallucination'
                  ? 'bg-[#f59e0b]'
                  : 'bg-[#10b981]'
              }`}
            />
            <span className="text-xs uppercase font-mono tracking-wider font-semibold text-[#f5f5f5]">
              {span.status}
            </span>
          </div>
        </div>

        {/* Error Callout Banner if present */}
        {span.error_message && (
          <div className="p-4 rounded-xl bg-[#ef444410] border border-[#ef444430] flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#ef4444] flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-[#ef4444] uppercase tracking-wider">Span Failure Exception</div>
              <div className="text-xs font-mono text-[#f5f5f5] mt-1">{span.error_message}</div>
            </div>
          </div>
        )}

        {/* Key-Value Metadata Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-2xl bg-[#0f0f0f] border border-[#1a1a1a]">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#737373]">Agent ID</div>
            <div className="text-xs font-mono text-[#f5f5f5] mt-1">{span.agent_id}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#737373]">Service</div>
            <div className="text-xs font-mono text-[#f5f5f5] mt-1">{span.service_name}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#737373]">Duration</div>
            <div className="text-xs font-mono text-[#f5f5f5] mt-1">{formatDuration(span.duration_ms)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-[#737373]">Cost</div>
            <div className="text-xs font-mono text-[#10b981] mt-1">{formatCost(span.estimated_usd)}</div>
          </div>

          {isLlm && (
            <>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#737373]">Model</div>
                <div className="text-xs font-mono text-[#818cf8] mt-1">{span.model || 'gpt-4o'}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#737373]">Tokens (P / C)</div>
                <div className="text-xs font-mono text-[#f5f5f5] mt-1">
                  {span.prompt_tokens || 0} / {span.completion_tokens || 0}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#737373]">Provider</div>
                <div className="text-xs font-mono text-[#f5f5f5] mt-1">{span.provider || 'openai'}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wider text-[#737373]">Total Tokens</div>
                <div className="text-xs font-mono text-[#f5f5f5] mt-1">{span.total_tokens || 0}</div>
              </div>
            </>
          )}
        </div>

        {/* LLM Scores Progress Bars */}
        {isLlm && (span.hallucination_score != null || span.faithfulness_score != null) && (
          <div className="p-4 rounded-2xl bg-[#0f0f0f] border border-[#1a1a1a] space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#737373]">LLM Eval Scores</h3>

            {span.hallucination_score != null && (
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-[#737373]">Hallucination Risk</span>
                  <span className={span.hallucination_score > 0.5 ? 'text-[#ef4444]' : 'text-[#10b981]'}>
                    {(span.hallucination_score * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-[#141414] rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      span.hallucination_score > 0.5 ? 'bg-[#ef4444]' : 'bg-[#10b981]'
                    }`}
                    style={{ width: `${Math.min(span.hallucination_score * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}

            {span.faithfulness_score != null && (
              <div>
                <div className="flex justify-between text-xs font-mono mb-1.5">
                  <span className="text-[#737373]">Faithfulness Score</span>
                  <span className={span.faithfulness_score < 0.6 ? 'text-[#f59e0b]' : 'text-[#10b981]'}>
                    {(span.faithfulness_score * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1.5 w-full bg-[#141414] rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      span.faithfulness_score < 0.6 ? 'bg-[#f59e0b]' : 'bg-[#10b981]'
                    }`}
                    style={{ width: `${Math.min(span.faithfulness_score * 100, 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* LLM Prompts Collapsible Sections */}
        {isLlm && (
          <div className="space-y-3">
            {/* System Prompt */}
            {span.system_prompt && (
              <div className="border border-[#1a1a1a] rounded-2xl overflow-hidden bg-[#0f0f0f]">
                <button
                  onClick={() => toggleSection('system')}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-[#f5f5f5] hover:bg-[#141414] transition-colors"
                >
                  <span>System Prompt</span>
                  {openPrompt === 'system' ? <ChevronDown className="w-4 h-4 text-[#737373]" /> : <ChevronRight className="w-4 h-4 text-[#737373]" />}
                </button>
                {openPrompt === 'system' && (
                  <div className="p-4 bg-[#141414] border-t border-[#1a1a1a] font-mono text-xs text-[#f5f5f5] whitespace-pre-wrap">
                    {span.system_prompt}
                  </div>
                )}
              </div>
            )}

            {/* User Prompt */}
            {span.user_prompt && (
              <div className="border border-[#1a1a1a] rounded-2xl overflow-hidden bg-[#0f0f0f]">
                <button
                  onClick={() => toggleSection('user')}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-semibold text-[#f5f5f5] hover:bg-[#141414] transition-colors"
                >
                  <span>User Prompt</span>
                  {openPrompt === 'user' ? <ChevronDown className="w-4 h-4 text-[#737373]" /> : <ChevronRight className="w-4 h-4 text-[#737373]" />}
                </button>
                {openPrompt === 'user' && (
                  <div className="p-4 bg-[#141414] border-t border-[#1a1a1a] font-mono text-xs text-[#f5f5f5] whitespace-pre-wrap">
                    {span.user_prompt}
                  </div>
                )}
              </div>
            )}

            {/* Response */}
            {span.response_text && (
              <div className="border border-[#1a1a1a] rounded-2xl overflow-hidden bg-[#0f0f0f]">
                <div className="px-4 py-3 flex items-center justify-between text-xs font-semibold text-[#f5f5f5] border-b border-[#1a1a1a]">
                  <button onClick={() => toggleSection('response')} className="flex items-center gap-2">
                    <span>LLM Output Response</span>
                    {openPrompt === 'response' ? <ChevronDown className="w-4 h-4 text-[#737373]" /> : <ChevronRight className="w-4 h-4 text-[#737373]" />}
                  </button>
                  <button
                    onClick={() => handleCopyText(span.response_text!, 'response')}
                    className="text-[#737373] hover:text-white transition-colors"
                  >
                    {copiedField === 'response' ? <Check className="w-3.5 h-3.5 text-[#10b981]" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
                {openPrompt === 'response' && (
                  <div className="p-4 bg-[#141414] font-mono text-xs text-[#10b981] whitespace-pre-wrap leading-relaxed">
                    {span.response_text}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tool Input / Output Syntax Highlighted JSON Viewer */}
        {isTool && (
          <div className="space-y-4">
            {span.input_json && (
              <div className="border border-[#1a1a1a] rounded-2xl overflow-hidden bg-[#0f0f0f]">
                <div className="px-4 py-2.5 bg-[#141414] border-b border-[#1a1a1a] text-xs font-semibold text-[#737373] uppercase tracking-wider">
                  Tool Input Arguments
                </div>
                <div className="p-4 bg-[#080808]">
                  {formatJsonSyntax(span.input_json)}
                </div>
              </div>
            )}

            {span.output_json && (
              <div className="border border-[#1a1a1a] rounded-2xl overflow-hidden bg-[#0f0f0f]">
                <div className="px-4 py-2.5 bg-[#141414] border-b border-[#1a1a1a] text-xs font-semibold text-[#737373] uppercase tracking-wider">
                  Tool Output Result
                </div>
                <div className="p-4 bg-[#080808]">
                  {formatJsonSyntax(span.output_json)}
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
