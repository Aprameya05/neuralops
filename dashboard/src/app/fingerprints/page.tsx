'use client';
export const runtime = 'edge';
import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Fingerprint, Zap, AlertTriangle, RefreshCw, Users, TrendingUp } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { getAgentFingerprints, AgentFingerprint, FingerprintReport } from '@/lib/api';
import { formatCost } from '@/lib/utils';

const ARCHETYPE_META: Record<string, { color: string; icon: string; desc: string }> = {
  ORCHESTRATOR: { color: '#6366f1', icon: '🎯', desc: 'Coordinates other agents, high fan-out' },
  RESEARCHER:   { color: '#10b981', icon: '🔍', desc: 'Heavy tool usage, data retrieval focus' },
  PLANNER:      { color: '#f59e0b', icon: '📋', desc: 'Structures tasks, low latency, high throughput' },
  CRITIC:       { color: '#ef4444', icon: '⚖️', desc: 'Validates outputs, hallucination scoring' },
  EXECUTOR:     { color: '#8b5cf6', icon: '⚡', desc: 'Direct action, minimal reasoning overhead' },
};

const DIMENSIONS = [
  'latency_norm', 'p95_latency', 'error_rate', 'tool_affinity',
  'cost_norm', 'spans_per_chain', 'op1_frac', 'op2_frac', 'op3_frac'
];

const DIM_LABELS = ['Latency', 'P95', 'Errors', 'Tools', 'Cost', 'Density', 'Op1', 'Op2', 'Op3'];

function RadarChart({ signature, color, size = 140 }: { signature: number[]; color: string; size?: number }) {
  const N = Math.min(signature.length, 9);
  const cx = size / 2, cy = size / 2, r = size * 0.38;
  const labelR = size * 0.48;

  const points = Array.from({ length: N }, (_, i) => {
    const angle = (i * 2 * Math.PI) / N - Math.PI / 2;
    const val = Math.min(Math.max(signature[i] ?? 0, 0), 1);
    return { x: cx + Math.cos(angle) * r * val, y: cy + Math.sin(angle) * r * val, angle, val };
  });

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');

  // Grid circles
  const gridLevels = [0.25, 0.5, 0.75, 1.0];

  return (
    <svg width={size} height={size} className="overflow-visible">
      {/* Grid */}
      {gridLevels.map(level => (
        <polygon
          key={level}
          points={Array.from({ length: N }, (_, i) => {
            const angle = (i * 2 * Math.PI) / N - Math.PI / 2;
            return `${cx + Math.cos(angle) * r * level},${cy + Math.sin(angle) * r * level}`;
          }).join(' ')}
          fill="none" stroke="#1a1a1a" strokeWidth="1"
        />
      ))}
      {/* Axes */}
      {Array.from({ length: N }, (_, i) => {
        const angle = (i * 2 * Math.PI) / N - Math.PI / 2;
        return <line key={i} x1={cx} y1={cy} x2={cx + Math.cos(angle) * r} y2={cy + Math.sin(angle) * r} stroke="#1a1a1a" strokeWidth="1" />;
      })}
      {/* Data */}
      <polygon points={polyline} fill={color + '25'} stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      {/* Dots */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2" fill={color} />
      ))}
      {/* Labels */}
      {Array.from({ length: N }, (_, i) => {
        const angle = (i * 2 * Math.PI) / N - Math.PI / 2;
        const lx = cx + Math.cos(angle) * labelR;
        const ly = cy + Math.sin(angle) * labelR;
        return (
          <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
            className="text-[8px] fill-[#404040] font-mono select-none" fontSize="8">
            {DIM_LABELS[i] ?? ''}
          </text>
        );
      })}
    </svg>
  );
}

