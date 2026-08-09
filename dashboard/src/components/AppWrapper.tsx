'use client';

import React from 'react';
import { useWebSocketAlerts } from '@/lib/hooks';
import LiveToast from './LiveToast';

export default function AppWrapper({ children }: { children: React.ReactNode }) {
  const { alerts, removeAlert } = useWebSocketAlerts();

  return (
    <div className="pl-[56px] min-h-screen flex flex-col relative z-10">
      {children}
      <LiveToast alerts={alerts} onDismiss={removeAlert} />
    </div>
  );
}
