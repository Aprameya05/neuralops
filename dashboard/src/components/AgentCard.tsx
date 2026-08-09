'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { AgentSummary } from '@/lib/types';
import { formatDuration, formatTimeAgo, formatCost } from '@/lib/utils';
import { Bot, Zap } from 'lucide-react';

interface AgentCardProps {
  agent: AgentSummary;
  index: number;
}

export default function AgentCard({ agent, index }: AgentCardProps) {
  const isHighError = agent.error_rate > 0.05;
  const progressWidth = Math.min(agent.error_rate * 100, 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      whileHover={{ scale: 1.02, borderColor: '#2a2a2a' }}
      className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6 hover:shadow-[0_0_0_1px_#6366f120] transition-colors flex flex-col justify-between"
    >
      <div>
        {/* Header: Framework Pill + Service */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-[#6366f115] text-[#818cf8] border border-[#6366f130]">
            {agent.agent_framework}
          </span>
          <span className="text-xs font-mono text-[#737373]">{agent.service_name}</span>
        </div>

        {/* Agent ID Monospace Large */}
        <div className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-xl bg-[#141414] border border-[#1a1a1a] flex items-center justify-center text-[#6366f1]">
            <Bot className="w-4 h-4" />
          </div>
          <h3 className="text-base font-mono font-bold text-[#f5f5f5] tracking-tight">
            {agent.agent_id}
          </h3>
        </div>

        {/* Latency & Cost Stats Grid */}
        <div className="grid grid-cols-3 gap-2 p-3 rounded-xl bg-[#141414] border border-[#1a1a1a] mb-4 text-center">
          <div>
            <div className="text-[10px] uppercase text-[#737373]">Spans</div>
            <div className="text-xs font-mono font-bold text-[#f5f5f5] mt-0.5">{agent.total_spans}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-[#737373]">Avg Latency</div>
            <div className="text-xs font-mono font-bold text-[#f5f5f5] mt-0.5">{formatDuration(agent.avg_latency_ms)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-[#737373]">Total USD</div>
            <div className="text-xs font-mono font-bold text-[#10b981] mt-0.5">{formatCost(agent.total_cost_usd)}</div>
          </div>
        </div>

        {/* Error rate progress bar */}
        <div>
          <div className="flex justify-between text-xs font-mono mb-1.5">
            <span className="text-[#737373]">Error Rate</span>
            <span className={isHighError ? 'text-[#ef4444] font-bold' : 'text-[#10b981]'}>
              {(agent.error_rate * 100).toFixed(1)}%
            </span>
          </div>
          <div className="h-1.5 w-full bg-[#141414] rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${isHighError ? 'bg-[#ef4444]' : 'bg-[#10b981]'}`}
              style={{ width: `${Math.max(progressWidth, 3)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Footer Last Seen relative time */}
      <div className="mt-5 pt-3 border-t border-[#1a1a1a] flex items-center justify-between text-xs text-[#737373] font-mono">
        <div className="flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-[#10b981]" />
          <span>Active</span>
        </div>
        <span>Seen {formatTimeAgo(agent.last_seen)}</span>
      </div>
    </motion.div>
  );
}
