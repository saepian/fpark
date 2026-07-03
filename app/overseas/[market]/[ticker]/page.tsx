'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import { Sparkles, AlertCircle, TrendingUp, TrendingDown, ChevronLeft, Star } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import Toast from '@/components/Toast';
import type { OverseasAnalysisResult } from '@/app/api/stock/overseas/[ticker]/analysis/route';

// ── Types ─────────────────────────────────────────────────────────────────────

interface QuoteData {
  name: string;
  exchange: string;
  exchangeCode: string;
  currency: string;
  price: number;
  change: number;
  changeRate: number;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  week52High: number;
  week52Low: number;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  roe: number | null;
  eps: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', JPY: '¥', HKD: 'HK$', CNY: '¥',
};

function fmtPrice(val: number, currency: string): string {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  const isJPY = currency === 'JPY';
  return `${sym}${val.toLocaleString('en-US', {
    minimumFractionDigits: isJPY ? 0 : 2,
    maximumFractionDigits: isJPY ? 0 : 2,
  })}`;
}

function fmtLarge(val: number | null, currency: string): string {
  if (val === null) return '—';
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  if (Math.abs(val) >= 1e12) return `${sym}${(val / 1e12).toFixed(2)}T`;
  if (Math.abs(val) >= 1e9)  return `${sym}${(val / 1e9).toFixed(2)}B`;
  if (Math.abs(val) >= 1e6)  return `${sym}${(val / 1e6).toFixed(2)}M`;
  return `${sym}${val.toLocaleString()}`;
}

// ── Lightweight 차트 ─────────────────────────────────────────────────────────

interface CandleData { date: string; open: number; high: number; low: number; close: number; volume: number; }

const CHART_PERIODS = ['1M', '3M', '6M', '1Y'] as const;
type ChartPeriod = typeof CHART_PERIODS[number];

