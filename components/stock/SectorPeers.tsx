'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Peer {
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
}

export default function SectorPeers({ ticker }: { ticker: string }) {
  const router = useRouter();
  const [peers, setPeers] = useState<Peer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/stock/${ticker}/sector`)
      .then(r => r.json())
      .then(data => setPeers(Array.isArray(data) ? data : []))
      .catch(() => setPeers([]))
      .finally(() => setLoading(false));
  }, [ticker]);

  if (loading) {
    return (
      <div className="rounded-xl bg-[#1a1d27] border border-slate-800 p-4 animate-pulse">
        <div className="h-3.5 bg-slate-700 rounded w-28 mb-4" />
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex justify-between items-center py-2.5 border-b border-slate-800/60">
            <div className="space-y-1.5">
              <div className="h-3 bg-slate-700 rounded w-20" />
              <div className="h-2.5 bg-slate-700/50 rounded w-12" />
            </div>
            <div className="h-3 bg-slate-700 rounded w-16" />
          </div>
        ))}
      </div>
    );
  }

  if (peers.length === 0) return null;

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">
      <div className="px-4 pt-4 pb-2.5 border-b border-slate-800">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
          동일업종 종목
        </h3>
      </div>

      <div className="divide-y divide-slate-800/50">
        {peers.map(peer => {
          const isUp = peer.changeRate >= 0;
          const color = isUp ? 'text-red-400' : 'text-blue-400';
          return (
            <button
              key={peer.ticker}
              onClick={() => router.push(`/stock/${peer.ticker}`)}
              className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.03] transition-colors text-left"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-white truncate leading-tight">
                  {peer.name}
                </p>
                <p className="text-[10px] text-slate-600 font-mono mt-0.5">{peer.ticker}</p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className={`text-[13px] font-bold font-mono ${color}`}>
                  {peer.price.toLocaleString('ko-KR')}
                </p>
                <p className={`text-[11px] font-mono ${color}`}>
                  {isUp ? '+' : ''}{peer.changeRate.toFixed(2)}%
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
