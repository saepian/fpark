'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NewsCard from '@/components/main/NewsCard';
import MarketSummary from '@/components/main/MarketSummary';
import { NewsItem } from '@/lib/types';

const PAGE_SIZE = 10;

const CATEGORIES = ['전체', '국내주식', '해외주식', '경제', '부동산', '원자재'] as const;
type Category = typeof CATEGORIES[number];

const CATEGORY_CODE: Record<Category, string> = {
  '전체':   '',
  '국내주식': 'domestic',
  '해외주식': 'global',
  '경제':   'macro',
  '부동산':  'real_estate',
  '원자재':  'commodity',
};

const RANK_BADGE: Record<number, string> = {
  1: 'bg-amber-400/20 text-amber-300 border border-amber-400/30',
  2: 'bg-slate-400/15 text-slate-300 border border-slate-500/30',
  3: 'bg-orange-800/20 text-orange-400 border border-orange-700/30',
};

interface SideStock {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
}

function SideStockList({
  title,
  stocks,
  onClickStock,
}: {
  title: string;
  stocks: SideStock[];
  onClickStock: (ticker: string) => void;
}) {
  if (stocks.length === 0) return null;
  return (
    <div className="bg-[#1e2130] rounded-2xl p-4">
      <p className="text-[12px] font-bold text-white mb-3">{title}</p>
      <div className="space-y-1">
        {stocks.map((stock, i) => {
          const rank      = i + 1;
          const isUp      = stock.changeRate >= 0;
          const badge     = RANK_BADGE[rank];
          const rateColor = isUp ? 'text-red-400' : 'text-blue-400';
          return (
            <div
              key={stock.ticker}
              onClick={() => onClickStock(stock.ticker)}
              className="flex items-center gap-2.5 py-1.5 cursor-pointer hover:opacity-75 transition-opacity"
            >
              {badge ? (
                <span className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center
                  text-[10px] font-bold ${badge}`}>
                  {rank}
                </span>
              ) : (
                <span className="shrink-0 text-[11px] font-semibold text-slate-500 w-5 text-center">
                  {rank}
                </span>
              )}
              <span className="flex-1 text-[13px] font-semibold text-white truncate">{stock.name}</span>
              <span className={`shrink-0 text-[11px] font-semibold font-mono ${rateColor}`}>
                {isUp ? '▲' : '▼'} {Math.abs(stock.changeRate).toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const currentPage = Math.max(1, Number(searchParams.get('page') || 1));
  const currentCategory = (searchParams.get('category') || '전체') as Category;

  const [news, setNews]       = useState<NewsItem[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [popular, setPopular] = useState<SideStock[]>([]);
  const [gainers, setGainers] = useState<SideStock[]>([]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  // 뉴스 목록
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const offset = (currentPage - 1) * PAGE_SIZE;
        const code   = CATEGORY_CODE[currentCategory];
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (code) params.set('category', code);
        const res  = await fetch(`/api/news?${params}`);
        const data = await res.json();
        if (!cancelled) {
          setNews(data.news ?? []);
          setTotal(data.total ?? 0);
        }
      } catch {
        if (!cancelled) setNews([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    window.scrollTo(0, 0);
    return () => { cancelled = true; };
  }, [currentPage, currentCategory]);

  // 사이드 패널 데이터
  useEffect(() => {
    fetch('/api/market/popular')
      .then(r => r.json())
      .then(d => setPopular(Array.isArray(d) ? d.slice(0, 5) : []))
      .catch(() => {});

    fetch('/api/market/ranking?tab=급등')
      .then(r => r.json())
      .then(d => setGainers(Array.isArray(d) ? d.slice(0, 5) : []))
      .catch(() => {});
  }, []);

  const goToPage = (page: number) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    if (currentCategory !== '전체') params.set('category', currentCategory);
    router.push(`/news?${params}`);
  };

  const goToCategory = (cat: Category) => {
    const params = new URLSearchParams();
    params.set('page', '1');
    if (cat !== '전체') params.set('category', cat);
    router.push(`/news?${params}`);
  };

  const pageNumbers = () => {
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
    const end   = Math.min(totalPages, start + 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };

  const goStock = (ticker: string) => router.push(`/stock/${ticker}`);

  return (
    <div className="max-w-[1200px] mx-auto px-5 py-7">

      <h1 className="text-[18px] font-bold text-white mb-1 tracking-tight">뉴스</h1>
      <p className="text-sm text-slate-500 mt-1 mb-5 leading-relaxed">
        국내 주요 경제·금융 뉴스 · 2시간마다 자동 업데이트 · 출처: 연합뉴스, 한국경제, 서울경제 등
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">

        {/* 좌측: 뉴스 목록 */}
        <div className="min-w-0">
          {/* 카테고리 탭 + 카운트 */}
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="flex gap-1.5 flex-wrap">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => goToCategory(cat)}
                  className={[
                    'px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer',
                    currentCategory === cat
                      ? 'bg-indigo-600 text-white'
                      : 'bg-transparent text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-slate-200',
                  ].join(' ')}
                >
                  {cat}
                </button>
              ))}
            </div>
            {total > 0 && (
              <span className="text-xs text-slate-600 shrink-0">총 {total.toLocaleString()}건</span>
            )}
          </div>

          {/* 뉴스 리스트 */}
          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : news.length === 0 ? (
            <div className="py-20 text-center text-slate-500 text-sm">해당 카테고리의 뉴스가 없습니다.</div>
          ) : (
            <div className="space-y-3">
              {news.map((item) => (
                <NewsCard
                  key={item.id}
                  item={item}
                  onSelectStock={goStock}
                />
              ))}
            </div>
          )}

          {/* 페이지네이션 */}
          {totalPages > 1 && (
            <>
              <div className="flex items-center justify-center gap-1 mt-10">
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="px-3 py-2 rounded-lg text-sm text-slate-400
                    hover:text-white hover:bg-slate-800
                    disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  ←
                </button>

                {pageNumbers().map((page) => (
                  <button
                    key={page}
                    onClick={() => goToPage(page)}
                    className={[
                      'w-9 h-9 rounded-lg text-sm font-medium transition-all',
                      page === currentPage
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800',
                    ].join(' ')}
                  >
                    {page}
                  </button>
                ))}

                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="px-3 py-2 rounded-lg text-sm text-slate-400
                    hover:text-white hover:bg-slate-800
                    disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                >
                  →
                </button>
              </div>

              <p className="text-center text-xs text-slate-600 mt-3">
                {currentPage} / {totalPages} 페이지
              </p>
            </>
          )}
        </div>

        {/* 우측: 사이드 패널 */}
        <div className="flex flex-col gap-4">
          <MarketSummary />
          <SideStockList title="🔥 인기 종목" stocks={popular} onClickStock={goStock} />
          <SideStockList title="📈 오늘 급등주" stocks={gainers} onClickStock={goStock} />
        </div>

      </div>
    </div>
  );
}

export default function NewsPage() {
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

    // 뉴스·정보 테마: 인디고/파랑/슬레이트 계열
    const COLORS = [
      { r: 99,  g: 102, b: 241 }, // indigo-500
      { r: 59,  g: 130, b: 246 }, // blue-500
      { r: 56,  g: 189, b: 248 }, // sky-400
      { r: 148, g: 163, b: 184 }, // slate-400
      { r: 139, g: 92,  b: 246 }, // violet-500
    ];

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
    };

    const COUNT = 65;
    const particles: Particle[] = Array.from({ length: COUNT }, () => ({
      x:          Math.random() * canvas.width,
      y:          Math.random() * canvas.height,
      vx:         (Math.random() - 0.5) * 0.45,
      vy:         (Math.random() - 0.5) * 0.45,
      size:       Math.random() * 6 + 4,
      opacity:    Math.random() * 0.5 + 0.2,
      color:      COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation:   Math.random() * Math.PI * 2,
      rotSpeed:   (Math.random() - 0.5) * 0.006,
      pulsePhase: Math.random() * Math.PI * 2,
      pulseSpeed: 0.015 + Math.random() * 0.02,
      glowing:    Math.random() < 0.2,
    }));

    // 문서(dog-ear) 모양 파티클 그리기
    const drawDoc = (
      x: number, y: number, size: number, rotation: number,
      r: number, g: number, b: number, opacity: number,
    ) => {
      const w    = size;
      const h    = size * 1.42;
      const fold = size * 0.28;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotation);
      // 본체
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo( w / 2 - fold, -h / 2);
      ctx.lineTo( w / 2,        -h / 2 + fold);
      ctx.lineTo( w / 2,         h / 2);
      ctx.lineTo(-w / 2,         h / 2);
      ctx.closePath();
      ctx.fillStyle = `rgba(${r},${g},${b},${opacity * 0.75})`;
      ctx.fill();
      // 접힌 귀퉁이
      ctx.beginPath();
      ctx.moveTo(w / 2 - fold, -h / 2);
      ctx.lineTo(w / 2,        -h / 2 + fold);
      ctx.lineTo(w / 2 - fold, -h / 2 + fold);
      ctx.closePath();
      ctx.fillStyle = `rgba(${r},${g},${b},${opacity * 1.3})`;
      ctx.fill();
      // 텍스트 줄 3개
      ctx.strokeStyle = `rgba(${r},${g},${b},${opacity * 0.45})`;
      ctx.lineWidth   = 0.5;
      const xRight = w / 2 - fold * 0.35;
      const xLeft  = -w / 2 + 1.5;
      [[-h / 5.5, 1], [0, 1], [h / 5.5, 0.68]].forEach(([ly, wRatio]) => {
        ctx.beginPath();
        ctx.moveTo(xLeft, ly);
        ctx.lineTo(xLeft + (xRight - xLeft) * wRatio, ly);
        ctx.stroke();
      });
      ctx.restore();
    };

    type Flow = { from: number; to: number; progress: number; speed: number };
    const flows: Flow[] = [];
    let tick = 0;
    let animId: number;
    const CONNECT_DIST = 155;

    const draw = () => {
      tick++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // 파티클 업데이트 & 렌더
      for (const p of particles) {
        p.pulsePhase += p.pulseSpeed;
        const pf = 1 + Math.sin(p.pulsePhase) * 0.18;
        p.rotation += p.rotSpeed;

        p.vx *= 0.99;
        p.vy *= 0.99;
        if (Math.hypot(p.vx, p.vy) < 0.08) {
          p.vx += (Math.random() - 0.5) * 0.08;
          p.vy += (Math.random() - 0.5) * 0.08;
        }
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -20 || p.x > canvas.width  + 20) p.vx *= -1;
        if (p.y < -20 || p.y > canvas.height + 20) p.vy *= -1;

        const { r, g, b } = p.color;

        // 글로우 후광
        if (p.glowing) {
          const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * pf * 5);
          grd.addColorStop(0, `rgba(${r},${g},${b},${p.opacity * 0.25})`);
          grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * pf * 5, 0, Math.PI * 2);
          ctx.fillStyle = grd;
          ctx.fill();
        }

        drawDoc(p.x, p.y, p.size * pf, p.rotation, r, g, b, p.opacity);
      }

      // 연결선
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dist = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y);
          if (dist < CONNECT_DIST) {
            const alpha = 0.18 * (1 - dist / CONNECT_DIST);
            const grad  = ctx.createLinearGradient(particles[i].x, particles[i].y, particles[j].x, particles[j].y);
            const ci = particles[i].color;
            const cj = particles[j].color;
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

      // 데이터 흐름 (연결선 위를 달리는 빛)
      if (tick % 55 === 0 && flows.length < 10) {
        const a = Math.floor(Math.random() * particles.length);
        let b   = Math.floor(Math.random() * particles.length);
        while (b === a) b = Math.floor(Math.random() * particles.length);
        flows.push({ from: a, to: b, progress: 0, speed: 0.012 + Math.random() * 0.018 });
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
        const tg = ctx.createRadialGradient(fx, fy, 0, fx, fy, 4.5);
        tg.addColorStop(0, `rgba(${r},${g},${b},0.9)`);
        tg.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.beginPath();
        ctx.arc(fx, fy, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = tg;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="relative min-h-screen">

      {/* ── 뉴스 배경 ── */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(160deg, #0f1117 0%, #0c1030 55%, #0f1117 100%)' }}
        />
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        <div
          className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[280px] rounded-full opacity-10 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse, #4f46e5 0%, transparent 70%)' }}
        />
      </div>

      <Suspense fallback={
        <div className="max-w-[1200px] mx-auto px-5 py-8">
          <div className="h-8 bg-slate-800 rounded w-20 mb-2 animate-pulse" />
          <div className="h-4 bg-slate-800/60 rounded w-96 mb-6 animate-pulse" />
          <div className="space-y-4">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      }>
        <NewsPageContent />
      </Suspense>
    </div>
  );
}
