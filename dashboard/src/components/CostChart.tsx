'use client';

import React from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { formatCost } from '@/lib/utils';

interface CostChartProps {
  data: { agent_id: string; total_cost: number }[];
}

const AGENT_COLORS = ['#6366f1', '#7c3aed', '#8b5cf6', '#a855f7', '#c084fc'];

export default function CostChart({ data }: CostChartProps) {
  const chartData = data.length > 0 ? data : [
    { agent_id: 'planner-agent', total_cost: 0.842 },
    { agent_id: 'researcher-agent', total_cost: 1.450 },
    { agent_id: 'writer-agent', total_cost: 0.920 },
    { agent_id: 'critic-agent', total_cost: 0.315 },
    { agent_id: 'orchestrator', total_cost: 0.180 },
  ];

  return (
    <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-5 hover:shadow-[0_0_0_1px_#6366f120] transition-colors">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-[#f5f5f5]">Cost by agent</h3>
          <p className="text-xs text-[#737373]">USD spend distribution last 24 hours</p>
        </div>
        <div className="text-xs text-[#737373] font-mono">Last 24h</div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
            <XAxis
              dataKey="agent_id"
              stroke="#404040"
              fontSize={11}
              tickLine={false}
              axisLine={{ stroke: '#1a1a1a' }}
              tickFormatter={(val) => val.replace('-agent', '')}
              tick={{ fill: '#737373', fontFamily: 'monospace' }}
            />
            <YAxis
              stroke="#404040"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(val) => `$${val}`}
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
              formatter={(value: any) => [formatCost(Number(value)), 'Spend']}
            />
            <Bar dataKey="total_cost" radius={[6, 6, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={AGENT_COLORS[index % AGENT_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
