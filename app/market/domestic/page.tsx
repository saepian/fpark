'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import WatchlistSection from '../../../components/main/WatchlistSection';

// ── Types ─────────────────────────────────────────────────────────────────────

const TABS = ['급등', '급락'] as const;
type Tab = typeof TABS[number];

interface IndexData {
  value: number;
  change: number;
  changeRate: number;
  sparkline?: number[];
}

interface StockRow {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  change: number;
  volume: number;
  tradingValue: number;
}

interface PopularStock {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  change: number;
}

interface NewsItem {
  id: string;
  title: string;
  source: string;
  published_at: string;
  original_url: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RANK_BADGE: Record<number, string> = {
  1: 'bg-amber-400/20 text-amber-300 border border-amber-400/30',
  2: 'bg-slate-400/15 text-slate-300 border border-slate-500/30',
  3: 'bg-orange-800/20 text-orange-400 border border-orange-700/30',
};

const INDEX_CARDS: { label: string; key: string; isYield?: boolean }[] = [
  { label: 'KOSPI',      key: 'KOSPI' },
  { label: 'KOSDAQ',     key: 'KOSDAQ' },
  { label: 'USD/KRW',    key: 'USD_KRW' },
  { label: '국고채 3년',  key: 'BOND_3Y', isYield: true },
];

const CHART_SYMBOLS = ['KOSPI', 'KOSDAQ', 'USD_KRW', 'BOND_3Y'];

// ── Formatters ────────────────────────────────────────────────────────────────

const fmtComma = (v: number) => v.toLocaleString('ko-KR');

const fmtVolume = (v: number): string => {
  if (v >= 10_000_000) return `${(v / 10_000_000).toFixed(1)}천만`;
  if (v >= 1_000_000)  return `${(v / 1_000_000).toFixed(1)}백만`;
  if (v >= 10_000)     return `${(v / 10_000).toFixed(0)}만`;
  return fmtComma(v);
};

function relativeTime(dateStr: string): string {
  const diff  = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  if (mins < 1)   return '방금 전';
  if (mins < 60)  return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ closes, isUp, uid }: { closes: number[]; isUp: boolean; uid: string }) {
  const color = isUp ? '#ef4444' : '#3b82f6';
  const gid   = `sp-dm-${uid}`;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={closes.map(v => ({ v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
            <stop offset="95%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5}
          fill={`url(#${gid})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Index Card ─────────────────────────────────────────────────────────────────

function IndexCardView({
  label, data, closes, uid, isYield = false,
}: {
  label: string;
  data: IndexData | null | undefined;
  closes: number[];
  uid: string;
  isYield?: boolean;
}) {
  if (!data) {
    return (
      <div className="flex-1 bg-[#1e2130] rounded-2xl overflow-hidden animate-pulse min-w-0">
        <div className="px-5 pt-4 pb-2">
          <div className="h-2.5 bg-slate-700/60 rounded w-16 mb-3" />
          <div className="h-6 bg-slate-700/60 rounded w-28 mb-2" />
          <div className="h-2.5 bg-slate-700/60 rounded w-20" />
        </div>
        <div className="h-12 w-full" />
      </div>
    );
  }

  const isUp  = data.changeRate >= 0;
  const color = isUp ? 'text-red-400' : 'text-blue-400';
  const displayValue = isYield
    ? `${data.value.toFixed(2)}%`
    : data.value.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex-1 bg-[#1e2130] rounded-2xl overflow-hidden min-w-0">
      <div className="px-5 pt-4 pb-2">
        <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mb-1.5">{label}</p>
        <p className="text-[21px] font-bold text-white font-mono leading-tight">{displayValue}</p>
        <p className={`text-[12px] font-mono mt-1 ${color}`}>
          {isUp ? '▲' : '▼'} {Math.abs(data.change).toFixed(2)}
          <span className="ml-1.5 text-[11px] opacity-75">
            ({isUp ? '+' : ''}{data.changeRate.toFixed(2)}%)
          </span>
        </p>
      </div>
      {closes.length >= 2 && (
        <div className="h-12 w-full">
          <Sparkline closes={closes} isUp={isUp} uid={uid} />
        </div>
      )}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <div className="divide-y divide-slate-800/40">
      {[...Array(15)].map((_, i) => (
        <div key={i} className="grid grid-cols-[48px_1fr_110px_100px_90px_90px] gap-3 px-4 py-3 animate-pulse">
          <div className="self-center mx-auto w-6 h-6 rounded-full bg-slate-800" />
          <div className="self-center space-y-1.5">
            <div className="h-3.5 bg-slate-800 rounded w-28" />
            <div className="h-2.5 bg-slate-800/60 rounded w-16" />
          </div>
          <div className="self-center h-3.5 bg-slate-800 rounded w-20 ml-auto" />
          <div className="self-center h-3.5 bg-slate-800 rounded w-16 ml-auto" />
          <div className="self-center h-3.5 bg-slate-800 rounded w-14 ml-auto" />
          <div className="self-center h-3.5 bg-slate-800 rounded w-14 ml-auto" />
        </div>
      ))}
    </div>
  );
}

// ── Popular List (우측 패널) ──────────────────────────────────────────────────

function PopularList({
  stocks,
  onClickStock,
}: {
  stocks: PopularStock[];
  onClickStock: (ticker: string) => void;
}) {
  if (stocks.length === 0) return null;

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-slate-800/70">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">인기종목</span>
        <span className="text-[10px] text-slate-600 font-medium">TOP 5</span>
      </div>
      <div className="divide-y divide-slate-800/40">
        {stocks.slice(0, 5).map((stock, i) => {
          const rank      = i + 1;
          const isUp      = stock.changeRate >= 0;
          const badge     = RANK_BADGE[rank];
          const rateColor = isUp ? 'text-red-400' : 'text-blue-400';
          return (
            <div
              key={stock.ticker}
              onClick={() => onClickStock(stock.ticker)}
              className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
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

// ── News Feed ─────────────────────────────────────────────────────────────────

function NewsFeed({ news }: { news: NewsItem[] }) {
  if (news.length === 0) return null;
  return (
    <div className="bg-[#1e2130] rounded-2xl overflow-hidden">
      {/* 타이틀 + 더보기 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800/70">
        <p className="text-[12px] font-bold text-white">실시간 뉴스</p>
        <Link
          href="/news"
          className="text-[22px] font-light text-slate-500 hover:text-slate-300 transition-all duration-200 leading-none hover:rotate-90 inline-block"
        >
          +
        </Link>
      </div>

      {/* 뉴스 목록 */}
      <div className="divide-y divide-slate-800/50 px-4 pb-[2px]">
        {news.slice(0, 5).map(item => (
          <a
            key={item.id}
            href={item.original_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col gap-0.5 py-[11px] hover:opacity-75 transition-opacity"
          >
            <p className="text-sm font-medium text-white truncate leading-snug">{item.title}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {item.source} · {relativeTime(item.published_at)}
            </p>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Colors ────────────────────────────────────────────────────────────────────

const COLORS = [
  { r: 99,  g: 102, b: 241 },
  { r: 59,  g: 130, b: 246 },
  { r: 139, g: 92,  b: 246 },
  { r: 14,  g: 165, b: 233 },
  { r: 100, g: 116, b: 139 },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DomesticMarketPage() {
  const router = useRouter();

  const [indices, setIndices]             = useState<Record<string, IndexData | null>>({});
  const [chartData, setChartData]         = useState<Record<string, number[]>>({});
  const [activeTab, setActiveTab]         = useState<Tab>('급등');
  const [stocks, setStocks]               = useState<StockRow[]>([]);
  const [loading, setLoading]             = useState(true);
  const [popularStocks, setPopularStocks] = useState<PopularStock[]>([]);
  const [news, setNews]                   = useState<NewsItem[]>([]);

  const rightPanelRef                     = useRef<HTMLDivElement>(null);
  const canvasRef                          = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    // 지수 카드
    fetch('/api/market')
      .then(r => r.json())
      .then(d => {
        setIndices({
          KOSPI:   d.KOSPI   ?? null,
          KOSDAQ:  d.KOSDAQ  ?? null,
          USD_KRW: d.USD_KRW ?? null,
          BOND_3Y: d.BOND_3Y ?? null,
        });
      })
      .catch(() => {});

    // 차트 데이터
    Promise.allSettled(
      CHART_SYMBOLS.map(s =>
        fetch(`/api/market/chart?symbol=${s}`).then(r => r.json()) as Promise<number[]>
      )
    ).then(results => {
      const map: Record<string, number[]> = {};
      results.forEach((r, i) => { map[CHART_SYMBOLS[i]] = r.status === 'fulfilled' ? r.value : []; });
      setChartData(map);
    });

    // 인기종목 + live price 보강
    fetch('/api/market/popular')
      .then(r => r.json())
      .then(async (data: PopularStock[]) => {
        if (!Array.isArray(data) || data.length === 0) return;
        setPopularStocks(data);

        const results = await Promise.allSettled(
          data.map(item =>
            fetch(`/api/stock/${item.ticker}/price`).then(r => r.json())
          )
        );
        const enriched = data.map((item, i) => {
          const r = results[i];
          if (r.status === 'fulfilled' && r.value?.price) {
            return { ...item, price: r.value.price, changeRate: r.value.changeRate, change: r.value.change };
          }
          return item;
        });
        setPopularStocks(enriched);
      })
      .catch(() => {});

    // 뉴스 (국내 카테고리만)
    fetch('/api/news?limit=5&category=domestic')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.news)) setNews(d.news); })
      .catch(() => {});
  }, []);

  // 탭 전환 시 랭킹 재조회
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/market/ranking?tab=${encodeURIComponent(activeTab)}`)
      .then(r => r.json())
      .then(data => { if (!cancelled) setStocks(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setStocks([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab]);

  // ── Canvas 파티클 배경 ──────────────────────────────────────────
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
        x:          Math.random() * canvas.width,
        y:          Math.random() * canvas.height,
        vx:         (Math.random() - 0.5) * 0.48,
        vy:         (Math.random() - 0.5) * 0.48,
        radius:     baseRadius,
        baseRadius,
        opacity:    Math.random() * 0.55 + 0.2,
        color,
        pulsePhase: Math.random() * Math.PI * 2,
        pulseSpeed: 0.018 + Math.random() * 0.025,
        glowing:    Math.random() < 0.2,
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
        const pf = 1 + Math.sin(p.pulsePhase) * 0.35;
        p.radius = p.baseRadius * pf;
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
        const pa = particles[f.from];
        const pb = particles[f.to];
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

  const goStock = (ticker: string) => router.push(`/stock/${ticker}`);

  const getCloses = (key: string) => {
    const inline = indices[key]?.sparkline;
    if (inline && inline.length >= 2) return inline;
    return chartData[key] ?? [];
  };

  return (
    <div className="relative min-h-screen">

      {/* ── 배경 레이어 ── */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
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

    <div className="max-w-[1200px] mx-auto px-5 py-7">

      <h1 className="text-[18px] font-bold text-white mb-1 tracking-tight">국내증시</h1>
      <p className="text-sm text-slate-500 mt-1 mb-5 leading-relaxed">
        KIS API 기반 실시간 국내 증시 정보 · 급등/급락 종목은 ETF·ETN 제외 · 매매 참고용으로만 활용하세요
      </p>

      {/* 지수 카드 4개 — 모바일 2x2 그리드, md 이상은 기존 가로 배치 */}
      <div className="grid grid-cols-2 gap-3 mb-6 md:flex">
        {INDEX_CARDS.map(({ label, key, isYield }) => (
          <IndexCardView
            key={key}
            label={label}
            data={indices[key]}
            closes={getCloses(key)}
            uid={key}
            isYield={isYield}
          />
        ))}
      </div>

      {/* 탭 */}
      <div className="flex items-center gap-1.5 mb-4">
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={[
              'px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer',
              activeTab === tab
                ? 'bg-indigo-600 text-white'
                : 'bg-transparent text-slate-400 border border-slate-700 hover:border-slate-500 hover:text-slate-200',
            ].join(' ')}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* 2컬럼 레이아웃 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">

        {/* 좌측: 테이블 + 광고 */}
        <div className="min-w-0">
          <div className="rounded-2xl bg-[#13161f] overflow-hidden mb-4">
            <div className="grid grid-cols-[48px_1fr_110px_100px_90px_90px] gap-3 px-4 py-2.5
              text-[12px] font-semibold text-slate-400 uppercase tracking-wider
              border-b border-slate-800/60">
              <span className="text-center">#</span>
              <span>종목</span>
              <span className="text-right">현재가</span>
              <span className="text-right">전일대비</span>
              <span className="text-right">등락률</span>
              <span className="text-right">거래량</span>
            </div>

            <div className="stock-scroll overflow-y-auto" style={{ maxHeight: '580px' }}>
            {loading ? <SkeletonRows /> : stocks.length === 0 ? (
              <p className="py-20 text-center text-slate-600 text-sm">데이터를 불러올 수 없습니다.</p>
            ) : (
              <div className="divide-y divide-slate-800/30">
                {stocks.map((stock, i) => {
                  const rank       = i + 1;
                  const isUp       = stock.changeRate >= 0;
                  const priceColor = isUp ? 'text-red-400' : 'text-blue-400';
                  const badge      = RANK_BADGE[rank];
                  return (
                    <div
                      key={stock.ticker}
                      onClick={() => goStock(stock.ticker)}
                      className={[
                        'grid grid-cols-[48px_1fr_110px_100px_90px_90px] gap-3 px-4 py-3',
                        'cursor-pointer transition-colors duration-100 hover:bg-white/[0.03]',
                        i % 2 === 1 ? 'bg-white/[0.015]' : '',
                      ].join(' ')}
                    >
                      <div className="self-center flex justify-center">
                        {badge ? (
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center
                            text-[11px] font-bold ${badge}`}>
                            {rank}
                          </span>
                        ) : (
                          <span className="text-[12px] font-medium text-slate-600">{rank}</span>
                        )}
                      </div>

                      <div className="self-center min-w-0">
                        <p className="text-[13px] font-semibold text-white truncate leading-tight">
                          {stock.name}
                        </p>
                        <p className="text-[10px] text-slate-600 font-mono mt-0.5">{stock.ticker}</p>
                      </div>

                      <p className={`self-center text-right text-[13px] font-bold font-mono ${priceColor}`}>
                        {fmtComma(stock.price)}
                      </p>

                      <p className={`self-center text-right text-[13px] font-mono font-semibold ${priceColor}`}>
                        {isUp ? '+' : ''}{fmtComma(Math.round(stock.change))}
                      </p>

                      <p className={`self-center text-right text-[13px] font-mono font-semibold ${priceColor}`}>
                        {isUp ? '+' : ''}{stock.changeRate.toFixed(2)}%
                      </p>

                      <p className="self-center text-right text-[13px] font-mono text-slate-400">
                        {fmtVolume(stock.volume)}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
            </div>
          </div>

        </div>

        {/* 우측 패널 */}
        <div ref={rightPanelRef} className="flex flex-col gap-4">
          <PopularList stocks={popularStocks} onClickStock={goStock} />
          <NewsFeed news={news} />
        </div>

      </div>

      {/* 관심종목 */}
      <WatchlistSection />

    </div>
    </div>
  );
}
