'use client';

import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';

interface SpanChartProps {
  data: { time: string; spans: number; errors: number }[];
}

export default function SpanChart({ data }: SpanChartProps) {
  return (
    <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-5 hover:shadow-[0_0_0_1px_#6366f120] transition-colors">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#f5f5f5]">Spans per minute</h3>
          <p className="text-xs text-[#737373]">Live throughput over the last 30 minutes</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#6366f1]"></span>
          <span className="text-xs text-[#737373] font-mono">Spans</span>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="spanColor" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
            <XAxis
              dataKey="time"
              stroke="#404040"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#1a1a1a' }}
              tick={{ fill: '#737373', fontFamily: 'monospace' }}
            />
            <YAxis
              stroke="#404040"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tick={{ fill: '#737373', fontFamily: 'monospace' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#141414',
                borderColor: '#1a1a1a',
                borderRadius: '12px',
                color: '#f5f5f5',
                fontSize: '12px',
                fontFamily: 'monospace',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
              }}
              itemStyle={{ color: '#6366f1' }}
            />
            <Area
              type="monotone"
              dataKey="spans"
              stroke="#6366f1"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#spanColor)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
