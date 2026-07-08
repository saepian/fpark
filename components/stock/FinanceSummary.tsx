'use client';

import { useEffect, useState } from 'react';

interface FinanceRow {
  year: string;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  roe: number | null;
}

function fmtAmount(v: number | null): string {
  if (v === null) return '—';
  if (v >= 10_000) return `${(v / 10_000).toFixed(1)}조`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}천억`;
  return `${v}억`;
}

export default function FinanceSummary({ ticker }: { ticker: string }) {
  const [rows, setRows] = useState<FinanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stock/${ticker}/finance`)
      .then(r => r.json())
      .then(data => setRows(Array.isArray(data) ? data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4 animate-pulse">
        <div className="h-3.5 bg-slate-700 rounded w-24 mb-4" />
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-8 bg-slate-700/60 rounded" />
          ))}
        </div>
      </div>
    );
  }

  if (rows.length === 0) return null;

  const ITEMS = [
    { key: 'revenue', label: '매출액' },
    { key: 'operatingProfit', label: '영업이익' },
    { key: 'netIncome', label: '순이익' },
    { key: 'roe', label: 'ROE' },
  ] as const;

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">
      <div className="px-4 pt-4 pb-2.5 border-b border-slate-800">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
          재무 요약
        </h3>
      </div>

      {/* 헤더 연도 */}
      <div className="grid px-4 pt-2.5 pb-1" style={{ gridTemplateColumns: '80px repeat(3, 1fr)' }}>
        <span />
        {rows.map(r => (
          <span key={r.year} className="text-center text-[10px] font-bold text-slate-500">
            {r.year}
          </span>
        ))}
      </div>

      {/* 데이터 행 */}
      <div className="px-4 pb-3 space-y-1">
        {ITEMS.map(({ key, label }) => (
          <div
            key={key}
            className="grid items-center py-1.5 border-b border-slate-800/40 last:border-0"
            style={{ gridTemplateColumns: '80px repeat(3, 1fr)' }}
          >
            <span className="text-[11px] text-slate-500 font-medium">{label}</span>
            {rows.map(r => {
              const val = r[key];
              const isRoe = key === 'roe';
              const text = isRoe
                ? (val === null ? '—' : `${(val as number).toFixed(1)}%`)
                : fmtAmount(val as number | null);
              const isPositive = val !== null && (val as number) > 0;
              return (
                <span
                  key={r.year}
                  className={`text-center text-[12px] font-bold font-mono ${
                    isPositive ? 'text-slate-200' : 'text-slate-500'
                  }`}
                >
                  {text}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <p className="px-4 pb-2.5 text-[9px] text-slate-600">
        단위: 억원 · 최근 3개 연도 확정 연간 실적 기준(분기·잠정실적은 반영되지 않습니다)
      </p>
    </div>
  );
}
