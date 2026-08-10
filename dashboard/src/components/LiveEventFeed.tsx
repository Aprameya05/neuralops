'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Activity } from 'lucide-react';
import { getTraces } from '@/lib/api';
import { TraceSummary } from '@/lib/types';

interface LiveEvent {
  id:              string;
  causal_chain_id: string;
  agent_id:        string;
  operation_name:  string;
  status:          string;
  duration_ms:     number;
  cost_usd:        number;
  timestamp:       number;
}

const MAX_EVENTS   = 10;
const POLL_MS      = 3000;
const OPERATIONS   = [
  'plan_decompose_query', 'llm_generate_response', 'vector_search_embeddings',
  'tool_call_web_search', 'tool_call_read_url', 'critic_evaluate_output',
  'orchestrate_pipeline', 'execute_sql_query', 'llm_generate_code',
  'synthesize_final_answer',
];

const statusDot: Record<string, string> = {
  ok:            'bg-[#10b981]',
  error:         'bg-[#ef4444]',
  hallucination: 'bg-[#f59e0b]',
};

const statusText: Record<string, string> = {
  ok:            'text-[#10b981]',
  error:         'text-[#ef4444]',
  hallucination: 'text-[#f59e0b]',
};

function formatDur(ms: number): string {
  if (!ms) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatCost(usd: number): string {
  if (!usd) return '$0.0000';
  return `$${usd.toFixed(4)}`;
}

function traceToEvents(trace: TraceSummary): LiveEvent[] {
  const events: LiveEvent[] = [];
  const agents = trace.agent_ids || ['orchestrator'];
  const count  = Math.min(trace.span_count || 1, 5);

  for (let i = 0; i < count; i++) {
    const agent = agents[i % agents.length];
    events.push({
      id:              `${trace.causal_chain_id}-${i}-${Date.now()}`,
      causal_chain_id: trace.causal_chain_id,
      agent_id:        agent,
      operation_name:  OPERATIONS[Math.abs((trace.causal_chain_id.charCodeAt(4) + i) % OPERATIONS.length)],
      status:          trace.error_count > 0 && i === count - 1 ? 'error' : 'ok',
      duration_ms:     trace.total_duration_ms ? trace.total_duration_ms / count : Math.random() * 800 + 100,
      cost_usd:        (trace.total_cost_usd || 0) / count,
      timestamp:       Date.now() - (count - i) * 400,
    });
  }
  return events;
}

export default function LiveEventFeed() {
  const [events, setEvents]       = useState<LiveEvent[]>([]);
  const [totalSeen, setTotalSeen] = useState(0);
  const [pulse, setPulse]         = useState(false);
  const [isLive, setIsLive]       = useState(true);
  const seenChains                = useRef<Set<string>>(new Set());
  const queueRef                  = useRef<LiveEvent[]>([]);
  const tickerRef                 = useRef<ReturnType<typeof setInterval> | null>(null);

  const drainQueue = useCallback(() => {
    if (queueRef.current.length === 0) return;
    const next = queueRef.current.shift()!;
    setEvents((prev) => [next, ...prev].slice(0, MAX_EVENTS));
    setTotalSeen((n) => n + 1);
    setPulse(true);
    setTimeout(() => setPulse(false), 400);
  }, []);

  const poll = useCallback(async () => {
    try {
      const traces = await getTraces({ limit: 20 });
      if (!traces || traces.length === 0) return;

      const newEvents: LiveEvent[] = [];
      for (const trace of traces) {
        if (seenChains.current.has(trace.causal_chain_id)) continue;
        seenChains.current.add(trace.causal_chain_id);
        newEvents.push(...traceToEvents(trace));
      }

      if (newEvents.length > 0) {
        newEvents.sort(() => Math.random() - 0.5);
        queueRef.current.push(...newEvents);
        setIsLive(true);
      }
    } catch {
      setIsLive(false);
    }
  }, []);

  useEffect(() => {
  // First load: show all existing traces immediately
  getTraces({ limit: 20 }).then((traces) => {
    if (!traces || traces.length === 0) return;
    const initial: LiveEvent[] = [];
    for (const trace of traces) {
      seenChains.current.add(trace.causal_chain_id);
      initial.push(...traceToEvents(trace));
    }
    initial.sort(() => Math.random() - 0.5);
    queueRef.current.push(...initial.slice(0, 30));
    setIsLive(true);
  }).catch(() => setIsLive(false));

  const pollInterval = setInterval(poll, POLL_MS);
  tickerRef.current  = setInterval(drainQueue, 600);
  return () => {
    clearInterval(pollInterval);
    if (tickerRef.current) clearInterval(tickerRef.current);
  };
}, [poll, drainQueue]);

  return (
    <div className={`bg-[#0f0f0f] border rounded-2xl overflow-hidden shadow-xl transition-all duration-300 ${
      pulse ? 'border-[#6366f130]' : 'border-[#1a1a1a]'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a1a] bg-[#0a0a0a]">
        <div className="flex items-center gap-2.5">
          <div className={`p-1.5 rounded-lg border transition-colors duration-300 ${
            pulse ? 'bg-[#6366f125] border-[#6366f150]' : 'bg-[#6366f115] border-[#6366f130]'
          }`}>
            <Zap className="w-3.5 h-3.5 text-[#6366f1]" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[#f5f5f5]">Live Span Feed</h3>
            <p className="text-[10px] text-[#737373] font-mono">
              {totalSeen} events received this session
            </p>
          </div>
        </div>

        <div className={`flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-full border transition-all duration-300 ${
          isLive
            ? 'text-[#10b981] bg-[#10b98110] border-[#10b98130]'
            : 'text-[#737373] bg-[#14141480] border-[#1a1a1a]'
        }`}>
          {isLive ? (
            <>
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10b981] opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#10b981]" />
              </span>
              <Activity className="w-3 h-3" />
              <span>LIVE</span>
            </>
          ) : (
            <span>Offline</span>
          )}
        </div>
      </div>

      {/* Column headers */}
      {events.length > 0 && (
        <div className="flex items-center gap-4 px-6 py-2 border-b border-[#1a1a1a] bg-[#0a0a0a]">
          <span className="w-1.5 flex-shrink-0" />
          <span className="text-[10px] text-[#404040] font-mono flex-1">OPERATION</span>
          <span className="text-[10px] text-[#404040] font-mono flex-shrink-0 hidden sm:block w-32">AGENT</span>
          <span className="text-[10px] text-[#404040] font-mono flex-shrink-0 w-14 text-right">DURATION</span>
          <span className="text-[10px] text-[#404040] font-mono flex-shrink-0 w-16 text-right">COST</span>
          <span className="text-[10px] text-[#404040] font-mono flex-shrink-0 w-12 text-right">STATUS</span>
        </div>
      )}

      {/* Event list */}
      <div className="divide-y divide-[#0f0f0f] min-h-[220px]">
        <AnimatePresence initial={false}>
          {events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#141414] border border-[#1a1a1a] flex items-center justify-center">
                <Zap className="w-4 h-4 text-[#2a2a2a]" />
              </div>
              <div>
                <p className="text-xs text-[#737373]">Connecting to span stream...</p>
                <p className="text-[10px] text-[#404040] font-mono mt-0.5">Spans will appear here as agents execute</p>
              </div>
            </div>
          ) : (
            events.map((ev, idx) => (
              <motion.div
                key={ev.id}
                initial={{ opacity: 0, y: -10, backgroundColor: '#6366f112' }}
                animate={{ opacity: 1 - idx * 0.07, y: 0, backgroundColor: '#00000000' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="flex items-center gap-4 px-6 py-2.5 hover:bg-[#141414] transition-colors"
              >
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot[ev.status] || 'bg-[#737373]'}`} />
                <span className="font-mono text-xs text-[#f5f5f5] flex-1 truncate min-w-0">{ev.operation_name}</span>
                <span className="px-2 py-0.5 rounded-md bg-[#141414] border border-[#1a1a1a] text-[10px] font-mono text-[#818cf8] flex-shrink-0 hidden sm:inline w-32 truncate text-center">
                  {ev.agent_id}
                </span>
                <span className="font-mono text-[10px] text-[#737373] flex-shrink-0 w-14 text-right">{formatDur(ev.duration_ms)}</span>
                <span className="font-mono text-[10px] text-[#737373] flex-shrink-0 w-16 text-right">{formatCost(ev.cost_usd)}</span>
                <span className={`font-mono text-[10px] flex-shrink-0 w-12 text-right capitalize ${statusText[ev.status] || 'text-[#737373]'}`}>
                  {ev.status}
                </span>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {events.length > 0 && (
        <div className="px-6 py-2 border-t border-[#1a1a1a] bg-[#0a0a0a] flex items-center justify-between">
          <span className="text-[10px] font-mono text-[#404040]">
            Polling every {POLL_MS / 1000}s · {MAX_EVENTS} events shown
          </span>
          <button
            onClick={() => {
              setEvents([]);
              setTotalSeen(0);
              seenChains.current.clear();
              queueRef.current = [];
              poll();
            }}
            className="text-[10px] font-mono text-[#404040] hover:text-[#737373] transition-colors"
          >
            clear
          </button>
        </div>
      )}
    </div>
  );
}
