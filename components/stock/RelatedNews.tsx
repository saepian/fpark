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
    <div id="related-news-grid" className="space-y-4">
      <h3 className="font-sans text-xl font-bold border-b border-gray-200 dark:border-[#2d313e]/70 pb-2 text-gray-900 dark:text-gray-100">
        관련 뉴스
      </h3>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded bg-gray-200 dark:bg-[#1a1d27] animate-pulse" />
          ))}
        </div>
      ) : news.length === 0 ? (
        <p className="text-gray-400 dark:text-[#8c909f] text-sm py-4">
          관련 뉴스가 없습니다.
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {news.map((item) => (
            <div
              id={`related-news-card-${item.id}`}
              key={item.id}
              onClick={() => window.open(item.original_url, '_blank', 'noopener,noreferrer')}
              className="flex flex-col gap-2 p-3 bg-white dark:bg-[#122131] border border-gray-200 dark:border-[#2d313e]/60 rounded hover:bg-gray-50 dark:hover:bg-[#1c2b3c] cursor-pointer transition-colors"
            >
              <h4 className="text-sm font-bold text-gray-900 dark:text-[#d4e4fa] line-clamp-2 leading-tight hover:text-blue-500 transition-colors">
                {item.title}
              </h4>
              <p className="text-[10px] font-bold text-gray-400 dark:text-[#8c909f] uppercase tracking-wide">
                {item.source} • {timeAgo(item.published_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
