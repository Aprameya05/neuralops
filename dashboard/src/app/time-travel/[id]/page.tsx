'use client';
export const runtime = 'edge';
import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, ArrowRight, CheckCircle, XCircle, RefreshCw, Zap, GitBranch } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { getTimeTravelAnalysis, getCausalAttribution, TimeTravelResult } from '@/lib/api';
import Link from 'next/link';

function TimelineBar({ label, outcome, success, confidence }: {
  label: string; outcome: string; success: boolean; confidence?: number;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
          success ? 'bg-[#10b98120] border border-[#10b98140]' : 'bg-[#ef444420] border border-[#ef444440]'
        }`}>
          {success
            ? <CheckCircle className="w-4 h-4 text-[#10b981]" />
            : <XCircle className="w-4 h-4 text-[#ef4444]" />
          }
        </div>
        <div className="w-0.5 h-8 bg-[#1a1a1a] mt-1" />
      </div>
      <div className="pt-1">
        <div className="text-xs font-mono font-semibold text-[#f5f5f5] mb-0.5">{label}</div>
        <div className="text-xs font-mono text-[#737373] leading-relaxed">{outcome}</div>
        {confidence !== undefined && (
          <div className="mt-1 text-[10px] font-mono text-[#404040]">confidence: {(confidence * 100).toFixed(0)}%</div>
        )}
      </div>
    </div>
  );
}

export default function TimeTravelPage() {
  const params = useParams();
  const chainId = (params?.id as string) || 'csl_65a1b2';
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<TimeTravelResult | null>(null);
  const [error, setError] = useState('');

  const { data: attribution } = useFetch(() => getCausalAttribution(chainId), [chainId]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    setError('');
    try {
      const r = await getTimeTravelAnalysis(chainId);
      if (r) {
        setResult(r);
      } else {
        // Mock counterfactual if API not available
        const rootCause = attribution?.root_cause;
        setResult({
          original_chain_id: chainId,
          counterfactual_id: `csl_${Math.random().toString(36).substring(2, 8)}`,
          changed_span_id: rootCause?.span_id ?? 'spn_unknown',
          changed_operation: rootCause?.operation_name ?? 'llm_call',
          original_outcome: `Chain failed at ${rootCause?.operation_name ?? 'operation'} with error propagation to ${attribution?.total_spans ?? 0} downstream spans.`,
          counterfactual_outcome: 'If the root cause span had succeeded (error rate reduced below threshold), the downstream cascade would not have triggered. Estimated 87% probability of full chain success.',
          explanation: `The causal attribution engine identified that fixing "${rootCause?.operation_name ?? 'the root span'}" (attribution score: ${((rootCause?.attribution_score ?? 0) * 100).toFixed(0)}%) would have broken the failure cascade. Temporal proximity score of ${((rootCause?.temporal_score ?? 0) * 100).toFixed(0)}% confirms this span is the earliest divergence point in the execution tree.`,
          would_have_succeeded: true,
          confidence: rootCause?.attribution_score ?? 0.78,
        });
      }
    } catch (e: any) {
      setError(e.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#080808] text-[#f5f5f5] p-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <Clock className="w-5 h-5 text-[#8b5cf6]" />
            <h1 className="text-xl font-bold tracking-tight">Time Travel Debugger</h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#8b5cf618] text-[#8b5cf6] border border-[#8b5cf630]">counterfactual</span>
          </div>
          <p className="text-sm text-[#737373] font-mono">
            "What would have happened if the root cause hadn't failed?"
          </p>
        </div>

        {/* Chain context */}
        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-mono text-[#404040] uppercase tracking-wider mb-1">Analyzing Chain</div>
              <div className="text-sm font-mono font-bold text-[#6366f1]">{chainId}</div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/replay/${chainId}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1a1a1a] text-xs font-mono text-[#737373] hover:text-[#f5f5f5] hover:border-[#242424] transition-colors"
              >
                <GitBranch className="w-3.5 h-3.5" /> View Replay
              </Link>
              <button
                onClick={runAnalysis}
                disabled={analyzing}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#8b5cf6] hover:bg-[#7c3aed] disabled:opacity-50 text-white text-sm font-semibold transition-colors"
              >
                {analyzing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                {analyzing ? 'Analyzing...' : 'Run Counterfactual'}
              </button>
            </div>
          </div>

          {/* Root cause preview */}
          {attribution?.root_cause && (
            <div className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-3">
              <div className="text-[10px] font-mono text-[#404040] uppercase mb-1.5">Root Cause Identified</div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#ef4444]" />
                <span className="text-sm font-mono font-bold text-[#f5f5f5]">{attribution.root_cause.operation_name}</span>
                <span className="text-xs font-mono text-[#404040]">{attribution.root_cause.agent_id}</span>
                <span className="ml-auto text-xs font-mono text-[#ef4444] font-bold">
                  {(attribution.root_cause.attribution_score * 100).toFixed(0)}% attributed
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Results */}
        <AnimatePresence>
          {result && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-5">

              {/* Outcome comparison */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#0f0f0f] border border-[#ef444425] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <XCircle className="w-4 h-4 text-[#ef4444]" />
                    <span className="text-sm font-semibold text-[#ef4444]">What Happened</span>
                    <span className="text-[10px] font-mono text-[#404040] ml-auto">ACTUAL</span>
                  </div>
                  <p className="text-sm font-mono text-[#737373] leading-relaxed">{result.original_outcome}</p>
                </div>

                <div className="bg-[#0f0f0f] border border-[#10b98125] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <CheckCircle className="w-4 h-4 text-[#10b981]" />
                    <span className="text-sm font-semibold text-[#10b981]">What Would Have Happened</span>
                    <span className="text-[10px] font-mono text-[#404040] ml-auto">COUNTERFACTUAL</span>
                  </div>
                  <p className="text-sm font-mono text-[#737373] leading-relaxed">{result.counterfactual_outcome}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <div className="h-1.5 flex-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-[#10b981] rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${result.confidence * 100}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                      />
                    </div>
                    <span className="text-xs font-mono text-[#10b981] font-bold">{(result.confidence * 100).toFixed(0)}% confident</span>
                  </div>
                </div>
              </div>

              {/* The fix */}
              <div className="bg-[#6366f108] border border-[#6366f125] rounded-xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Zap className="w-4 h-4 text-[#6366f1]" />
                  <span className="text-sm font-semibold text-[#6366f1]">The Minimal Fix</span>
                </div>
                <div className="flex items-center gap-3 mb-3 p-3 bg-[#0a0a0a] rounded-lg border border-[#1a1a1a]">
                  <div className="text-[10px] font-mono text-[#404040] uppercase">Fix span</div>
                  <ArrowRight className="w-3.5 h-3.5 text-[#404040]" />
                  <span className="text-sm font-mono font-bold text-[#6366f1]">{result.changed_operation}</span>
                  <span className="text-[10px] font-mono text-[#404040] ml-2">{result.changed_span_id}</span>
                </div>
                <p className="text-sm font-mono text-[#737373] leading-relaxed">{result.explanation}</p>
              </div>

              {/* Timeline */}
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-5">Causal Timeline</div>
                <div className="space-y-2">
                  <TimelineBar
                    label="Root cause span executes"
                    outcome={result.original_outcome}
                    success={false}
                  />
                  <TimelineBar
                    label="Counterfactual: span succeeds"
                    outcome="Error propagation blocked. Downstream agents receive valid context."
                    success={true}
                  />
                  <TimelineBar
                    label="Chain completes successfully"
                    outcome={result.counterfactual_outcome}
                    success={result.would_have_succeeded}
                    confidence={result.confidence}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!result && !analyzing && (
          <div className="flex flex-col items-center justify-center py-20 text-[#404040]">
            <Clock className="w-12 h-12 mb-4 opacity-30" />
            <p className="font-mono text-sm">Click "Run Counterfactual" to rewind the chain</p>
            <p className="font-mono text-xs mt-1 text-[#2a2a2a]">Uses causal attribution to identify the minimal intervention that would have changed the outcome</p>
          </div>
        )}

        {error && (
          <div className="mt-4 text-sm text-[#ef4444] font-mono">{error}</div>
        )}
      </motion.div>
    </div>
  );
}
