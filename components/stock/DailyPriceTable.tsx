'use client';

import { useEffect, useState } from 'react';

interface DayData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  changeRate: number;
}

export default function DailyPriceTable({ ticker }: { ticker: string }) {
  const [data, setData] = useState<DayData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stock/${ticker}/daily`)
      .then((r) => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [ticker]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
  };

  if (loading) {
    return (
      <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4 animate-pulse">
        <div className="h-4 bg-slate-700 rounded w-32 mb-4" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-8 bg-slate-700 rounded mb-2" />
        ))}
      </div>
    );
  }

  if (!data.length) return null;

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4">
      <h3 className="text-sm font-bold text-slate-300 mb-3">
        일별 주가 동향
        <span className="text-[10px] text-slate-500 font-normal ml-2">최근 5거래일</span>
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800">
              <th className="text-left pb-2.5 font-medium">날짜</th>
              <th className="text-right pb-2.5 font-medium">종가</th>
              <th className="text-right pb-2.5 font-medium">등락률</th>
              <th className="text-right pb-2.5 font-medium">시가</th>
              <th className="text-right pb-2.5 font-medium">고가</th>
              <th className="text-right pb-2.5 font-medium">저가</th>
              <th className="text-right pb-2.5 font-medium">거래량</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d, i) => {
              const isUp = d.changeRate >= 0;
              const color = isUp ? 'text-red-400' : 'text-blue-400';
              return (
                <tr
                  key={d.date}
                  className="border-b border-slate-800/40 hover:bg-slate-800/30 transition-colors"
                >
                  <td className="py-2.5 text-slate-400">
                    {formatDate(d.date)}
                    {i === 0 && (
                      <span className="ml-1.5 text-[9px] text-indigo-400 bg-indigo-400/10 px-1.5 py-0.5 rounded-full">
                        최근
                      </span>
                    )}
                  </td>
                  <td className={`py-2.5 text-right font-mono font-semibold ${color}`}>
                    {d.close.toLocaleString()}
                  </td>
                  <td className={`py-2.5 text-right font-mono ${color}`}>
                    {isUp ? '+' : ''}{d.changeRate.toFixed(2)}%
                  </td>
                  <td className="py-2.5 text-right font-mono text-slate-400">
                    {d.open.toLocaleString()}
                  </td>
                  <td className="py-2.5 text-right font-mono text-red-400/70">
                    {d.high.toLocaleString()}
                  </td>
                  <td className="py-2.5 text-right font-mono text-blue-400/70">
                    {d.low.toLocaleString()}
                  </td>
                  <td className="py-2.5 text-right font-mono text-slate-500">
                    {(d.volume / 1000).toFixed(0)}K
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
