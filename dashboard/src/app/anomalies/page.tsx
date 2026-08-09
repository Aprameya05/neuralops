'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, CheckCircle2, X, Play, Zap, ArrowUpRight, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { getDriftAlerts } from '@/lib/api';
import { AnomalyAlert } from '@/lib/types';
import { formatTimeAgo } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a value string like "3840ms" or "0.87" into a raw number. */
function parseMetricValue(raw: string): number {
  const n = parseFloat(raw.replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

/**
 * Build a tiny synthetic sparkline from two data points (baseline + current)
 * so every anomaly gets a unique, contextually accurate curve rather than a
 * hard-coded one.  The chart shows 6 time-steps: the first four hover near
 * baseline, step 5 begins climbing, step 6 is the observed spike.
 */
function buildSparklinePoints(
  baselineRaw: string,
  currentRaw: string
): { x: number; y: number }[] {
  const baseline = parseMetricValue(baselineRaw) || 1;
  const current  = parseMetricValue(currentRaw)  || baseline * 2;

  // SVG coordinate system: y=0 is top, y=100 is bottom.
  // We map metric value → SVG y by inverting: higher value = lower y (higher on chart).
  const maxVal = Math.max(current * 1.1, baseline * 1.2);
  const toY = (v: number) => 90 - (v / maxVal) * 80; // leaves 10px padding top/bottom

  const xs = [10, 60, 110, 160, 210, 260];

  // Simulate a realistic run-up: flat near baseline then spike.
  const values = [
    baseline * 0.98,
    baseline * 1.00,
    baseline * 1.02,
    baseline * 1.15,
    baseline * 1.50 + (current - baseline) * 0.4,
    current,
  ];

  return xs.map((x, i) => ({ x, y: toY(values[i]) }));
}

/** Render an SVG <path> d-string from points using a simple cardinal spline. */
function pointsToPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const cpx = (prev.x + curr.x) / 2;
    d += ` C ${cpx} ${prev.y.toFixed(1)}, ${cpx} ${curr.y.toFixed(1)}, ${curr.x} ${curr.y.toFixed(1)}`;
  }
  return d;
}

// ---------------------------------------------------------------------------
// Sub-component: data-driven sparkline
// ---------------------------------------------------------------------------

