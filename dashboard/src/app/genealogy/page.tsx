'use client';
export const runtime = 'edge';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Network, RefreshCw, X, TrendingUp } from 'lucide-react';
import { useFetch } from '@/lib/hooks';
import { getAgentFingerprints, getAgentsSummary, AgentFingerprint, AgentSummary } from '@/lib/api';

const ARCHETYPE_COLORS: Record<string, string> = {
  ORCHESTRATOR: '#6366f1',
  RESEARCHER:   '#10b981',
  PLANNER:      '#f59e0b',
  CRITIC:       '#ef4444',
  EXECUTOR:     '#8b5cf6',
  UNKNOWN:      '#737373',
};

interface Node {
  id: string;
  archetype: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  agent: AgentFingerprint | null;
  summary: AgentSummary | null;
}

interface Edge {
  source: string;
  target: string;
  weight: number;
}

function useForceLayout(nodes: Node[], edges: Edge[], width: number, height: number) {
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const frameRef = useRef<number>();
  const nodesRef = useRef<Node[]>([]);

  useEffect(() => {
    if (nodes.length === 0) return;
    nodesRef.current = nodes.map(n => ({
      ...n,
      x: n.x || width / 2 + (Math.random() - 0.5) * 200,
      y: n.y || height / 2 + (Math.random() - 0.5) * 200,
      vx: 0,
      vy: 0,
    }));

    let iter = 0;
    const simulate = () => {
      const ns = nodesRef.current;
      const alpha = Math.max(0.01, 0.3 * Math.pow(0.92, iter++));

      // Repulsion
      for (let i = 0; i < ns.length; i++) {
        for (let j = i + 1; j < ns.length; j++) {
          const dx = ns[j].x - ns[i].x;
          const dy = ns[j].y - ns[i].y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = (150 * 150) / (dist * dist) * alpha;
          ns[i].vx -= (dx / dist) * force;
          ns[i].vy -= (dy / dist) * force;
          ns[j].vx += (dx / dist) * force;
          ns[j].vy += (dy / dist) * force;
        }
      }

      // Attraction along edges
      for (const edge of edges) {
        const s = ns.find(n => n.id === edge.source);
        const t = ns.find(n => n.id === edge.target);
        if (!s || !t) continue;
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const idealDist = 160;
        const force = (dist - idealDist) * edge.weight * 0.05 * alpha;
        s.vx += (dx / dist) * force;
        s.vy += (dy / dist) * force;
        t.vx -= (dx / dist) * force;
        t.vy -= (dy / dist) * force;
      }

      // Center gravity
      for (const n of ns) {
        n.vx += (width / 2 - n.x) * 0.005 * alpha;
        n.vy += (height / 2 - n.y) * 0.005 * alpha;
        n.vx *= 0.85;
        n.vy *= 0.85;
        n.x += n.vx;
        n.y += n.vy;
        n.x = Math.max(n.radius + 10, Math.min(width - n.radius - 10, n.x));
        n.y = Math.max(n.radius + 10, Math.min(height - n.radius - 10, n.y));
      }

      setPositions(Object.fromEntries(ns.map(n => [n.id, { x: n.x, y: n.y }])));

      if (iter < 200) {
        frameRef.current = requestAnimationFrame(simulate);
      }
    };

    frameRef.current = requestAnimationFrame(simulate);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [nodes.length, edges.length, width, height]);

  return positions;
}

export default function GenealogyPage() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 800, h: 600 });

  const { data: fpReport, loading: fpLoading } = useFetch(() => getAgentFingerprints(168), []);
  const { data: summaries, loading: sumLoading } = useFetch(() => getAgentsSummary(), []);

  useEffect(() => {
    const update = () => {
      if (containerRef.current) {
        setDims({ w: containerRef.current.clientWidth, h: containerRef.current.clientHeight });
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const nodes: Node[] = React.useMemo(() => {
    if (!fpReport) return [];
    return fpReport.fingerprints.map((fp, i) => {
      const sum = summaries?.find(s => s.agent_id === fp.agent_id) ?? null;
      const totalSpans = fp.total_spans || 1;
      return {
        id: fp.agent_id,
        archetype: fp.archetype || 'UNKNOWN',
        x: dims.w / 2 + Math.cos((i * 2 * Math.PI) / fpReport.fingerprints.length) * 200,
        y: dims.h / 2 + Math.sin((i * 2 * Math.PI) / fpReport.fingerprints.length) * 200,
        vx: 0, vy: 0,
        radius: Math.max(18, Math.min(40, 12 + Math.log(totalSpans + 1) * 5)),
        agent: fp,
        summary: sum,
      };
    });
  }, [fpReport, summaries, dims]);

  const edges: Edge[] = React.useMemo(() => {
    if (!fpReport) return [];
    return fpReport.similarities
      .filter(s => s.similarity > 0.3)
      .map(s => ({ source: s.agent_a, target: s.agent_b, weight: s.similarity }));
  }, [fpReport]);

  const positions = useForceLayout(nodes, edges, dims.w, dims.h);
  const selectedNode = nodes.find(n => n.id === selectedAgent);

  const loading = fpLoading || sumLoading;

  return (
    <div className="h-screen flex flex-col bg-[#080808] text-[#f5f5f5] overflow-hidden">
      {/* Header */}
      <div className="h-14 px-6 border-b border-[#1a1a1a] bg-[#0f0f0f] flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Network className="w-4 h-4 text-[#6366f1]" />
          <span className="font-bold tracking-tight">Agent Genealogy</span>
          <span className="text-[10px] font-mono text-[#404040]">force-directed · 7d window</span>
        </div>
        <div className="flex items-center gap-4 text-[10px] font-mono">
          {Object.entries(ARCHETYPE_COLORS).filter(([k]) => k !== 'UNKNOWN').map(([arch, color]) => (
            <span key={arch} className="flex items-center gap-1.5 text-[#737373]">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              {arch}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {/* Graph canvas */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden bg-[#060606]">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-[#404040]">
                <div className="w-6 h-6 border-2 border-[#6366f1] border-t-transparent rounded-full animate-spin" />
                <span className="text-xs font-mono">Building agent relationship graph...</span>
              </div>
            </div>
          )}

          {!loading && nodes.length > 0 && (
            <svg width={dims.w} height={dims.h} className="absolute inset-0">
              <defs>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>

              {/* Edges */}
              {edges.map(edge => {
                const src = positions[edge.source];
                const tgt = positions[edge.target];
                if (!src || !tgt) return null;
                const isRelated = selectedAgent && (edge.source === selectedAgent || edge.target === selectedAgent);
                return (
                  <line
                    key={`${edge.source}-${edge.target}`}
                    x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                    stroke={isRelated ? '#6366f1' : '#1a1a1a'}
                    strokeWidth={isRelated ? edge.weight * 3 : edge.weight * 1.5}
                    strokeOpacity={isRelated ? 0.8 : 0.4}
                  />
                );
              })}

              {/* Nodes */}
              {nodes.map(node => {
                const pos = positions[node.id];
                if (!pos) return null;
                const color = ARCHETYPE_COLORS[node.archetype] ?? '#737373';
                const isSelected = selectedAgent === node.id;
                const isRelated = selectedAgent && edges.some(e =>
                  (e.source === node.id && e.target === selectedAgent) ||
                  (e.target === node.id && e.source === selectedAgent)
                );

                return (
                  <g
                    key={node.id}
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSelectedAgent(isSelected ? null : node.id)}
                  >
                    {/* Glow ring for selected */}
                    {isSelected && (
                      <circle cx={pos.x} cy={pos.y} r={node.radius + 8} fill="none" stroke={color} strokeWidth="2" strokeOpacity="0.3" filter="url(#glow)" />
                    )}
                    {/* Main circle */}
                    <circle
                      cx={pos.x} cy={pos.y} r={node.radius}
                      fill={color + (isSelected ? '40' : isRelated ? '25' : '18')}
                      stroke={color}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                      strokeOpacity={isSelected ? 1 : isRelated ? 0.8 : 0.5}
                    />
                    {/* Error indicator */}
                    {(node.agent?.error_rate ?? 0) > 0.1 && (
                      <circle cx={pos.x + node.radius * 0.7} cy={pos.y - node.radius * 0.7} r="4" fill="#ef4444" />
                    )}
                    {/* Label */}
                    <text
                      x={pos.x} y={pos.y + node.radius + 12}
                      textAnchor="middle"
                      fontSize="10"
                      fill={isSelected ? '#f5f5f5' : '#737373'}
                      fontFamily="monospace"
                      className="select-none"
                    >
                      {node.id.length > 14 ? node.id.slice(0, 13) + '…' : node.id}
                    </text>
                    {/* Archetype letter */}
                    <text
                      x={pos.x} y={pos.y + 3}
                      textAnchor="middle"
                      fontSize={node.radius * 0.7}
                      fill={color}
                      fontFamily="monospace"
                      fontWeight="bold"
                      className="select-none"
                    >
                      {node.archetype[0]}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}

          {!loading && nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[#404040]">
              <Network className="w-12 h-12 mb-4 opacity-30" />
              <p className="font-mono text-sm">No agent data yet</p>
              <p className="font-mono text-xs mt-1 text-[#2a2a2a]">Ingest spans with multiple agents to see the graph</p>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <AnimatePresence>
          {selectedNode && (
            <motion.div
              initial={{ x: 320, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 320, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              className="w-80 border-l border-[#1a1a1a] bg-[#0f0f0f] overflow-y-auto flex-shrink-0"
            >
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm font-bold text-[#f5f5f5] truncate">{selectedNode.id}</div>
                    <div
                      className="text-xs font-mono font-bold mt-0.5"
                      style={{ color: ARCHETYPE_COLORS[selectedNode.archetype] }}
                    >
                      {selectedNode.archetype}
                    </div>
                  </div>
                  <button onClick={() => setSelectedAgent(null)} className="p-1.5 rounded-lg bg-[#141414] text-[#737373] hover:text-[#f5f5f5] transition-colors">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {selectedNode.agent && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Total Spans', value: selectedNode.agent.total_spans },
                        { label: 'Chains', value: selectedNode.agent.total_chains },
                        { label: 'Avg Latency', value: `${selectedNode.agent.avg_latency_ms.toFixed(0)}ms` },
                        { label: 'P95', value: `${selectedNode.agent.p95_latency_ms.toFixed(0)}ms` },
                        { label: 'Error Rate', value: `${(selectedNode.agent.error_rate * 100).toFixed(1)}%` },
                        { label: 'Tool Affinity', value: `${(selectedNode.agent.tool_affinity * 100).toFixed(0)}%` },
                      ].map(s => (
                        <div key={s.label} className="bg-[#0a0a0a] rounded-lg p-2.5">
                          <div className="text-[9px] font-mono text-[#404040] uppercase mb-0.5">{s.label}</div>
                          <div className="text-sm font-mono font-bold text-[#f5f5f5]">{s.value}</div>
                        </div>
                      ))}
                    </div>

                    <div>
                      <div className="text-[10px] font-mono text-[#737373] uppercase tracking-wider mb-2">Top Operations</div>
                      {selectedNode.agent.top_operations.map((op, i) => (
                        <div key={op.op} className="flex items-center gap-2 mb-1.5">
                          <span className="text-[9px] font-mono text-[#404040] w-3">{i + 1}</span>
                          <div className="flex-1 h-1.5 bg-[#1a1a1a] rounded overflow-hidden">
                            <div
                              className="h-full rounded"
                              style={{
                                width: `${op.fraction * 100}%`,
                                backgroundColor: ARCHETYPE_COLORS[selectedNode.archetype]
                              }}
                            />
                          </div>
                          <span className="text-[9px] font-mono text-[#737373] truncate max-w-[100px]">{op.op}</span>
                          <span className="text-[9px] font-mono text-[#404040] w-7 text-right">{(op.fraction * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>

                    {/* Related agents */}
                    {edges.filter(e => e.source === selectedNode.id || e.target === selectedNode.id).length > 0 && (
                      <div>
                        <div className="text-[10px] font-mono text-[#737373] uppercase tracking-wider mb-2">Behaviorally Similar</div>
                        {edges
                          .filter(e => e.source === selectedNode.id || e.target === selectedNode.id)
                          .sort((a, b) => b.weight - a.weight)
                          .slice(0, 4)
                          .map(edge => {
                            const other = edge.source === selectedNode.id ? edge.target : edge.source;
                            return (
                              <div key={other} className="flex items-center justify-between text-xs font-mono mb-1.5">
                                <button
                                  onClick={() => setSelectedAgent(other)}
                                  className="text-[#6366f1] hover:underline truncate max-w-[160px]"
                                >
                                  {other}
                                </button>
                                <span className="text-[#404040]">{(edge.weight * 100).toFixed(0)}%</span>
                              </div>
                            );
                          })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
