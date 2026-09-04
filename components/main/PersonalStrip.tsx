'use client';

// 메인(로그인 홈) 개인화 스트립 (2026-09-04 C) — 히어로 바로 아래, 최신뉴스 그리드 위.
// 로그인 유저에게만 렌더링. 카드 3분할: ① 내 관심종목 등락률 상위 칩 ② 내 대시보드 요약 ③ 바로가기.
// 데이터는 기존 캐시 경로만 재사용 — /api/watchlist(fetchStockPricesCached), /api/dashboard/holdings
// (fetchStockQuoteCached), /api/saved-reports(DB) — 이 컴포넌트가 새로 여는 KIS 호출 경로는 없다.
// 참고: 예전 워치리스트 캐러셀(components/main/WatchlistSection.tsx)은 현재 메인이 아니라
// /market/domestic 페이지에만 마운트돼 있어 메인에서 중복되지 않는다(AppShell 미사용, 2026-09-04 확인).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bookmark, LayoutDashboard, PieChart, Star } from 'lucide-react';
import { useSession } from '@/lib/useSession';
import { topWatchMovers, summarizeDashboard, stockHref, type StripWatchItem, type StripHolding, type DashboardSummary } from '@/lib/personal-strip';

interface StripData {
  watch: StripWatchItem[] | null;      // null = 조회 실패
  dashboard: DashboardSummary | null;  // null = 조회 실패
  savedToday: number | null;
}

const CARD = 'rounded-xl bg-[#1a1d27] border border-slate-800 px-4 py-3 min-h-[84px] flex flex-col justify-between';
const LABEL = 'flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400';

function pct(n: number): string { return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`; }
function colorFor(n: number): string { return n > 0 ? 'text-red-400' : n < 0 ? 'text-blue-400' : 'text-slate-400'; }

export default function PersonalStrip() {
  const { user, loading: sessionLoading } = useSession();
  const [data, setData] = useState<StripData | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [watchRes, holdRes, savedRes] = await Promise.allSettled([
        fetch('/api/watchlist').then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
        fetch('/api/dashboard/holdings').then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
        fetch('/api/saved-reports').then((r) => (r.ok ? r.json() : Promise.reject(r.status))),
      ]);
      if (cancelled) return;
      const watch = watchRes.status === 'fulfilled' && Array.isArray(watchRes.value) ? (watchRes.value as StripWatchItem[]) : null;
      const holdings = holdRes.status === 'fulfilled' && Array.isArray(holdRes.value?.holdings) ? (holdRes.value.holdings as StripHolding[]) : null;
      const saved = savedRes.status === 'fulfilled' ? savedRes.value as { stock?: unknown[]; portfolio?: unknown[] } : null;
      setData({
        watch,
        dashboard: holdings ? summarizeDashboard(holdings) : null,
        savedToday: saved ? (saved.stock?.length ?? 0) + (saved.portfolio?.length ?? 0) : null,
      });
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (sessionLoading || !user) return null; // 비로그인은 렌더링 없음

  const movers = data?.watch ? topWatchMovers(data.watch, 5) : [];
  const dash = data?.dashboard ?? null;

  return (
    <section id="personal-strip" aria-label="내 정보 요약" className="max-w-[1400px] mx-auto px-6 pt-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* ① 내 관심종목 */}
        <div className={CARD} data-testid="strip-watchlist">
          <div className="flex items-center justify-between">
            <span className={LABEL}><Star className="w-3 h-3 text-amber-400" />내 관심종목</span>
            {data?.watch && data.watch.length > 0 && <span className="text-[11px] text-slate-500">등락률 상위</span>}
          </div>
          {!data ? (
            <div className="flex gap-2 mt-2 animate-pulse">{[0, 1, 2].map((i) => <div key={i} className="h-6 w-20 rounded-full bg-slate-800" />)}</div>
          ) : data.watch === null ? (
            <p className="text-xs text-slate-500 mt-2">관심종목을 불러오지 못했습니다</p>
          ) : movers.length === 0 ? (
            <p className="text-xs text-slate-500 mt-2">관심기업을 등록해보세요 <span className="text-slate-600">— 로그인 아이콘 › 관심기업</span></p>
          ) : (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {movers.map((w) => (
                <Link key={w.ticker} href={stockHref(w)} className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs hover:border-blue-500 transition-colors">
                  <span className="font-semibold text-slate-100 truncate max-w-[7rem]">{w.name}</span>
                  <span className={`font-mono font-bold ${colorFor(w.changeRate)}`}>{pct(w.changeRate)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* ② 내 대시보드 */}
        <Link href="/dashboard" className={`${CARD} hover:border-blue-500/60 transition-colors`} data-testid="strip-dashboard">
          <span className={LABEL}><LayoutDashboard className="w-3 h-3 text-indigo-400" />내 대시보드</span>
          {!data ? (
            <div className="h-6 w-40 rounded bg-slate-800 animate-pulse mt-2" />
          ) : dash === null ? (
            <p className="text-xs text-slate-500 mt-2">대시보드를 불러오지 못했습니다</p>
          ) : dash.count === 0 ? (
            <p className="text-xs text-slate-500 mt-2">보유 종목을 등록하면 손익을 추적해드려요 →</p>
          ) : (
            <div className="flex items-baseline gap-3 mt-2">
              <span className="text-sm text-slate-200">보유 <b className="text-white">{dash.count}</b>종목</span>
              <span className="text-xs text-slate-500">오늘 평가</span>
              {dash.todayChangePct == null
                ? <span className="text-xs text-slate-500">시세 없음</span>
                : <span className={`font-mono text-sm font-bold ${colorFor(dash.todayChangePct)}`}>{pct(dash.todayChangePct)}</span>}
            </div>
          )}
        </Link>

        {/* ③ 바로가기 */}
        <div className={CARD} data-testid="strip-shortcuts">
          <span className={LABEL}>바로가기</span>
          <div className="flex gap-2 mt-2">
            <Link href="/diagnosis" className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-blue-500 transition-colors">
              <Bookmark className="w-3.5 h-3.5 text-emerald-400" />
              저장내역{data?.savedToday != null && <span className="text-slate-400">(오늘 {data.savedToday}건)</span>}
            </Link>
            <Link href="/portfolio-diagnosis" className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors">
              <PieChart className="w-3.5 h-3.5" />
              포트폴리오 분석
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
