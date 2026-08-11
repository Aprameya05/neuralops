'use client';
export const runtime = 'edge'
import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy, Check, GitBranch, Clock, DollarSign, Users,
  AlertTriangle, Zap, TrendingUp, Play, Pause, SkipForward,
  ChevronDown, ChevronRight, Brain, Target, Activity, Eye, EyeOff
} from 'lucide-react';
import CausalTree from '@/components/CausalTree';
import NodeDetail from '@/components/NodeDetail';
import { useFetch } from '@/lib/hooks';
import { getCausalReplay, getCausalAttribution, getHallucinationRisk, AttributionReport, HallucinationRisk } from '@/lib/api';
import { Span } from '@/lib/types';
import { formatCost, formatDuration, copyToClipboard } from '@/lib/utils';

const ARCHETYPE_COLORS: Record<string, string> = {
  ORCHESTRATOR: '#6366f1',
  RESEARCHER: '#10b981',
  PLANNER: '#f59e0b',
  CRITIC: '#ef4444',
  EXECUTOR: '#8b5cf6',
};

function AttributionPanel({ chainId, selectedSpanId }: { chainId: string; selectedSpanId: string | null }) {
  const { data: report, loading } = useFetch<AttributionReport | null>(
    () => getCausalAttribution(chainId),
    [chainId]
  );
  const [expanded, setExpanded] = useState(true);

  if (loading) return (
    <div className="border-t border-[#1a1a1a] px-4 py-3">
      <div className="text-xs font-mono text-[#404040] animate-pulse">Loading root cause analysis...</div>
    </div>
  );

  if (!report || !report.root_cause) return null;

  const maxScore = Math.max(...report.ranked_causes.map(c => c.attribution_score), 0.001);

  return (
    <div className="border-t border-[#1a1a1a]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center justify-between bg-[#0f0f0f] hover:bg-[#141414] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Target className="w-3.5 h-3.5 text-[#ef4444]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[#ef4444]">Root Cause Analysis</span>
          <span className="text-[10px] font-mono text-[#404040] ml-1">
            {(report.confidence * 100).toFixed(0)}% confidence
          </span>
        </div>
        {expanded ? <ChevronDown className="w-3.5 h-3.5 text-[#737373]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#737373]" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {/* Summary */}
            <div className="px-4 py-2 bg-[#0a0a0a] border-b border-[#1a1a1a]">
              <p className="text-[11px] text-[#737373] font-mono leading-relaxed">{report.summary}</p>
            </div>

            {/* Ranked causes */}
            <div className="px-4 py-3 space-y-2 max-h-72 overflow-y-auto">
              {report.ranked_causes.slice(0, 6).map((cause, i) => {
                const isRoot = i === 0;
                const pct = (cause.attribution_score / maxScore) * 100;
                const isHighlighted = selectedSpanId === cause.span_id;
                return (
                  <motion.div
                    key={cause.span_id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className={`rounded-lg p-2.5 border transition-colors ${
                      isRoot
                        ? 'bg-[#ef444408] border-[#ef444425]'
                        : isHighlighted
                        ? 'bg-[#6366f108] border-[#6366f125]'
                        : 'bg-[#0f0f0f] border-[#1a1a1a]'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        {isRoot && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#ef444420] text-[#ef4444] font-mono font-bold uppercase flex-shrink-0">Root</span>}
                        <span className="text-[11px] font-mono font-semibold text-[#f5f5f5] truncate">{cause.operation_name}</span>
                        <span className="text-[10px] font-mono text-[#404040] flex-shrink-0">{cause.agent_id}</span>
                      </div>
                      <span className="text-xs font-mono font-bold text-[#f5f5f5] flex-shrink-0 ml-2">
                        {(cause.attribution_score * 100).toFixed(0)}%
                      </span>
                    </div>
                    {/* Score bar */}
                    <div className="h-1 bg-[#1a1a1a] rounded-full overflow-hidden mb-1.5">
                      <motion.div
                        className={`h-full rounded-full ${isRoot ? 'bg-[#ef4444]' : 'bg-[#6366f1]'}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5, delay: i * 0.04 }}
                      />
                    </div>
                    {/* Signal breakdown */}
                    <div className="flex items-center gap-3 text-[9px] font-mono text-[#404040]">
                      <span>⏱ {(cause.temporal_score * 100).toFixed(0)}%</span>
                      <span>⚠ {(cause.error_score * 100).toFixed(0)}%</span>
                      <span>📈 {(cause.latency_score * 100).toFixed(0)}%</span>
                      <span>🔗 {(cause.centrality_score * 100).toFixed(0)}%</span>
                    </div>
                    <p className="text-[10px] text-[#404040] mt-1 leading-relaxed line-clamp-2">{cause.explanation}</p>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HallucinationPanel({ chainId }: { chainId: string }) {
  const { data: risk, loading } = useFetch<HallucinationRisk | null>(
    () => getHallucinationRisk(chainId),
    [chainId]
  );
  const [expanded, setExpanded] = useState(false);

  if (loading || !risk || risk.high_risk_spans.length === 0) return null;

  const avgRisk = risk.avg_risk;
  const color = avgRisk > 0.6 ? '#ef4444' : avgRisk > 0.35 ? '#f59e0b' : '#10b981';

  return (
    <div className="border-t border-[#1a1a1a]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center justify-between bg-[#0f0f0f] hover:bg-[#141414] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Brain className="w-3.5 h-3.5" style={{ color }} />
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color }}>Hallucination Risk</span>
          <span className="text-[10px] font-mono text-[#404040]">{risk.high_risk_spans.length} spans flagged</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-12 h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${avgRisk * 100}%`, backgroundColor: color }} />
          </div>
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-[#737373]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#737373]" />}
        </div>
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-3 space-y-2 max-h-48 overflow-y-auto">
              {risk.high_risk_spans.map((s, i) => (
                <div key={s.span_id} className="flex items-start gap-3 text-xs font-mono">
                  <div className="w-2 h-2 rounded-full mt-1 flex-shrink-0" style={{ backgroundColor: s.risk_score > 0.7 ? '#ef4444' : '#f59e0b' }} />
                  <div className="min-w-0">
                    <span className="text-[#f5f5f5]">{s.operation_name}</span>
                    <span className="text-[#404040] ml-2">{(s.risk_score * 100).toFixed(0)}% risk</span>
                    <p className="text-[#404040] text-[10px] mt-0.5 truncate">{s.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CostWaterfall({ spans }: { spans: Span[] }) {
  const [show, setShow] = useState(false);
  const spansWithCost = spans.filter(s => (s.estimated_usd || 0) > 0).slice(0, 12);
  if (spansWithCost.length === 0) return null;
  const total = spansWithCost.reduce((a, s) => a + (s.estimated_usd || 0), 0);
  let cumulative = 0;

  return (
    <div className="border-t border-[#1a1a1a]">
      <button
        onClick={() => setShow(!show)}
        className="w-full px-4 py-2.5 flex items-center justify-between bg-[#0f0f0f] hover:bg-[#141414] transition-colors"
      >
        <div className="flex items-center gap-2">
          <DollarSign className="w-3.5 h-3.5 text-[#10b981]" />
          <span className="text-xs font-semibold uppercase tracking-wider text-[#10b981]">Cost Waterfall</span>
          <span className="text-[10px] font-mono text-[#404040]">${total.toFixed(6)} total</span>
        </div>
        {show ? <ChevronDown className="w-3.5 h-3.5 text-[#737373]" /> : <ChevronRight className="w-3.5 h-3.5 text-[#737373]" />}
      </button>
      <AnimatePresence>
        {show && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="px-4 py-3 space-y-1.5">
              {spansWithCost.map((span, i) => {
                const pct = ((span.estimated_usd || 0) / total) * 100;
                const cumulativePrev = cumulative;
                cumulative += pct;
                return (
                  <div key={span.span_id} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className="text-[#404040] w-4 text-right">{i + 1}</span>
                    <span className="text-[#737373] truncate flex-1 min-w-0">{span.operation_name}</span>
                    <div className="w-24 h-2 bg-[#1a1a1a] rounded-sm overflow-hidden">
                      <motion.div
                        className="h-full bg-[#10b981]"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: i * 0.05, duration: 0.4 }}
                      />
                    </div>
                    <span className="text-[#f5f5f5] w-16 text-right">${(span.estimated_usd || 0).toFixed(6)}</span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TimelineScrubber({ spans, onSelectSpan }: { spans: Span[]; onSelectSpan: (s: Span) => void }) {
  const [playing, setPlaying] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const sorted = [...spans].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());

  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCurrentIdx(prev => {
          const next = prev + 1;
          if (next >= sorted.length) {
            setPlaying(false);
            return prev;
          }
          onSelectSpan(sorted[next]);
          return next;
        });
      }, 600);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [playing, sorted.length]);

  if (sorted.length === 0) return null;

  const pct = sorted.length > 1 ? (currentIdx / (sorted.length - 1)) * 100 : 0;

  return (
    <div className="px-4 py-2 border-t border-[#1a1a1a] bg-[#0a0a0a]">
      <div className="flex items-center gap-3">
        <button
          onClick={() => { setPlaying(!playing); if (!playing && currentIdx >= sorted.length - 1) setCurrentIdx(0); }}
          className="p-1.5 rounded bg-[#141414] hover:bg-[#1e1e1e] text-[#6366f1] transition-colors"
        >
          {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={() => { setCurrentIdx(0); setPlaying(false); onSelectSpan(sorted[0]); }}
          className="p-1.5 rounded bg-[#141414] hover:bg-[#1e1e1e] text-[#737373] transition-colors"
        >
          <SkipForward className="w-3 h-3 rotate-180" />
        </button>
        <div className="flex-1 relative h-1.5 bg-[#1a1a1a] rounded-full cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            const idx = Math.round(x * (sorted.length - 1));
            setCurrentIdx(idx);
            onSelectSpan(sorted[idx]);
          }}
        >
          <motion.div
            className="absolute inset-y-0 left-0 bg-[#6366f1] rounded-full"
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.1 }}
          />
          <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-[#6366f1] rounded-full border-2 border-[#0a0a0a] shadow-lg" style={{ left: `calc(${pct}% - 6px)` }} />
        </div>
        <span className="text-[10px] font-mono text-[#737373] whitespace-nowrap">
          {currentIdx + 1} / {sorted.length}
        </span>
      </div>
    </div>
  );
}

export default function ReplayPage() {
  const params = useParams();
  const idParam = (params?.id as string) || 'csl_65a1b2';

  const { data: causalGraph, loading } = useFetch(
    () => getCausalReplay(idParam),
    [idParam]
  );

  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const [copiedChain, setCopiedChain] = useState(false);
  const [showAttribution, setShowAttribution] = useState(true);
  const [allSpans, setAllSpans] = useState<Span[]>([]);

  useEffect(() => {
    if (causalGraph?.root) {
      setSelectedSpan(causalGraph.root);
      // Flatten tree into list
      const flat: Span[] = [];
      const walk = (s: Span) => { flat.push(s); (s.children || []).forEach(walk); };
      walk(causalGraph.root);
      setAllSpans(flat);
    }
  }, [causalGraph]);

  const handleCopyChainId = async () => {
    if (!causalGraph) return;
    const ok = await copyToClipboard(causalGraph.causal_chain_id);
    if (ok) { setCopiedChain(true); setTimeout(() => setCopiedChain(false), 2000); }
  };

  if (loading || !causalGraph) {
    return (
      <div className="h-screen flex items-center justify-center text-sm font-mono text-[#737373] bg-[#080808]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
          Reconstructing causal graph for chain {idParam}...
        </div>
      </div>
    );
  }

  const hasErrors = causalGraph.status === 'error';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="h-screen flex flex-col bg-[#080808] overflow-hidden"
    >
      {/* Top Strip */}
      <div className="h-16 px-6 border-b border-[#1a1a1a] bg-[#0f0f0f] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase font-mono tracking-wider text-[#737373]">Causal Chain</span>
          <span className="font-mono text-sm font-bold text-[#6366f1]">{causalGraph.causal_chain_id}</span>
          <button
            onClick={handleCopyChainId}
            className="p-1 rounded text-[#737373] hover:text-[#f5f5f5] hover:bg-[#141414] transition-colors"
          >
            {copiedChain ? <Check className="w-3.5 h-3.5 text-[#10b981]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <span className={`ml-2 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border ${
            causalGraph.status === 'error'
              ? 'bg-[#ef444415] text-[#ef4444] border-[#ef444430]'
              : causalGraph.status === 'hallucination'
              ? 'bg-[#f59e0b15] text-[#f59e0b] border-[#f59e0b30]'
              : 'bg-[#10b98115] text-[#10b981] border-[#10b98130]'
          }`}>{causalGraph.status}</span>
        </div>
        <div className="flex items-center gap-6 text-xs font-mono text-[#737373]">
          <div className="flex items-center gap-1.5"><GitBranch className="w-3.5 h-3.5 text-[#6366f1]" />{causalGraph.total_spans} Spans</div>
          <div className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 text-[#8b5cf6]" />{formatDuration(causalGraph.total_duration_ms)}</div>
          <div className="flex items-center gap-1.5"><DollarSign className="w-3.5 h-3.5 text-[#10b981]" />{formatCost(causalGraph.total_cost_usd)}</div>
          <div className="flex items-center gap-1.5"><Users className="w-3.5 h-3.5 text-[#737373]" />{causalGraph.agents.length} Agents</div>
          {hasErrors && (
            <button
              onClick={() => setShowAttribution(!showAttribution)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#ef444410] border border-[#ef444425] text-[#ef4444] hover:bg-[#ef444420] transition-colors"
            >
              <Target className="w-3 h-3" />
              {showAttribution ? 'Hide' : 'Show'} RCA
            </button>
          )}
        </div>
      </div>

      {/* Two Panel Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Causal Tree + panels */}
        <div className="w-[400px] border-r border-[#1a1a1a] bg-[#080808] flex-shrink-0 flex flex-col">
          <div className="px-4 py-3 border-b border-[#1a1a1a] bg-[#0f0f0f] text-xs font-semibold uppercase tracking-wider text-[#737373] flex justify-between items-center">
            <span>Causal Execution Graph</span>
            <span className="font-mono text-[10px] text-[#404040]">Tree View</span>
          </div>

          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto">
              <CausalTree
                rootNode={causalGraph.root}
                selectedSpanId={selectedSpan?.span_id || null}
                onSelectNode={(span) => setSelectedSpan(span)}
              />
            </div>

            {/* Timeline Scrubber */}
            <TimelineScrubber spans={allSpans} onSelectSpan={setSelectedSpan} />

            {/* Attribution Panel */}
            {hasErrors && showAttribution && (
              <AttributionPanel chainId={idParam} selectedSpanId={selectedSpan?.span_id || null} />
            )}

            {/* Hallucination Panel */}
            <HallucinationPanel chainId={idParam} />

            {/* Cost Waterfall */}
            <CostWaterfall spans={allSpans} />
          </div>
        </div>

        {/* RIGHT: Detail Panel */}
        <div className="flex-1 bg-[#080808] flex flex-col overflow-hidden">
          <div className="px-6 py-3 border-b border-[#1a1a1a] bg-[#0f0f0f] text-xs font-semibold uppercase tracking-wider text-[#737373] flex justify-between items-center">
            <span>Span Telemetry Inspector</span>
            {selectedSpan && <span className="font-mono text-[10px] text-[#6366f1]">{selectedSpan.span_id}</span>}
          </div>
          <div className="flex-1 overflow-y-auto">
            <NodeDetail span={selectedSpan} />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
