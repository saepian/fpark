'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Header from '@/components/layout/Header';
import Footer from '@/components/layout/Footer';
import NewsCard from '@/components/main/NewsCard';
import { NewsItem, NewsListResponse } from '@/lib/types';

const TABS = [
  { label: '전체',   code: 'all' },
  { label: '국내주식', code: 'domestic' },
  { label: '해외주식', code: 'global' },
  { label: '경제',   code: 'macro' },
  { label: '부동산', code: 'real_estate' },
  { label: '종목',   code: 'stock' },
] as const;

type TabCode = typeof TABS[number]['code'];
const PAGE_SIZE = 20;

function NewsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialCategory = (searchParams.get('category') ?? 'all') as TabCode;

  const [activeCode, setActiveCode] = useState<TabCode>(initialCategory);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const fetchNews = useCallback(async (code: TabCode, offset: number, append: boolean) => {
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (code !== 'all') params.set('category', code);
    const res = await fetch(`/api/news?${params}`);
    if (!res.ok) throw new Error('fetch failed');
    const data: NewsListResponse = await res.json();
    if (append) {
      setNews((prev) => [...prev, ...data.news]);
    } else {
      setNews(data.news);
    }
    setTotal(data.total);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(false);
    fetchNews(activeCode, 0, false)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [activeCode, fetchNews]);

  // Infinite scroll sentinel
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loadingMore && !loading && news.length < total) {
          setLoadingMore(true);
          fetchNews(activeCode, news.length, true)
            .catch(() => null)
            .finally(() => setLoadingMore(false));
        }
      },
      { rootMargin: '300px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [activeCode, fetchNews, loading, loadingMore, news.length, total]);

  const handleTabChange = (code: TabCode) => {
    setActiveCode(code);
    const query = code !== 'all' ? `?category=${code}` : '';
    router.replace(`/news${query}`, { scroll: false });
  };

  return (
    <div className="min-h-screen bg-[#f4f6f9] dark:bg-[#0f1117] text-[#0f1117] dark:text-[#d4e4fa]">
      <Header onSelectStock={(ticker) => router.push(`/stock/${ticker}`)} />

      <main className="max-w-3xl mx-auto px-4 md:px-8 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between border-b-2 border-gray-200 dark:border-[#2d313e] pb-3 mb-6">
          <h1 className="font-sans text-2xl font-extrabold flex items-center gap-2 text-gray-900 dark:text-gray-100">
            전체 뉴스
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
          </h1>
          {total > 0 && (
            <span className="text-xs font-mono font-bold text-gray-400">
              총 {total.toLocaleString()}건
            </span>
          )}
        </div>

        {/* Category tabs */}
        <div className="flex gap-2 flex-wrap mb-6">
          {TABS.map(({ label, code }) => (
            <button
              key={code}
              onClick={() => handleTabChange(code)}
              className={`px-3 py-1.5 text-xs font-bold rounded-full border transition-all ${
                activeCode === code
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'border-gray-300 dark:border-[#2d313e] text-gray-500 dark:text-[#8c909f] hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* News list */}
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-32 rounded-lg bg-gray-200 dark:bg-[#1a1d27] animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="py-16 text-center">
            <p className="text-gray-400 text-sm">뉴스를 불러오지 못했습니다.</p>
            <button
              onClick={() => { setError(false); setLoading(true); fetchNews(activeCode, 0, false).catch(() => setError(true)).finally(() => setLoading(false)); }}
              className="mt-3 text-xs text-blue-500 underline"
            >
              다시 시도
            </button>
          </div>
        ) : news.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            해당 카테고리의 뉴스가 없습니다.
          </div>
        ) : (
          <div className="space-y-4">
            {news.map((item) => (
              <NewsCard
                key={item.id}
                item={item}
                onSelectStock={(ticker) => router.push(`/stock/${ticker}`)}
              />
            ))}

            <div ref={sentinelRef} className="h-4" />

            {loadingMore && (
              <div className="py-6 text-center">
                <span className="text-xs text-gray-400">불러오는 중...</span>
              </div>
            )}

            {!loadingMore && news.length >= total && total > 0 && (
              <div className="py-6 text-center text-xs text-gray-400">
                모든 뉴스를 불러왔습니다. ({total.toLocaleString()}건)
              </div>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}

export default function NewsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <span className="text-gray-400 text-sm">로딩 중...</span>
      </div>
    }>
      <NewsPageContent />
    </Suspense>
  );
}
