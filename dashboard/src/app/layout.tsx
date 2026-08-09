import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import Sidebar from '@/components/Sidebar';
import AppWrapper from '@/components/AppWrapper';
import AnimatedBackground from '@/components/AnimatedBackground';

const inter = Inter({
  variable: '--font-sans',
  subsets: ['latin'],
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'NeuralOps — AI Agent Observability Platform',
  description: 'Real-time tracing, causal replay, cost attribution, and drift detection for AI agent frameworks.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased dark`}>
      <body className="min-h-full bg-[#080808] text-[#f5f5f5] font-sans overflow-x-hidden selection:bg-[#6366f140] selection:text-white">
        <AnimatedBackground />
        <Sidebar />
        <AppWrapper>{children}</AppWrapper>
      </body>
    </html>
  );
}
