'use client';

import { useEffect, useRef } from 'react';

// 메인 대시보드 Hero와 랜딩페이지(/ai-portfolio) 히어로가 동일한 배경을 쓰도록 분리한 컴포넌트.
// 마우스 인터랙션이 있는 파티클 네트워크 + 그라디언트 — components/main/Hero.tsx에서 그대로 추출.
export default function HeroCanvasBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // 색상 팔레트 (인디고 → 퍼플 → 핑크)
    const COLORS = [
      { r: 99,  g: 102, b: 241 }, // indigo-500
      { r: 139, g: 92,  b: 246 }, // violet-500
      { r: 168, g: 85,  b: 247 }, // purple-500
      { r: 217, g: 70,  b: 239 }, // fuchsia-500
      { r: 236, g: 72,  b: 153 }, // pink-500
    ];

    const mouse = { x: -9999, y: -9999 };
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
    };
    canvas.addEventListener('mousemove', onMouseMove);

    type Particle = {
      x: number; y: number;
      vx: number; vy: number;
      radius: number;
      baseRadius: number;
      opacity: number;
      color: { r: number; g: number; b: number };
      pulsePhase: number;
      pulseSpeed: number;
      glowing: boolean;
    };

    const COUNT = 90;
    const particles: Particle[] = Array.from({ length: COUNT }, () => {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const baseRadius = Math.random() * 2.5 + 0.8;
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: baseRadius,
        baseRadius,
        opacity: Math.random() * 0.6 + 0.25,
        color,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.02 + Math.random() * 0.03,
        glowing: Math.random() < 0.2,
      };
    });

    // 데이터 흐름 파티클 (연결선 위를 달리는 빛)
    type Flow = { from: number; to: number; progress: number; speed: number };
    const flows: Flow[] = [];
    let tick = 0;

    let animId: number;
    const CONNECT_DIST = 160;
    const MOUSE_REPEL = 120;

    const draw = () => {
      tick++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 마우스 주변 글로우
      if (mouse.x > 0) {
        const mg = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, MOUSE_REPEL);
        mg.addColorStop(0, 'rgba(139,92,246,0.06)');
        mg.addColorStop(1, 'rgba(139,92,246,0)');
        ctx.fillStyle = mg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      // 파티클 이동 + 마우스 반발
      for (const p of particles) {
        p.pulsePhase += p.pulseSpeed;
        const pulseFactor = 1 + Math.sin(p.pulsePhase) * 0.35;
        p.radius = p.baseRadius * pulseFactor;

        const dx = p.x - mouse.x;
        const dy = p.y - mouse.y;
        const distMouse = Math.sqrt(dx * dx + dy * dy);
        if (distMouse < MOUSE_REPEL && distMouse > 0) {
          const force = (MOUSE_REPEL - distMouse) / MOUSE_REPEL * 0.8;
          p.vx += (dx / distMouse) * force * 0.4;
          p.vy += (dy / distMouse) * force * 0.4;
        }

        // 속도 감쇠
        p.vx *= 0.98;
        p.vy *= 0.98;
        // 최소 속도 보장
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed < 0.1) {
          p.vx += (Math.random() - 0.5) * 0.1;
          p.vy += (Math.random() - 0.5) * 0.1;
        }

        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        const { r, g, b } = p.color;

        if (p.glowing) {
          // 글로우 효과
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

      // 연결선 + 색상 그라디언트
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECT_DIST) {
            const alpha = 0.2 * (1 - dist / CONNECT_DIST);
            const grad = ctx.createLinearGradient(particles[i].x, particles[i].y, particles[j].x, particles[j].y);
            const ci = particles[i].color;
            const cj = particles[j].color;
            grad.addColorStop(0, `rgba(${ci.r},${ci.g},${ci.b},${alpha})`);
            grad.addColorStop(1, `rgba(${cj.r},${cj.g},${cj.b},${alpha})`);
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 0.6;
            ctx.stroke();
          }
        }
      }

      // 데이터 흐름 생성 (매 60프레임마다)
      if (tick % 60 === 0 && flows.length < 12) {
        const a = Math.floor(Math.random() * particles.length);
        let b = Math.floor(Math.random() * particles.length);
        while (b === a) b = Math.floor(Math.random() * particles.length);
        flows.push({ from: a, to: b, progress: 0, speed: 0.015 + Math.random() * 0.02 });
      }

      // 데이터 흐름 렌더링
      for (let i = flows.length - 1; i >= 0; i--) {
        const f = flows[i];
        f.progress += f.speed;
        if (f.progress >= 1) { flows.splice(i, 1); continue; }

        const pa = particles[f.from];
        const pb = particles[f.to];
        const fx = pa.x + (pb.x - pa.x) * f.progress;
        const fy = pa.y + (pb.y - pa.y) * f.progress;
        const { r, g, b } = pa.color;

        const trailGrd = ctx.createRadialGradient(fx, fy, 0, fx, fy, 5);
        trailGrd.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
        trailGrd.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(fx, fy, 5, 0, Math.PI * 2);
        ctx.fillStyle = trailGrd;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMouseMove);
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {/* 배경 그라디언트 — 헤더(#0f1117)에서 자연스럽게 이어짐 */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, #0f1117 0%, #0d1033 40%, #0a0d1f 100%)' }}
      />

      {/* Canvas 파티클 — 배경 위 */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-auto" />

      {/* 중앙 글로우 */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[320px] rounded-full opacity-20"
          style={{ background: 'radial-gradient(ellipse, #4f46e5 0%, transparent 70%)' }}
        />
        {/* 상단 라인 */}
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, #4f46e5, transparent)' }}
        />
      </div>
    </div>
  );
}
