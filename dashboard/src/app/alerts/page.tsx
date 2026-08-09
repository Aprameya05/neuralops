'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Bell, ShieldAlert, Zap, AlertCircle } from 'lucide-react';
import { formatTimeAgo, formatDuration } from '@/lib/utils';

const SAMPLE_ALERTS = [
  { id: '1', op: 'execute_sql_query', agent: 'researcher-agent', rule: 'Latency Z-Score Anomaly (>3.8x baseline)', severity: 'critical', time: new Date(Date.now() - 120000).toISOString(), latency: 1840 },
  { id: '2', op: 'llm_generate_code', agent: 'writer-agent', rule: 'Faithfulness Score Drift (<0.50 threshold)', severity: 'warning', time: new Date(Date.now() - 450000).toISOString(), latency: 890 },
  { id: '3', op: 'tool_call_read_url', agent: 'planner-agent', rule: 'Sliding Error Window (>5.0% error rate)', severity: 'critical', time: new Date(Date.now() - 1800000).toISOString(), latency: 3200 },
];

export default function AlertsPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-8 max-w-7xl mx-auto space-y-8"
    >
      <div className="flex items-center justify-between border-b border-[#1a1a1a] pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f5f5f5]">Drift & Anomaly Alerts</h1>
          <p className="text-xs text-[#737373] mt-1">Welford z-score latency anomalies, EMA cost spikes, and error rate drifts</p>
        </div>
        <div className="flex items-center gap-2 bg-[#0f0f0f] border border-[#1a1a1a] px-3 py-1.5 rounded-full text-xs text-[#10b981] font-mono">
          <ShieldAlert className="w-4 h-4 text-[#10b981]" />
          <span>Real-time Monitoring Active</span>
        </div>
      </div>

      <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl overflow-hidden shadow-xl">
        <div className="divide-y divide-[#1a1a1a]">
          {SAMPLE_ALERTS.map((alert) => (
            <div key={alert.id} className="p-6 flex items-start justify-between gap-4 hover:bg-[#141414] transition-colors">
              <div className="flex items-start gap-4">
                <div className={`p-2.5 rounded-xl border ${alert.severity === 'critical' ? 'bg-[#ef444415] text-[#ef4444] border-[#ef444430]' : 'bg-[#f59e0b15] text-[#f59e0b] border-[#f59e0b30]'}`}>
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-[#f5f5f5]">{alert.op}</span>
                    <span className="px-2 py-0.5 rounded-md bg-[#141414] border border-[#1a1a1a] text-[11px] font-mono text-[#818cf8]">
                      {alert.agent}
                    </span>
                  </div>
                  <div className="text-xs text-[#737373] mt-1 font-mono">{alert.rule}</div>
                </div>
              </div>

              <div className="text-right font-mono text-xs text-[#737373]">
                <div>Latency: {formatDuration(alert.latency)}</div>
                <div className="mt-1">{formatTimeAgo(alert.time)}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
