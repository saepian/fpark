'use client';

import { useEffect, useRef } from 'react';

// 랜딩페이지(app/ai-portfolio) 전용 — 마우스를 스프링으로 뒤쫓는 발광 AI 오브.
// LandingBackground(z-index 최하단)와 분리된 별도 레이어로, 카드/버튼 등 페이지
// 콘텐츠보다 위(z-40)에 그려서 오브가 카드 뒤로 숨지 않도록 한다.
// pointer-events-none이라 클릭/호버는 그대로 아래 콘텐츠로 전달된다.

export default function AiCompanion() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width  = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const w = () => canvas.width / dpr;
    const h = () => canvas.height / dpr;

    const mouse = { x: w() / 2, y: h() / 2, active: false, lastMoveTick: 0 };
    const onMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      mouse.active = true;
      mouse.lastMoveTick = tick;
    };
    const onMouseLeave = () => { mouse.active = false; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseleave', onMouseLeave);

    const bot = {
      x: w() / 2, y: h() / 2,
      angle: 0,
      idleAnchorX: w() / 2, idleAnchorY: h() / 2,
      wasIdle: true,
      blinkPhase: Math.random() * Math.PI * 2,
      ringAngle: 0,
      trail: [] as { x: number; y: number }[],
    };

    let tick = 0;
    let animId: number;

    const draw = () => {
      tick++;
      ctx.clearRect(0, 0, w(), h());

      const idleFor = tick - mouse.lastMoveTick;
      const isIdle = !mouse.active || idleFor > 150; // 마우스 정지 2.5초↑면 유휴 배회

      if (isIdle) {
        if (!bot.wasIdle) { bot.idleAnchorX = bot.x; bot.idleAnchorY = bot.y; }
        const wanderT = tick * 0.012;
        mouse.x = bot.idleAnchorX + Math.sin(wanderT) * 60;
        mouse.y = bot.idleAnchorY + Math.sin(wanderT * 1.7) * 34;
      }
      bot.wasIdle = isIdle;

      const prevX = bot.x, prevY = bot.y;
      const followSpeed = isIdle ? 0.03 : 0.09;
      bot.x += (mouse.x - bot.x) * followSpeed;
      bot.y += (mouse.y - bot.y) * followSpeed;

      const vx = bot.x - prevX, vy = bot.y - prevY;
      const speed = Math.hypot(vx, vy);
      const targetAngle = speed > 0.15 ? Math.atan2(vy, vx) : bot.angle;
      bot.angle += (targetAngle - bot.angle) * 0.12;
      bot.ringAngle += 0.02;
      bot.blinkPhase += 0.05;

      // 트레일 (빛 궤적)
      bot.trail.push({ x: bot.x, y: bot.y });
      if (bot.trail.length > 16) bot.trail.shift();
      for (let i = 0; i < bot.trail.length; i++) {
        const t = bot.trail[i];
        const alpha = (i / bot.trail.length) * 0.25;
        const r = 3 + (i / bot.trail.length) * 3;
        ctx.beginPath();
        ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(62,207,142,${alpha})`;
        ctx.fill();
      }

      const R = 15; // 오브 반경

      // 외곽 발광
      const glow = ctx.createRadialGradient(bot.x, bot.y, 0, bot.x, bot.y, R * 4.2);
      glow.addColorStop(0, 'rgba(62,207,142,0.35)');
      glow.addColorStop(0.5, 'rgba(99,102,241,0.14)');
      glow.addColorStop(1, 'rgba(62,207,142,0)');
      ctx.beginPath();
      ctx.arc(bot.x, bot.y, R * 4.2, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();

      // 회전 스캔링 (점선)
      ctx.save();
      ctx.translate(bot.x, bot.y);
      ctx.rotate(bot.ringAngle);
      ctx.beginPath();
      ctx.setLineDash([4, 6]);
      ctx.arc(0, 0, R * 1.9, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(99,102,241,0.55)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 진행 방향으로 살짝 기운 본체 (캡슐형 코어)
      ctx.save();
      ctx.translate(bot.x, bot.y);
      ctx.rotate(bot.angle * 0.25);
      const bodyGrad = ctx.createLinearGradient(-R, -R, R, R);
      bodyGrad.addColorStop(0, '#1b2130');
      bodyGrad.addColorStop(1, '#0c0f18');
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, Math.PI * 2);
      ctx.fillStyle = bodyGrad;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = 'rgba(62,207,142,0.8)';
      ctx.stroke();

      // 눈(코어) — 주기적으로 깜빡임
      const blink = Math.max(0, Math.sin(bot.blinkPhase));
      const eyeH = 5.5 * (0.15 + 0.85 * (blink > 0.94 ? 1 - (blink - 0.94) / 0.06 : 1));
      const eyeGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, 6);
      eyeGrad.addColorStop(0, 'rgba(190,255,225,0.95)');
      eyeGrad.addColorStop(1, 'rgba(62,207,142,0.85)');
      ctx.beginPath();
      ctx.ellipse(0, 0, 6, Math.max(0.6, eyeH), 0, 0, Math.PI * 2);
      ctx.fillStyle = eyeGrad;
      ctx.fill();

      // 안테나
      ctx.beginPath();
      ctx.moveTo(0, -R);
      ctx.lineTo(0, -R - 7);
      ctx.strokeStyle = 'rgba(62,207,142,0.7)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, -R - 9, 1.8, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(190,255,225,0.95)';
      ctx.fill();

      ctx.restore();

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseleave', onMouseLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-40 w-full h-full pointer-events-none"
    />
  );
}
