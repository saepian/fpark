'use client';

import React from 'react';
import { NewsItem, StockTag } from '../../lib/types';
import { isLegacyFallbackImage, pickNewsPlaceholder } from '../../lib/news-placeholder';

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}일 전`;
  return new Date(dateStr).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

const CATEGORY_LABELS: Record<string, string> = {
  domestic: '국내시장', global: '해외시장', macro: '경제',
  real_estate: '부동산', stock: '종목', company: '기업', crypto: '가상화폐',
};

// 2026-09-04 B-2: 카테고리 무관하게 같은 unsplash 캔들차트로 폴백하던 CATEGORY_IMAGES/DEFAULT_IMAGE 제거 —
// 이미지가 없거나(신규 행은 null) 예전 폴백 URL이 박힌 행이면 lib/news-placeholder.ts의 분산 플레이스홀더.

function stockNames(stocks: StockTag[] | string[] | null): string[] {
  if (!stocks || stocks.length === 0) return [];
  return stocks
    .map((s) => (typeof s === 'string' ? s : s.name))
    .filter((name) => !/^\d{6}$/.test(name));
}

interface NewsCardProps {
  item: NewsItem;
  onSelectStock?: (ticker: string) => void;
}

export default function NewsCard({ item, onSelectStock }: NewsCardProps) {
  const names = stockNames(item.stocks);
  const hasImage = !isLegacyFallbackImage(item.image_url);
  const placeholder = pickNewsPlaceholder(item.category, item.id);
  const [imgFailed, setImgFailed] = React.useState(false);

  const handleCardClick = () => {
    window.open(item.original_url, '_blank', 'noopener,noreferrer');
  };

  const handleTagClick = (e: React.MouseEvent, name: string) => {
    e.stopPropagation();
    if (onSelectStock) onSelectStock(name);
  };

  return (
    <article
      id={`news-card-${item.id}`}
      onClick={handleCardClick}
      className="glass-card bg-white dark:bg-[#1a1d27]/70 border border-gray-200 dark:border-[#2d313e] rounded-lg flex flex-col sm:flex-row p-4 gap-4 group cursor-pointer hover:border-blue-500 transition-all duration-300"
    >
      {/* Category thumbnail */}
      <div className="w-32 h-24 flex-shrink-0 rounded-lg overflow-hidden bg-slate-800">
        {hasImage && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image_url!}
            alt={item.title}
            width={128}
            height={96}
            className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-500"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            data-placeholder={placeholder.key}
            className="w-full h-full flex items-end p-2"
            style={{ background: placeholder.background }}
            aria-hidden="true"
          >
            <span className="text-[11px] font-bold tracking-wider text-white/70">{placeholder.label}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col justify-between py-0.5 flex-1 min-w-0">
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {names.slice(0, 3).map((name, idx) => (
              <span
                key={idx}
                onClick={(e) => handleTagClick(e, name)}
                className="font-sans text-[11px] font-bold text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/30 px-1.5 py-0.5 rounded hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors cursor-pointer"
              >
                #{name}
              </span>
            ))}
            {item.category && (
              <span className="font-sans text-[11px] font-bold text-gray-500 dark:text-gray-500 bg-gray-100 dark:bg-gray-800/50 px-1.5 py-0.5 rounded">
                {CATEGORY_LABELS[item.category] ?? item.category}
              </span>
            )}
          </div>
          <h3 className="font-sans text-base font-bold text-gray-900 dark:text-gray-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2 leading-snug">
            {item.title}
          </h3>
          {item.summary?.trim() && (
            <p className="text-gray-500 dark:text-gray-400 text-sm line-clamp-2 leading-relaxed">
              {item.summary}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 mt-2 text-[11px] font-bold tracking-wider text-gray-400 dark:text-[#8c909f] uppercase">
          <span>{item.source}</span>
          <span>•</span>
          <span>{timeAgo(item.published_at)}</span>
        </div>
      </div>
    </article>
  );
}
