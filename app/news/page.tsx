'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import NewsCard from '@/components/main/NewsCard';
import { NewsItem } from '@/lib/types';

const PAGE_SIZE = 20;

const CATEGORIES = ['전체', '국내주식', '해외주식', '경제', '부동산', '원자재'] as const;
type Category = typeof CATEGORIES[number];

const CATEGORY_CODE: Record<Category, string> = {
  '전체':   '',
  '국내주식': 'domestic',
  '해외주식': 'global',
  '경제':   'macro',
  '부동산':  'real_estate',
  '원자재':  'commodity',
};

function NewsPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const currentPage = Math.max(1, Number(searchParams.get('page') || 1));
  const currentCategory = (searchParams.get('category') || '전체') as Category;

  const [news, setNews] = useState<NewsItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const offset = (currentPage - 1) * PAGE_SIZE;
        const code = CATEGORY_CODE[currentCategory];
        const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
        if (code) params.set('category', code);
        const res = await fetch(`/api/news?${params}`);
        const data = await res.json();
        if (!cancelled) {
          setNews(data.news ?? []);
          setTotal(data.total ?? 0);
        }
      } catch {
        if (!cancelled) setNews([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    window.scrollTo(0, 0);
    return () => { cancelled = true; };
  }, [currentPage, currentCategory]);

  const goToPage = (page: number) => {
    const params = new URLSearchParams();
    params.set('page', String(page));
    if (currentCategory !== '전체') params.set('category', currentCategory);
    router.push(`/news?${params}`);
  };

  const goToCategory = (cat: Category) => {
    const params = new URLSearchParams();
    params.set('page', '1');
    if (cat !== '전체') params.set('category', cat);
    router.push(`/news?${params}`);
  };

  // 현재 페이지 주변 5개 페이지 번호 계산
  const pageNumbers = () => {
    const start = Math.max(1, Math.min(currentPage - 2, totalPages - 4));
    const end = Math.min(totalPages, start + 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white mb-1">전체 뉴스</h1>
        <p className="text-sm text-slate-500">총 {total.toLocaleString()}건</p>
      </div>

      {/* 카테고리 탭 */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => goToCategory(cat)}
            className={[
              'px-4 py-1.5 rounded-full text-xs font-semibold transition-all cursor-pointer',
              currentCategory === cat
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700',
            ].join(' ')}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* 뉴스 리스트 */}
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : news.length === 0 ? (
        <div className="py-20 text-center text-slate-500 text-sm">해당 카테고리의 뉴스가 없습니다.</div>
      ) : (
        <div className="space-y-3">
          {news.map((item) => (
            <NewsCard
              key={item.id}
              item={item}
              onSelectStock={(ticker) => router.push(`/stock/${ticker}`)}
            />
          ))}
        </div>
      )}

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <>
          <div className="flex items-center justify-center gap-1 mt-10">
            <button
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="px-3 py-2 rounded-lg text-sm text-slate-400
                hover:text-white hover:bg-slate-800
                disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              ←
            </button>

            {pageNumbers().map((page) => (
              <button
                key={page}
                onClick={() => goToPage(page)}
                className={[
                  'w-9 h-9 rounded-lg text-sm font-medium transition-all',
                  page === currentPage
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800',
                ].join(' ')}
              >
                {page}
              </button>
            ))}

            <button
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="px-3 py-2 rounded-lg text-sm text-slate-400
                hover:text-white hover:bg-slate-800
                disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              →
            </button>
          </div>

          <p className="text-center text-xs text-slate-600 mt-3">
            {currentPage} / {totalPages} 페이지
          </p>
        </>
      )}
    </div>
  );
}

export default function NewsPage() {
  return (
    <Suspense fallback={
      <div className="max-w-4xl mx-auto px-6 py-8">
        <div className="space-y-4">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-24 bg-slate-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    }>
      <NewsPageContent />
    </Suspense>
  );
}
