'use client';

import { useEffect, useRef } from 'react';

const COLORS = [
  { r: 99,  g: 102, b: 241 },   // indigo
  { r: 59,  g: 130, b: 246 },   // blue
  { r: 139, g: 92,  b: 246 },   // violet
  { r: 100, g: 116, b: 139 },   // slate
];

export default function AuthBackground() {
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

    // ── 자물쇠 그리기 ──────────────────────────────────────────────
    const drawLock = (
      x: number, y: number, size: number, rotation: number,
      r: number, g: number, b: number, opacity: number,
    ) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);

      const bw = size * 1.1;
      const bh = size * 1.15;
      const br = size * 0.14;
      const bodyY = -bh * 0.05;

      // 몸통
      ctx.beginPath();
      ctx.roundRect(-bw / 2, bodyY, bw, bh, br);
      ctx.fillStyle   = `rgba(${r},${g},${b},${opacity * 0.22})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${r},${g},${b},${opacity * 0.65})`;
      ctx.lineWidth   = 0.6;
      ctx.stroke();

      // 걸쇠 (U자 아크)
      const shR = size * 0.37;
      ctx.beginPath();
      ctx.arc(0, bodyY, shR, Math.PI, 0, false);
      ctx.strokeStyle = `rgba(${r},${g},${b},${opacity * 0.7})`;
      ctx.lineWidth   = size * 0.17;
      ctx.lineCap     = 'round';
      ctx.stroke();

      // 열쇠구멍 원
      ctx.beginPath();
      ctx.arc(0, bodyY + bh * 0.35, size * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${r},${g},${b},${opacity * 0.55})`;
      ctx.fill();

      // 열쇠구멍 슬롯
      ctx.fillRect(-size * 0.06, bodyY + bh * 0.35, size * 0.12, size * 0.24);

      ctx.restore();
    };

    // ── 열쇠 그리기 ───────────────────────────────────────────────
    const drawKey = (
      x: number, y: number, size: number, rotation: number,
      r: number, g: number, b: number, opacity: number,
    ) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);

      const headR  = size * 0.4;
      const shaftL = size * 1.35;
      const shaftH = size * 0.22;
      const ox     = -shaftL * 0.25;  // 헤드 오프셋

      // 헤드 외곽
      ctx.beginPath();
      ctx.arc(ox, 0, headR, 0, Math.PI * 2);
      ctx.fillStyle   = `rgba(${r},${g},${b},${opacity * 0.2})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${r},${g},${b},${opacity * 0.65})`;
      ctx.lineWidth   = size * 0.14;
      ctx.stroke();

      // 헤드 내부 구멍
      ctx.beginPath();
      ctx.arc(ox, 0, headR * 0.46, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(0,0,0,${opacity * 0.35})`;
      ctx.fill();

      // 샤프트
      const shaftX = ox + headR * 0.82;
      ctx.fillStyle = `rgba(${r},${g},${b},${opacity * 0.55})`;
      ctx.fillRect(shaftX, -shaftH / 2, shaftL * 0.88, shaftH);

      // 이빨 (3개)
      const toothW = size * 0.13;
      const toothH = size * 0.24;
      [0.28, 0.52, 0.74].forEach(pos => {
        ctx.fillRect(shaftX + shaftL * 0.88 * pos, shaftH / 2, toothW, toothH);
      });

      ctx.restore();
    };

    type Particle = {
      x: number; y: number;
      vx: number; vy: number;
      size: number;
      opacity: number;
      color: { r: number; g: number; b: number };
      rotation: number;
      rotSpeed: number;
      pulsePhase: number;
      pulseSpeed: number;
      glowing: boolean;
      isKey: boolean;
    };

    const COUNT = 60;
    const particles: Particle[] = Array.from({ length: COUNT }, () => {
      const isKey = Math.random() < 0.45;
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      return {
        x:          Math.random() * canvas.width,
        y:          Math.random() * canvas.height,
        vx:         (Math.random() - 0.5) * 0.38,
        vy:         (Math.random() - 0.5) * 0.38,
        size:       Math.random() * 5 + 5,
        opacity:    Math.random() * 0.38 + 0.15,
        color,
        rotation:   Math.random() * Math.PI * 2,
        rotSpeed:   (Math.random() - 0.5) * (isKey ? 0.005 : 0.003),
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.012 + Math.random() * 0.018,
        glowing:    Math.random() < 0.18,
        isKey,
      };
    });

    type Flow = { from: number; to: number; progress: number; speed: number };
    const flows: Flow[] = [];
    let tick = 0;
    let animId: number;
    const CONNECT_DIST = 155;

    const draw = () => {
      tick++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const p of particles) {
        p.pulsePhase += p.pulseSpeed;
        const pf = 1 + Math.sin(p.pulsePhase) * 0.12;
        p.rotation += p.rotSpeed;
        p.vx *= 0.99;
        p.vy *= 0.99;
        if (Math.hypot(p.vx, p.vy) < 0.08) {
          p.vx += (Math.random() - 0.5) * 0.08;
          p.vy += (Math.random() - 0.5) * 0.08;
        }
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -40 || p.x > canvas.width  + 40) p.vx *= -1;
        if (p.y < -40 || p.y > canvas.height + 40) p.vy *= -1;

        const { r, g, b } = p.color;

        if (p.glowing) {
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * pf * 5);
          grd.addColorStop(0, `rgba(${r},${g},${b},${p.opacity * 0.8})`);
          grd.addColorStop(0.4, `rgba(${r},${g},${b},${p.opacity * 0.25})`);
          grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * pf * 5, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }

        if (p.isKey) {
          drawKey(p.x, p.y, p.size * pf, p.rotation, r, g, b, p.opacity);
        } else {
          drawLock(p.x, p.y, p.size * pf, p.rotation, r, g, b, p.opacity);
        }
      }

      // 연결선
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dist = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y);
          if (dist < CONNECT_DIST) {
            const alpha = 0.14 * (1 - dist / CONNECT_DIST);
            const grad  = ctx.createLinearGradient(particles[i].x, particles[i].y, particles[j].x, particles[j].y);
            const ci = particles[i].color;
            const cj = particles[j].color;
            grad.addColorStop(0, `rgba(${ci.r},${ci.g},${ci.b},${alpha})`);
            grad.addColorStop(1, `rgba(${cj.r},${cj.g},${cj.b},${alpha})`);
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = grad;
            ctx.lineWidth   = 0.5;
            ctx.stroke();
          }
        }
      }

      // 데이터 흐름
      if (tick % 60 === 0 && flows.length < 10) {
        const a = Math.floor(Math.random() * particles.length);
        let b   = Math.floor(Math.random() * particles.length);
        while (b === a) b = Math.floor(Math.random() * particles.length);
        flows.push({ from: a, to: b, progress: 0, speed: 0.013 + Math.random() * 0.017 });
      }
      for (let i = flows.length - 1; i >= 0; i--) {
        const f = flows[i];
        f.progress += f.speed;
        if (f.progress >= 1) { flows.splice(i, 1); continue; }
        const pa = particles[f.from];
        const pb = particles[f.to];
        const fx = pa.x + (pb.x - pa.x) * f.progress;
        const fy = pa.y + (pb.y - pa.y) * f.progress;
        const { r, g, b } = pa.color;
        const tg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 4);
        tg.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
        tg.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(fx, fy, 4, 0, Math.PI * 2);
        ctx.fillStyle = tg;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => { cancelAnimationFrame(animId); ro.disconnect(); };
  }, []);

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(160deg, #0f1117 0%, #0d1030 50%, #0f1117 100%)' }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[250px] rounded-full opacity-10"
        style={{ background: 'radial-gradient(ellipse, #4f46e5 0%, transparent 70%)' }}
      />
    </div>
  );
}
