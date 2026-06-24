'use client';

import React, { useEffect, useState } from 'react';
import { NewsItem, TopNewsResponse } from '../../lib/types';

const CATEGORY_STYLES: Record<string, { gradient: string; label: string; img: string }> = {
  domestic:    { gradient: 'from-blue-950 via-blue-900 to-slate-900',     label: '국내주식', img: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=400&fit=crop' },
  global:      { gradient: 'from-violet-950 via-violet-900 to-slate-900', label: '해외주식', img: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=400&fit=crop' },
  macro:       { gradient: 'from-emerald-950 via-emerald-900 to-slate-900', label: '경제',   img: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=800&h=400&fit=crop' },
  real_estate: { gradient: 'from-orange-950 via-orange-900 to-slate-900', label: '부동산',  img: 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&h=400&fit=crop' },
  stock:       { gradient: 'from-cyan-950 via-cyan-900 to-slate-900',     label: '종목',    img: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=400&fit=crop' },
  company:     { gradient: 'from-indigo-950 via-indigo-900 to-slate-900', label: '기업',    img: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=400&fit=crop' },
  crypto:      { gradient: 'from-yellow-950 via-yellow-900 to-slate-900', label: '가상화폐', img: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&h=400&fit=crop' },
};
const DEFAULT_STYLE = { gradient: 'from-slate-950 via-slate-800 to-gray-900', label: 'NEWS', img: 'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=800&h=400&fit=crop' };

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${Math.max(1, mins)}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

export default function HeroNews() {
  const [hero, setHero] = useState<NewsItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [heroImgFailed, setHeroImgFailed] = useState(false);

  useEffect(() => {
    fetch('/api/news/top')
      .then((r) => r.json())
      .then((data: TopNewsResponse) => {
        setHero(data.hero);
        setHeroImgFailed(false);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const catStyle = hero ? (CATEGORY_STYLES[hero.category] ?? DEFAULT_STYLE) : DEFAULT_STYLE;
  const heroImg = !heroImgFailed && hero?.image_url ? hero.image_url : catStyle.img;

  if (loading) {
    return <div className="relative h-[400px] rounded-lg border border-gray-200 dark:border-[#2d313e] bg-gray-200 dark:bg-[#1a1d27] animate-pulse" />;
  }

  if (!hero) {
    return (
      <div className="relative h-[400px] rounded-lg border border-gray-200 dark:border-[#2d313e] bg-slate-900 flex items-end p-8">
        <p className="text-gray-400 text-sm">뉴스를 불러올 수 없습니다.</p>
      </div>
    );
  }

  return (
    <div
      id="hero-news-banner"
      onClick={() => window.open(hero.original_url, '_blank', 'noopener,noreferrer')}
      className={`relative h-[400px] group overflow-hidden rounded-lg border border-gray-200 dark:border-[#2d313e] cursor-pointer bg-gradient-to-br ${catStyle.gradient} transition-all duration-300 shadow-lg`}
    >
      {/* Background image with overlay */}
      <div className="absolute inset-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={heroImg}
          alt={catStyle.label}
          onError={() => setHeroImgFailed(true)}
          className="w-full h-full object-cover opacity-40 transition-transform duration-700 group-hover:scale-105"
        />
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />

      <div className="absolute bottom-0 left-0 p-6 md:p-8 space-y-3 z-10">
        <div className="flex items-center gap-3">
          <span className="inline-block bg-blue-600 dark:bg-[#4d8eff] text-white dark:text-[#00285d] px-3.5 py-1 text-[11px] font-bold tracking-widest rounded-full uppercase">
            {catStyle.label}
          </span>
          <span className="text-gray-300 text-xs font-medium">{timeAgo(hero.published_at)}</span>
        </div>
        <h1 className="text-2xl md:text-3xl lg:text-4xl font-extrabold text-white leading-tight max-w-3xl drop-shadow-sm group-hover:text-blue-200 transition-colors">
          {hero.title}
        </h1>
        {hero.summary && (
          <p className="text-gray-200 text-sm md:text-base line-clamp-2 max-w-2xl font-light leading-relaxed">
            {hero.summary}
          </p>
        )}
        <p className="text-gray-400 text-xs font-bold tracking-widest uppercase">{hero.source}</p>
      </div>
    </div>
  );
}
