'use client';

import React, { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  opacity: number;
}

interface Pulse {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startTime: number;
  duration: number; // 1200ms
}

const COLORS = ['#6366f1', '#8b5cf6', '#a78bfa'];

export default function AnimatedBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrameId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', handleResize);

    // Initialize 28 floating nodes
    const nodes: Node[] = Array.from({ length: 28 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.15 + Math.random() * 0.25; // 0.15 to 0.4 px/frame
      return {
        x: Math.random() * width,
        y: Math.random() * height,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        radius: 1.5 + Math.random() * 1.5, // 1.5 to 3px
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        opacity: 0.4 + Math.random() * 0.2, // 0.4 to 0.6
      };
    });

    let activePulses: Pulse[] = [];
    let lastPulseTriggerTime = performance.now();

    const render = (time: number) => {
      ctx.clearRect(0, 0, width, height);

      // 1. Draw static grid lines (spacing 80px)
      ctx.strokeStyle = '#6366f120';
      ctx.lineWidth = 1;
      const gridSpacing = 80;

      ctx.beginPath();
      for (let x = 0; x <= width; x += gridSpacing) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y <= height; y += gridSpacing) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // 2. Update and draw nodes
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        node.x += node.vx;
        node.y += node.vy;

        // Screen wrap around
        if (node.x < 0) node.x = width;
        else if (node.x > width) node.x = 0;

        if (node.y < 0) node.y = height;
        else if (node.y > height) node.y = 0;

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.globalAlpha = node.opacity;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      }

      // 3. Draw connecting edges (max distance 180px)
      const validEdges: { n1: Node; n2: Node }[] = [];
      const maxDistance = 180;

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const n1 = nodes[i];
          const n2 = nodes[j];
          const dx = n1.x - n2.x;
          const dy = n1.y - n2.y;
          const dist = Math.hypot(dx, dy);

          if (dist < maxDistance) {
            validEdges.push({ n1, n2 });
            const lineOpacity = (1 - dist / maxDistance) * 0.18;

            ctx.beginPath();
            ctx.moveTo(n1.x, n1.y);
            ctx.lineTo(n2.x, n2.y);
            ctx.strokeStyle = '#6366f1';
            ctx.lineWidth = 0.5;
            ctx.globalAlpha = lineOpacity;
            ctx.stroke();
            ctx.globalAlpha = 1.0;
          }
        }
      }

      // 4. Trigger signal pulse every 2.5s (2500ms)
      if (time - lastPulseTriggerTime > 2500 && validEdges.length > 0) {
        lastPulseTriggerTime = time;
        const randomEdge = validEdges[Math.floor(Math.random() * validEdges.length)];
        const forward = Math.random() > 0.5;

        activePulses.push({
          startX: forward ? randomEdge.n1.x : randomEdge.n2.x,
          startY: forward ? randomEdge.n1.y : randomEdge.n2.y,
          endX: forward ? randomEdge.n2.x : randomEdge.n1.x,
          endY: forward ? randomEdge.n2.y : randomEdge.n1.y,
          startTime: time,
          duration: 1200,
        });
      }

      // 5. Update and draw active signal pulses
      activePulses = activePulses.filter((pulse) => {
        const elapsed = time - pulse.startTime;
        if (elapsed >= pulse.duration) return false;

        const progress = elapsed / pulse.duration;
        const currentX = pulse.startX + (pulse.endX - pulse.startX) * progress;
        const currentY = pulse.startY + (pulse.endY - pulse.startY) * progress;

        // Fade in at start (<0.2), fade out at end (>0.8)
        let alpha = 0.9;
        if (progress < 0.2) {
          alpha = (progress / 0.2) * 0.9;
        } else if (progress > 0.8) {
          alpha = ((1 - progress) / 0.2) * 0.9;
        }

        ctx.beginPath();
        ctx.arc(currentX, currentY, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#a78bfa';
        ctx.globalAlpha = alpha;
        ctx.fill();
        ctx.globalAlpha = 1.0;

        return true;
      });

      // 6. Corner Vignette (Radial gradient from transparent center to #08080880 at edges)
      const maxDim = Math.max(width, height);
      const gradient = ctx.createRadialGradient(
        width / 2,
        height / 2,
        maxDim * 0.25,
        width / 2,
        height / 2,
        maxDim * 0.75
      );
      gradient.addColorStop(0, 'rgba(8, 8, 8, 0)');
      gradient.addColorStop(1, 'rgba(8, 8, 8, 0.5)');

      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      animFrameId = requestAnimationFrame(render);
    };

    animFrameId = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animFrameId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed top-0 left-0 w-full h-full z-0 pointer-events-none"
    />
  );
}
