'use client';

import { useEffect, useState } from 'react';

interface InvestorData {
  date?:       string;
  foreign:     { qty: number; amount: number };
  institution: { qty: number; amount: number };
  individual:  { qty: number; amount: number };
}

const LABELS: Record<keyof InvestorData, string> = {
  foreign:     '외국인',
  institution: '기관',
  individual:  '개인',
};

function formatAmt(n: number) {
  const abs = Math.abs(n);
  if (abs >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${(n / 10_000).toFixed(0)}만`;
  return n.toLocaleString();
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.min(100, (Math.abs(value) / max) * 100);
  const positive = value >= 0;
  return (
    <div className="flex items-center gap-1.5 w-full">
      {/* 매도 방향 (왼쪽) */}
      <div className="flex-1 flex justify-end">
        {!positive && (
          <div
            className="h-3 rounded-sm bg-rose-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      {/* 중앙선 */}
      <div className="w-px h-4 bg-slate-600 shrink-0" />
      {/* 매수 방향 (오른쪽) */}
      <div className="flex-1">
        {positive && (
          <div
            className="h-3 rounded-sm bg-indigo-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </div>
  );
}

export default function InvestorFlow({ ticker }: { ticker: string }) {
  const [data, setData] = useState<InvestorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/stock/${ticker}/investors`);
        if (!res.ok) throw new Error('fetch failed');
        setData(await res.json());
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [ticker]);

  const keys = Object.keys(LABELS) as (keyof InvestorData)[];
  const maxAmt = data
    ? Math.max(...keys.map((k) => Math.abs(data[k].amount)), 1)
    : 1;

  return (
    <div className="bg-white dark:bg-[#161b2e] rounded-2xl border border-gray-200 dark:border-[#2d313e] p-5">
      <h3 className="text-sm font-bold text-gray-900 dark:text-white mb-4">투자자별 매매 동향</h3>

      {loading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-8 bg-slate-800 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs text-slate-500 text-center py-4">데이터를 불러올 수 없습니다.</p>
      )}

      {data && !loading && (
        <>
          {/* 범례 */}
          <div className="flex justify-between text-[10px] text-slate-500 mb-3 px-0.5">
            <span className="text-rose-400">← 순매도</span>
            <span className="text-indigo-400">순매수 →</span>
          </div>

          <div className="space-y-3.5">
            {keys.map((key) => {
              const { amount } = data[key];
              const positive = amount >= 0;
              return (
                <div key={key}>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-xs text-slate-400 w-14">{LABELS[key]}</span>
                    <span
                      className={[
                        'text-xs font-semibold tabular-nums',
                        positive ? 'text-indigo-400' : 'text-rose-400',
                      ].join(' ')}
                    >
                      {positive ? '+' : ''}{formatAmt(amount)}원
                    </span>
                  </div>
                  <Bar value={amount} max={maxAmt} />
                </div>
              );
            })}
          </div>

          <p className="text-[10px] text-slate-600 mt-4 text-right">
            {data.date
              ? `${data.date.slice(0, 4)}.${data.date.slice(4, 6)}.${data.date.slice(6, 8)} 순매수 금액`
              : '순매수 금액 기준'}
          </p>
        </>
      )}
    </div>
  );
}
