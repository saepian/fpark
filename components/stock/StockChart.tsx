'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
} from 'lightweight-charts';
import type { ChartDataPoint } from '../../lib/types';

interface StockChartProps {
  ticker: string;
}

const PERIODS = ['1W', '1M', '3M', '1Y'] as const;
type Period = (typeof PERIODS)[number];

export default function StockChart({ ticker }: StockChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [period, setPeriod] = useState<Period>('1M');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        // 하단 30%를 거래량 공간으로 확보
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor: '#1e2535',
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      width: containerRef.current.clientWidth,
      height: 360,
    });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444',
      downColor: '#3b82f6',
      borderUpColor: '#ef4444',
      borderDownColor: '#3b82f6',
      wickUpColor: '#ef4444',
      wickDownColor: '#3b82f6',
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    });

    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
    });

    chart.priceScale('vol').applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    });

    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      if (!candleRef.current || !volumeRef.current) return;
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/stock/${ticker}/chart?period=${period}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const json: ChartDataPoint[] = await res.json();

        if (!candleRef.current || !volumeRef.current) return;

        candleRef.current.setData(
          json.map((d) => ({
            time: d.date as unknown as import('lightweight-charts').Time,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
          }))
        );

        volumeRef.current.setData(
          json.map((d) => ({
            time: d.date as unknown as import('lightweight-charts').Time,
            value: d.volume,
            color: d.close >= d.open ? '#ef444466' : '#3b82f666',
          }))
        );

        chartRef.current?.timeScale().fitContent();
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : '차트 조회 실패');
      } finally {
        setLoading(false);
      }
    };

    load();
    return () => controller.abort();
  }, [ticker, period]);

  return (
    <div
      id="stock-chart-card"
      className="bg-[#122131] dark:bg-[#122131] border border-gray-200 dark:border-[#2d313e] p-5 rounded-lg space-y-4"
    >
      <div className="flex justify-between items-center border-b border-gray-100 dark:border-[#2d313e]/40 pb-3">
        <h3 className="text-sm font-bold text-gray-900 dark:text-[#d4e4fa] tracking-wider uppercase">
          Price Chart
        </h3>
        <div className="flex bg-gray-100 dark:bg-[#010f1f] rounded-lg p-0.5 border border-gray-200 dark:border-[#2d313e]/60">
          {PERIODS.map((p) => (
            <button
              id={`tab-period-${p}`}
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1 font-mono text-[11px] font-bold rounded-md transition-all ${
                period === p
                  ? 'bg-blue-600 dark:bg-blue-500 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-700 dark:hover:text-white'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-[#122131]/80 z-10 rounded">
            <div className="flex space-x-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-3 w-3 bg-blue-500 rounded-full animate-bounce"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
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

      <div className="flex items-center gap-4 text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-red-500" />
          상승
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-sm bg-blue-500" />
          하락
        </span>
      </div>
    </div>
  );
}