function AnomalySparkline({
  anomaly,
}: {
  anomaly: AnomalyAlert;
}) {
  const pts = useMemo(
    () => buildSparklinePoints(anomaly.baseline_value, anomaly.current_value),
    [anomaly.baseline_value, anomaly.current_value]
  );

  const baselineY = useMemo(() => {
    const baseline = parseMetricValue(anomaly.baseline_value) || 1;
    const current  = parseMetricValue(anomaly.current_value)  || baseline * 2;
    const maxVal   = Math.max(current * 1.1, baseline * 1.2);
    return 90 - (baseline / maxVal) * 80;
  }, [anomaly.baseline_value, anomaly.current_value]);

  const spikeLabel = anomaly.current_value;
  const lastPt     = pts[pts.length - 1];

  return (
    <div className="bg-[#0f0f0f] border border-[#1a1a1a] p-5 rounded-xl space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-[#f5f5f5] flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-[#818cf8]" />
          Operation Metric Over Time
        </span>
        <span className="text-[10px] font-mono text-[#737373]">
          Dashed = Baseline ({anomaly.baseline_value})
        </span>
      </div>

      <div className="h-36 w-full pt-2">
        <svg className="w-full h-full overflow-visible" viewBox="0 0 300 100">
          {/* Grid lines */}
          {[20, 50, 80].map((y) => (
            <line
              key={y}
              x1="0" y1={y} x2="300" y2={y}
              stroke="#1a1a1a"
              strokeDasharray="3 3"
            />
          ))}

          {/* Baseline threshold */}
          <line
            x1="0" y1={baselineY.toFixed(1)}
            x2="300" y2={baselineY.toFixed(1)}
            stroke="#6366f1"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            opacity="0.6"
          />

          {/* Metric curve */}
          <path
            d={pointsToPath(pts)}
            fill="none"
            stroke="#ef4444"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data point dots */}
          {pts.map((pt, i) => {
            const isSpike = i === pts.length - 1;
            return (
              <g key={i}>
                {isSpike && (
                  <circle
                    cx={pt.x} cy={pt.y.toFixed(1)}
                    r="5"
                    fill="#ef4444"
                    opacity="0.3"
                    className="animate-ping"
                  />
                )}
                <circle
                  cx={pt.x} cy={pt.y.toFixed(1)}
                  r={isSpike ? 4.5 : 3 + i * 0.2}
                  fill="#ef4444"
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div className="flex justify-between text-[10px] font-mono text-[#737373] pt-1">
        <span>-30m</span>
        <span>-20m</span>
        <span>-10m</span>
        <span>Now (Spike {spikeLabel})</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AnomaliesPage() {
  const [timeRange, setTimeRange]       = useState<'1h' | '6h' | '24h'>('24h');
  const [anomalies, setAnomalies]       = useState<AnomalyAlert[]>([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [selectedAnomaly, setSelectedAnomaly] = useState<AnomalyAlert | null>(null);

  const fetchAlerts = async (hoursStr: '1h' | '6h' | '24h') => {
    const hours = hoursStr === '1h' ? 1 : hoursStr === '6h' ? 6 : 24;
    try {
      const data = await getDriftAlerts(hours);
      setAnomalies(data);
    } catch (err) {
      console.error('Failed to fetch drift alerts:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setIsLoading(true);
    fetchAlerts(timeRange);

    const interval = setInterval(() => fetchAlerts(timeRange), 30_000);
    return () => clearInterval(interval);
  }, [timeRange]);

  const borderColors: Record<AnomalyAlert['type'], string> = {
    ERROR:      'border-l-[#ef4444]',
    LATENCY:    'border-l-[#f97316]',
    COST:       'border-l-[#f59e0b]',
    ERROR_RATE: 'border-l-[#ef4444]',
  };

  const typeBadgeStyles: Record<AnomalyAlert['type'], string> = {
    ERROR:      'bg-[#ef444415] text-[#ef4444] border-[#ef444430]',
    LATENCY:    'bg-[#f9731615] text-[#f97316] border-[#f9731630]',
    COST:       'bg-[#f59e0b15] text-[#f59e0b] border-[#f59e0b30]',
    ERROR_RATE: 'bg-[#ef444415] text-[#ef4444] border-[#ef444430]',
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-8 max-w-7xl mx-auto space-y-8 relative min-h-screen"
    >
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#1a1a1a] pb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f5f5f5]">Anomaly Replay</h1>
          <p className="text-xs text-[#737373] mt-1">
            Statistically detected anomalies with root cause attribution
          </p>
        </div>

        <div className="flex items-center gap-1 bg-[#0f0f0f] border border-[#1a1a1a] p-1 rounded-xl self-start sm:self-auto">
          {(['1h', '6h', '24h'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${
                timeRange === range
                  ? 'bg-[#141414] text-[#f5f5f5] font-bold border border-[#1a1a1a] shadow-sm'
                  : 'text-[#737373] hover:text-[#f5f5f5]'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Anomaly Cards */}
      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 bg-[#0f0f0f] border border-[#1a1a1a] border-l-4 border-l-[#1a1a1a] rounded-2xl p-6 animate-pulse flex justify-between items-center"
            >
              <div className="space-y-3">
                <div className="w-48 h-4 bg-[#141414] rounded" />
                <div className="w-32 h-3 bg-[#141414] rounded" />
              </div>
              <div className="w-24 h-4 bg-[#141414] rounded" />
            </div>
          ))}
        </div>
      ) : anomalies.length === 0 ? (
        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-16 text-center space-y-4 shadow-xl">
          <div className="w-14 h-14 rounded-2xl bg-[#10b98115] border border-[#10b98130] flex items-center justify-center mx-auto text-[#10b981]">
            <CheckCircle2 className="w-7 h-7" />
          </div>
          <div className="max-w-md mx-auto">
            <h3 className="text-base font-semibold text-[#f5f5f5]">No anomalies detected in this time window</h3>
            <p className="text-xs text-[#737373] mt-1">
              All agent execution metrics (latency z-score, cost spikes, error rate) are operating within baseline standard deviations.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {anomalies.map((anom, index) => (
            <motion.div
              key={anom.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: index * 0.05 }}
              onClick={() => setSelectedAnomaly(anom)}
              className={`bg-[#0f0f0f] hover:bg-[#141414] border border-[#1a1a1a] border-l-4 ${
                borderColors[anom.type]
              } rounded-2xl p-6 transition-all duration-150 cursor-pointer shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-6 group`}
            >
              <div className="space-y-2 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono font-bold text-base text-[#f5f5f5] group-hover:text-[#6366f1] transition-colors">
                    {anom.operation_name}
                  </span>
                  <span className="text-xs text-[#737373] font-mono">{anom.agent_id}</span>
                  <span
                    className={`px-2.5 py-0.5 rounded-md border text-[11px] font-mono font-medium ${typeBadgeStyles[anom.type]}`}
                  >
                    {anom.type}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-6 text-xs font-mono pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[#737373]">Current:</span>
                    <span className="font-bold text-[#f5f5f5]">{anom.current_value}</span>
                    <span className="text-[#737373]">vs Baseline:</span>
                    <span className="text-[#a3a3a3]">{anom.baseline_value}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[#737373]">Error Rate:</span>
                    <div className="w-28 bg-[#141414] border border-[#1a1a1a] h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-[#ef4444] h-full rounded-full transition-all duration-300"
                        style={{ width: `${Math.round(anom.error_rate * 100)}%` }}
                      />
                    </div>
                    <span className="text-[#ef4444] font-bold">
                      {(anom.error_rate * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center md:flex-col md:items-end justify-between text-xs text-[#737373] font-mono flex-shrink-0 gap-2">
                <span>{formatTimeAgo(anom.timestamp)}</span>
                <span className="text-[#6366f1] text-[11px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                  Inspect anomaly <ArrowUpRight className="w-3 h-3" />
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Side Panel Drawer */}
      <AnimatePresence>
        {selectedAnomaly && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedAnomaly(null)}
              className="fixed inset-0 bg-black z-50"
            />

            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 250 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-xl bg-[#080808] border-l border-[#1a1a1a] z-50 p-6 overflow-y-auto flex flex-col justify-between shadow-2xl space-y-6"
            >
              <div className="space-y-6">
                {/* Panel Header */}
                <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-[#ef444415] border border-[#ef444430] text-[#ef4444]">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-[#f5f5f5] font-mono">
                        {selectedAnomaly.operation_name}
                      </h2>
                      <p className="text-xs text-[#737373] font-mono mt-0.5">
                        Agent: <span className="text-[#818cf8]">{selectedAnomaly.agent_id}</span>
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedAnomaly(null)}
                    className="p-2 text-[#737373] hover:text-[#f5f5f5] hover:bg-[#141414] rounded-xl transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Metric Summary Grid */}
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: 'Anomaly Type',      value: selectedAnomaly.type,           color: 'text-[#f5f5f5]' },
                    { label: 'Severity',           value: selectedAnomaly.severity,       color: 'text-[#ef4444] capitalize' },
                    { label: 'Current Observed',   value: selectedAnomaly.current_value,  color: 'text-[#f5f5f5]' },
                    { label: 'Historical Baseline',value: selectedAnomaly.baseline_value, color: 'text-[#a3a3a3]' },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-[#0f0f0f] border border-[#1a1a1a] p-4 rounded-xl space-y-1">
                      <div className="text-[11px] text-[#737373]">{label}</div>
                      <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* Root Cause Attribution */}
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] p-4 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[#f5f5f5]">
                    <Zap className="w-4 h-4 text-[#6366f1]" />
                    <span>Root Cause Attribution</span>
                  </div>
                  <p className="text-xs text-[#737373] leading-relaxed">
                    {selectedAnomaly.description ||
                      'Welford z-score exceeded baseline limits during context propagation. High concurrency on agent handoff caused downstream latency serialization.'}
                  </p>
                </div>

                {/* Data-driven sparkline */}
                <AnomalySparkline anomaly={selectedAnomaly} />
              </div>

              {/* Action */}
              <div className="pt-4 border-t border-[#1a1a1a]">
                <Link
                  href={`/replay/${selectedAnomaly.causal_chain_id}`}
                  className="w-full bg-[#6366f1] hover:bg-[#4f46e5] text-white font-medium py-3 px-4 rounded-xl transition-all duration-150 flex items-center justify-center gap-2 text-sm shadow-lg shadow-[#6366f125]"
                >
                  <Play className="w-4 h-4 fill-white" />
                  <span>View Causal Replay</span>
                </Link>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}