'use client';

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, Clock, FileX2 } from 'lucide-react';
import TraceTable from '@/components/TraceTable';
import { useFetch } from '@/lib/hooks';
import { getTraces } from '@/lib/api';

export default function TracesPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [timeRange, setTimeRange] = useState('24h');

  const { data: rawTraces, loading } = useFetch(getTraces);

  const filteredTraces = useMemo(() => {
    if (!rawTraces) return [];
    return rawTraces.filter((t) => {
      // Status filter
      if (statusFilter !== 'all' && t.status !== statusFilter) {
        return false;
      }
      // Search query filter (matches causal_chain_id or agent_ids)
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesChain = t.causal_chain_id.toLowerCase().includes(q);
        const matchesAgent = t.agent_ids.some((a) => a.toLowerCase().includes(q));
        return matchesChain || matchesAgent;
      }
      return true;
    });
  }, [rawTraces, statusFilter, searchQuery]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="p-8 max-w-7xl mx-auto space-y-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f5f5f5]">Trace Explorer</h1>
          <p className="text-xs text-[#737373] mt-1">Search, filter, and inspect multi-hop causal spans</p>
        </div>
        <div className="font-mono text-xs text-[#737373]">
          Showing <span className="text-[#f5f5f5] font-bold">{filteredTraces.length}</span> traces
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Text Input Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-[#737373]" />
          <input
            type="text"
            placeholder="Search by agent ID or chain hash..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl pl-10 pr-4 py-2.5 text-xs text-[#f5f5f5] placeholder-[#404040] focus:outline-none focus:border-[#6366f1] transition-colors font-mono"
          />
        </div>

        {/* Status Select */}
        <div className="relative">
          <Filter className="w-4 h-4 absolute left-3.5 top-3 text-[#737373]" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl pl-10 pr-4 py-2.5 text-xs text-[#f5f5f5] focus:outline-none focus:border-[#6366f1] transition-colors appearance-none font-mono cursor-pointer"
          >
            <option value="all">All Statuses</option>
            <option value="ok">Success (ok)</option>
            <option value="error">Failed (error)</option>
            <option value="hallucination">Hallucinated</option>
          </select>
        </div>

        {/* Time Range Select */}
        <div className="relative">
          <Clock className="w-4 h-4 absolute left-3.5 top-3 text-[#737373]" />
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="w-full bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl pl-10 pr-4 py-2.5 text-xs text-[#f5f5f5] focus:outline-none focus:border-[#6366f1] transition-colors appearance-none font-mono cursor-pointer"
          >
            <option value="1h">Last 1 Hour</option>
            <option value="24h">Last 24 Hours</option>
            <option value="7d">Last 7 Days</option>
          </select>
        </div>
      </div>

      {/* Main Table or Empty State */}
      {!loading && filteredTraces.length === 0 ? (
        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-16 text-center space-y-3">
          <FileX2 className="w-8 h-8 text-[#404040] mx-auto" />
          <h3 className="text-sm font-semibold text-[#f5f5f5]">No traces matched your query</h3>
          <p className="text-xs text-[#737373]">Try adjusting your search keywords or status filters</p>
        </div>
      ) : (
        <TraceTable traces={filteredTraces} loading={loading} />
      )}
    </motion.div>
  );
}
