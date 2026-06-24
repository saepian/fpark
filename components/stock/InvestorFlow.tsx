'use client';

import { useEffect, useState } from 'react';

export default function InvestorFlow({ ticker }: { ticker: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stock/${ticker}/investors`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [ticker]);

  // 금액 포맷 (억원 단위 입력)
  const fmtAmt = (v: number) => {
    if (v === 0) return '0';
    const sign = v > 0 ? '+' : '';
    const abs = Math.abs(v);
    if (abs >= 10000) return `${sign}${(v / 10000).toFixed(1)}조`;
    if (abs >= 1000)  return `${sign}${(v / 1000).toFixed(0)}천억`;
    if (abs >= 100)   return `${sign}${(v / 100).toFixed(1)}백억`;
    if (abs >= 10)    return `${sign}${(v / 10).toFixed(0)}십억`;
    return `${sign}${v.toFixed(0)}억`;
  };

  // 수량 포맷
  const fmtQty = (v: number) => {
    if (v === 0) return '0';
    const sign = v > 0 ? '+' : '';
    const abs = Math.abs(v);
    if (abs >= 10000) return `${sign}${(v / 10000).toFixed(1)}만주`;
    return `${sign}${v.toLocaleString()}주`;
  };

  if (loading) return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4 animate-pulse">
      <div className="h-4 bg-slate-700 rounded w-32 mb-4" />
      {[...Array(6)].map((_, i) => (
        <div key={i} className="h-8 bg-slate-700 rounded mb-2" />
      ))}
    </div>
  );

  if (!data || data.error) return null;

  const investors = [
    { label: '외국인', icon: '🌍', qty: data.foreign?.qty,     amount: data.foreign?.amount },
    { label: '기관',   icon: '🏢', qty: data.institution?.qty, amount: data.institution?.amount },
    { label: '개인',   icon: '👤', qty: data.individual?.qty,  amount: data.individual?.amount },
  ];

  const maxAbs = Math.max(
    Math.abs(data.foreign?.qty     || 0),
    Math.abs(data.institution?.qty || 0),
    Math.abs(data.individual?.qty  || 0),
    1
  );

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">

      {/* 헤더 */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            투자자별 매매 동향
          </h3>
          <span className="text-[10px] text-slate-500">{data.date} 기준</span>
        </div>
      </div>

      {/* 섹션 1: 외국인/기관/개인 */}
      <div className="px-4 py-3 border-b border-slate-800">
        <div className="flex justify-between text-[10px] text-slate-600 mb-3">
          <span>← 순매도</span>
          <span>순매수 →</span>
        </div>
        <div className="space-y-3">
          {investors.map((inv) => {
            const isUp = (inv.qty || 0) > 0;
            const barPct = maxAbs > 0 ? Math.abs(inv.qty || 0) / maxAbs * 45 : 0;
            return (
              <div key={inv.label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <span>{inv.icon}</span>{inv.label}
                  </span>
                  <div className="text-right">
                    <span className={`text-xs font-bold font-mono ${
                      isUp ? 'text-red-400' : (inv.qty || 0) < 0 ? 'text-blue-400' : 'text-slate-500'
                    }`}>
                      {fmtAmt(inv.amount || 0)}원
                    </span>
                    <span className={`text-[10px] font-mono ml-1 ${
                      isUp ? 'text-red-400/60' : 'text-blue-400/60'
                    }`}>
                      ({fmtQty(inv.qty || 0)})
                    </span>
                  </div>
                </div>
                {/* 중앙 기준 바 그래프 */}
                <div className="relative h-1.5 bg-slate-800 rounded-full">
                  <div className="absolute top-0 left-1/2 w-px h-full bg-slate-600" />
                  {(inv.qty || 0) !== 0 && (
                    <div
                      className={`absolute top-0 h-full rounded-full ${
                        isUp ? 'left-1/2 bg-red-400' : 'right-1/2 bg-blue-400'
                      }`}
                      style={{ width: `${barPct}%` }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 섹션 2: 프로그램 매매 */}
      {data.program !== null && data.program !== undefined && (
        <div className="px-4 py-3 border-b border-slate-800">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            프로그램 매매
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '매수',  value: data.program.buy,  color: 'text-red-400' },
              { label: '매도',  value: data.program.sell, color: 'text-blue-400' },
              { label: '순매수', value: data.program.net,
                color: data.program.net >= 0 ? 'text-red-400' : 'text-blue-400' },
            ].map(item => (
              <div key={item.label} className="text-center bg-slate-800/50 rounded-lg p-2">
                <p className="text-[10px] text-slate-500 mb-0.5">{item.label}</p>
                <p className={`text-xs font-bold font-mono ${item.color}`}>
                  {fmtAmt(item.value)}원
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 섹션 3: 공매도 현황 */}
      {data.shortSell !== null && data.shortSell !== undefined && (
        <div className="px-4 py-3 border-b border-slate-800">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            공매도 현황
          </p>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400">공매도 비율</span>
            <span className="text-sm font-bold font-mono text-amber-400">
              {data.shortSell.ratio.toFixed(2)}%
            </span>
          </div>
          {/* 공매도 비율 바 (0~20%+ 스케일) */}
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-amber-400 rounded-full transition-all"
              style={{ width: `${Math.min(data.shortSell.ratio * 5, 100)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-slate-600 mt-1">
            <span>0%</span>
            <span>20%+</span>
          </div>
        </div>
      )}

      {/* 섹션 4: 거래대금 비중 */}
      {data.marketShare !== null && data.marketShare !== undefined && (
        <div className="px-4 py-3">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">
            시장 거래대금 비중
          </p>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-slate-400">KOSPI 대비</span>
            <span className="text-sm font-bold font-mono text-indigo-400">
              {data.marketShare.ratio.toFixed(2)}%
            </span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-400 rounded-full transition-all"
              style={{ width: `${Math.min(data.marketShare.ratio * 10, 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-slate-600 mt-1">
            거래대금 {fmtAmt(data.marketShare.stockAmount || 0)}원
          </p>
        </div>
      )}
    </div>
  );
}
