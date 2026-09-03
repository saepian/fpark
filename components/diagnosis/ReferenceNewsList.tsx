// "참고 기사" 목록 — 기업분석 메인(DiagnosisReport.tsx)과 공유 페이지(app/share/[id]/page.tsx)
// 공용(2026-09-01). 예전엔 메인만 newsIssueClusters로 이슈별 묶음을 그렸고 공유 페이지는
// 평면 목록이라 드리프트가 있었다. 또 메인은 묶음 안에서 원본 배열 인덱스(i+1)를 번호로
// 찍어 "2, 4, 3, 5, 1"처럼 뒤섞여 보였다 — 본문이 기사 번호를 인용하지 않으므로(프롬프트에
// 인용 지시 없음) 번호는 순수 표시용이며, 화면에 보이는 순서대로 1부터 다시 매긴다.
// 순수 프레젠테이션 컴포넌트(훅 없음)라 서버/클라이언트 양쪽에서 import 가능.
import { SECTION_TITLE_CLASS } from '@/lib/ui-constants';

export interface ReferenceNewsItem { title: string; url?: string }
export interface NewsIssueCluster { label: string; articleIndexes: number[] }

// 클러스터가 없으면 null(호출부가 평면 목록으로 폴백). 모델이 일부 기사를 어느 클러스터에도
// 안 넣었을 수 있어 남은 인덱스는 "기타" 묶음으로 보완한다.
export function buildNewsGroups(
  news: ReferenceNewsItem[],
  clusters?: NewsIssueCluster[] | null,
): { label: string; indexes: number[] }[] | null {
  if (!clusters || clusters.length === 0) return null;
  const covered = new Set<number>();
  const groups = clusters.map((c) => {
    const indexes = c.articleIndexes.filter((i) => i >= 0 && i < news.length && !covered.has(i));
    indexes.forEach((i) => covered.add(i));
    return { label: c.label, indexes };
  }).filter((g) => g.indexes.length > 0);
  if (groups.length === 0) return null;
  const leftover = news.map((_, i) => i).filter((i) => !covered.has(i));
  if (leftover.length > 0) groups.push({ label: '기타', indexes: leftover });
  return groups;
}

function hrefOf(n: ReferenceNewsItem): string {
  return n.url || `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(n.title)}`;
}

function Row({ n, no }: { n: ReferenceNewsItem; no: number }) {
  return (
    <a href={hrefOf(n)} target="_blank" rel="noopener noreferrer"
      className="py-2 first:pt-0 last:pb-0 group cursor-pointer flex items-center gap-2.5">
      <span className="text-[11px] font-bold text-slate-600 shrink-0 w-4">{no}</span>
      <p className="text-[13px] text-slate-300 leading-snug group-hover:text-indigo-300 group-hover:underline transition-colors">{n.title}</p>
    </a>
  );
}

export default function ReferenceNewsList({
  news,
  clusters,
  newsBasis,
  pending = false,
  className = '',
}: {
  news: ReferenceNewsItem[];
  clusters?: NewsIssueCluster[] | null;
  newsBasis?: 'news' | 'estimated';
  // 2026-09-03 로딩속도 후속 3번: 기업분석 Stage0(서버 계산 카드)이 뉴스 선별(Haiku)보다 먼저
  // 도착하므로, 선별 결과가 올 때까지 "없음"이 아니라 "선별 중"으로 보여준다(배지도 잠시 숨김).
  pending?: boolean;
  className?: string;
}) {
  const groups = buildNewsGroups(news, clusters);
  const waiting = pending && news.length === 0;
  let no = 0; // 화면 표시 순서대로 1부터
  return (
    <div className={`bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <p className={`${SECTION_TITLE_CLASS} text-slate-500 uppercase tracking-widest`}>참고 기사</p>
        {waiting ? null : newsBasis === 'news' ? (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">📰 뉴스 기반 분석</span>
        ) : newsBasis === 'estimated' ? (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-700/40 text-slate-400 border border-slate-600/40">🔍 수급·기술적 추정</span>
        ) : null}
      </div>
      {waiting ? (
        <div className="space-y-1.5 animate-pulse">
          <p className="text-xs text-slate-500">관련 뉴스를 선별하는 중입니다...</p>
          <div className="h-3 rounded bg-slate-700/40 w-full" />
          <div className="h-3 rounded bg-slate-700/40 w-3/5" />
        </div>
      ) : news.length === 0 ? (
        <p className="text-xs text-slate-500 leading-relaxed">관련도 높은 뉴스가 확인되지 않아, 수급·기술적 지표를 근거로 분석했습니다.</p>
      ) : groups ? (
        <div className="flex flex-col gap-3">
          {groups.map((g, gi) => (
            <div key={gi}>
              <p className="text-[11px] font-bold text-indigo-300/90 mb-1.5">{g.label !== '기타' && '🔖 '}{g.label}</p>
              <div className="flex flex-col divide-y divide-slate-700/40">
                {g.indexes.map((i) => <Row key={i} n={news[i]} no={++no} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-slate-700/40">
          {news.map((n, i) => <Row key={i} n={n} no={i + 1} />)}
        </div>
      )}
    </div>
  );
}
