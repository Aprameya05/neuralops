'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { TraceSummary } from '@/lib/types';
import { formatCost, formatDuration, formatTimeAgo, truncateId, copyToClipboard } from '@/lib/utils';
import SkeletonRow from './SkeletonRow';

interface TraceTableProps {
  traces: TraceSummary[];
  loading?: boolean;
}

export default function TraceTable({ traces, loading = false }: TraceTableProps) {
  const router = useRouter();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const ok = await copyToClipboard(id);
    if (ok) {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  if (loading) {
    return <SkeletonRow count={6} />;
  }

  if (!traces || traces.length === 0) {
    return (
      <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-12 text-center text-[#737373]">
        No traces recorded matching the selected filter criteria.
      </div>
    );
  }

  return (
    <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl overflow-hidden shadow-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#1a1a1a] bg-[#141414] text-[11px] uppercase tracking-wider text-[#737373] font-medium">
              <th className="py-3 px-4">Chain ID</th>
              <th className="py-3 px-4">Agents</th>
              <th className="py-3 px-4 text-right">Spans</th>
              <th className="py-3 px-4 text-right">Duration</th>
              <th className="py-3 px-4 text-right">Cost</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Time</th>
              <th className="py-3 px-4 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1a1a1a] text-sm text-[#f5f5f5]">
            {traces.map((trace, idx) => {
              const isError = trace.status === 'error';
              const isHallucination = trace.status === 'hallucination';

              return (
                <motion.tr
                  key={trace.causal_chain_id + idx}
                  initial={{ opacity: 0, x: -16 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2, delay: idx * 0.03 }}
                  onClick={() => router.push(`/replay/${trace.causal_chain_id}`)}
                  className="hover:bg-[#141414] transition-colors cursor-pointer group"
                >
                  {/* Chain ID */}
                  <td className="py-3.5 px-4 font-mono text-xs text-[#f5f5f5]">
                    <div className="flex items-center gap-2">
                      <span className="text-[#6366f1] group-hover:underline">
                        {truncateId(trace.causal_chain_id, 10)}
                      </span>
                      <button
                        onClick={(e) => handleCopy(e, trace.causal_chain_id)}
                        className="text-[#404040] hover:text-[#f5f5f5] p-1 rounded transition-colors"
                        title="Copy Causal Chain ID"
                      >
                        {copiedId === trace.causal_chain_id ? (
                          <Check className="w-3.5 h-3.5 text-[#10b981]" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </td>

                  {/* Agents */}
                  <td className="py-3.5 px-4">
                    <div className="flex flex-wrap gap-1 max-w-xs">
                      {trace.agent_ids.map((agent) => (
                        <span
                          key={agent}
                          className="px-2 py-0.5 rounded-md bg-[#141414] border border-[#1a1a1a] text-[11px] font-mono text-[#737373]"
                        >
                          {agent.replace('-agent', '')}
                        </span>
                      ))}
                    </div>
                  </td>

                  {/* Spans count */}
                  <td className="py-3.5 px-4 text-right font-mono text-xs text-[#737373]">
                    {trace.span_count}
                  </td>

                  {/* Duration */}
                  <td className="py-3.5 px-4 text-right font-mono text-xs text-[#f5f5f5]">
                    {formatDuration(trace.total_duration_ms)}
                  </td>

                  {/* Cost */}
                  <td className="py-3.5 px-4 text-right font-mono text-xs text-[#10b981]">
                    {formatCost(trace.total_cost_usd)}
                  </td>

                  {/* Status: Small dot + text */}
                  <td className="py-3.5 px-4">
                    <div className="flex items-center gap-1.5 font-medium text-xs capitalize">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isError
                            ? 'bg-[#ef4444]'
                            : isHallucination
                            ? 'bg-[#f59e0b]'
                            : 'bg-[#10b981]'
                        }`}
                      ></span>
                      <span
                        className={
                          isError
                            ? 'text-[#ef4444]'
                            : isHallucination
                            ? 'text-[#f59e0b]'
                            : 'text-[#10b981]'
                        }
                      >
                        {trace.status}
                      </span>
                    </div>
                  </td>

                  {/* Relative Time */}
                  <td className="py-3.5 px-4 text-right font-mono text-xs text-[#737373]">
                    {formatTimeAgo(trace.started_at)}
                  </td>

                  {/* Arrow Action */}
                  <td className="py-3.5 px-4 text-right text-[#404040] group-hover:text-[#6366f1] transition-colors">
                    <ExternalLink className="w-4 h-4 ml-auto" />
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
