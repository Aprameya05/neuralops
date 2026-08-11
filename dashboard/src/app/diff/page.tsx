'use client';
export const runtime = 'edge';
import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GitCompare, ArrowRight, TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle, RefreshCw, GitBranch } from 'lucide-react';
import { getTraceDiff, getTraces, TraceDiffReport } from '@/lib/api';
import { formatDuration } from '@/lib/utils';

function DivergenceGauge({ score }: { score: number }) {
  const pct = Math.min(score * 100, 100);
  const color = score > 0.6 ? '#ef4444' : score > 0.3 ? '#f59e0b' : '#10b981';
  const label = score > 0.6 ? 'High Divergence' : score > 0.3 ? 'Moderate' : 'Similar';

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#1a1a1a" strokeWidth="8" />
          <motion.circle
            cx="50" cy="50" r="40" fill="none"
            stroke={color} strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 40}`}
            initial={{ strokeDashoffset: 2 * Math.PI * 40 }}
            animate={{ strokeDashoffset: 2 * Math.PI * 40 * (1 - pct / 100) }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold font-mono" style={{ color }}>{pct.toFixed(0)}</span>
          <span className="text-[9px] text-[#404040] font-mono">/ 100</span>
        </div>
      </div>
      <span className="text-xs font-mono font-semibold" style={{ color }}>{label}</span>
    </div>
  );
}

function OpRow({ op, idx }: { op: TraceDiffReport['operations'][0]; idx: number }) {
  const delta = op.delta_ms ?? 0;
  const maxBar = 2000;
  const barA = Math.min(((op.latency_a_ms ?? 0) / maxBar) * 100, 100);
  const barB = Math.min(((op.latency_b_ms ?? 0) / maxBar) * 100, 100);

  return (
    <motion.tr
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.03 }}
      className={`border-b border-[#111] ${!op.in_a ? 'bg-[#10b98108]' : !op.in_b ? 'bg-[#ef444408]' : ''}`}
    >
      {/* Status */}
      <td className="px-3 py-2 w-6">
        {!op.in_a ? (
          <div className="w-2 h-2 rounded-full bg-[#10b981]" title="Only in B" />
        ) : !op.in_b ? (
          <div className="w-2 h-2 rounded-full bg-[#ef4444]" title="Only in A" />
        ) : op.status_changed ? (
          <div className="w-2 h-2 rounded-full bg-[#f59e0b]" title="Status changed" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-[#1a1a1a]" />
        )}
      </td>
      {/* Operation */}
      <td className="px-3 py-2 text-xs font-mono text-[#f5f5f5] max-w-[160px] truncate">{op.operation_name}</td>
      {/* Chain A latency */}
      <td className="px-3 py-2 w-40">
        {op.in_a ? (
          <div className="space-y-1">
            <div className="h-1.5 bg-[#1a1a1a] rounded overflow-hidden">
              <div className="h-full bg-[#6366f1] rounded" style={{ width: `${barA}%` }} />
            </div>
            <span className="text-[10px] font-mono text-[#737373]">{op.latency_a_ms?.toFixed(0)}ms</span>
          </div>
        ) : <span className="text-[10px] font-mono text-[#404040]">—</span>}
      </td>
      {/* Chain B latency */}
      <td className="px-3 py-2 w-40">
        {op.in_b ? (
          <div className="space-y-1">
            <div className="h-1.5 bg-[#1a1a1a] rounded overflow-hidden">
              <div className="h-full bg-[#8b5cf6] rounded" style={{ width: `${barB}%` }} />
            </div>
            <span className="text-[10px] font-mono text-[#737373]">{op.latency_b_ms?.toFixed(0)}ms</span>
          </div>
        ) : <span className="text-[10px] font-mono text-[#404040]">—</span>}
      </td>
      {/* Delta */}
      <td className="px-3 py-2 w-28">
        {op.in_a && op.in_b ? (
          <div className="flex items-center gap-1">
            {delta > 0 ? (
              <TrendingUp className="w-3 h-3 text-[#ef4444] flex-shrink-0" />
            ) : delta < 0 ? (
              <TrendingDown className="w-3 h-3 text-[#10b981] flex-shrink-0" />
            ) : (
              <Minus className="w-3 h-3 text-[#404040] flex-shrink-0" />
            )}
            <span className={`text-[11px] font-mono font-semibold ${
              delta > 50 ? 'text-[#ef4444]' : delta < -50 ? 'text-[#10b981]' : 'text-[#737373]'
            }`}>
              {delta > 0 ? '+' : ''}{delta.toFixed(0)}ms
            </span>
          </div>
        ) : null}
      </td>
      {/* Status change */}
      <td className="px-3 py-2 w-40">
        {op.status_changed ? (
          <div className="flex items-center gap-1 text-[10px] font-mono">
            <span className={`px-1.5 py-0.5 rounded ${op.status_a === 'error' ? 'bg-[#ef444420] text-[#ef4444]' : 'bg-[#10b98120] text-[#10b981]'}`}>
              {op.status_a}
            </span>
            <ArrowRight className="w-3 h-3 text-[#404040]" />
            <span className={`px-1.5 py-0.5 rounded ${op.status_b === 'error' ? 'bg-[#ef444420] text-[#ef4444]' : 'bg-[#10b98120] text-[#10b981]'}`}>
              {op.status_b}
            </span>
          </div>
        ) : op.in_a && op.in_b ? (
          <span className="text-[10px] font-mono text-[#404040]">unchanged</span>
        ) : null}
      </td>
    </motion.tr>
  );
}

