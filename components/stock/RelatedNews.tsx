'use client';

import React, { useState, useEffect } from 'react';
import { NewsItem } from '../../lib/types';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

interface RelatedNewsProps {
  ticker: string;
}

export default function RelatedNews({ ticker }: RelatedNewsProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/news/stock/${ticker}`)
      .then((r) => r.json())
      .then((data) => setNews(data.news ?? []))
      .catch(() => setNews([]))
      .finally(() => setLoading(false));
  }, [ticker]);

  return (
    <div className="rounded-xl bg-[#1a1d27] border border-slate-800 overflow-hidden">
      <div className="px-4 pt-4 pb-2.5 border-b border-slate-800">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">관련 뉴스</h3>
      </div>

      {loading ? (
        <div className="divide-y divide-slate-800/50">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-3 animate-pulse space-y-1.5">
              <div className="h-3 bg-slate-700 rounded w-full" />
              <div className="h-2.5 bg-slate-700/50 rounded w-24" />
            </div>
          ))}
        </div>
      ) : news.length === 0 ? (
        <p className="px-4 py-4 text-[12px] text-slate-600">관련 뉴스가 없습니다.</p>
      ) : (
        <div className="divide-y divide-slate-800/50">
          {news.slice(0, 5).map((item) => (
            <a
              key={item.id}
              href={item.original_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block px-4 py-3 hover:bg-white/[0.03] transition-colors group"
            >
              <p className="text-[13px] font-semibold text-slate-200 truncate leading-tight group-hover:text-indigo-300 transition-colors">
                {item.title}
              </p>
              <p className="text-[10px] text-slate-600 mt-1">
                {item.source} · {timeAgo(item.published_at)}
              </p>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
