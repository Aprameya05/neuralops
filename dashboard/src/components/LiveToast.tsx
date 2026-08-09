'use client';

import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, AlertTriangle, CheckCircle2, X } from 'lucide-react';
import { LiveAlert } from '@/lib/types';
import { formatDuration } from '@/lib/utils';

interface LiveToastProps {
  alerts: LiveAlert[];
  onDismiss: (id: string) => void;
}

interface ToastItemProps {
  alert: LiveAlert;
  onDismiss: (id: string) => void;
}

function ToastItem({ alert, onDismiss }: ToastItemProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(alert.id);
    }, 4000);
    return () => clearTimeout(timer);
  }, [alert.id, onDismiss]);

  const isError = alert.status === 'error';
  const isHallucination = alert.status === 'hallucination';

  const borderColor = isError ? '#ef4444' : isHallucination ? '#f59e0b' : '#10b981';

  return (
    <motion.div
      initial={{ opacity: 0, x: 50, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 50, scale: 0.95 }}
      transition={{ duration: 0.25, ease: 'easeOut' }}
      className="relative bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl shadow-2xl p-4 w-80 overflow-hidden flex flex-col justify-between"
      style={{ borderLeft: `4px solid ${borderColor}` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {isError ? (
            <AlertCircle className="w-4 h-4 text-[#ef4444] flex-shrink-0" />
          ) : isHallucination ? (
            <AlertTriangle className="w-4 h-4 text-[#f59e0b] flex-shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-[#10b981] flex-shrink-0" />
          )}
          <div className="text-xs font-semibold text-[#f5f5f5] truncate max-w-[180px]">
            {alert.operation_name}
          </div>
        </div>

        <button
          onClick={() => onDismiss(alert.id)}
          className="text-[#737373] hover:text-[#f5f5f5] transition-colors p-0.5 rounded"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="mt-2 text-[11px] font-mono text-[#737373] flex items-center justify-between">
        <span>{alert.agent_id}</span>
        <span>{formatDuration(alert.duration_ms)}</span>
      </div>

      {alert.message && (
        <div className="mt-1.5 text-xs text-[#f5f5f5] font-sans">
          {alert.message}
        </div>
      )}

      {/* 4-second shrinking progress bar at bottom */}
      <motion.div
        initial={{ width: '100%' }}
        animate={{ width: '0%' }}
        transition={{ duration: 4, ease: 'linear' }}
        className="absolute bottom-0 left-0 h-0.5"
        style={{ backgroundColor: borderColor }}
      />
    </motion.div>
  );
}

export default function LiveToast({ alerts, onDismiss }: LiveToastProps) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
      <AnimatePresence>
        {alerts.map((alert) => (
          <div key={alert.id} className="pointer-events-auto">
            <ToastItem alert={alert} onDismiss={onDismiss} />
          </div>
        ))}
      </AnimatePresence>
    </div>
  );
}