export default function DiffPage() {
  const [chainA, setChainA] = useState('');
  const [chainB, setChainB] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<TraceDiffReport | null>(null);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<{ id: string; status: string }[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const loadSuggestions = async () => {
    try {
      const traces = await getTraces({ limit: 10 });
      setSuggestions(traces.map(t => ({ id: t.causal_chain_id, status: t.status })));
      setShowSuggestions(true);
    } catch {}
  };

  const runDiff = useCallback(async () => {
    if (!chainA.trim() || !chainB.trim()) { setError('Enter both chain IDs'); return; }
    setError('');
    setLoading(true);
    try {
      const result = await getTraceDiff(chainA.trim(), chainB.trim());
      if (!result) throw new Error('No diff returned');
      setReport(result);
    } catch (e: any) {
      setError(e.message || 'Diff failed');
    } finally {
      setLoading(false);
    }
  }, [chainA, chainB]);

  const onlyA = report?.operations.filter(o => o.in_a && !o.in_b) ?? [];
  const onlyB = report?.operations.filter(o => !o.in_a && o.in_b) ?? [];
  const common = report?.operations.filter(o => o.in_a && o.in_b) ?? [];
  const changed = common.filter(o => o.status_changed || Math.abs(o.delta_ms ?? 0) > 100);

  return (
    <div className="min-h-screen bg-[#080808] text-[#f5f5f5] p-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <GitCompare className="w-5 h-5 text-[#6366f1]" />
            <h1 className="text-xl font-bold tracking-tight">Trace Diff</h1>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-[#6366f118] text-[#6366f1] border border-[#6366f130]">beta</span>
          </div>
          <p className="text-sm text-[#737373] font-mono">Structural comparison between two agent execution chains</p>
        </div>

        {/* Input section */}
        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-5 mb-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] font-mono text-[#737373] uppercase tracking-wider block mb-1.5">Chain A</label>
              <input
                value={chainA}
                onChange={e => setChainA(e.target.value)}
                onFocus={loadSuggestions}
                placeholder="csl_abc123"
                className="w-full bg-[#141414] border border-[#242424] rounded-lg px-3 py-2 text-sm font-mono text-[#f5f5f5] placeholder-[#404040] focus:outline-none focus:border-[#6366f1] transition-colors"
              />
            </div>
            <div className="flex items-end pb-0.5">
              <ArrowRight className="w-5 h-5 text-[#404040]" />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-[10px] font-mono text-[#737373] uppercase tracking-wider block mb-1.5">Chain B</label>
              <input
                value={chainB}
                onChange={e => setChainB(e.target.value)}
                placeholder="csl_xyz789"
                className="w-full bg-[#141414] border border-[#242424] rounded-lg px-3 py-2 text-sm font-mono text-[#f5f5f5] placeholder-[#404040] focus:outline-none focus:border-[#6366f1] transition-colors"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={runDiff}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#6366f1] hover:bg-[#5254cc] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
              >
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <GitCompare className="w-4 h-4" />}
                {loading ? 'Diffing...' : 'Run Diff'}
              </button>
            </div>
          </div>

          {/* Quick-select suggestions */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#1a1a1a]">
              <span className="text-[10px] font-mono text-[#404040] uppercase tracking-wider mr-2">Recent chains:</span>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {suggestions.slice(0, 8).map(s => (
                  <button
                    key={s.id}
                    onClick={() => { if (!chainA) setChainA(s.id); else setChainB(s.id); }}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors hover:bg-[#1a1a1a] ${
                      s.status === 'error' ? 'border-[#ef444425] text-[#ef4444]' : 'border-[#1a1a1a] text-[#737373]'
                    }`}
                  >
                    {s.id}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 flex items-center gap-2 text-sm text-[#ef4444] font-mono">
              <AlertCircle className="w-4 h-4" /> {error}
            </div>
          )}
        </div>

        {/* Results */}
        <AnimatePresence>
          {report && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="space-y-5">

              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4 flex flex-col items-center justify-center">
                  <DivergenceGauge score={report.divergence_score} />
                </div>
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4 space-y-3">
                  <div className="text-[10px] font-mono text-[#737373] uppercase tracking-wider">Operations</div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-[#ef4444]">Only in A</span>
                      <span className="text-[#f5f5f5] font-bold">{onlyA.length}</span>
                    </div>
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-[#10b981]">Only in B</span>
                      <span className="text-[#f5f5f5] font-bold">{onlyB.length}</span>
                    </div>
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-[#737373]">Common</span>
                      <span className="text-[#f5f5f5] font-bold">{common.length}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4">
                  <div className="text-[10px] font-mono text-[#737373] uppercase tracking-wider mb-2">Changed</div>
                  <div className="text-3xl font-bold font-mono text-[#f59e0b]">{changed.length}</div>
                  <div className="text-xs font-mono text-[#404040] mt-1">ops with diff</div>
                </div>
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4">
                  <div className="text-[10px] font-mono text-[#737373] uppercase tracking-wider mb-2">First Divergence</div>
                  <div className="text-sm font-mono font-bold text-[#6366f1] truncate">{report.first_divergence_op || 'None'}</div>
                  <div className="text-xs font-mono text-[#404040] mt-1">first deviation point</div>
                </div>
              </div>

              {/* Summary */}
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl px-5 py-3">
                <p className="text-sm text-[#737373] font-mono leading-relaxed">{report.summary}</p>
              </div>

              {/* Operations table */}
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl overflow-hidden">
                <div className="px-5 py-3 border-b border-[#1a1a1a] flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#737373]">Operation Comparison</span>
                  <div className="flex items-center gap-4 text-[10px] font-mono text-[#404040]">
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-[#6366f1]" />Chain A</span>
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-[#8b5cf6]" />Chain B</span>
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-[#ef4444]" />Only in A</span>
                    <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-[#10b981]" />Only in B</span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-[#111]">
                        <th className="px-3 py-2 text-left text-[10px] font-mono text-[#404040] uppercase w-6" />
                        <th className="px-3 py-2 text-left text-[10px] font-mono text-[#404040] uppercase">Operation</th>
                        <th className="px-3 py-2 text-left text-[10px] font-mono text-[#404040] uppercase w-40">Chain A Latency</th>
                        <th className="px-3 py-2 text-left text-[10px] font-mono text-[#404040] uppercase w-40">Chain B Latency</th>
                        <th className="px-3 py-2 text-left text-[10px] font-mono text-[#404040] uppercase w-28">Delta</th>
                        <th className="px-3 py-2 text-left text-[10px] font-mono text-[#404040] uppercase w-40">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.operations.map((op, i) => (
                        <OpRow key={op.operation_name} op={op} idx={i} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {!report && !loading && (
          <div className="flex flex-col items-center justify-center py-24 text-[#404040]">
            <GitCompare className="w-12 h-12 mb-4 opacity-30" />
            <p className="font-mono text-sm">Enter two chain IDs to compare their execution paths</p>
            <p className="font-mono text-xs mt-1 text-[#2a2a2a]">Detects structural divergence, latency regressions, and status changes</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
