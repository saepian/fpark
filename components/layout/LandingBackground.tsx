'use client';

import { useEffect, useRef } from 'react';

// 랜딩페이지(app/ai-portfolio) 전용 — 대시보드와 공유하는 PageBackground보다
// 마케팅 임팩트를 위해 훨씬 화려하게 구성 (오로라 블롭 + 밀도 높은 파티클 +
// 슈팅스타 + 레이더 펄스). prefers-reduced-motion이면 정적 그라디언트만 표시.

const COLORS = [
  { r: 62,  g: 207, b: 142 },  // accent-green (브랜드 포인트)
  { r: 99,  g: 102, b: 241 },  // indigo
  { r: 139, g: 92,  b: 246 },  // purple
  { r: 59,  g: 130, b: 246 },  // blue
  { r: 236, g: 72,  b: 153 },  // pink (포인트로만 소량)
];

export default function LandingBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return; // 정적 그라디언트/블롭만 CSS로 표시, 캔버스 애니메이션 생략

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width  = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const w = () => canvas.width / dpr;
    const h = () => canvas.height / dpr;

    // ── 파티클 (기존 대비 밀도·글로우 강화) ────────────────────────────────
    type Particle = {
      x: number; y: number;
      vx: number; vy: number;
      radius: number; baseRadius: number;
      opacity: number;
      color: { r: number; g: number; b: number };
      pulsePhase: number; pulseSpeed: number;
      glowing: boolean;
    };

    const COUNT = 130;
    const particles: Particle[] = Array.from({ length: COUNT }, () => {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const baseRadius = Math.random() * 2.4 + 0.9;
      return {
        x: Math.random() * w(),
        y: Math.random() * h(),
        vx: (Math.random() - 0.5) * 0.55,
        vy: (Math.random() - 0.5) * 0.55,
        radius: baseRadius, baseRadius,
        opacity: Math.random() * 0.6 + 0.25,
        color,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.02 + Math.random() * 0.03,
        glowing: Math.random() < 0.3,
      };
    });

    // ── 데이터 흐름 입자 (노드 사이를 이동) ──────────────────────────────────
    type Flow = { from: number; to: number; progress: number; speed: number };
    const flows: Flow[] = [];

    // ── 슈팅스타(코멧) — 화면을 가로지르는 강조 효과 ─────────────────────────
    type Comet = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; color: { r: number; g: number; b: number } };
    const comets: Comet[] = [];
    const spawnComet = () => {
      const fromLeft = Math.random() < 0.5;
      const y0 = Math.random() * h() * 0.6;
      const speed = 6 + Math.random() * 4;
      const angle = (Math.random() * 20 - 10) * (Math.PI / 180) + (fromLeft ? 0.5 : Math.PI - 0.5);
      comets.push({
        x: fromLeft ? -20 : w() + 20,
        y: y0,
        vx: Math.cos(angle) * speed * (fromLeft ? 1 : -1),
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 60,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      });
    };

    // ── 레이더 펄스 — 주기적으로 퍼지는 원형 링 ("AI 관측" 느낌) ─────────────
    type Pulse = { x: number; y: number; radius: number; maxRadius: number; color: { r: number; g: number; b: number } };
    const pulses: Pulse[] = [];

    let tick = 0;
    let animId: number;
    const CONNECT_DIST = 170;

    const draw = () => {
      tick++;
      ctx.clearRect(0, 0, w(), h());

      // 파티클 업데이트 + 렌더
      for (const p of particles) {
        p.pulsePhase += p.pulseSpeed;
        p.radius = p.baseRadius * (1 + Math.sin(p.pulsePhase) * 0.4);
        p.vx *= 0.985;
        p.vy *= 0.985;
        if (Math.hypot(p.vx, p.vy) < 0.12) {
          p.vx += (Math.random() - 0.5) * 0.12;
          p.vy += (Math.random() - 0.5) * 0.12;
        }
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > w()) p.vx *= -1;
        if (p.y < 0 || p.y > h()) p.vy *= -1;

        const { r, g, b } = p.color;
        if (p.glowing) {
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 6);
          grd.addColorStop(0, `rgba(${r},${g},${b},${p.opacity * 0.95})`);
          grd.addColorStop(0.4, `rgba(${r},${g},${b},${p.opacity * 0.35})`);
          grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 6, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},${p.opacity})`;
        ctx.fill();
      }

      // 파티클 간 연결선
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dist = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y);
          if (dist < CONNECT_DIST) {
            const alpha = 0.22 * (1 - dist / CONNECT_DIST);
            const grad  = ctx.createLinearGradient(particles[i].x, particles[i].y, particles[j].x, particles[j].y);
            const ci = particles[i].color, cj = particles[j].color;
            grad.addColorStop(0, `rgba(${ci.r},${ci.g},${ci.b},${alpha})`);
            grad.addColorStop(1, `rgba(${cj.r},${cj.g},${cj.b},${alpha})`);
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = grad;
            ctx.lineWidth   = 0.7;
            ctx.stroke();
          }
        }
      }

      // 데이터 흐름 입자 생성/렌더
      if (tick % 45 === 0 && flows.length < 16) {
        const a = Math.floor(Math.random() * particles.length);
        let b = Math.floor(Math.random() * particles.length);
        while (b === a) b = Math.floor(Math.random() * particles.length);
        flows.push({ from: a, to: b, progress: 0, speed: 0.015 + Math.random() * 0.025 });
      }
      for (let i = flows.length - 1; i >= 0; i--) {
        const f = flows[i];
        f.progress += f.speed;
        if (f.progress >= 1) { flows.splice(i, 1); continue; }
        const pa = particles[f.from], pb = particles[f.to];
        const fx = pa.x + (pb.x - pa.x) * f.progress;
        const fy = pa.y + (pb.y - pa.y) * f.progress;
        const { r, g, b } = pa.color;
        const tg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 5.5);
        tg.addColorStop(0, `rgba(${r},${g},${b},0.95)`);
        tg.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(fx, fy, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = tg;
        ctx.fill();
      }

      // 슈팅스타 생성/렌더 (약 4초에 한 번 정도)
      if (tick % 240 === 0) spawnComet();
      for (let i = comets.length - 1; i >= 0; i--) {
        const c = comets[i];
        c.life++;
        c.x += c.vx;
        c.y += c.vy;
        if (c.life > c.maxLife || c.x < -50 || c.x > w() + 50) { comets.splice(i, 1); continue; }
        const { r, g, b } = c.color;
        const tailLen = 70;
        const tailX = c.x - c.vx * (tailLen / 8);
        const tailY = c.y - c.vy * (tailLen / 8);
        const grad = ctx.createLinearGradient(c.x, c.y, tailX, tailY);
        grad.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(tailX, tailY);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(c.x, c.y, 1.8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
        ctx.fill();
      }

      // 레이더 펄스 생성/렌더 (약 5초에 한 번)
      if (tick % 300 === 0) {
        pulses.push({
          x: w() * (0.25 + Math.random() * 0.5),
          y: h() * (0.25 + Math.random() * 0.5),
          radius: 0,
          maxRadius: 140 + Math.random() * 80,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        });
      }
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        p.radius += 1.1;
        if (p.radius > p.maxRadius) { pulses.splice(i, 1); continue; }
        const { r, g, b } = p.color;
        const alpha = 0.35 * (1 - p.radius / p.maxRadius);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => { cancelAnimationFrame(animId); ro.disconnect(); };
  }, []);

  return (
    <div data-print-bg className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* 베이스 그라디언트 (서서히 색조가 움직이는 애니메이션) */}
      <div className="absolute inset-0 landing-bg-base" />

      {/* 오로라 블롭 3개 — 느리게 떠다니는 큰 광원 */}
      <div className="absolute w-[560px] h-[560px] rounded-full blur-[110px] opacity-40 landing-bg-blob-1"
        style={{ background: 'radial-gradient(circle, #3ECF8E 0%, transparent 70%)' }} />
      <div className="absolute w-[620px] h-[620px] rounded-full blur-[120px] opacity-30 landing-bg-blob-2"
        style={{ background: 'radial-gradient(circle, #6366f1 0%, transparent 70%)' }} />
      <div className="absolute w-[460px] h-[460px] rounded-full blur-[100px] opacity-25 landing-bg-blob-3"
        style={{ background: 'radial-gradient(circle, #ec4899 0%, transparent 70%)' }} />

      {/* 캔버스 파티클/코멧/펄스 레이어 */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {/* 은은한 점 그리드 (깊이감) */}
      <div className="absolute inset-0 opacity-[0.07]" style={{
        backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)',
        backgroundSize: '32px 32px',
      }} />

      {/* 가장자리 비네트 */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at center, transparent 40%, #0B0D12 100%)',
      }} />

      <style>{`
        .landing-bg-base {
          background: linear-gradient(160deg, #0B0D12 0%, #0d1030 45%, #0a1420 75%, #0B0D12 100%);
          background-size: 200% 200%;
          animation: landingGradientShift 18s ease-in-out infinite;
        }
        .landing-bg-blob-1 {
          top: -8%;
          left: 8%;
          animation: landingBlobFloat1 22s ease-in-out infinite;
        }
        .landing-bg-blob-2 {
          top: 30%;
          right: -10%;
          animation: landingBlobFloat2 26s ease-in-out infinite;
        }
        .landing-bg-blob-3 {
          bottom: -12%;
          left: 30%;
          animation: landingBlobFloat3 20s ease-in-out infinite;
        }
        @keyframes landingGradientShift {
          0%, 100% { background-position: 0% 0%; }
          50% { background-position: 100% 100%; }
        }
        @keyframes landingBlobFloat1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(60px, 40px) scale(1.1); }
          66% { transform: translate(-30px, 70px) scale(0.95); }
        }
        @keyframes landingBlobFloat2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(-70px, 50px) scale(1.08); }
          66% { transform: translate(40px, -40px) scale(0.92); }
        }
        @keyframes landingBlobFloat3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(50px, -50px) scale(1.05); }
          66% { transform: translate(-60px, -20px) scale(0.98); }
        }
        @media (prefers-reduced-motion: reduce) {
          .landing-bg-base, .landing-bg-blob-1, .landing-bg-blob-2, .landing-bg-blob-3 {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
