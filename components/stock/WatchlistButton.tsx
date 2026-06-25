'use client';

import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { createClient } from '../../lib/supabase-browser';
import Toast from '../Toast';

interface Props {
  ticker: string;
  name: string;
}

export default function WatchlistButton({ ticker, name }: Props) {
  const [loggedIn, setLoggedIn]   = useState(false);
  const [watching, setWatching]   = useState(false);
  const [loading, setLoading]     = useState(true);
  const [toastMsg, setToastMsg]   = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { setLoading(false); return; }
      setLoggedIn(true);
      fetch('/api/watchlist')
        .then(r => r.json())
        .then((list: { ticker: string }[]) => {
          setWatching(Array.isArray(list) && list.some(w => w.ticker === ticker));
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    });
  }, [ticker]);

  if (!loggedIn || loading) return null;

  const toggle = async () => {
    const prev = watching;
    setWatching(!prev);
    try {
      const res = await fetch('/api/watchlist', {
        method: prev ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, name }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setToastMsg(body.error ?? '오류가 발생했습니다.');
        setWatching(prev); // 낙관적 업데이트 롤백
      }
    } catch {
      setToastMsg('네트워크 오류가 발생했습니다.');
      setWatching(prev);
    }
  };

  return (
    <>
      <button
        onClick={toggle}
        aria-label={watching ? '관심종목 해제' : '관심종목 추가'}
        className={[
          'flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium transition-all cursor-pointer',
          watching
            ? 'border-yellow-500/60 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20'
            : 'border-slate-700 bg-transparent text-slate-400 hover:border-slate-500 hover:text-slate-200',
        ].join(' ')}
      >
        <Star
          className="w-3 h-3"
          fill={watching ? 'currentColor' : 'none'}
          strokeWidth={2}
        />
        {watching ? '관심종목' : '추가'}
      </button>

      {toastMsg && (
        <Toast message={toastMsg} onClose={() => setToastMsg(null)} />
      )}
    </>
  );
}
