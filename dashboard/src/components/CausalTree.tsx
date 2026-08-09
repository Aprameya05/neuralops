'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Span } from '@/lib/types';
import { formatDuration } from '@/lib/utils';

interface CausalTreeProps {
  rootNode: Span;
  selectedSpanId: string | null;
  onSelectNode: (span: Span) => void;
}

interface TreeNodeProps {
  span: Span;
  depth?: number;
  index: number;
  selectedSpanId: string | null;
  onSelectNode: (span: Span) => void;
}

function TreeNode({ span, depth = 0, index, selectedSpanId, onSelectNode }: TreeNodeProps) {
  const isSelected = selectedSpanId === span.span_id;
  const isLlm = Boolean(span.model || span.operation_name.includes('llm') || span.operation_name.includes('generate'));
  const isTool = Boolean(span.tool_name || span.operation_name.includes('tool'));
  const isError = span.status === 'error';

  const barColor = isError
    ? '#ef4444'
    : isLlm
    ? '#6366f1'
    : isTool
    ? '#8b5cf6'
    : '#737373';

  return (
    <div className="relative">
      {/* Indentation guide line */}
      {depth > 0 && (
        <div
          className="absolute left-[-12px] top-0 bottom-0 w-[1px] bg-[#1a1a1a]"
          style={{ left: `${depth * 20 - 10}px` }}
        />
      )}

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, delay: index * 0.05 }}
        onClick={() => onSelectNode(span)}
        style={{ marginLeft: `${depth * 20}px` }}
        className={`relative my-2 p-3 rounded-xl border transition-all cursor-pointer select-none flex items-center justify-between gap-3 overflow-hidden ${
          isSelected
            ? 'bg-[#6366f118] border-[#6366f1] shadow-[0_0_0_1px_#6366f150]'
            : 'bg-[#0f0f0f] border-[#1a1a1a] hover:border-[#2a2a2a] hover:bg-[#141414]'
        }`}
      >
        {/* Left colored bar */}
        <div
          className="absolute left-0 top-0 bottom-0 w-1.5"
          style={{ backgroundColor: barColor }}
        />

        <div className="pl-2 overflow-hidden flex-1">
          <div className="text-xs font-semibold text-[#f5f5f5] truncate">
            {span.operation_name}
          </div>
          <div className="text-[11px] font-mono text-[#737373] truncate">
            {span.agent_id}
          </div>
        </div>

        {/* Right side info: duration + status dot */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="font-mono text-xs text-[#737373]">
            {formatDuration(span.duration_ms)}
          </span>
          <span
            className={`w-2 h-2 rounded-full ${
              span.status === 'error'
                ? 'bg-[#ef4444]'
                : span.status === 'hallucination'
                ? 'bg-[#f59e0b]'
                : 'bg-[#10b981]'
            }`}
          />
        </div>
      </motion.div>

      {/* Render children sequentially recursively */}
      {span.children && span.children.length > 0 && (
        <div className="relative">
          {span.children.map((child, cIdx) => (
            <TreeNode
              key={child.span_id}
              span={child}
              depth={depth + 1}
              index={index + cIdx + 1}
              selectedSpanId={selectedSpanId}
              onSelectNode={onSelectNode}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function CausalTree({ rootNode, selectedSpanId, onSelectNode }: CausalTreeProps) {
  if (!rootNode) return null;

  return (
    <div className="p-4 overflow-y-auto max-h-[calc(100vh-140px)]">
      <TreeNode
        span={rootNode}
        index={0}
        selectedSpanId={selectedSpanId}
        onSelectNode={onSelectNode}
      />
    </div>
  );
}
