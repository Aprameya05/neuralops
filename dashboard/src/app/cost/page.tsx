'use client';

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { DollarSign, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useFetch } from '@/lib/hooks';
import { getCostSummary } from '@/lib/api';
import { formatCost } from '@/lib/utils';
import { CostSummaryItem } from '@/lib/types';

type SortField = 'agent_id' | 'model' | 'calls' | 'tokens' | 'cost_usd';

export default function CostPage() {
  const [timeRange, setTimeRange] = useState<number>(24);
  const [sortField, setSortField] = useState<SortField>('cost_usd');
  const [sortAsc, setSortAsc] = useState<boolean>(false);

  const { data: rawCostData, loading } = useFetch(
    () => getCostSummary(timeRange),
    [timeRange]
  );

  const costData = rawCostData || [];

  // Total Spend Sum
  const totalSpend = useMemo(() => {
    return costData.reduce((sum, item) => sum + item.cost_usd, 0);
  }, [costData]);

  // Aggregate hourly data for full width AreaChart
  const chartData = useMemo(() => {
    const hoursMap = new Map<string, Record<string, number>>();

    costData.forEach((item) => {
      const timeKey = item.hour.slice(11, 16);
      if (!hoursMap.has(timeKey)) {
        hoursMap.set(timeKey, { time: timeKey as any });
      }
      const hourObj = hoursMap.get(timeKey)!;
      hourObj[item.agent_id] = (hourObj[item.agent_id] || 0) + item.cost_usd;
    });

    return Array.from(hoursMap.values());
  }, [costData]);

  // Sorted Table rows
  const sortedTable = useMemo(() => {
    return [...costData].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];
      if (typeof valA === 'string') {
        valA = (valA as string).toLowerCase();
        valB = (valB as string).toLowerCase();
      }
      if (valA < valB) return sortAsc ? -1 : 1;
      if (valA > valB) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [costData, sortField, sortAsc]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 text-[#404040]" />;
    return sortAsc ? <ArrowUp className="w-3 h-3 text-[#6366f1]" /> : <ArrowDown className="w-3 h-3 text-[#6366f1]" />;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-8 max-w-7xl mx-auto space-y-8"
    >
      {/* Header & Time Range Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#1a1a1a] pb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f5f5f5]">Cost Analysis</h1>
          <p className="text-xs text-[#737373] mt-1">Per-agent & model token expenditure breakdown</p>
        </div>

        {/* Time Tabs: 1h, 6h, 24h, 7d */}
        <div className="flex items-center bg-[#0f0f0f] border border-[#1a1a1a] p-1 rounded-xl font-mono text-xs">
          {[
            { label: '1h', value: 1 },
            { label: '6h', value: 6 },
            { label: '24h', value: 24 },
            { label: '7d', value: 168 },
          ].map((tab) => (
            <button
              key={tab.label}
              onClick={() => setTimeRange(tab.value)}
              className={`px-4 py-1.5 rounded-lg transition-colors cursor-pointer ${
                timeRange === tab.value
                  ? 'bg-[#6366f1] text-white font-bold shadow-sm'
                  : 'text-[#737373] hover:text-[#f5f5f5]'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Full Width AreaChart */}
      <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6 hover:shadow-[0_0_0_1px_#6366f120] transition-colors space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-[#f5f5f5]">Hourly USD Spend Trajectory</h3>
            <p className="text-xs text-[#737373]">Multi-agent expenditure curves over selected window</p>
          </div>
          <div className="flex items-center gap-4 text-xs font-mono text-[#737373]">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#6366f1]"></span>planner</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#8b5cf6]"></span>researcher</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#14b8a6]"></span>writer</span>
          </div>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="pColor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="rColor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="wColor" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#14b8a6" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} />
              <XAxis dataKey="time" stroke="#404040" fontSize={11} tick={{ fill: '#737373', fontFamily: 'monospace' }} />
              <YAxis stroke="#404040" fontSize={11} tickFormatter={(v) => `$${v}`} tick={{ fill: '#737373', fontFamily: 'monospace' }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#141414',
                  borderColor: '#1a1a1a',
                  borderRadius: '12px',
                  color: '#f5f5f5',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                }}
              />
              <Area type="monotone" dataKey="planner-agent" stackId="1" stroke="#6366f1" fill="url(#pColor)" />
              <Area type="monotone" dataKey="researcher-agent" stackId="1" stroke="#8b5cf6" fill="url(#rColor)" />
              <Area type="monotone" dataKey="writer-agent" stackId="1" stroke="#14b8a6" fill="url(#wColor)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Sortable Table */}
      <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-[#1a1a1a] bg-[#141414] text-xs font-semibold uppercase tracking-wider text-[#737373] flex justify-between items-center">
          <span>Cost Attribution Breakdown</span>
          <span className="font-mono text-[11px] text-[#404040]">Click column headers to sort</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#1a1a1a] text-[11px] uppercase tracking-wider text-[#737373] font-medium bg-[#0f0f0f]">
                <th className="py-3.5 px-6 cursor-pointer select-none" onClick={() => handleSort('agent_id')}>
                  <div className="flex items-center gap-1.5">
                    <span>Agent</span>
                    {renderSortIcon('agent_id')}
                  </div>
                </th>
                <th className="py-3.5 px-6 cursor-pointer select-none" onClick={() => handleSort('model')}>
                  <div className="flex items-center gap-1.5">
                    <span>Model</span>
                    {renderSortIcon('model')}
                  </div>
                </th>
                <th className="py-3.5 px-6 text-right cursor-pointer select-none" onClick={() => handleSort('calls')}>
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Calls</span>
                    {renderSortIcon('calls')}
                  </div>
                </th>
                <th className="py-3.5 px-6 text-right cursor-pointer select-none" onClick={() => handleSort('tokens')}>
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Tokens</span>
                    {renderSortIcon('tokens')}
                  </div>
                </th>
                <th className="py-3.5 px-6 text-right cursor-pointer select-none" onClick={() => handleSort('cost_usd')}>
                  <div className="flex items-center justify-end gap-1.5">
                    <span>Cost (USD)</span>
                    {renderSortIcon('cost_usd')}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1a1a] text-sm text-[#f5f5f5]">
              {sortedTable.map((item, idx) => (
                <tr key={idx} className="hover:bg-[#141414] transition-colors font-mono text-xs">
                  <td className="py-3.5 px-6 font-semibold text-[#f5f5f5]">{item.agent_id}</td>
                  <td className="py-3.5 px-6 text-[#818cf8]">{item.model}</td>
                  <td className="py-3.5 px-6 text-right text-[#737373]">{item.calls}</td>
                  <td className="py-3.5 px-6 text-right text-[#737373]">{item.tokens.toLocaleString()}</td>
                  <td className="py-3.5 px-6 text-right text-[#10b981] font-bold">{formatCost(item.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Total Spend Banner at Bottom */}
      <div className="bg-[#0f0f0f] border border-[#6366f140] shadow-[0_0_20px_rgba(99,102,241,0.1)] rounded-2xl p-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#6366f115] border border-[#6366f130] flex items-center justify-center text-[#6366f1]">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs uppercase font-mono text-[#737373] tracking-wider">Accumulated Expenditure</div>
            <div className="text-sm text-[#f5f5f5] mt-0.5">Total spend across all active models in this timeframe</div>
          </div>
        </div>

        <div className="text-3xl font-mono font-bold text-[#10b981]">
          {formatCost(totalSpend)}
        </div>
      </div>
    </motion.div>
  );
}
