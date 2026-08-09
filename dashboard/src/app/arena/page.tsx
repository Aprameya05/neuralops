'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Play, Clock, Award, Cpu, CheckCircle2, Zap } from 'lucide-react';
import { runBenchmarkSuite, BenchmarkResult } from '@/lib/api';
import { formatDuration } from '@/lib/utils';

export default function ArenaPage() {
  const [prompt, setPrompt] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<BenchmarkResult[]>([]);

  const handleRunBenchmark = async () => {
    if (!prompt.trim() || isRunning) return;

    setIsRunning(true);
    setResults([]);

    try {
      const data = await runBenchmarkSuite(prompt);
      // Sort results by quality_score descending
      const sorted = [...data.results].sort((a, b) => b.quality_score - a.quality_score);
      
      // Update rank indices
      const ranked = sorted.map((item, idx) => ({ ...item, rank: idx + 1 }));
      setResults(ranked);
    } catch (err) {
      console.error('Failed to run benchmark', err);
    } finally {
      setIsRunning(false);
    }
  };

  const getProviderBadgeClass = (provider: string) => {
    const p = provider.toLowerCase();
    if (p.includes('groq')) return 'bg-[#6366f115] text-[#818cf8] border-[#6366f130]';
    if (p.includes('gemini')) return 'bg-[#3b82f615] text-[#60a5fa] border-[#3b82f630]';
    if (p.includes('mistral')) return 'bg-[#f9731615] text-[#fb923c] border-[#f9731630]';
    return 'bg-[#8b5cf615] text-[#c084fc] border-[#8b5cf630]'; // OpenRouter or default
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="p-8 max-w-7xl mx-auto space-y-8"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-6">
        <div>
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-[#6366f1]" />
            <h1 className="text-2xl font-bold tracking-tight text-[#f5f5f5]">Benchmark Arena</h1>
          </div>
          <p className="text-xs text-[#737373] mt-1">
            Run the same prompt across all providers simultaneously and rank by quality
          </p>
        </div>

        <div className="flex items-center gap-2 bg-[#0f0f0f] border border-[#1a1a1a] px-3 py-1.5 rounded-full text-xs text-[#10b981] font-mono">
          <Zap className="w-3.5 h-3.5" />
          <span>Parallel Inference Engine</span>
        </div>
      </div>

      {/* Input Section */}
      <div className="space-y-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-[#737373]">
          Benchmark Evaluation Prompt
        </label>
        <textarea
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter prompt to evaluate across Groq, Gemini, Mistral, and OpenRouter models..."
          className="w-full bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-4 text-sm text-[#f5f5f5] placeholder-[#404040] focus:outline-none focus:border-[#6366f1] transition-colors resize-none font-mono"
        />

        <button
          onClick={handleRunBenchmark}
          disabled={isRunning || !prompt.trim()}
          className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-mono text-xs font-bold uppercase tracking-wider transition-all shadow-lg ${
            isRunning || !prompt.trim()
              ? 'bg-[#141414] text-[#404040] border border-[#1a1a1a] cursor-not-allowed'
              : 'bg-[#6366f1] text-white hover:bg-[#4f46e5] shadow-[#6366f130] cursor-pointer'
          }`}
        >
          <Play className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
          <span>{isRunning ? 'Running Benchmark Across Providers...' : 'Run Benchmark'}</span>
        </button>
      </div>

      {/* Loading Skeleton Rows */}
      {isRunning && (
        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl overflow-hidden shadow-xl p-6 space-y-4 animate-pulse">
          <div className="h-4 w-48 bg-[#141414] rounded"></div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 bg-[#141414] border border-[#1a1a1a] rounded-xl flex items-center justify-between px-4">
              <div className="h-4 w-20 bg-[#1a1a1a] rounded"></div>
              <div className="h-4 w-32 bg-[#1a1a1a] rounded"></div>
              <div className="h-4 w-16 bg-[#1a1a1a] rounded"></div>
            </div>
          ))}
        </div>
      )}

      {/* Ranked Leaderboard Table */}
      {!isRunning && results.length > 0 && (
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-6"
          >
            <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl overflow-hidden shadow-xl">
              <div className="px-6 py-4 border-b border-[#1a1a1a] bg-[#141414] text-xs font-semibold uppercase tracking-wider text-[#737373] flex justify-between items-center">
                <span>Leaderboard Rankings</span>
                <span className="font-mono text-[11px] text-[#6366f1]">Sorted by Quality Score</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#1a1a1a] text-[11px] uppercase tracking-wider text-[#737373] font-medium bg-[#0f0f0f]">
                      <th className="py-3.5 px-6">Rank</th>
                      <th className="py-3.5 px-6">Provider</th>
                      <th className="py-3.5 px-6">Model</th>
                      <th className="py-3.5 px-6">Quality Score</th>
                      <th className="py-3.5 px-6 text-right">Latency</th>
                      <th className="py-3.5 px-6 text-right">Tokens</th>
                      <th className="py-3.5 px-6">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1a1a1a] text-sm text-[#f5f5f5]">
                    {results.map((row) => {
                      const isWinner = row.rank === 1;

                      return (
                        <tr
                          key={row.provider + row.model}
                          className={`transition-colors font-mono text-xs ${
                            isWinner
                              ? 'bg-[#6366f115] border-l-4 border-l-[#6366f1]'
                              : 'hover:bg-[#141414]'
                          }`}
                        >
                          {/* Rank */}
                          <td className="py-3.5 px-6 font-bold">
                            {isWinner ? (
                              <div className="flex items-center gap-1.5 text-[#6366f1]">
                                <Award className="w-4 h-4 text-[#6366f1]" />
                                <span>#1 Winner</span>
                              </div>
                            ) : (
                              <span className="text-[#737373]">#{row.rank}</span>
                            )}
                          </td>

                          {/* Provider Badge */}
                          <td className="py-3.5 px-6">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border ${getProviderBadgeClass(
                                row.provider
                              )}`}
                            >
                              {row.provider}
                            </span>
                          </td>

                          {/* Model */}
                          <td className="py-3.5 px-6 font-semibold text-[#f5f5f5]">{row.model}</td>

                          {/* Quality Score Progress Bar + Number */}
                          <td className="py-3.5 px-6">
                            <div className="flex items-center gap-3">
                              <div className="w-24 h-2 bg-[#141414] rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${isWinner ? 'bg-[#6366f1]' : 'bg-[#818cf8]'}`}
                                  style={{ width: `${(row.quality_score / 10) * 100}%` }}
                                />
                              </div>
                              <span className="font-bold text-[#f5f5f5]">{row.quality_score} / 10</span>
                            </div>
                          </td>

                          {/* Latency */}
                          <td className="py-3.5 px-6 text-right text-[#f5f5f5]">
                            {formatDuration(row.latency_ms)}
                          </td>

                          {/* Tokens */}
                          <td className="py-3.5 px-6 text-right text-[#737373]">{row.tokens}</td>

                          {/* Status */}
                          <td className="py-3.5 px-6">
                            <div className="flex items-center gap-1.5 text-[#10b981]">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span className="capitalize">{row.status}</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Four Side-by-Side Response Cards */}
            <div className="space-y-4 pt-4">
              <h2 className="text-base font-semibold text-[#f5f5f5]">Provider Text Responses</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {results.map((res, index) => (
                  <motion.div
                    key={res.provider}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.08 }}
                    className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-5 flex flex-col justify-between space-y-4 hover:border-[#2a2a2a] transition-colors"
                  >
                    <div>
                      <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-3 mb-3">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-medium border ${getProviderBadgeClass(
                            res.provider
                          )}`}
                        >
                          {res.provider}
                        </span>
                        <div className="flex items-center gap-1 text-xs font-mono text-[#737373]">
                          <Clock className="w-3 h-3 text-[#10b981]" />
                          <span>{formatDuration(res.latency_ms)}</span>
                        </div>
                      </div>

                      <div className="text-xs font-mono text-[#818cf8] mb-2">{res.model}</div>
                      <div className="text-xs font-mono text-[#f5f5f5] bg-[#141414] p-3 rounded-xl leading-relaxed whitespace-pre-wrap">
                        {res.text}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[#1a1a1a] flex items-center justify-between text-[11px] font-mono text-[#737373]">
                      <span>Quality: {res.quality_score}/10</span>
                      <span>Tokens: {res.tokens}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </motion.div>
  );
}
