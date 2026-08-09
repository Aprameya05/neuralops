'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Bot, Plus, Cpu } from 'lucide-react';
import AgentCard from '@/components/AgentCard';
import { useFetch } from '@/lib/hooks';
import { getAgentsSummary } from '@/lib/api';

export default function AgentsPage() {
  const { data: agents, loading } = useFetch(getAgentsSummary);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-8 max-w-7xl mx-auto space-y-8"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f5f5f5]">Agent Registry</h1>
          <p className="text-xs text-[#737373] mt-1">Instrumented agent services & performance telemetry</p>
        </div>

        <button className="flex items-center gap-2 bg-[#6366f1] text-white px-4 py-2 rounded-xl text-xs font-mono font-medium hover:bg-[#4f46e5] transition-colors shadow-lg shadow-[#6366f130]">
          <Plus className="w-4 h-4" />
          <span>Register Agent</span>
        </button>
      </div>

      {/* Grid of Agent Cards - 3 Columns */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-64 bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {agents?.map((agent, index) => (
            <AgentCard key={agent.agent_id} agent={agent} index={index} />
          ))}
        </div>
      )}
    </motion.div>
  );
}
