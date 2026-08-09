import React from 'react';

export function formatCost(usd: number | null | undefined): string {
  if (usd == null || isNaN(usd)) return '$0.0000';
  if (usd < 0.001) return `$${usd.toFixed(5)}`;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(3)}`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || isNaN(ms)) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTimeAgo(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function truncateId(id: string, len: number = 8): string {
  if (!id) return '';
  if (id.length <= len) return id;
  return `${id.slice(0, len)}…`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy to clipboard', err);
    return false;
  }
}

/**
 * Custom simple syntax highlighter for JSON data
 * Keys: #f5f5f5 (white), Strings: #10b981 (green), Numbers: #6366f1 (indigo/blue), Booleans: #f59e0b (amber)
 */
export function formatJsonSyntax(data: any): React.ReactNode {
  const jsonStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  if (!jsonStr) return null;

  const lines = jsonStr.split('\n');

  return (
    <pre className="font-mono text-xs leading-relaxed text-[#f5f5f5] whitespace-pre-wrap break-all">
      {lines.map((line, idx) => {
        // Regex match key-value pairs
        const parts = line.split(/("[\w_]+":)/g);

        return (
          <div key={idx} className="hover:bg-[#141414] px-1 rounded transition-colors">
            {parts.map((part, pIdx) => {
              if (/^"[\w_]+":$/.test(part)) {
                return (
                  <span key={pIdx} className="text-white font-medium">
                    {part}{' '}
                  </span>
                );
              }
              if (/".*?"/.test(part)) {
                return (
                  <span key={pIdx} className="text-[#10b981]">
                    {part}
                  </span>
                );
              }
              if (/\b(true|false|null)\b/.test(part)) {
                return (
                  <span key={pIdx} className="text-[#f59e0b]">
                    {part}
                  </span>
                );
              }
              if (/\b\d+(\.\d+)?\b/.test(part)) {
                return (
                  <span key={pIdx} className="text-[#818cf8]">
                    {part}
                  </span>
                );
              }
              return <span key={pIdx}>{part}</span>;
            })}
          </div>
        );
      })}
    </pre>
  );
}
