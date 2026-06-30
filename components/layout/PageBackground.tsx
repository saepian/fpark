'use client';

import { useEffect, useRef } from 'react';

const COLORS = [
  { r: 99,  g: 102, b: 241 },
  { r: 59,  g: 130, b: 246 },
  { r: 139, g: 92,  b: 246 },
  { r: 14,  g: 165, b: 233 },
  { r: 100, g: 116, b: 139 },
];

export default function PageBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    type Particle = {
      x: number; y: number;
      vx: number; vy: number;
      radius: number; baseRadius: number;
      opacity: number;
      color: { r: number; g: number; b: number };
      pulsePhase: number; pulseSpeed: number;
      glowing: boolean;
    };

    const COUNT = 85;
    const particles: Particle[] = Array.from({ length: COUNT }, () => {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const baseRadius = Math.random() * 2.2 + 0.8;
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.48,
        vy: (Math.random() - 0.5) * 0.48,
        radius: baseRadius, baseRadius,
        opacity: Math.random() * 0.55 + 0.2,
        color,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.018 + Math.random() * 0.025,
        glowing: Math.random() < 0.2,
      };
    });

    type Flow = { from: number; to: number; progress: number; speed: number };
    const flows: Flow[] = [];
    let tick = 0;
    let animId: number;
    const CONNECT_DIST = 160;

    const draw = () => {
      tick++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.pulsePhase += p.pulseSpeed;
        p.radius = p.baseRadius * (1 + Math.sin(p.pulsePhase) * 0.35);
        p.vx *= 0.98;
        p.vy *= 0.98;
        if (Math.hypot(p.vx, p.vy) < 0.1) {
          p.vx += (Math.random() - 0.5) * 0.1;
          p.vy += (Math.random() - 0.5) * 0.1;
        }
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width)  p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        const { r, g, b } = p.color;
        if (p.glowing) {
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 5);
          grd.addColorStop(0, `rgba(${r},${g},${b},${p.opacity * 0.9})`);
          grd.addColorStop(0.4, `rgba(${r},${g},${b},${p.opacity * 0.3})`);
          grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 5, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${p.opacity})`;
        ctx.fill();
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dist = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y);
          if (dist < CONNECT_DIST) {
            const alpha = 0.2 * (1 - dist / CONNECT_DIST);
            const grad  = ctx.createLinearGradient(particles[i].x, particles[i].y, particles[j].x, particles[j].y);
            const ci = particles[i].color, cj = particles[j].color;
            grad.addColorStop(0, `rgba(${ci.r},${ci.g},${ci.b},${alpha})`);
            grad.addColorStop(1, `rgba(${cj.r},${cj.g},${cj.b},${alpha})`);
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = grad;
            ctx.lineWidth   = 0.6;
            ctx.stroke();
          }
        }
      }

      if (tick % 60 === 0 && flows.length < 12) {
        const a = Math.floor(Math.random() * particles.length);
        let b   = Math.floor(Math.random() * particles.length);
        while (b === a) b = Math.floor(Math.random() * particles.length);
        flows.push({ from: a, to: b, progress: 0, speed: 0.015 + Math.random() * 0.02 });
      }
      for (let i = flows.length - 1; i >= 0; i--) {
        const f = flows[i];
        f.progress += f.speed;
        if (f.progress >= 1) { flows.splice(i, 1); continue; }
        const pa = particles[f.from], pb = particles[f.to];
        const fx = pa.x + (pb.x - pa.x) * f.progress;
        const fy = pa.y + (pb.y - pa.y) * f.progress;
        const { r, g, b } = pa.color;
        const tg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 5);
        tg.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
        tg.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(fx, fy, 5, 0, Math.PI * 2);
        ctx.fillStyle = tg;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => { cancelAnimationFrame(animId); ro.disconnect(); };
  }, []);

  return (
    <div className="print:hidden fixed inset-0 -z-10 pointer-events-none">
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(160deg, #0f1117 0%, #0d1030 50%, #0f1117 100%)' }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[280px] rounded-full opacity-10"
        style={{ background: 'radial-gradient(ellipse, #4f46e5 0%, transparent 70%)' }}
      />
    </div>
  );
}
