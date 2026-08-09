'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, GitBranch, Layers, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { searchSpans, searchChains } from '@/lib/api';
import { SpanSearchResult, ChainSearchResult } from '@/lib/types';
import { formatTimeAgo, formatDuration } from '@/lib/utils';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'spans' | 'chains'>('spans');
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  
  const [spanResults, setSpanResults] = useState<SpanSearchResult[]>([]);
  const [chainResults, setChainResults] = useState<ChainSearchResult[]>([]);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setIsLoading(true);
    setHasSearched(true);

    try {
      if (activeTab === 'spans') {
        const results = await searchSpans(query.trim(), 20);
        setSpanResults(results);
      } else {
        const results = await searchChains(query.trim(), 20);
        setChainResults(results);
      }
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Replace the useEffect in search/page.tsx
useEffect(() => {
  if (hasSearched && query.trim()) {
    handleSearch();
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [activeTab])

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-8 max-w-7xl mx-auto space-y-8"
    >
      {/* Header */}
      <div className="border-b border-[#1a1a1a] pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[#f5f5f5]">Semantic Search</h1>
        <p className="text-xs text-[#737373] mt-1">Find similar traces and agent behaviors using natural language</p>
      </div>

      {/* Large Search Input Bar & Tab Selectors */}
      <div className="space-y-4">
        <form onSubmit={handleSearch} className="flex gap-3">
          <div className="relative flex-1">
            <Search className="w-5 h-5 absolute left-4 top-3.5 text-[#737373]" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search spans by behavior, error, or operation..."
              className="w-full bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl pl-12 pr-4 py-3 text-sm text-[#f5f5f5] placeholder-[#737373] focus:outline-none focus:border-[#6366f1] transition-colors shadow-inner"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className="bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium px-6 py-3 rounded-xl transition-all duration-150 flex items-center gap-2 text-sm shadow-lg shadow-[#6366f125] flex-shrink-0"
          >
            <Search className="w-4 h-4" />
            <span>Search</span>
          </button>
        </form>

        {/* Tab Buttons */}
        <div className="flex items-center gap-2 border-b border-[#1a1a1a] pb-1">
          <button
            onClick={() => setActiveTab('spans')}
            className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 relative ${
              activeTab === 'spans'
                ? 'text-[#f5f5f5] bg-[#141414] border border-[#1a1a1a]'
                : 'text-[#737373] hover:text-[#f5f5f5] hover:bg-[#0f0f0f]'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Spans</span>
            {activeTab === 'spans' && (
              <motion.div
                layoutId="activeSearchTab"
                className="absolute bottom-[-5px] left-0 right-0 h-[2px] bg-[#6366f1]"
              />
            )}
          </button>
          <button
            onClick={() => setActiveTab('chains')}
            className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors flex items-center gap-2 relative ${
              activeTab === 'chains'
                ? 'text-[#f5f5f5] bg-[#141414] border border-[#1a1a1a]'
                : 'text-[#737373] hover:text-[#f5f5f5] hover:bg-[#0f0f0f]'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Causal Chains</span>
            {activeTab === 'chains' && (
              <motion.div
                layoutId="activeSearchTab"
                className="absolute bottom-[-5px] left-0 right-0 h-[2px] bg-[#6366f1]"
              />
            )}
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        /* Loading Skeleton */
        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl overflow-hidden shadow-xl animate-pulse">
          <div className="h-10 border-b border-[#1a1a1a] bg-[#141414] px-6 flex items-center justify-between">
            <div className="h-3 w-24 bg-[#1a1a1a] rounded"></div>
            <div className="h-3 w-32 bg-[#1a1a1a] rounded"></div>
            <div className="h-3 w-20 bg-[#1a1a1a] rounded"></div>
          </div>
          <div className="divide-y divide-[#1a1a1a]">
            {Array.from({ length: 5 }).map((_, idx) => (
              <div key={idx} className="p-4 px-6 flex items-center justify-between gap-4">
                <div className="w-28 h-2 bg-[#1a1a1a] rounded-full"></div>
                <div className="w-40 h-4 bg-[#141414] border border-[#1a1a1a] rounded"></div>
                <div className="w-24 h-4 bg-[#141414] border border-[#1a1a1a] rounded-md"></div>
                <div className="w-16 h-3 bg-[#141414] rounded"></div>
              </div>
            ))}
          </div>
        </div>
      ) : !hasSearched ? (
        /* Empty / Initial State */
        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-16 text-center space-y-4 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-[#141414] border border-[#1a1a1a] flex items-center justify-center mx-auto text-[#6366f1]">
            <Search className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto">
            <h3 className="text-base font-semibold text-[#f5f5f5]">Enter a query to find similar traces</h3>
            <p className="text-xs text-[#737373] mt-1">
              Search across vector embeddings by describing agent behaviors, error messages, or tool invocations in plain English.
            </p>
          </div>
        </div>
      ) : activeTab === 'spans' ? (
        /* Spans Table Results */
        spanResults.length === 0 ? (
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-12 text-center text-[#737373] text-sm shadow-xl">
            No matching spans found for query &quot;{query}&quot;
          </div>
        ) : (
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#141414] border-b border-[#1a1a1a] text-[#737373] font-medium">
                    <th className="py-3.5 px-6">Similarity Score</th>
                    <th className="py-3.5 px-6">Operation</th>
                    <th className="py-3.5 px-6">Agent</th>
                    <th className="py-3.5 px-6">Status</th>
                    <th className="py-3.5 px-6">Duration</th>
                    <th className="py-3.5 px-6 text-right">Started At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a]">
                  {spanResults.map((span, index) => {
                    const statusColor =
                      span.status === 'ok'
                        ? 'bg-[#10b981]'
                        : span.status === 'error'
                        ? 'bg-[#ef4444]'
                        : 'bg-[#f59e0b]';

                    return (
                      <motion.tr
                        key={span.span_id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: index * 0.04 }}
                        className="hover:bg-[#141414] transition-colors"
                      >
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <div className="w-24 bg-[#141414] border border-[#1a1a1a] h-2 rounded-full overflow-hidden">
                              <div
                                className="bg-[#6366f1] h-full rounded-full transition-all duration-300"
                                style={{ width: `${Math.round(span.similarity * 100)}%` }}
                              />
                            </div>
                            <span className="font-mono text-xs text-[#818cf8]">
                              {(span.similarity * 100).toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        <td className="py-4 px-6 font-mono font-bold text-sm text-[#f5f5f5]">
                          {span.operation_name}
                        </td>
                        <td className="py-4 px-6">
                          <span className="px-2.5 py-1 rounded-md bg-[#141414] border border-[#1a1a1a] text-xs font-mono text-[#818cf8]">
                            {span.agent_id}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${statusColor}`} />
                            <span className="capitalize font-mono text-xs text-[#f5f5f5]">
                              {span.status}
                            </span>
                          </div>
                        </td>
                        <td className="py-4 px-6 font-mono text-[#737373]">
                          {formatDuration(span.duration_ms)}
                        </td>
                        <td className="py-4 px-6 font-mono text-[#737373] text-right">
                          {formatTimeAgo(span.started_at)}
                        </td>
                      </motion.tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ) : (
        /* Causal Chains Table Results */
        chainResults.length === 0 ? (
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-12 text-center text-[#737373] text-sm shadow-xl">
            No matching causal chains found for query &quot;{query}&quot;
          </div>
        ) : (
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#141414] border-b border-[#1a1a1a] text-[#737373] font-medium">
                    <th className="py-3.5 px-6">Similarity</th>
                    <th className="py-3.5 px-6">Chain ID</th>
                    <th className="py-3.5 px-6">Agents involved</th>
                    <th className="py-3.5 px-6">Span Count</th>
                    <th className="py-3.5 px-6">Total Cost</th>
                    <th className="py-3.5 px-6 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1a1a1a]">
                  {chainResults.map((chain, index) => (
                    <motion.tr
                      key={chain.causal_chain_id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.04 }}
                      className="hover:bg-[#141414] transition-colors"
                    >
                      <td className="py-4 px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-24 bg-[#141414] border border-[#1a1a1a] h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-[#6366f1] h-full rounded-full transition-all duration-300"
                              style={{ width: `${Math.round(chain.similarity * 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-[#818cf8]">
                            {(chain.similarity * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-6">
                        <Link
                          href={`/replay/${chain.causal_chain_id}`}
                          className="font-mono font-medium text-[#6366f1] hover:underline flex items-center gap-1 group"
                        >
                          <span>{chain.causal_chain_id}</span>
                          <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      </td>
                      <td className="py-4 px-6">
                        <div className="flex flex-wrap gap-1.5">
                          {chain.agent_ids.map((agent) => (
                            <span
                              key={agent}
                              className="px-2 py-0.5 rounded-md bg-[#141414] border border-[#1a1a1a] text-[11px] font-mono text-[#818cf8]"
                            >
                              {agent}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-4 px-6 font-mono text-[#737373]">
                        {chain.span_count} spans
                      </td>
                      <td className="py-4 px-6 font-mono text-[#f5f5f5]">
                        ${chain.total_cost_usd.toFixed(4)}
                      </td>
                      <td className="py-4 px-6 text-right">
                        {chain.has_errors ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#ef444415] border border-[#ef444430] text-[#ef4444] text-[11px] font-mono font-medium">
                            <AlertCircle className="w-3 h-3" />
                            <span>Error</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#10b98115] border border-[#10b98130] text-[#10b981] text-[11px] font-mono font-medium">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Clean</span>
                          </span>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      )}
    </motion.div>
  );
}
