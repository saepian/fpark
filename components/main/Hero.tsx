'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import SearchDropdown from '@/components/search/SearchDropdown';
import type { SearchResult } from '@/lib/types';

interface MarketData {
  KOSPI: { value: number; changeRate: number };
  KOSDAQ: { value: number; changeRate: number };
}

const POPULAR = [
  { name: '삼성전자', ticker: '005930' },
  { name: 'SK하이닉스', ticker: '000660' },
  { name: 'NAVER', ticker: '035420' },
  { name: '카카오', ticker: '035720' },
  { name: '현대차', ticker: '005380' },
  { name: '셀트리온', ticker: '068270' },
];

export default function Hero() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDrop, setShowDrop] = useState(false);
  const [market, setMarket] = useState<MarketData | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Canvas 파티클 네트워크 애니메이션
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

  // 시장 데이터
  useEffect(() => {
    fetch('/api/market')
      .then((r) => r.json())
      .then((d) => { if (d.KOSPI && d.KOSDAQ) setMarket(d); })
      .catch(() => {});
  }, []);

  // 검색어 디바운스 fetch
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data: SearchResult[] = await res.json();
          setResults(Array.isArray(data) ? data : []);
        }
      } catch { setResults([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = useCallback((ticker: string) => {
    router.push(`/stock/${ticker}`);
    setShowDrop(false);
    setQuery('');
    setResults([]);
  }, [router]);

  const isKospiUp = (market?.KOSPI.changeRate ?? 0) >= 0;
  const isKosdaqUp = (market?.KOSDAQ.changeRate ?? 0) >= 0;

  return (
    <div className="relative w-full">
      {/* 배경 그라디언트 — 헤더(#0f1117)에서 자연스럽게 이어짐 */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, #0f1117 0%, #0d1033 40%, #0a0d1f 100%)' }}
      />

      {/* Canvas 파티클 — 배경 위 */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />

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

      {/* 콘텐츠 */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 py-20 text-center">

        {/* AI 뱃지 */}
        <div className="inline-flex items-center gap-2 mb-6
          bg-indigo-500/10 border border-indigo-500/30 rounded-full px-4 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
          </span>
          <span className="text-xs font-semibold text-indigo-300 tracking-wide">
            AI 기반 실시간 주식 분석 플랫폼
          </span>
        </div>

        {/* 헤드라인 */}
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
          AI가 분석하는
          <br />
          <span className="relative inline-block">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
              실시간 주식 인사이트
            </span>
            <span
              className="absolute -bottom-1 left-0 right-0 h-px opacity-60"
              style={{ background: 'linear-gradient(90deg, #818cf8, #a78bfa, #f472b6)' }}
            />
          </span>
        </h1>

        <p className="text-slate-400 text-sm mb-10 max-w-lg mx-auto leading-relaxed">
          최신 뉴스와 시장 데이터를 AI가 종합 분석합니다.
          <br />
          관심 종목을 검색하고 맞춤 인사이트를 받아보세요.
        </p>

        {/* 검색창 */}
        <div ref={wrapperRef} className="relative max-w-xl mx-auto mb-8">
          <div className="relative group">
            {/* 포커스 글로우 */}
            <div
              className="absolute -inset-0.5 rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 blur-sm"
              style={{ background: 'linear-gradient(90deg, #4f46e5, #7c3aed, #ec4899)' }}
            />
            <div className="relative flex items-center">
              <svg
                className="absolute left-4 w-5 h-5 text-slate-400 shrink-0 z-10 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowDrop(true); }}
                onFocus={() => { if (query.length >= 1) setShowDrop(true); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setShowDrop(false);
                  if (e.key === 'Enter' && query.trim()) {
                    router.push(`/search?q=${encodeURIComponent(query)}`);
                    setShowDrop(false);
                  }
                }}
                placeholder="종목명 또는 코드 검색  (예: 삼성전자, 005930)"
                className="relative w-full pl-12 pr-4 py-4 rounded-xl z-10
                  bg-slate-900/90 border border-slate-700/50
                  text-white placeholder:text-slate-500
                  focus:outline-none focus:border-indigo-500/50
                  text-sm transition-all backdrop-blur-md"
              />
            </div>
          </div>

          {showDrop && query.length >= 1 && (
            <div className="absolute top-full left-0 right-0 mt-2 z-50">
              <SearchDropdown
                query={query}
                results={results}
                onSelect={handleSelect}
                onClose={() => setShowDrop(false)}
              />
            </div>
          )}
        </div>

        {/* 인기 종목 */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
          <span className="text-xs text-slate-600">인기 종목</span>
          {POPULAR.map((s) => (
            <button
              key={s.ticker}
              onClick={() => router.push(`/stock/${s.ticker}`)}
              className="text-xs text-slate-400 hover:text-white
                bg-slate-800/50 hover:bg-indigo-600/30
                border border-slate-700/50 hover:border-indigo-500/50
                rounded-full px-3.5 py-1.5 transition-all cursor-pointer"
            >
              {s.name}
            </button>
          ))}
        </div>

        {/* 시장 현황 */}
        {market && (
          <div className="inline-flex flex-wrap items-center justify-center gap-4 sm:gap-6
            bg-slate-900/50 border border-slate-800/50
            rounded-2xl px-4 sm:px-6 py-3 backdrop-blur-sm">
            {[
              { label: 'KOSPI',  value: market.KOSPI.value,  rate: market.KOSPI.changeRate,  isUp: isKospiUp },
              { label: 'KOSDAQ', value: market.KOSDAQ.value, rate: market.KOSDAQ.changeRate, isUp: isKosdaqUp },
            ].map((m, i) => (
              <div key={m.label} className="flex items-center gap-3">
                {i > 0 && <div className="w-px h-4 bg-slate-700" />}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{m.label}</span>
                  <span className="text-sm font-bold font-mono text-white">
                    {m.value.toLocaleString()}
                  </span>
                  <span className={`text-xs font-mono font-semibold ${m.isUp ? 'text-red-400' : 'text-blue-400'}`}>
                    {m.isUp ? '▲' : '▼'} {Math.abs(m.rate).toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
            <div className="w-px h-4 bg-slate-700" />
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-slate-500">실시간</span>
            </div>
          </div>
        )}

        {/* 통계 수치 */}
        <div className="flex items-center justify-center gap-8 mt-8">
          {[
            { label: '분석 종목', value: '2,500+' },
            { label: '실시간 뉴스', value: '24/7' },
            { label: 'AI 분석', value: 'GPT-4급' },
          ].map((stat, i) => (
            <div key={i} className="text-center">
              <p className="text-lg font-bold text-white">{stat.value}</p>
              <p className="text-[11px] text-slate-500">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 하단 페이드 아웃 */}
      <div
        className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
        style={{ background: 'linear-gradient(0deg, #0f1117 0%, transparent 100%)' }}
      />
    </div>
  );
}
