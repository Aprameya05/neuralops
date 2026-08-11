'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  LayoutDashboard,
  GitBranch,
  Play,
  Terminal,
  Trophy,
  DollarSign,
  Bot,
  Bell,
  Layers,
  Search,
  AlertTriangle,
  GitCompare,
  Fingerprint,
  Network,
  FlaskConical,
  Clock,
} from 'lucide-react';

const NAV_GROUPS = [
  {
    label: 'Observe',
    items: [
      { href: '/', label: 'Overview', icon: LayoutDashboard },
      { href: '/search', label: 'Search', icon: Search },
      { href: '/traces', label: 'Traces', icon: GitBranch },
      { href: '/replay/csl_65a1b2', label: 'Replay', icon: Play },
      { href: '/anomalies', label: 'Anomalies', icon: AlertTriangle },
    ],
  },
  {
    label: 'Analyze',
    items: [
      { href: '/diff', label: 'Trace Diff', icon: GitCompare },
      { href: '/fingerprints', label: 'Fingerprints', icon: Fingerprint },
      { href: '/genealogy', label: 'Genealogy', icon: Network },
      { href: '/cost', label: 'Cost', icon: DollarSign },
      { href: '/agents', label: 'Agents', icon: Bot },
    ],
  },
  {
    label: 'Experiment',
    items: [
      { href: '/lab', label: 'Prompt Lab', icon: FlaskConical },
      { href: '/time-travel/csl_65a1b2', label: 'Time Travel', icon: Clock },
      { href: '/playground', label: 'Playground', icon: Terminal },
      { href: '/arena', label: 'Arena', icon: Trophy },
    ],
  },
  {
    label: 'Configure',
    items: [
      { href: '/alerts-config', label: 'Alert Config', icon: Bell },
    ],
  },
];

export default function Sidebar() {
  const [isHovered, setIsHovered] = useState(false);
  const pathname = usePathname();

  return (
    <motion.aside
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      initial={false}
      animate={{ width: isHovered ? 220 : 56 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      className="fixed top-0 left-0 bottom-0 z-40 bg-[#080808] border-r border-[#1a1a1a] flex flex-col justify-between overflow-hidden shadow-2xl select-none"
    >
      {/* Top Logo Header */}
      <div className="flex-1 overflow-hidden">
        <div className="h-16 flex items-center px-4 border-b border-[#1a1a1a] gap-3 overflow-hidden">
          <div className="w-6 h-6 rounded-lg bg-[#6366f1] flex items-center justify-center flex-shrink-0 shadow-sm shadow-[#6366f150]">
            <Layers className="w-3.5 h-3.5 text-white" />
          </div>
          <motion.div
            animate={{ opacity: isHovered ? 1 : 0, display: isHovered ? 'flex' : 'none' }}
            transition={{ duration: 0.15 }}
            className="items-center gap-1.5 font-bold tracking-tight text-white whitespace-nowrap text-base"
          >
            <span className="w-2 h-2 rounded-full bg-[#6366f1] inline-block mr-1"></span>
            Neural<span className="text-[#6366f1]">Ops</span>
          </motion.div>
        </div>

        {/* Nav Groups */}
        <nav className="mt-3 px-2 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 80px)' }}>
          {NAV_GROUPS.map(group => (
            <div key={group.label}>
              <motion.div
                animate={{ opacity: isHovered ? 1 : 0 }}
                transition={{ duration: 0.1 }}
                className="px-2 mb-1 text-[9px] font-mono font-semibold uppercase tracking-widest text-[#2a2a2a]"
              >
                {group.label}
              </motion.div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    item.href === '/'
                      ? pathname === '/'
                      : item.href.startsWith('/replay')
                      ? pathname.startsWith('/replay')
                      : item.href.startsWith('/time-travel')
                      ? pathname.startsWith('/time-travel')
                      : pathname.startsWith(item.href);

                  return (
                    <Link key={item.href} href={item.href}>
                      <div
                        className={`relative flex items-center h-9 px-3 rounded-xl transition-all duration-150 group cursor-pointer ${
                          isActive
                            ? 'bg-[#6366f118] text-[#f5f5f5] font-medium border-l-2 border-[#6366f1]'
                            : 'text-[#737373] hover:text-[#f5f5f5] hover:bg-[#141414]'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 flex-shrink-0 transition-colors ${
                            isActive ? 'text-[#6366f1]' : 'group-hover:text-[#f5f5f5]'
                          }`}
                        />
                        <motion.span
                          animate={{ opacity: isHovered ? 1 : 0, display: isHovered ? 'inline' : 'none' }}
                          transition={{ duration: 0.15 }}
                          className="ml-3 text-sm whitespace-nowrap"
                        >
                          {item.label}
                        </motion.span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Bottom Footer Version Tag */}
      <div className="p-3 border-t border-[#1a1a1a] flex items-center overflow-hidden">
        <div className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-mono text-[#737373] flex-shrink-0 bg-[#141414]">
          v
        </div>
        <motion.span
          animate={{ opacity: isHovered ? 1 : 0, display: isHovered ? 'inline' : 'none' }}
          transition={{ duration: 0.15 }}
          className="ml-2 font-mono text-xs text-[#737373] whitespace-nowrap"
        >
          v0.3.0
        </motion.span>
      </div>
    </motion.aside>
  );
}
