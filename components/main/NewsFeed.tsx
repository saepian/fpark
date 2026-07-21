'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import NewsCard from './NewsCard';
import { NewsItem, NewsListResponse } from '../../lib/types';

const TABS = [
  { label: '전체',   code: 'all' },
  { label: '국내시장', code: 'domestic' },
  { label: '해외시장', code: 'global' },
  { label: '경제',   code: 'macro' },
  { label: '부동산', code: 'real_estate' },
  { label: '기업',   code: 'stock' },
] as const;

type TabCode = typeof TABS[number]['code'];

const PAGE_SIZE = 10;

interface NewsFeedProps {
  onSelectStock: (ticker: string) => void;
}

export default function NewsFeed({ onSelectStock }: NewsFeedProps) {
  const router = useRouter();
  const [activeCode, setActiveCode] = useState<TabCode>('all');
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchNews = useCallback(async (code: TabCode) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: '0' });
    if (code !== 'all') params.set('category', code);
    const res = await fetch(`/api/news?${params}`);
    if (!res.ok) throw new Error('fetch failed');
    const data: NewsListResponse = await res.json();
    setNews(data.news);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetchNews(activeCode)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [activeCode, fetchNews]);

  const handleMoreClick = () => {
    const query = activeCode !== 'all' ? `?category=${activeCode}` : '';
    router.push(`/news${query}`);
  };

  return (
    <div id="news-feed-container" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b-2 border-gray-200 dark:border-[#2d313e] pb-2 gap-2">
        <h2 className="font-sans text-xl font-bold flex items-center gap-2 text-gray-900 dark:text-gray-100 shrink-0">
          최신 뉴스
          <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
        </h2>
        <div className="flex gap-3 overflow-x-auto scrollbar-none pb-0.5">
          {TABS.map(({ label, code }) => (
            <button
              key={code}
              onClick={() => setActiveCode(code)}
              className={`text-xs font-bold transition-all whitespace-nowrap shrink-0 ${
                activeCode === code
                  ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400'
                  : 'text-gray-400 dark:text-[#8c909f] hover:text-gray-900 dark:hover:text-[#d4e4fa]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 rounded-lg bg-gray-200 dark:bg-[#1a1d27] animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <p className="text-gray-400 text-sm">뉴스를 불러오지 못했습니다.</p>
          <button
            onClick={() => { setError(false); setLoading(true); fetchNews(activeCode).catch(() => setError(true)).finally(() => setLoading(false)); }}
            className="mt-3 text-xs text-blue-500 underline"
          >
            다시 시도
          </button>
        </div>
      ) : news.length === 0 ? (
        <div className="py-12 text-center text-gray-400 text-sm">해당 카테고리의 뉴스가 없습니다.</div>
      ) : (
        <div className="space-y-4">
          {news.map((item) => (
            <NewsCard key={item.id} item={item} onSelectStock={onSelectStock} />
          ))}

          {/* 더보기 버튼 */}
          <button
            onClick={handleMoreClick}
            className="w-full py-3.5 mt-2 flex items-center justify-center gap-2 border border-gray-200 dark:border-[#2d313e] rounded-lg text-sm font-bold text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-[#1a1d27] hover:text-blue-600 dark:hover:text-blue-400 hover:border-blue-400 dark:hover:border-blue-500 transition-all"
          >
            뉴스 더보기
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
