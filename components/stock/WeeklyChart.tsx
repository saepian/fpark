'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, Cell, ResponsiveContainer, Tooltip } from 'recharts';

interface DayData {
  date: string;
  changeRate: number;
}

export default function WeeklyChart({ ticker }: { ticker: string }) {
  const [data, setData] = useState<DayData[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await fetch(`/api/stock/${ticker}/daily`);
          const d = await r.json();
          if (!cancelled) {
            if (Array.isArray(d)) {
              setData([...d].reverse());
              return;
            }
            console.error('[WeeklyChart] 응답이 배열이 아님:', d);
          }
        } catch (e) {
          console.error('[WeeklyChart] fetch 에러:', e);
        }
        if (attempt === 0 && !cancelled) await new Promise((r) => setTimeout(r, 1500));
      }
      if (!cancelled) setData([]);
    };
    load();
    return () => { cancelled = true; };
  }, [ticker]);

  if (!data || !data.length) return null;

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4">
      <h3 className="text-xs font-bold text-slate-400 mb-3">5일 등락률 추이</h3>
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => {
              const date = new Date(d);
              return `${date.getMonth() + 1}/${date.getDate()}`;
            }}
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            formatter={(v: number) => [`${v > 0 ? '+' : ''}${v.toFixed(2)}%`, '등락률']}
            contentStyle={{
              backgroundColor: '#1a1d27',
              border: '1px solid #334155',
              borderRadius: '6px',
              fontSize: '11px',
            }}
          />
          <Bar dataKey="changeRate" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.changeRate >= 0 ? '#ef4444' : '#3b82f6'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
