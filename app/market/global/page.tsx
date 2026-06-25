'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

// ── Types ─────────────────────────────────────────────────────────────────────

interface IndexData {
  value: number;
  change: number;
  changeRate: number;
  sparkline?: number[];
}

interface OverseasStock {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changeRate: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const COUNTRY_TABS = [
  { id: 'us', label: '🇺🇸 미국' },
  { id: 'jp', label: '🇯🇵 일본' },
  { id: 'hk', label: '🇭🇰 홍콩' },
  { id: 'cn', label: '🇨🇳 중국' },
] as const;

type CountryTab = typeof COUNTRY_TABS[number]['id'];

const TAB_TICKERS: Record<CountryTab, string> = {
  us: 'AAPL,MSFT,NVDA,GOOGL,AMZN,META,TSLA,AVGO,JPM,V,UNH,XOM,LLY,JNJ,MA,PG,HD,MRK,COST,ORCL',
  jp: '7203.T,6758.T,9984.T,6861.T,6954.T,6501.T,9432.T,8306.T,4063.T,6367.T',
  hk: '0700.HK,9988.HK,3690.HK,1211.HK,0005.HK,0941.HK,1299.HK,2318.HK,0388.HK,2020.HK',
  cn: '600519.SS,300750.SZ,601318.SS,601166.SS,000858.SZ,601988.SS,600036.SS,000333.SZ,002594.SZ,600900.SS',
};

const TAB_CURRENCY: Record<CountryTab, string> = {
  us: '$',
  jp: '¥',
  hk: 'HK$',
  cn: '¥',
};

const TAB_INDEX_CARDS: Record<CountryTab, { label: string; key: string; isFx?: boolean }[]> = {
  us: [
    { label: 'S&P 500',  key: 'SP500' },
    { label: '나스닥',   key: 'NASDAQ' },
    { label: '다우존스', key: 'DOW' },
    { label: 'USD/KRW',  key: 'USD_KRW', isFx: true },
  ],
  jp: [
    { label: '닛케이 225', key: 'NIKKEI' },
    { label: 'USD/JPY',   key: 'USDJPY', isFx: true },
    { label: 'EUR/JPY',   key: 'EURJPY', isFx: true },
  ],
  hk: [
    { label: '항셍',    key: 'HANGSENG' },
    { label: 'USD/HKD', key: 'USDHKD', isFx: true },
    { label: 'CNY/HKD', key: 'CNYHKD', isFx: true },
  ],
  cn: [
    { label: '상해종합', key: 'SHANGHAI' },
    { label: '심천종합', key: 'SHENZHEN' },
    { label: 'USD/CNY', key: 'USDCNY', isFx: true },
  ],
};

const RANK_BADGE: Record<number, string> = {
  1: 'bg-amber-400/20 text-amber-300 border border-amber-400/30',
  2: 'bg-slate-400/15 text-slate-300 border border-slate-500/30',
  3: 'bg-orange-800/20 text-orange-400 border border-orange-700/30',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPrice(price: number, currency: string): string {
  const noDecimals = currency === '¥';
  return `${currency}${price.toLocaleString('en-US', {
    minimumFractionDigits: noDecimals ? 0 : 2,
    maximumFractionDigits: noDecimals ? 0 : 2,
  })}`;
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ closes, isUp, uid }: { closes: number[]; isUp: boolean; uid: string }) {
  const color = isUp ? '#ef4444' : '#3b82f6';
  const gid   = `gsp-${uid}`;
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

function IndexCard({
  label, data, closes = [], uid = '', isFx = false,
}: {
  label: string;
  data: IndexData | null | undefined;
  closes?: number[];
  uid?: string;
  isFx?: boolean;
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
  const isUp       = data.changeRate >= 0;
  const valueColor = isFx ? 'text-white' : (isUp ? 'text-red-400' : 'text-blue-400');
  const diffColor  = isFx ? 'text-slate-400' : (isUp ? 'text-red-400' : 'text-blue-400');
  const arrow      = isFx ? (isUp ? '+' : '') : (isUp ? '▲ ' : '▼ ');
  return (
    <div className="flex-1 bg-[#1e2130] rounded-2xl overflow-hidden min-w-0">
      <div className="px-5 pt-4 pb-2">
        <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wide mb-1.5">{label}</p>
        <p className={`text-[21px] font-bold font-mono leading-tight ${valueColor}`}>
          {data.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className={`text-[12px] font-mono mt-1 ${diffColor}`}>
          {arrow}{Math.abs(data.change).toFixed(2)}
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

// ── Stock Table ────────────────────────────────────────────────────────────────

function StockSkeleton({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-slate-800/30">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="grid grid-cols-[48px_1fr_120px_90px] gap-3 px-4 py-3 animate-pulse">
          <div className="self-center mx-auto w-6 h-6 rounded-full bg-slate-800" />
          <div className="space-y-1.5">
            <div className="h-3.5 bg-slate-800 rounded w-28" />
            <div className="h-2.5 bg-slate-800/60 rounded w-16" />
          </div>
          <div className="self-center h-3.5 bg-slate-800 rounded w-20 ml-auto" />
          <div className="self-center h-3.5 bg-slate-800 rounded w-14 ml-auto" />
        </div>
      ))}
    </div>
  );
}

function StockTable({
  stocks, loading, currency, rows, onRowClick,
}: {
  stocks: OverseasStock[];
  loading: boolean;
  currency: string;
  rows: number;
  onRowClick?: (ticker: string) => void;
}) {
  return (
    <div className="rounded-2xl bg-[#13161f] overflow-hidden">
      <div className="grid grid-cols-[48px_1fr_120px_90px] gap-3 px-4 py-2.5
        text-[10px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-800/60">
        <span className="text-center">#</span>
        <span>종목</span>
        <span className="text-right">현재가</span>
        <span className="text-right">등락률</span>
      </div>

      {loading ? (
        <StockSkeleton rows={rows} />
      ) : stocks.length === 0 ? (
        <p className="py-10 text-center text-slate-600 text-sm">데이터를 불러올 수 없습니다.</p>
      ) : (
        <div className="divide-y divide-slate-800/30">
          {stocks.map((stock, idx) => {
            const rank  = idx + 1;
            const badge = RANK_BADGE[rank];
            const isUp  = stock.changeRate >= 0;
            const color = isUp ? 'text-red-400' : 'text-blue-400';
            return (
              <div
                key={stock.ticker}
                onClick={() => onRowClick?.(stock.ticker)}
                className={[
                  'grid grid-cols-[48px_1fr_120px_90px] gap-3 px-4 py-3',
                  'transition-colors duration-100 hover:bg-white/[0.06]',
                  onRowClick ? 'cursor-pointer' : '',
                  idx % 2 === 1 ? 'bg-white/[0.015]' : '',
                ].join(' ')}
              >
                <div className="self-center flex justify-center">
                  {badge ? (
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${badge}`}>
                      {rank}
                    </span>
                  ) : (
                    <span className="text-[12px] font-medium text-slate-600">{rank}</span>
                  )}
                </div>
                <div className="self-center min-w-0">
                  <p className="text-[13px] font-semibold text-white truncate leading-tight">{stock.name}</p>
                  <p className="text-[10px] text-slate-600 font-mono mt-0.5">{stock.ticker}</p>
                </div>
                <p className={`self-center text-right text-[13px] font-bold font-mono ${color}`}>
                  {fmtPrice(stock.price, currency)}
                </p>
                <p className={`self-center text-right text-[13px] font-mono font-semibold ${color}`}>
                  {isUp ? '+' : ''}{stock.changeRate.toFixed(2)}%
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const CHART_SYMBOLS = ['USD_KRW', 'USDJPY', 'EURJPY', 'USDHKD', 'CNYHKD', 'USDCNY'];

const COLORS = [
  { r: 99,  g: 102, b: 241 },
  { r: 59,  g: 130, b: 246 },
  { r: 139, g: 92,  b: 246 },
  { r: 14,  g: 165, b: 233 },
  { r: 100, g: 116, b: 139 },
];

export default function GlobalMarketPage() {
  const router = useRouter();
  const [activeTab, setActiveTab]       = useState<CountryTab>('us');
  const [indices, setIndices]           = useState<Record<string, IndexData | null>>({});
  const [chartData, setChartData]       = useState<Record<string, number[]>>({});
  const [stocksByTab, setStocksByTab]   = useState<Partial<Record<CountryTab, OverseasStock[]>>>({});
  const [loadingByTab, setLoadingByTab] = useState<Record<CountryTab, boolean>>(
    { us: true, jp: true, hk: true, cn: true }
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    fetch('/api/market')
      .then(r => r.json())
      .then(d => {
        setIndices({
          USD_KRW:  d.USD_KRW  ?? null,
          SP500:    d.SP500    ?? null,
          NASDAQ:   d.NASDAQ   ?? null,
          DOW:      d.DOW      ?? null,
          NIKKEI:   d.NIKKEI   ?? null,
          HANGSENG: d.HANGSENG ?? null,
          SHANGHAI: d.SHANGHAI ?? null,
          SHENZHEN: d.SHENZHEN ?? null,
          USDJPY:   d.USDJPY   ?? null,
          EURJPY:   d.EURJPY   ?? null,
          USDHKD:   d.USDHKD   ?? null,
          CNYHKD:   d.CNYHKD   ?? null,
          USDCNY:   d.USDCNY   ?? null,
        });
      })
      .catch(() => {});

    Promise.allSettled(
      CHART_SYMBOLS.map(s =>
        fetch(`/api/market/chart?symbol=${s}`).then(r => r.json()) as Promise<number[]>
      )
    ).then(results => {
      const map: Record<string, number[]> = {};
      results.forEach((r, i) => { map[CHART_SYMBOLS[i]] = r.status === 'fulfilled' ? r.value : []; });
      setChartData(map);
    });

    (Object.entries(TAB_TICKERS) as [CountryTab, string][]).forEach(([tabId, tickers]) => {
      fetch(`/api/market/overseas?tickers=${tickers}${tabId === 'us' ? '&country=us' : ''}`)
        .then(r => r.json())
        .then(d => {
          setStocksByTab(prev => ({ ...prev, [tabId]: Array.isArray(d) ? d : [] }));
        })
        .catch(() => {
          setStocksByTab(prev => ({ ...prev, [tabId]: [] }));
        })
        .finally(() => {
          setLoadingByTab(prev => ({ ...prev, [tabId]: false }));
        });
    });
  }, []);

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

        {/* 타이틀 */}
        <h1 className="text-[18px] font-bold text-white mb-1 tracking-tight">해외증시</h1>
        <p className="text-sm text-slate-500 mt-1 mb-5 leading-relaxed">
          Yahoo Finance 기반 해외 증시 정보 · 실시간 대비 약 15분 지연 · 환율 포함 주요 지수와 종목을 확인하세요
        </p>

        {/* 국가 탭 */}
        <div className="flex items-center gap-1.5 mb-6">
          {COUNTRY_TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'px-3.5 py-1.5 rounded-lg text-[12px] font-semibold transition-all cursor-pointer',
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-[#1e2130] text-slate-400 hover:text-slate-200',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 지수 카드 + 종목 테이블 */}
        {COUNTRY_TABS.map(tab => activeTab === tab.id && (
          <div key={tab.id}>
            {/* 지수 카드 */}
            <div className="flex gap-3 mb-7">
              {TAB_INDEX_CARDS[tab.id].map(({ label, key, isFx }) => (
                <IndexCard
                  key={key}
                  label={label}
                  data={indices[key]}
                  closes={indices[key]?.sparkline ?? chartData[key] ?? []}
                  uid={key}
                  isFx={isFx}
                />
              ))}
            </div>

            {/* 종목 테이블 */}
            <h2 className="text-[14px] font-bold text-white mb-3">주요 종목</h2>
            <StockTable
              stocks={stocksByTab[tab.id] ?? []}
              loading={loadingByTab[tab.id]}
              currency={TAB_CURRENCY[tab.id]}
              rows={tab.id === 'us' ? 20 : 10}
              onRowClick={(ticker) => router.push(`/overseas/${tab.id}/${ticker}`)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
