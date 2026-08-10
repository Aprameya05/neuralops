'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Wifi, WifiOff } from 'lucide-react';

interface LiveEvent {
  id: string;
  span_id: string;
  causal_chain_id: string;
  agent_id: string;
  operation_name: string;
  status: 'ok' | 'error' | 'hallucination';
  duration_ms: number;
  timestamp: number;
}

const MAX_EVENTS = 8;

const statusColors: Record<string, string> = {
  ok:           'text-[#10b981]',
  error:        'text-[#ef4444]',
  hallucination:'text-[#f59e0b]',
};

const statusDot: Record<string, string> = {
  ok:           'bg-[#10b981]',
  error:        'bg-[#ef4444]',
  hallucination:'bg-[#f59e0b]',
};

function formatDur(ms: number): string {
  if (!ms) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function LiveEventFeed() {
  const [events, setEvents]       = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [totalSeen, setTotalSeen] = useState(0);
  const wsRef                     = useRef<WebSocket | null>(null);
  const reconnectRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  const WS_URL = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000').replace(/^http/, 'ws') + '/ws/traces';

  function connect() {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === 'span' && msg.data) {
          const d = msg.data;
          const event: LiveEvent = {
            id:             Math.random().toString(36).slice(2),
            span_id:        d.span_id        || '',
            causal_chain_id:d.causal_chain_id|| '',
            agent_id:       d.agent_id       || 'unknown',
            operation_name: d.operation_name || 'unknown',
            status:         d.status         || 'ok',
            duration_ms:    d.duration_ms    || 0,
            timestamp:      Date.now(),
          };
          setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
          setTotalSeen((n) => n + 1);
        }
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after 3 seconds
      reconnectRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, []);

  return (
    <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl overflow-hidden shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1a1a1a] bg-[#0a0a0a]">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-[#6366f115] border border-[#6366f130]">
            <Zap className="w-3.5 h-3.5 text-[#6366f1]" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[#f5f5f5]">Live Span Feed</h3>
            <p className="text-[10px] text-[#737373] font-mono">
              {totalSeen} events received this session
            </p>
          </div>
        </div>

        {/* Connection status */}
        <div className={`flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-full border ${
          connected
            ? 'text-[#10b981] bg-[#10b98110] border-[#10b98130]'
            : 'text-[#737373] bg-[#14141480] border-[#1a1a1a]'
        }`}>
          {connected ? (
            <>
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10b981] opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#10b981]" />
              </span>
              <Wifi className="w-3 h-3" />
              <span>LIVE</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3 h-3" />
              <span>Reconnecting...</span>
            </>
          )}
        </div>
      </div>

      {/* Event list */}
      <div className="divide-y divide-[#1a1a1a] min-h-[200px]">
        <AnimatePresence initial={false}>
          {events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-[#141414] border border-[#1a1a1a] flex items-center justify-center">
                <Zap className="w-4 h-4 text-[#2a2a2a]" />
              </div>
              <p className="text-xs text-[#737373]">
                {connected ? 'Waiting for spans...' : 'Connecting to live stream...'}
              </p>
              <p className="text-[10px] text-[#404040] font-mono">
                Spans appear here as agents execute
              </p>
            </div>
          ) : (
            events.map((ev) => (
              <motion.div
                key={ev.id}
                initial={{ opacity: 0, y: -8, backgroundColor: '#6366f108' }}
                animate={{ opacity: 1, y: 0, backgroundColor: '#00000000' }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex items-center gap-4 px-6 py-3 hover:bg-[#141414] transition-colors"
              >
                {/* Status dot */}
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot[ev.status] || 'bg-[#737373]'}`} />

                {/* Operation */}
                <span className="font-mono text-xs text-[#f5f5f5] flex-1 truncate min-w-0">
                  {ev.operation_name}
                </span>

                {/* Agent */}
                <span className="px-2 py-0.5 rounded-md bg-[#141414] border border-[#1a1a1a] text-[10px] font-mono text-[#818cf8] flex-shrink-0 hidden sm:inline">
                  {ev.agent_id}
                </span>

                {/* Duration */}
                <span className="font-mono text-[10px] text-[#737373] flex-shrink-0 w-14 text-right">
                  {formatDur(ev.duration_ms)}
                </span>

                {/* Status text */}
                <span className={`font-mono text-[10px] flex-shrink-0 w-16 text-right capitalize ${statusColors[ev.status] || 'text-[#737373]'}`}>
                  {ev.status}
                </span>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Footer */}
      {events.length > 0 && (
        <div className="px-6 py-2 border-t border-[#1a1a1a] bg-[#0a0a0a] flex items-center justify-between">
          <span className="text-[10px] font-mono text-[#404040]">
            Showing last {events.length} of {totalSeen} events
          </span>
          <button
            onClick={() => setEvents([])}
            className="text-[10px] font-mono text-[#404040] hover:text-[#737373] transition-colors"
          >
            clear
          </button>
        </div>
      )}
    </div>
  );
}
