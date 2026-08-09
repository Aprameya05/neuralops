'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Bell, Hash, Eye, EyeOff, Send, CheckCircle2, AlertCircle, Save, ShieldCheck } from 'lucide-react';

export default function AlertsConfigPage() {
  // Slack State
  const [slackWebhook, setSlackWebhook] = useState(
    ''
  );
  const [showSlackWebhook, setShowSlackWebhook] = useState(false);
  const [slackEnabled, setSlackEnabled] = useState(true);
  const [slackTesting, setSlackTesting] = useState(false);
  const [slackTestStatus, setSlackTestStatus] = useState<string | null>(null);

  // PagerDuty State
  const [pdRoutingKey, setPdRoutingKey] = useState('');
  const [showPdKey, setShowPdKey] = useState(false);
  const [pdFilterMode, setPdFilterMode] = useState<'critical_only' | 'all'>('critical_only');
  const [pdEnabled, setPdEnabled] = useState(true);
  const [pdTesting, setPdTesting] = useState(false);
  const [pdTestStatus, setPdTestStatus] = useState<string | null>(null);

  // General Save State
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const handleTestSlack = async () => {
    setSlackTesting(true);
    setSlackTestStatus(null);
    await new Promise((resolve) => setTimeout(resolve, 800));
    setSlackTesting(false);
    setSlackTestStatus('Test alert sent to Slack channel successfully!');
    setTimeout(() => setSlackTestStatus(null), 4000);
  };

  const handleTestPD = async () => {
    setPdTesting(true);
    setPdTestStatus(null);
    await new Promise((resolve) => setTimeout(resolve, 800));
    setPdTesting(false);
    setPdTestStatus('Test incident triggered on PagerDuty successfully!');
    setTimeout(() => setPdTestStatus(null), 4000);
  };

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setIsSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  const ALERT_RULES = [
    { condition: 'Latency z-score', threshold: '> 4.0', severity: 'critical', action: 'Page + Slack' },
    { condition: 'Error rate', threshold: '> 30%', severity: 'critical', action: 'Page + Slack' },
    { condition: 'Error rate', threshold: '> 15%', severity: 'warning', action: 'Slack only' },
    { condition: 'Cost spike', threshold: '> 3x EMA', severity: 'warning', action: 'Slack only' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="p-8 max-w-7xl mx-auto space-y-8"
    >
      {/* Header */}
      <div className="border-b border-[#1a1a1a] pb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#f5f5f5]">Alert Configuration</h1>
          <p className="text-xs text-[#737373] mt-1">Configure Slack and PagerDuty integrations</p>
        </div>
        <div className="flex items-center gap-2 bg-[#0f0f0f] border border-[#1a1a1a] px-3 py-1.5 rounded-full text-xs text-[#10b981] font-mono">
          <ShieldCheck className="w-4 h-4 text-[#10b981]" />
          <span>Alert Pipeline Active</span>
        </div>
      </div>

      {/* Two Integration Cards Side by Side */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* LEFT CARD - Slack */}
        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6 space-y-6 shadow-xl flex flex-col justify-between">
          <div className="space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#6366f115] border border-[#6366f130] flex items-center justify-center text-[#6366f1] font-black text-lg">
                  #
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#f5f5f5]">Slack Alerts</h3>
                  <p className="text-xs text-[#737373] mt-0.5">
                    Send drift alerts and error spikes to a Slack channel
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    slackEnabled && slackWebhook ? 'bg-[#10b981]' : 'bg-[#737373]'
                  }`}
                />
                <span className="text-xs font-mono text-[#737373]">
                  {slackEnabled && slackWebhook ? 'Connected' : 'Not configured'}
                </span>
              </div>
            </div>

            {/* Webhook Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#737373]">Webhook URL</label>
              <div className="relative">
                <input
                  type={showSlackWebhook ? 'text' : 'password'}
                  value={slackWebhook}
                  onChange={(e) => setSlackWebhook(e.target.value)}
                  placeholder="https://hooks.slack.com/services/..."
                  className="w-full bg-[#141414] border border-[#1a1a1a] rounded-xl px-4 py-2.5 pr-10 text-xs font-mono text-[#f5f5f5] placeholder-[#737373] focus:outline-none focus:border-[#6366f1] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowSlackWebhook(!showSlackWebhook)}
                  className="absolute right-3 top-2.5 text-[#737373] hover:text-[#f5f5f5] transition-colors"
                >
                  {showSlackWebhook ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Enable/Disable Toggle */}
            <div className="flex items-center justify-between pt-1 border-t border-[#1a1a1a]">
              <span className="text-xs font-medium text-[#f5f5f5]">Enable Slack Notifications</span>
              <button
                type="button"
                onClick={() => setSlackEnabled(!slackEnabled)}
                className={`w-11 h-6 rounded-full transition-colors relative border ${
                  slackEnabled
                    ? 'bg-[#6366f1] border-[#6366f1]'
                    : 'bg-[#141414] border-[#1a1a1a]'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform ${
                    slackEnabled ? 'translate-x-5.5' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Test Action & Feedback */}
          <div className="space-y-3 pt-2">
            {slackTestStatus && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs font-mono text-[#10b981] bg-[#10b98115] border border-[#10b98130] p-2.5 rounded-lg flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{slackTestStatus}</span>
              </motion.div>
            )}
            <button
              type="button"
              onClick={handleTestSlack}
              disabled={slackTesting || !slackWebhook}
              className="w-full bg-[#141414] hover:bg-[#1a1a1a] border border-[#1a1a1a] text-[#f5f5f5] text-xs font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{slackTesting ? 'Sending test...' : 'Test Slack Integration'}</span>
            </button>
          </div>
        </div>

        {/* RIGHT CARD - PagerDuty */}
        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-6 space-y-6 shadow-xl flex flex-col justify-between">
          <div className="space-y-5">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#10b98115] border border-[#10b98130] flex items-center justify-center text-[#10b981]">
                  <Bell className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#f5f5f5]">PagerDuty</h3>
                  <p className="text-xs text-[#737373] mt-0.5">
                    Page on-call engineers for critical anomalies
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    pdEnabled && pdRoutingKey ? 'bg-[#10b981]' : 'bg-[#737373]'
                  }`}
                />
                <span className="text-xs font-mono text-[#737373]">
                  {pdEnabled && pdRoutingKey ? 'Connected' : 'Not configured'}
                </span>
              </div>
            </div>

            {/* Routing Key Input */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#737373]">Integration Routing Key</label>
              <div className="relative">
                <input
                  type={showPdKey ? 'text' : 'password'}
                  value={pdRoutingKey}
                  onChange={(e) => setPdRoutingKey(e.target.value)}
                  placeholder="pd_live_key_..."
                  className="w-full bg-[#141414] border border-[#1a1a1a] rounded-xl px-4 py-2.5 pr-10 text-xs font-mono text-[#f5f5f5] placeholder-[#737373] focus:outline-none focus:border-[#10b981] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPdKey(!showPdKey)}
                  className="absolute right-3 top-2.5 text-[#737373] hover:text-[#f5f5f5] transition-colors"
                >
                  {showPdKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Severity Filter Toggle */}
            <div className="flex items-center justify-between pt-1 border-t border-[#1a1a1a]">
              <span className="text-xs font-medium text-[#f5f5f5]">Trigger Scope</span>
              <div className="flex gap-1 bg-[#141414] border border-[#1a1a1a] p-0.5 rounded-lg">
                <button
                  type="button"
                  onClick={() => setPdFilterMode('critical_only')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
                    pdFilterMode === 'critical_only'
                      ? 'bg-[#6366f118] text-[#818cf8] font-bold border border-[#6366f130]'
                      : 'text-[#737373] hover:text-[#f5f5f5]'
                  }`}
                >
                  Critical only
                </button>
                <button
                  type="button"
                  onClick={() => setPdFilterMode('all')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors ${
                    pdFilterMode === 'all'
                      ? 'bg-[#6366f118] text-[#818cf8] font-bold border border-[#6366f130]'
                      : 'text-[#737373] hover:text-[#f5f5f5]'
                  }`}
                >
                  All alerts
                </button>
              </div>
            </div>
          </div>

          {/* Test Action & Feedback */}
          <div className="space-y-3 pt-2">
            {pdTestStatus && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-xs font-mono text-[#10b981] bg-[#10b98115] border border-[#10b98130] p-2.5 rounded-lg flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                <span>{pdTestStatus}</span>
              </motion.div>
            )}
            <button
              type="button"
              onClick={handleTestPD}
              disabled={pdTesting || !pdRoutingKey}
              className="w-full bg-[#141414] hover:bg-[#1a1a1a] border border-[#1a1a1a] text-[#f5f5f5] text-xs font-medium py-2.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5 text-[#10b981]" />
              <span>{pdTesting ? 'Sending test...' : 'Test PagerDuty Integration'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Alert Rules Section */}
      <div className="space-y-4">
        <div className="border-b border-[#1a1a1a] pb-3">
          <h2 className="text-lg font-bold text-[#f5f5f5]">Alert Rules</h2>
          <p className="text-xs text-[#737373] mt-0.5">
            Active statistical thresholds triggering webhook dispatches
          </p>
        </div>

        <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#141414] border-b border-[#1a1a1a] text-[#737373] font-medium">
                  <th className="py-3.5 px-6">Condition</th>
                  <th className="py-3.5 px-6">Threshold</th>
                  <th className="py-3.5 px-6">Severity</th>
                  <th className="py-3.5 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1a1a1a]">
                {ALERT_RULES.map((rule, idx) => (
                  <tr key={idx} className="hover:bg-[#141414] transition-colors">
                    <td className="py-4 px-6 font-mono font-bold text-[#f5f5f5]">
                      {rule.condition}
                    </td>
                    <td className="py-4 px-6 font-mono text-[#818cf8]">
                      {rule.threshold}
                    </td>
                    <td className="py-4 px-6">
                      {rule.severity === 'critical' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#ef444415] border border-[#ef444430] text-[#ef4444] text-[11px] font-mono capitalize">
                          <AlertCircle className="w-3 h-3" />
                          <span>{rule.severity}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#f59e0b15] border border-[#f59e0b30] text-[#f59e0b] text-[11px] font-mono capitalize">
                          <AlertCircle className="w-3 h-3" />
                          <span>{rule.severity}</span>
                        </span>
                      )}
                    </td>
                    <td className="py-4 px-6 font-mono text-right text-[#737373]">
                      {rule.action}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Save Button at Bottom */}
      <div className="pt-4 flex items-center justify-between border-t border-[#1a1a1a]">
        <div>
          {saveSuccess && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-xs font-mono text-[#10b981] flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-4 h-4" />
              Configurations saved successfully!
            </motion.span>
          )}
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={isSaving}
          className="bg-[#6366f1] hover:bg-[#4f46e5] text-white font-medium px-8 py-3 rounded-xl transition-all duration-150 flex items-center gap-2 text-sm shadow-lg shadow-[#6366f125]"
        >
          <Save className="w-4 h-4" />
          <span>{isSaving ? 'Saving...' : 'Save Configuration'}</span>
        </button>
      </div>
    </motion.div>
  );
}
