'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { useCountUp } from '@/lib/hooks';

interface StatCardProps {
  title: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  icon: LucideIcon;
  trend?: string;
  isNegative?: boolean;
}

export default function StatCard({
  title,
  value,
  prefix = '',
  suffix = '',
  decimals = 0,
  icon: Icon,
  trend,
  isNegative = false,
}: StatCardProps) {
  const animatedValue = useCountUp(value, 1200, decimals);

  return (
    <motion.div
      whileHover={{ scale: 1.01, borderColor: '#2a2a2a' }}
      transition={{ duration: 0.15 }}
      className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-5 hover:shadow-[0_0_0_1px_#6366f120] transition-colors flex flex-col justify-between"
    >
      <div className="flex items-center justify-between text-[#737373] mb-3">
        <span className="text-xs uppercase font-medium tracking-wider text-[#737373]">{title}</span>
        <div className="w-8 h-8 rounded-xl bg-[#141414] border border-[#1a1a1a] flex items-center justify-center text-[#f5f5f5]">
          <Icon className="w-4 h-4 text-[#6366f1]" />
        </div>
      </div>

      <div>
        <div className="text-3xl font-mono font-bold tracking-tight text-[#f5f5f5]">
          {prefix}
          {animatedValue}
          {suffix}
        </div>
        {trend && (
          <div className="mt-2 flex items-center gap-1 text-xs">
            <span className={`font-mono font-medium ${isNegative ? 'text-[#ef4444]' : 'text-[#10b981]'}`}>
              {trend}
            </span>
            <span className="text-[#404040]">vs last period</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}