function SimilarityHeatmap({ fingerprints, similarities }: { fingerprints: AgentFingerprint[]; similarities: FingerprintReport['similarities'] }) {
  const agents = fingerprints.map(f => f.agent_id);
  const simMap: Record<string, number> = {};
  similarities.forEach(s => {
    simMap[`${s.agent_a}__${s.agent_b}`] = s.similarity;
    simMap[`${s.agent_b}__${s.agent_a}`] = s.similarity;
  });

  if (agents.length < 2) return null;

  return (
    <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-4">Behavioral Similarity Matrix</div>
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="w-24" />
              {agents.map(a => (
                <th key={a} className="pb-2 px-1 text-[9px] font-mono text-[#404040] rotate-45 w-16 align-bottom">
                  <div className="truncate max-w-[60px]">{a.split('-')[0]}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map(rowAgent => (
              <tr key={rowAgent}>
                <td className="pr-2 py-0.5 text-[9px] font-mono text-[#404040] text-right truncate max-w-[90px]">{rowAgent.split('-')[0]}</td>
                {agents.map(colAgent => {
                  const sim = rowAgent === colAgent ? 1 : (simMap[`${rowAgent}__${colAgent}`] ?? 0);
                  const alpha = sim;
                  const bg = rowAgent === colAgent ? '#6366f140' : `rgba(99,102,241,${alpha * 0.7})`;
                  return (
                    <td key={colAgent} className="w-10 h-8 p-0.5" title={`${rowAgent} ↔ ${colAgent}: ${(sim * 100).toFixed(0)}%`}>
                      <div
                        className="w-full h-full rounded flex items-center justify-center text-[8px] font-mono font-bold"
                        style={{ backgroundColor: bg, color: sim > 0.5 ? '#f5f5f5' : '#404040' }}
                      >
                        {sim > 0 ? (sim * 100).toFixed(0) : ''}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgentCard({ fp, rank }: { fp: AgentFingerprint; rank: number }) {
  const [open, setOpen] = useState(false);
  const meta = ARCHETYPE_META[fp.archetype] ?? { color: '#737373', icon: '?', desc: '' };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.05 }}
      className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl overflow-hidden hover:border-[#242424] transition-colors"
    >
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg" style={{ backgroundColor: meta.color + '20' }}>
              {meta.icon}
            </div>
            <div>
              <div className="text-sm font-bold text-[#f5f5f5] truncate max-w-[180px]">{fp.agent_id}</div>
              <div className="text-[10px] font-mono text-[#404040]">{fp.agent_framework}</div>
            </div>
          </div>
          <span
            className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border"
            style={{ color: meta.color, borderColor: meta.color + '40', backgroundColor: meta.color + '15' }}
          >
            {fp.archetype}
          </span>
        </div>

        {/* Radar */}
        <div className="flex justify-center mb-3">
          <RadarChart signature={fp.signature} color={meta.color} size={130} />
        </div>

        {/* Quick stats */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { label: 'Avg Latency', value: `${fp.avg_latency_ms.toFixed(0)}ms` },
            { label: 'Error Rate', value: `${(fp.error_rate * 100).toFixed(1)}%` },
            { label: 'Cost/Span', value: `$${fp.avg_cost_per_span.toFixed(5)}` },
          ].map(stat => (
            <div key={stat.label} className="bg-[#0a0a0a] rounded-lg p-2 text-center">
              <div className="text-[9px] font-mono text-[#404040] uppercase mb-0.5">{stat.label}</div>
              <div className="text-xs font-mono font-bold text-[#f5f5f5]">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Top ops */}
        <button onClick={() => setOpen(!open)} className="w-full text-left">
          <div className="text-[10px] font-mono text-[#404040] uppercase tracking-wider mb-1.5">Top Operations</div>
          {fp.top_operations.slice(0, open ? fp.top_operations.length : 2).map((op, i) => (
            <div key={op.op} className="flex items-center gap-2 mb-1">
              <div className="flex-1 h-1 bg-[#1a1a1a] rounded overflow-hidden">
                <motion.div
                  className="h-full rounded"
                  style={{ backgroundColor: meta.color }}
                  initial={{ width: 0 }}
                  animate={{ width: `${op.fraction * 100}%` }}
                  transition={{ delay: rank * 0.05 + i * 0.05, duration: 0.5 }}
                />
              </div>
              <span className="text-[9px] font-mono text-[#737373] truncate max-w-[80px]">{op.op}</span>
              <span className="text-[9px] font-mono text-[#404040] w-8 text-right">{(op.fraction * 100).toFixed(0)}%</span>
            </div>
          ))}
        </button>
      </div>
    </motion.div>
  );
}

export default function FingerprintsPage() {
  const [hours, setHours] = useState(24);
  const { data: report, loading, refetch } = useFetch(
    () => getAgentFingerprints(hours),
    [hours]
  );

  const redundantPairs = report?.similarities.filter(s => s.similarity > 0.85) ?? [];

  return (
    <div className="min-h-screen bg-[#080808] text-[#f5f5f5] p-6">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <Fingerprint className="w-5 h-5 text-[#6366f1]" />
              <h1 className="text-xl font-bold tracking-tight">Agent Fingerprints</h1>
            </div>
            <p className="text-sm text-[#737373] font-mono">Behavioral clustering · Archetype detection · Redundancy analysis</p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={hours}
              onChange={e => setHours(Number(e.target.value))}
              className="bg-[#141414] border border-[#242424] rounded-lg px-3 py-1.5 text-xs font-mono text-[#f5f5f5] focus:outline-none focus:border-[#6366f1]"
            >
              <option value={6}>Last 6h</option>
              <option value={24}>Last 24h</option>
              <option value={72}>Last 72h</option>
              <option value={168}>Last 7d</option>
            </select>
            <button onClick={refetch} className="p-2 rounded-lg bg-[#141414] border border-[#242424] text-[#737373] hover:text-[#f5f5f5] transition-colors">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="flex flex-col items-center gap-3 text-[#404040]">
              <div className="w-6 h-6 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-mono">Clustering agent behaviors...</span>
            </div>
          </div>
        )}

        {!loading && report && (
          <div className="space-y-6">
            {/* Summary */}
            {report.summary && (
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl px-5 py-3">
                <p className="text-sm text-[#737373] font-mono leading-relaxed">{report.summary}</p>
              </div>
            )}

            {/* Redundancy warnings */}
            {redundantPairs.length > 0 && (
              <div className="bg-[#f59e0b08] border border-[#f59e0b25] rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="w-4 h-4 text-[#f59e0b]" />
                  <span className="text-sm font-semibold text-[#f59e0b]">Potential Redundancy Detected</span>
                </div>
                <div className="space-y-2">
                  {redundantPairs.map(pair => (
                    <div key={`${pair.agent_a}-${pair.agent_b}`} className="flex items-center gap-3 text-xs font-mono">
                      <span className="text-[#f5f5f5]">{pair.agent_a}</span>
                      <span className="text-[#404040]">↔</span>
                      <span className="text-[#f5f5f5]">{pair.agent_b}</span>
                      <span className="px-2 py-0.5 rounded-full bg-[#f59e0b20] text-[#f59e0b]">
                        {(pair.similarity * 100).toFixed(0)}% similar
                      </span>
                      {pair.explanation && <span className="text-[#404040] truncate">{pair.explanation}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clusters */}
            {report.clusters.length > 0 && (
              <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-5">
                <div className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-4 flex items-center gap-2">
                  <Users className="w-3.5 h-3.5" /> Behavioral Clusters
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {report.clusters.map(cluster => {
                    const meta = ARCHETYPE_META[cluster.archetype] ?? { color: '#737373', icon: '?', desc: '' };
                    return (
                      <div key={cluster.cluster_id} className="rounded-lg border p-3" style={{ borderColor: meta.color + '30', backgroundColor: meta.color + '08' }}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.icon} {cluster.archetype}</span>
                          <span className="text-[10px] font-mono text-[#404040]">cohesion: {(cluster.cohesion * 100).toFixed(0)}%</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mb-2">
                          {cluster.agents.map(a => (
                            <span key={a} className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-[#0a0a0a] text-[#737373] border border-[#1a1a1a]">{a}</span>
                          ))}
                        </div>
                        {cluster.description && <p className="text-[10px] font-mono text-[#404040]">{cluster.description}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Agent cards grid */}
            {report.fingerprints.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-[#737373] mb-4">Individual Profiles</div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {report.fingerprints.map((fp, i) => (
                    <AgentCard key={fp.agent_id} fp={fp} rank={i} />
                  ))}
                </div>
              </div>
            )}

            {/* Similarity heatmap */}
            {report.fingerprints.length >= 2 && (
              <SimilarityHeatmap fingerprints={report.fingerprints} similarities={report.similarities} />
            )}
          </div>
        )}

        {!loading && !report && (
          <div className="flex flex-col items-center justify-center py-24 text-[#404040]">
            <Fingerprint className="w-12 h-12 mb-4 opacity-30" />
            <p className="font-mono text-sm">No fingerprint data available</p>
            <p className="font-mono text-xs mt-1 text-[#2a2a2a]">Ingest agent spans first, then fingerprints will auto-generate</p>
          </div>
        )}
      </motion.div>
    </div>
  );
}