function LightweightChart({ ticker, market }: { ticker: string; market: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const candleRef    = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef    = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [period, setPeriod] = useState<ChartPeriod>('3M');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  const isJPY = market === 'jp';

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#94a3b8',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1e2535' },
        horzLines: { color: '#1e2535' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: '#1e2535',
        textColor: '#94a3b8',
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: '#1e2535',
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      width: containerRef.current.clientWidth,
      height: 420,
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor:       '#ef4444',
      downColor:     '#3b82f6',
      borderUpColor: '#ef4444',
      borderDownColor: '#3b82f6',
      wickUpColor:   '#ef4444',
      wickDownColor: '#3b82f6',
      priceFormat: isJPY
        ? { type: 'price', precision: 0, minMove: 1 }
        : { type: 'price', precision: 2, minMove: 0.01 },
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat:  { type: 'volume' },
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });

    chartRef.current  = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [isJPY]);

  const loadData = useCallback(async (p: ChartPeriod, signal: AbortSignal) => {
    if (!candleRef.current || !volumeRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/overseas/${market}/${ticker}/chart?period=${p}`, { signal });
      if (!res.ok) throw new Error(`${res.status}`);
      const json: CandleData[] = await res.json();
      if (!candleRef.current || !volumeRef.current) return;

      candleRef.current.setData(json.map(d => ({
        time:  d.date as unknown as import('lightweight-charts').Time,
        open:  d.open, high: d.high, low: d.low, close: d.close,
      })));
      volumeRef.current.setData(json.map(d => ({
        time:  d.date as unknown as import('lightweight-charts').Time,
        value: d.volume,
        color: d.close >= d.open ? '#ef444466' : '#3b82f666',
      })));
      chartRef.current?.timeScale().fitContent();
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setError('차트 데이터 조회 실패');
    } finally {
      setLoading(false);
    }
  }, [ticker, market]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(period, controller.signal);
    return () => controller.abort();
  }, [period, loadData]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Price Chart</h2>
          <span className="text-[10px] text-slate-600">· Yahoo Finance</span>
        </div>
        <div className="flex bg-[#0d1117] rounded-lg p-0.5 border border-slate-800/60">
          {CHART_PERIODS.map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 font-mono text-[11px] font-bold rounded-md transition-all cursor-pointer ${
                period === p
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1d27]/80 z-10 rounded-xl">
            <div className="flex gap-1.5">
              {[0, 1, 2].map(i => (
                <div key={i} className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
                  style={{ animationDelay: `${i * 0.2}s` }} />
              ))}
            </div>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
        <div ref={containerRef} className="w-full" />
      </div>

      <div className="flex items-center gap-4 text-[10px] text-slate-600">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-red-500" />상승
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-blue-500" />하락
        </span>
      </div>
    </div>
  );
}

// ── AI 분석 ───────────────────────────────────────────────────────────────────

const ANALYSIS_STEPS = [
  '📊 글로벌 시장 데이터 수집 중...',
  '📈 차트 패턴 분석 중...',
  '💹 밸류에이션 검토 중...',
  '⚡ 리스크 요인 분석 중...',
  '🎯 52주 가격 위치 확인 중...',
  '📝 분석 리포트 작성 중...',
];

function AiLoadingCard() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setIdx(i => (i + 1) % ANALYSIS_STEPS.length), 1600);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="bg-[#122131] border border-blue-900/40 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="text-blue-400 w-4 h-4" />
        <span className="text-[11px] font-bold text-blue-400 uppercase tracking-widest">FPARK AI</span>
      </div>
      <div className="flex flex-col items-center gap-5 py-6">
        <p className="text-[14px] text-indigo-300 font-medium text-center">{ANALYSIS_STEPS[idx]}</p>
        <div className="flex items-center gap-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
              style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
        <p className="text-[11px] text-slate-600">AI가 기업을 분석하고 있습니다</p>
      </div>
    </div>
  );
}

function AiAnalysisCard({ ticker, market }: { ticker: string; market: string }) {
  const [data, setData] = useState<OverseasAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    const load = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(`/api/stock/overseas/${ticker}/analysis?market=${market}`);
          if (!res.ok) throw new Error(`${res.status}`);
          const json = await res.json() as OverseasAnalysisResult;
          if (!cancelled) setData(json);
          return;
        } catch {
          if (attempt === 0 && !cancelled) await new Promise(r => setTimeout(r, 2000));
        }
      }
      if (!cancelled) setError('AI 분석을 불러올 수 없습니다.');
    };

    load().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, market]);

  if (loading) return <AiLoadingCard />;

  if (error || !data) {
    return (
      <div className="bg-[#122131] border border-blue-900/40 p-6 rounded-xl">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="text-blue-400 w-4 h-4" />
          <span className="text-sm font-bold text-gray-100">FPARK AI 기업 분석</span>
        </div>
        <p className="text-sm text-gray-500">{error ?? 'AI 분석 데이터 없음'}</p>
      </div>
    );
  }

  const sym      = CURRENCY_SYMBOLS[data.currency] ?? data.currency;
  const timeLabel = data.isCached
    ? '오늘 분석 (캐시)'
    : new Date(data.createdAt).toLocaleString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 기준';

  const priceDiff = (target: number) => {
    const pct = ((target - data.current_price) / data.current_price) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  return (
    <div className="bg-[#122131] border border-blue-900/40 rounded-xl overflow-hidden">
      <div className="px-6 pt-5 pb-4 border-b border-blue-900/30">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="text-blue-400 w-4 h-4" />
            <span className="text-[11px] font-bold text-blue-400 uppercase tracking-widest">FPARK AI</span>
          </div>
        </div>
        <p className="text-[15px] font-semibold text-white leading-snug">{data.summary}</p>
        <p className="text-[11px] text-slate-500 mt-1.5">{timeLabel}</p>
      </div>

      <div className="px-6 py-4 space-y-5">
        {/* 저항선 관찰(52주 고점 기준) / 지지선 관찰(52주 저점 기준) — 목표가·손절가 아님, AI가 지어낸 수치 아니고 서버가 실제 52주 데이터로 계산 */}
        {(data.resistance > 0 || data.support > 0) && (
          <div className="grid grid-cols-2 gap-3">
            {data.resistance > 0 && (
              <div className="bg-red-500/8 border border-red-500/20 rounded-lg p-3">
                <div className="flex items-center gap-1 mb-1">
                  <TrendingUp className="w-3 h-3 text-red-400" />
                  <span className="text-[10px] text-red-400/80 font-bold uppercase tracking-wide">52주 최고가</span>
                </div>
                <p className="text-[15px] font-bold font-mono text-red-300">
                  {sym}{data.resistance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {data.current_price > 0 && (
                  <p className="text-[11px] text-red-400/60 font-mono mt-0.5">
                    현재가 대비 {priceDiff(data.resistance)}
                  </p>
                )}
              </div>
            )}
            {data.support > 0 && (
              <div className="bg-blue-950/30 border border-blue-500/30 rounded-lg p-3">
                <div className="flex items-center gap-1 mb-1">
                  <TrendingDown className="w-3 h-3 text-blue-400" />
                  <span className="text-[10px] text-blue-400/80 font-bold uppercase tracking-wide">52주 최저가</span>
                </div>
                <p className="text-[15px] font-bold font-mono text-blue-400">
                  {sym}{data.support.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {data.current_price > 0 && (
                  <p className="text-[11px] text-blue-300/60 font-mono mt-0.5">
                    현재가 대비 {priceDiff(data.support)}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* 섹션 */}
        {data.sections?.map(sec => (
          <div key={sec.title}>
            <p className="text-[12px] font-bold text-slate-300 mb-2">{sec.title}</p>
            <ul className="space-y-1.5">
              {sec.points?.map((pt, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px] text-slate-400 leading-snug">
                  <span className="shrink-0 mt-[2px] text-[8px] text-indigo-400">●</span>
                  {pt}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* 태그 */}
        {data.tags?.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {data.tags.map(tag => (
              <span key={tag} className="px-2 py-0.5 bg-blue-950/60 text-blue-400/80 text-[11px] font-semibold rounded">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {/* 면책 고지 */}
        <div className="pt-3 border-t border-blue-900/30 flex items-start gap-2 text-[11px] text-slate-600 leading-snug">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <p>{data.disclaimer}</p>
        </div>
      </div>
    </div>
  );
}

// ── 재무 요약 ─────────────────────────────────────────────────────────────────

function FinanceCard({ quote }: { quote: QuoteData }) {
  const { currency } = quote;

  const rows = [
    { label: '매출액',    value: fmtLarge(quote.revenue, currency) },
    { label: '영업이익',  value: fmtLarge(quote.operatingIncome, currency) },
    { label: '순이익',    value: fmtLarge(quote.netIncome, currency) },
    { label: 'ROE',       value: quote.roe != null ? `${(quote.roe * 100).toFixed(1)}%` : '—' },
    { label: 'EPS',       value: quote.eps != null ? fmtPrice(quote.eps, currency) : '—' },
  ];

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">
      <div className="px-4 pt-4 pb-2.5 border-b border-slate-800">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">재무 요약</h3>
      </div>
      <div className="px-4 py-3 space-y-0.5">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-800/40 last:border-0">
            <span className="text-[11px] text-slate-500">{label}</span>
            <span className="text-[12px] font-bold font-mono text-slate-200">{value}</span>
          </div>
        ))}
      </div>
      <p className="px-4 pb-2.5 text-[9px] text-slate-600">Yahoo Finance 기준 · 연간 데이터</p>
    </div>
  );
}

// ── 기본 정보 카드 ────────────────────────────────────────────────────────────

function InfoCard({ quote }: { quote: QuoteData }) {
  const { currency } = quote;
  const isUp = quote.changeRate >= 0;

  const rows = [
    { label: '시가',    value: quote.open  != null ? fmtPrice(quote.open,  currency) : '—' },
    { label: '고가',    value: quote.high  != null ? fmtPrice(quote.high,  currency) : '—' },
    { label: '저가',    value: quote.low   != null ? fmtPrice(quote.low,   currency) : '—' },
    { label: '거래량',  value: quote.volume != null ? quote.volume.toLocaleString() : '—' },
    { label: '시가총액', value: fmtLarge(quote.marketCap, currency) },
    { label: 'PER',     value: quote.pe != null ? `${quote.pe.toFixed(1)}x` : '—' },
    { label: 'PBR',     value: quote.pb != null ? `${quote.pb.toFixed(2)}x` : '—' },
    { label: '52주 고',  value: quote.week52High > 0 ? fmtPrice(quote.week52High, currency) : '—' },
    { label: '52주 저',  value: quote.week52Low  > 0 ? fmtPrice(quote.week52Low,  currency) : '—' },
  ];

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b border-slate-800">
        <div className="flex items-baseline justify-between mb-1">
          <span className={`text-2xl font-bold font-mono ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
            {fmtPrice(quote.price, currency)}
          </span>
          <span className={`text-sm font-semibold font-mono ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
            {isUp ? '+' : ''}{quote.changeRate.toFixed(2)}%
          </span>
        </div>
        <p className={`text-[12px] font-mono ${isUp ? 'text-red-400/70' : 'text-blue-400/70'}`}>
          {isUp ? '▲ ' : '▼ '}{Math.abs(quote.change).toFixed(2)} {currency}
        </p>
      </div>
      <div className="px-4 py-3 space-y-0.5">
        {rows.map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-800/40 last:border-0">
            <span className="text-[11px] text-slate-500">{label}</span>
            <span className="text-[12px] font-bold font-mono text-slate-200">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 일별 주가동향 ─────────────────────────────────────────────────────────────

interface DayData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changeRate: number;
}

function DailyPriceTable({ ticker, currency }: { ticker: string; currency: string }) {
  const [data, setData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stock/overseas/${ticker}/daily`)
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setData(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticker]);

  const isJPY = currency === 'JPY';
  const sym   = CURRENCY_SYMBOLS[currency] ?? currency + ' ';

  const fmtVal = (v: number) =>
    sym + v.toLocaleString('en-US', {
      minimumFractionDigits: isJPY ? 0 : 2,
      maximumFractionDigits: isJPY ? 0 : 2,
    });

  const fmtVol = (v: number) => {
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)}B`;
    if (v >= 1_000_000)     return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000)         return `${(v / 1_000).toFixed(1)}K`;
    return v.toLocaleString();
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
  };

  if (loading) {
    return (
      <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4 animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-32 mb-4" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-8 bg-slate-700/60 rounded mb-2" />
        ))}
      </div>
    );
  }

  if (!data.length) return null;

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">
      <div className="px-4 pt-4 pb-2.5 border-b border-slate-800">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
          일별 주가 동향
          <span className="text-[10px] text-slate-500 font-normal ml-2 normal-case">최근 5거래일</span>
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[480px] w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800/60">
              <th className="text-left px-4 py-2.5 font-medium">날짜</th>
              <th className="text-right px-3 py-2.5 font-medium">종가</th>
              <th className="text-right px-3 py-2.5 font-medium">등락률</th>
              <th className="text-right px-3 py-2.5 font-medium">시가</th>
              <th className="text-right px-3 py-2.5 font-medium">고가</th>
              <th className="text-right px-3 py-2.5 font-medium">저가</th>
              <th className="text-right px-4 py-2.5 font-medium">거래량</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => {
              const isUp  = d.changeRate >= 0;
              const color = isUp ? 'text-red-400' : 'text-blue-400';
              return (
                <tr key={d.date} className="border-b border-slate-800/40 hover:bg-white/[0.03] transition-colors">
                  <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap">
                    {formatDate(d.date)}
                    {i === 0 && (
                      <span className="ml-1.5 text-[9px] text-indigo-400 bg-indigo-400/10 px-1.5 py-0.5 rounded-full">
                        최근
                      </span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono font-semibold ${color}`}>
                    {fmtVal(d.close)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono ${color}`}>
                    {isUp ? '+' : ''}{d.changeRate.toFixed(2)}%
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-slate-400">
                    {fmtVal(d.open)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-red-400/70">
                    {fmtVal(d.high)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-blue-400/70">
                    {fmtVal(d.low)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-500">
                    {fmtVol(d.volume)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 동일업종 종목 ─────────────────────────────────────────────────────────────

interface SectorStock {
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
}

interface SectorData {
  sector: string;
  industry: string;
  stocks: SectorStock[];
}

function SectorCard({ ticker, market }: { ticker: string; market: string }) {
  const router = useRouter();
  const [data, setData] = useState<SectorData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/overseas/${market}/${ticker}/sector`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ticker, market]);

  if (loading) {
    return (
      <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">
        <div className="px-4 pt-4 pb-2.5 border-b border-slate-800">
          <div className="h-3 bg-slate-700 rounded w-24 animate-pulse" />
        </div>
        <div className="divide-y divide-slate-800/40">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 animate-pulse">
              <div className="h-3 bg-slate-800 rounded w-20" />
              <div className="h-3 bg-slate-800 rounded w-14" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data || !data.stocks.length) return null;

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2.5 border-b border-slate-800/70">
        <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">동일업종 기업</span>
        {data.sector && (
          <span className="text-[10px] text-indigo-400 bg-indigo-400/10 px-2 py-0.5 rounded-full font-medium">
            {data.sector}
          </span>
        )}
      </div>
      <div className="divide-y divide-slate-800/40">
        {data.stocks.map(s => {
          const isUp = s.changeRate >= 0;
          return (
            <div
              key={s.ticker}
              onClick={() => router.push(`/overseas/us/${s.ticker}`)}
              className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-white truncate leading-tight">{s.name}</p>
                <p className="text-[10px] text-slate-600 font-mono mt-0.5">{s.ticker}</p>
              </div>
              <div className="shrink-0 text-right ml-3">
                <p className={`text-[12px] font-bold font-mono ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
                  ${s.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                <p className={`text-[11px] font-mono ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
                  {isUp ? '+' : ''}{s.changeRate.toFixed(2)}%
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

const MARKET_LABELS: Record<string, string> = {
  us: '🇺🇸 미국', jp: '🇯🇵 일본', hk: '🇭🇰 홍콩', cn: '🇨🇳 중국',
};

interface PageProps {
  params: Promise<{ market: string; ticker: string }>;
}

export default function OverseasStockPage({ params }: PageProps) {
  const { market, ticker } = use(params);
  const router = useRouter();

  const [quote, setQuote]       = useState<QuoteData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [watching, setWatching] = useState(false);
  const [wLoggedIn, setWLoggedIn] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setWLoggedIn(true);
      fetch('/api/watchlist')
        .then(r => r.json())
        .then((list: { ticker: string }[]) => {
          setWatching(Array.isArray(list) && list.some(w => w.ticker === ticker));
        })
        .catch(() => {});
    });
  }, [ticker]);

  useEffect(() => {
    fetch(`/api/stock/overseas/${ticker}/quote`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setQuote(d);
      })
      .catch(e => setError(e.message ?? '조회 실패'))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-6 bg-slate-800 rounded w-48" />
          <div className="h-16 bg-slate-800 rounded" />
          <div className="grid grid-cols-12 gap-8">
            <div className="col-span-8 space-y-4">
              <div className="h-[460px] bg-slate-800 rounded-xl" />
            </div>
            <div className="col-span-4 space-y-4">
              <div className="h-64 bg-slate-800 rounded-xl" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !quote) {
    return (
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <button onClick={() => router.back()}
          className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-6 transition-colors cursor-pointer">
          <ChevronLeft className="w-4 h-4" />뒤로
        </button>
        <p className="text-red-400">{error ?? '데이터를 불러올 수 없습니다.'}</p>
      </div>
    );
  }

  const isUp = quote.changeRate >= 0;

  const toggleWatch = async () => {
    const prev = watching;
    setWatching(!prev);
    const res = await fetch('/api/watchlist', {
      method: prev ? 'DELETE' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker, name: quote.name, market }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setToastMsg(body.error ?? '오류가 발생했습니다.');
      setWatching(prev);
    }
  };

  return (
    <>
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-6">

      {/* 뒤로가기 */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-1 text-slate-400 hover:text-white text-sm transition-colors cursor-pointer"
      >
        <ChevronLeft className="w-4 h-4" />
        {MARKET_LABELS[market] ?? market} 해외증시
      </button>

      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 pb-5 border-b border-slate-800">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              {quote.exchange}
            </span>
            <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
              {ticker}
            </span>
            {wLoggedIn && (
              <button
                onClick={toggleWatch}
                aria-label={watching ? '관심기업 해제' : '관심기업 추가'}
                className={[
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all cursor-pointer',
                  watching
                    ? 'border-yellow-500/60 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20'
                    : 'border-slate-700 bg-transparent text-slate-400 hover:border-slate-500 hover:text-slate-200',
                ].join(' ')}
              >
                <Star className="w-4 h-4" fill={watching ? 'currentColor' : 'none'} strokeWidth={2} />
                {watching ? '관심기업' : '추가'}
              </button>
            )}
          </div>
          <h1 className="text-[22px] font-bold text-white leading-tight truncate">{quote.name}</h1>
        </div>

        <div className="text-right shrink-0">
          <p className={`text-[28px] font-bold font-mono leading-none ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
            {fmtPrice(quote.price, quote.currency)}
          </p>
          <p className={`text-[14px] font-mono mt-0.5 ${isUp ? 'text-red-400' : 'text-blue-400'}`}>
            {isUp ? '▲ +' : '▼ '}{Math.abs(quote.change).toFixed(2)}
            <span className="ml-1.5 text-[12px] opacity-75">
              ({isUp ? '+' : ''}{quote.changeRate.toFixed(2)}%)
            </span>
          </p>
        </div>
      </div>

      {/* 주요 지표 요약 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: '시가총액', value: fmtLarge(quote.marketCap, quote.currency) },
          { label: 'PER',      value: quote.pe != null ? `${quote.pe.toFixed(1)}x` : '—' },
          { label: 'PBR',      value: quote.pb != null ? `${quote.pb.toFixed(2)}x` : '—' },
          { label: '52주 범위', value: quote.week52High > 0
            ? `${fmtPrice(quote.week52Low, quote.currency)} ~ ${fmtPrice(quote.week52High, quote.currency)}`
            : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[#1a1d27] rounded-xl px-4 py-3 border border-slate-800">
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide mb-1">{label}</p>
            <p className="text-[13px] font-bold text-white font-mono truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* 2컬럼 레이아웃 */}
      <div className="grid grid-cols-12 gap-8">

        {/* 좌측: 차트 + AI 분석 */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          <div className="bg-[#1a1d27] border border-slate-800 rounded-xl p-4">
            <LightweightChart ticker={ticker} market={market} />
          </div>

          <DailyPriceTable ticker={ticker} currency={quote.currency} />
          <AiAnalysisCard ticker={ticker} market={market} />
        </div>

        {/* 우측: 기본 정보 + 재무 요약 */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          <InfoCard quote={quote} />
          <FinanceCard quote={quote} />
          <SectorCard ticker={ticker} market={market} />

          {/* 관련 링크 배너 */}
          <a
            href="https://devkitpack.com/tools/stock-avg"
            target="_blank"
            rel="noopener noreferrer"
            className="group block rounded-xl border border-slate-700 bg-[#0f1629] p-4 hover:border-blue-500/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-950 flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-400 text-xl">⌗</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs text-blue-400 font-medium">무료 도구</span>
                    <span className="text-[11px] bg-blue-950 text-blue-400 border border-blue-900 px-2 py-0.5 rounded-full">DevKitPack</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-100">평균 매입단가 계산기</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">여러 번에 걸쳐 매입한 평균 단가를 빠르게 계산하세요</p>
                </div>
              </div>
              <span className="arrow-slide text-blue-400 text-base flex-shrink-0">→</span>
            </div>
          </a>
        </div>
      </div>
    </div>
    {toastMsg && <Toast message={toastMsg} onClose={() => setToastMsg(null)} />}
    </>
  );
}
