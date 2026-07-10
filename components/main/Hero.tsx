'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import SearchDropdown from '@/components/search/SearchDropdown';
import HeroCanvasBackground from './HeroCanvasBackground';
import WelcomeBanner from './WelcomeBanner';
import type { SearchResult } from '@/lib/types';

interface MarketData {
  KOSPI: { value: number; changeRate: number };
  KOSDAQ: { value: number; changeRate: number };
}

const POPULAR = [
  { name: '삼성전자', ticker: '005930' },
  { name: 'SK하이닉스', ticker: '000660' },
  { name: 'NAVER', ticker: '035420' },
  { name: '카카오', ticker: '035720' },
  { name: '현대차', ticker: '005380' },
  { name: '셀트리온', ticker: '068270' },
];

export default function Hero() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showDrop, setShowDrop] = useState(false);
  const [market, setMarket] = useState<MarketData | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // 시장 데이터
  useEffect(() => {
    fetch('/api/market')
      .then((r) => r.json())
      .then((d) => { if (d.KOSPI && d.KOSDAQ) setMarket(d); })
      .catch(() => {});
  }, []);

  // 검색어 디바운스 fetch
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data: SearchResult[] = await res.json();
          setResults(Array.isArray(data) ? data : []);
        }
      } catch { setResults([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDrop(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = useCallback((ticker: string) => {
    router.push(`/stock/${ticker}`);
    setShowDrop(false);
    setQuery('');
    setResults([]);
  }, [router]);

  const isKospiUp = (market?.KOSPI.changeRate ?? 0) >= 0;
  const isKosdaqUp = (market?.KOSDAQ.changeRate ?? 0) >= 0;

  return (
    <div className="relative w-full overflow-hidden">
      <HeroCanvasBackground />

      {/* 콘텐츠 */}
      <div className="relative z-10 max-w-4xl mx-auto px-6 py-20 text-center">

        {/* AI 뱃지 */}
        <div className="inline-flex items-center gap-2 mb-6
          bg-indigo-500/10 border border-indigo-500/30 rounded-full px-4 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
          </span>
          <span className="text-xs font-semibold text-indigo-300 tracking-wide">
            AI 기반 실시간 기업 데이터 분석 플랫폼
          </span>
        </div>

        {/* 헤드라인 */}
        <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 leading-tight">
          AI가 분석하는
          <br />
          <span className="relative inline-block">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400">
              실시간 시장 데이터
            </span>
            <span
              className="absolute -bottom-1 left-0 right-0 h-px opacity-60"
              style={{ background: 'linear-gradient(90deg, #818cf8, #a78bfa, #f472b6)' }}
            />
          </span>
        </h1>

        <p className="text-slate-400 text-sm mb-10 max-w-lg mx-auto leading-relaxed">
          AI가 공개된 시장 데이터와 뉴스를 분석하여
          <br />
          기업별 핵심 정보와 데이터 리포트를 제공합니다.
        </p>

        {/* 검색창 */}
        <div ref={wrapperRef} className="relative max-w-xl mx-auto mb-8">
          <div className="relative group">
            {/* 포커스 글로우 */}
            <div
              className="absolute -inset-0.5 rounded-xl opacity-0 group-focus-within:opacity-100 transition-opacity duration-300 blur-sm"
              style={{ background: 'linear-gradient(90deg, #4f46e5, #7c3aed, #ec4899)' }}
            />
            <div className="relative flex items-center">
              <svg
                className="absolute left-4 w-5 h-5 text-slate-400 shrink-0 z-10 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowDrop(true); }}
                onFocus={() => { if (query.length >= 1) setShowDrop(true); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { setShowDrop(false); return; }
                  if (e.key === 'Enter' && query.trim()) {
                    e.preventDefault();
                    if (results.length > 0) {
                      const first = results[0];
                      if (first.isOverseas && first.market) {
                        router.push(`/overseas/${first.market}/${first.ticker}`);
                        setShowDrop(false);
                        setQuery('');
                        setResults([]);
                      } else {
                        handleSelect(first.ticker);
                      }
                    } else {
                      setShowDrop(true);
                    }
                  }
                }}
                placeholder="기업명 또는 코드 검색  (예: 삼성전자, 005930)"
                className="relative w-full pl-12 pr-4 py-4 rounded-xl z-10
                  bg-slate-900/90 border border-slate-700/50
                  text-white placeholder:text-slate-500
                  focus:outline-none focus:border-indigo-500/50
                  text-sm transition-all backdrop-blur-md"
              />
            </div>
          </div>

          {showDrop && query.length >= 1 && (
            <div className="absolute top-full left-0 right-0 mt-2 z-50">
              <SearchDropdown
                query={query}
                results={results}
                onSelect={handleSelect}
                onClose={() => setShowDrop(false)}
              />
            </div>
          )}
        </div>

        {/* 인기 종목 */}
        <div className="flex flex-wrap items-center justify-center gap-2 mb-10">
          <span className="text-xs text-slate-600">인기 기업</span>
          {POPULAR.map((s) => (
            <button
              key={s.ticker}
              onClick={() => router.push(`/stock/${s.ticker}`)}
              className="text-xs text-slate-400 hover:text-white
                bg-slate-800/50 hover:bg-indigo-600/30
                border border-slate-700/50 hover:border-indigo-500/50
                rounded-full px-3.5 py-1.5 transition-all cursor-pointer"
            >
              {s.name}
            </button>
          ))}
        </div>

        {/* AI 진단 바로가기 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl mx-auto mb-10">
          {/* 종목진단 */}
          <div className="group cursor-pointer" onClick={() => router.push('/diagnosis')}>
            <div className="hero-banner-border-blue p-px rounded-2xl transition-transform duration-300 group-hover:-translate-y-1">
              <div className="bg-[#080b18]/90 backdrop-blur-sm rounded-[15px] px-4 py-4 h-full flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(99,102,241,0.2)', fontSize: '18px' }}
                    >
                      🔍
                    </div>
                    <div className="text-left">
                      <p className="text-[13px] font-bold text-white leading-tight">AI 기업 분석</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">기업 하나를 깊이 분석해드립니다</p>
                    </div>
                  </div>
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap mt-0.5"
                    style={{ background: 'rgba(99,102,241,0.2)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.35)' }}
                  >
                    무료 하루 1회
                  </span>
                </div>
                <div
                  className="flex items-center gap-1 text-[11px] font-semibold transition-all duration-200 group-hover:gap-1.5"
                  style={{ color: '#818cf8' }}
                >
                  분석 시작하기 <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                </div>
              </div>
            </div>
          </div>

          {/* 포트폴리오 진단 */}
          <div className="group cursor-pointer" onClick={() => router.push('/portfolio-diagnosis')}>
            <div className="hero-banner-border-purple p-px rounded-2xl transition-transform duration-300 group-hover:-translate-y-1">
              <div className="bg-[#080b18]/90 backdrop-blur-sm rounded-[15px] px-4 py-4 h-full flex flex-col gap-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{ background: 'rgba(139,92,246,0.2)', fontSize: '18px' }}
                    >
                      📊
                    </div>
                    <div className="text-left">
                      <p className="text-[13px] font-bold text-white leading-tight">AI 포트폴리오 분석</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">보유 기업 전체를 한번에 분석</p>
                    </div>
                  </div>
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap mt-0.5"
                    style={{ background: 'rgba(234,179,8,0.15)', color: '#fbbf24', border: '1px solid rgba(234,179,8,0.35)' }}
                  >
                    PRO
                  </span>
                </div>
                <div
                  className="flex items-center gap-1 text-[11px] font-semibold transition-all duration-200 group-hover:gap-1.5"
                  style={{ color: '#c084fc' }}
                >
                  분석 시작하기 <span className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 신규 유저 전용 웰컴 페이지 안내 배너 (선택적 진입, 강제 리다이렉트 아님) */}
        <WelcomeBanner />

        {/* 시장 현황 */}
        {market && (
          <div className="inline-flex flex-wrap items-center justify-center gap-4 sm:gap-6
            bg-slate-900/50 border border-slate-800/50
            rounded-2xl px-4 sm:px-6 py-3 backdrop-blur-sm">
            {[
              { label: 'KOSPI',  value: market.KOSPI.value,  rate: market.KOSPI.changeRate,  isUp: isKospiUp },
              { label: 'KOSDAQ', value: market.KOSDAQ.value, rate: market.KOSDAQ.changeRate, isUp: isKosdaqUp },
            ].map((m, i) => (
              <div key={m.label} className="flex items-center gap-3">
                {i > 0 && <div className="w-px h-4 bg-slate-700" />}
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">{m.label}</span>
                  <span className="text-sm font-bold font-mono text-white">
                    {m.value.toLocaleString()}
                  </span>
                  <span className={`text-xs font-mono font-semibold ${m.isUp ? 'text-red-400' : 'text-blue-400'}`}>
                    {m.isUp ? '▲' : '▼'} {Math.abs(m.rate).toFixed(2)}%
                  </span>
                </div>
              </div>
            ))}
            <div className="w-px h-4 bg-slate-700" />
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-slate-500">실시간</span>
            </div>
          </div>
        )}

        {/* 통계 수치 */}
        <div className="flex items-center justify-center gap-8 mt-8">
          {[
            { label: '분석 기업', value: '2,500+' },
            { label: '실시간 뉴스', value: '24/7' },
            { label: 'AI 분석', value: 'GPT-4급' },
          ].map((stat, i) => (
            <div key={i} className="text-center">
              <p className="text-lg font-bold text-white">{stat.value}</p>
              <p className="text-[11px] text-slate-500">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 하단 페이드 아웃 */}
      <div
        className="absolute bottom-0 left-0 right-0 h-16 pointer-events-none"
        style={{ background: 'linear-gradient(0deg, #0f1117 0%, transparent 100%)' }}
      />
    </div>
  );
}
