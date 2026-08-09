'use client';
export const runtime = 'edge'
import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Copy, Check, GitBranch, Clock, DollarSign, Users } from 'lucide-react';
import CausalTree from '@/components/CausalTree';
import NodeDetail from '@/components/NodeDetail';
import { useFetch } from '@/lib/hooks';
import { getCausalReplay } from '@/lib/api';
import { Span } from '@/lib/types';
import { formatCost, formatDuration, copyToClipboard } from '@/lib/utils';

export default function ReplayPage() {
  const params = useParams();
  const idParam = (params?.id as string) || 'csl_65a1b2';

  const { data: causalGraph, loading } = useFetch(
    () => getCausalReplay(idParam),
    [idParam]
  );

  const [selectedSpan, setSelectedSpan] = useState<Span | null>(null);
  const [copiedChain, setCopiedChain] = useState(false);

  useEffect(() => {
    if (causalGraph?.root) {
      setSelectedSpan(causalGraph.root);
    }
  }, [causalGraph]);

  const handleCopyChainId = async () => {
    if (!causalGraph) return;
    const ok = await copyToClipboard(causalGraph.causal_chain_id);
    if (ok) {
      setCopiedChain(true);
      setTimeout(() => setCopiedChain(false), 2000);
    }
  };

  if (loading || !causalGraph) {
    return (
      <div className="h-screen flex items-center justify-center text-sm font-mono text-[#737373] bg-[#080808]">
        Reconstructing causal graph for chain {idParam}...
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="h-screen flex flex-col bg-[#080808] overflow-hidden"
    >
      {/* Top Strip */}
      <div className="h-16 px-6 border-b border-[#1a1a1a] bg-[#0f0f0f] flex items-center justify-between flex-shrink-0">
        {/* Chain ID & Copy */}
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase font-mono tracking-wider text-[#737373]">Causal Chain</span>
          <span className="font-mono text-sm font-bold text-[#6366f1]">{causalGraph.causal_chain_id}</span>
          <button
            onClick={handleCopyChainId}
            className="p-1 rounded text-[#737373] hover:text-[#f5f5f5] hover:bg-[#141414] transition-colors"
            title="Copy Chain ID"
          >
            {copiedChain ? <Check className="w-3.5 h-3.5 text-[#10b981]" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Status Pill */}
          <span
            className={`ml-2 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border ${
              causalGraph.status === 'error'
                ? 'bg-[#ef444415] text-[#ef4444] border-[#ef444430]'
                : causalGraph.status === 'hallucination'
                ? 'bg-[#f59e0b15] text-[#f59e0b] border-[#f59e0b30]'
                : 'bg-[#10b98115] text-[#10b981] border-[#10b98130]'
            }`}
          >
            {causalGraph.status}
          </span>
        </div>

        {/* Inline Stats */}
        <div className="flex items-center gap-6 text-xs font-mono text-[#737373]">
          <div className="flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5 text-[#6366f1]" />
            <span>{causalGraph.total_spans} Spans</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-[#8b5cf6]" />
            <span>{formatDuration(causalGraph.total_duration_ms)}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <DollarSign className="w-3.5 h-3.5 text-[#10b981]" />
            <span>{formatCost(causalGraph.total_cost_usd)}</span>
          </div>

          <div className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-[#737373]" />
            <span>{causalGraph.agents.length} Agents</span>
          </div>
        </div>
      </div>

      {/* Two Panel Layout Below */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT (380px fixed width): Causal Tree */}
        <div className="w-[380px] border-r border-[#1a1a1a] bg-[#080808] flex-shrink-0 flex flex-col">
          <div className="px-4 py-3 border-b border-[#1a1a1a] bg-[#0f0f0f] text-xs font-semibold uppercase tracking-wider text-[#737373] flex justify-between items-center">
            <span>Causal Execution Graph</span>
            <span className="font-mono text-[10px] text-[#404040]">Tree View</span>
          </div>

          <CausalTree
            rootNode={causalGraph.root}
            selectedSpanId={selectedSpan?.span_id || null}
            onSelectNode={(span) => setSelectedSpan(span)}
          />
        </div>

        {/* RIGHT (flex 1): Detail Panel */}
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
