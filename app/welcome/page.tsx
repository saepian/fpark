'use client';

// 회원가입 직후 신규 유저에게 한 번만 보여주는 서비스 소개 페이지.
// 노출 여부(users.has_seen_welcome)는 lib/post-auth-redirect.ts가 판단해서 여기로
// 보낸다 — 이 페이지 자신은 방문 시점에 "이미 봤음" 마커만 갱신한다.
//
// 탭(FREE/BASIC/PRO) = 그 플랜의 기능을 전부 담은 하나의 통합 소개 섹션.
// 기업 분석 미리보기만 실제 components/diagnosis/DiagnosisReport를 샘플 데이터로
// 축소 렌더링한 "실시간 화면"이고, 나머지는 실제 문구·구조를 재현한 예시(비실시간).

import { Suspense, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase-browser';
import { sanitizeRedirect } from '@/lib/auth-redirect';
import { PLAN_USAGE_LIMITS } from '@/lib/payment-constants';
import DiagnosisReport, { type DiagnosisResult } from '@/components/diagnosis/DiagnosisReport';

type PlanType = 'free' | 'basic' | 'pro';

const TABS: { type: PlanType; label: string }[] = [
  { type: 'free', label: 'FREE' },
  { type: 'basic', label: 'BASIC' },
  { type: 'pro', label: 'PRO' },
];

// ── 미리보기 컴포넌트들 ──────────────────────────────────────────────────────

const SAMPLE_DIAGNOSIS: DiagnosisResult = {
  summary: '최근 한 달간 외국인·기관의 순매수가 이어지며 주가가 상승 흐름을 보이고 있습니다. 반도체 업황 개선 기대감이 반영된 뉴스가 다수 확인됩니다.',
  currentPrice: 75000,
  avgPrice: 68000,
  quantity: 10,
  profitRate: 10.29,
  profitAmount: 70000,
  news: [
    { title: '삼성전자, 차세대 메모리 신규 라인 투자 발표', description: '반도체 업황 회복 기대감이 커지는 가운데 대규모 설비 투자 계획이 공개됐다.' },
    { title: '외국인 3거래일 연속 순매수, 반도체株 강세', description: '외국인 투자자들의 자금 유입이 이어지며 관련주 전반이 강세를 보였다.' },
  ],
  newsBasis: 'news',
  institutionalFlow: '최근 5거래일간 기관은 순매수 기조를 유지하고 있습니다.',
  foreignFlow: '외국인은 최근 3거래일 연속 순매수를 기록했습니다.',
  reasons: [
    '반도체 업황 개선 기대감으로 관련 뉴스 노출 증가',
    '외국인·기관 동반 순매수 흐름 관찰',
    '거래량이 20일 평균 대비 확대',
  ],
  technicalAnalysis: [
    '20일 이동평균선을 상회하며 단기 상승 흐름 유지 중',
    'RSI 지표는 과열권 진입 전 구간에 위치',
  ],
  resistance: 82000,
  support: 61000,
  riskFactors: [
    '글로벌 반도체 수요 둔화 시 변동성 확대 가능',
    '단기 급등에 따른 차익 실현 매물 관찰 필요',
  ],
  opportunityFactors: [
    '반도체 업황 회복 사이클 초입 관측',
    '외국인 수급 개선 흐름 지속 중',
  ],
  flowType: 'BUY',
  flowPercentage: 68,
};

// 실제 리포트 컴포넌트를 그대로 축소 렌더링(썸네일 용도라 세부 수치는 작게 보임) —
// 진짜 실시간 화면이라는 게 핵심이라 "예시 화면" 캡션을 붙이지 않는다.
function DiagnosisThumb() {
  return (
    <div className="pointer-events-none origin-top-left" style={{ transform: 'scale(0.4)', width: '250%' }}>
      <DiagnosisReport
        result={SAMPLE_DIAGNOSIS}
        stockName="삼성전자"
        ticker="005930"
        generatedAt="2026-07-10 09:00"
        actions={false}
        showBackground={false}
      />
    </div>
  );
}

// 실제 결과화면(app/portfolio-diagnosis/page.tsx)이 export 안 된 로컬 함수로만 있어
// 재사용이 불가능함 — 앱 톤에 맞춘 정적 예시.
function PortfolioThumb() {
  const holdings = [
    { name: '삼성전자', weight: 42 },
    { name: 'SK하이닉스', weight: 31 },
  ];
  return (
    <div className="p-3.5 flex flex-col gap-2.5 h-full">
      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">포트폴리오 리스크 체크</p>
      <div className="flex flex-col gap-2">
        {holdings.map(h => (
          <div key={h.name}>
            <div className="flex justify-between text-[10.5px] text-slate-300 mb-0.5">
              <span>{h.name}</span>
              <span className="font-mono text-slate-400">{h.weight}%</span>
            </div>
            <div className="h-1 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full bg-violet-500/70" style={{ width: `${h.weight}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-auto flex items-start gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-2 py-1.5">
        <span className="text-amber-400 text-[10px]">⚠</span>
        <p className="text-[10px] text-amber-200/90 leading-snug">반도체 섹터 비중 73%로 쏠림 관찰</p>
      </div>
    </div>
  );
}

// 표시 형태는 components/layout/NotificationBell.tsx, 문구 포맷은
// app/api/cron/stock-alerts/route.ts의 실제 알림 메시지 형식을 그대로 따른 정적 예시.
function AlertThumb() {
  const items = [
    { icon: '▲', color: 'text-red-400', text: '[삼성전자] +10% 상승', sub: '현재가 75,000원' },
    { icon: '●', color: 'text-sky-400', text: '[SK하이닉스] 수급 알림', sub: '외국인 자금 1,200억 유입' },
  ];
  return (
    <div className="p-3.5 flex flex-col gap-2 h-full">
      <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">관심기업 알림</p>
      {items.map((it, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md bg-slate-800/40 px-2.5 py-2">
          <span className={`text-[11px] ${it.color} shrink-0`}>{it.icon}</span>
          <div className="min-w-0">
            <p className="text-[10.5px] text-slate-200 truncate">{it.text}</p>
            <p className="text-[9.5px] text-slate-500 truncate">{it.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// 실제 이메일은 app/api/cron/daily-alert-email/route.ts의 buildEmailHtml()이 만드는
// HTML 문자열이라 React 컴포넌트로 직접 삽입 불가 — 실제 섹션 구성을 재현한 정적 예시.
function EmailThumb() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-700/40 bg-slate-800/40 shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400/70" />
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400/70" />
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/70" />
        <p className="ml-1.5 text-[9px] text-slate-500 truncate">[Finance Park] 일일 리포트</p>
      </div>
      <div className="p-3 flex flex-col gap-2">
        <div className="flex gap-1.5 text-[9.5px]">
          <span className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 font-semibold">상승 3</span>
          <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-semibold">하락 1</span>
        </div>
        <div className="rounded-md border border-indigo-500/20 bg-indigo-500/[0.05] p-2">
          <p className="text-[9px] font-bold text-indigo-400 mb-0.5">AI 분석</p>
          <p className="text-[9.5px] text-slate-400 leading-snug line-clamp-2">
            오늘 관심종목 중 반도체 관련주가 외국인 순매수에 힘입어 강세를 보였습니다.
          </p>
        </div>
      </div>
    </div>
  );
}

function PreviewThumb({ children, isLive }: { children: ReactNode; isLive?: boolean }) {
  return (
    <div className="relative w-full sm:w-[270px] h-[190px] rounded-xl border border-slate-700/50 bg-[#0d0f1a] overflow-hidden shrink-0">
      {children}
      <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#0d0f1a] to-transparent pointer-events-none" />
      {!isLive && (
        <span className="absolute bottom-1.5 right-2 text-[8.5px] font-medium text-slate-600 bg-[#0d0f1a]/80 px-1.5 py-0.5 rounded">
          예시 화면
        </span>
      )}
    </div>
  );
}

function Badge({ type }: { type: 'BASIC' | 'PRO' }) {
  return (
    <span
      className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
        type === 'PRO'
          ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
          : 'bg-violet-500/15 text-violet-400 border-violet-500/30'
      }`}
    >
      {type}
    </span>
  );
}

// ── 탭별 카피 ────────────────────────────────────────────────────────────────

interface FeatureCopy {
  key: string;
  title: string;
  badge?: 'BASIC' | 'PRO';
  desc: string;
  caption?: string;
  preview: ReactNode;
  isLive: boolean;
}

interface TabCopy {
  intro: string;
  features: FeatureCopy[];
  closingNote?: string;
  transition?: string;
}

const TAB_COPY: Record<PlanType, TabCopy> = {
  free: {
    intro: 'FREE 플랜은 가볍게 시장을 훑어보고, 관심 가는 종목을 한두 개 가볍게 확인해보고 싶은 분께 맞는 구성이에요. 매일 정해진 만큼 기업 분석을 무료로 체험해보실 수 있어요.',
    features: [
      {
        key: 'diagnosis',
        title: '기업 분석',
        desc: '궁금한 종목명이나 종목코드를 검색하면, AI가 최근 뉴스 흐름과 주가 등락, 외국인·기관의 매매 동향을 한 번에 정리해서 리포트로 보여드려요. 예를 들어 삼성전자를 검색하면 최근 한 달간 어떤 뉴스가 있었는지, 외국인이 사고 있는지 팔고 있는지, 주가가 왜 이렇게 움직였는지를 하나하나 따로 찾아보지 않아도 한 화면에서 파악할 수 있어요.',
        caption: `FREE는 하루 ${PLAN_USAGE_LIMITS.free.diagnosis}회까지 무료로 이용할 수 있어요`,
        preview: <DiagnosisThumb />,
        isLive: true,
      },
    ],
    closingNote: '이 외에도 뉴스·시장 데이터는 무제한으로 보실 수 있고, 관심종목은 워치리스트에 자유롭게 등록해두실 수 있어요.',
    transition: '매일 여러 종목을 살펴보고, 보유 종목 전체를 한 번에 점검해보고 싶으시다면 BASIC 플랜부터는 하루 이용 횟수가 늘어나고 포트폴리오 분석도 가능해져요.',
  },
  basic: {
    intro: 'BASIC 플랜은 매일 몇 개 종목을 꾸준히 살펴보고, 보유한 여러 종목을 포트폴리오 관점에서 점검해보고 싶은 분께 맞는 구성이에요.',
    features: [
      {
        key: 'diagnosis',
        title: '기업 분석',
        desc: 'FREE와 같은 방식으로, 궁금한 종목을 검색하면 AI가 뉴스·수급·주가 흐름을 종합해 리포트로 정리해드려요. BASIC 플랜에서는 하루 6개 종목까지 분석해볼 수 있어서, 관심 있는 여러 종목을 매일 꾸준히 확인하기에 넉넉해요.',
        caption: `하루 ${PLAN_USAGE_LIMITS.basic.diagnosis}회`,
        preview: <DiagnosisThumb />,
        isLive: true,
      },
      {
        key: 'portfolio',
        title: '포트폴리오 분석',
        badge: 'BASIC',
        desc: '보유하고 있는 여러 종목을 한 번에 입력하면, 특정 섹터에 비중이 지나치게 쏠려있진 않은지, 전체적으로 어떤 리스크 요인이 있는지 AI가 종합해서 짚어드려요. 예를 들어 반도체 관련주를 여러 개 보유하고 있다면, 특정 산업에 비중이 쏠려 있다는 점을 알려드리고 그게 왜 리스크가 될 수 있는지도 함께 설명해드려요.',
        caption: `월 ${PLAN_USAGE_LIMITS.basic.portfolio}회`,
        preview: <PortfolioThumb />,
        isLive: false,
      },
    ],
    transition: '매일 더 많은 종목을 분석하고 포트폴리오도 더 자주 점검하고 싶다면, 그리고 중요한 변화를 직접 확인하지 않아도 자동으로 받아보고 싶다면 PRO 플랜이 잘 맞아요. PRO부터는 이용 횟수가 크게 늘어나고, 알림과 이메일 리포트까지 함께 이용할 수 있어요.',
  },
  pro: {
    intro: 'PRO 플랜은 여러 종목을 포트폴리오 단위로 꾸준히 관리하면서, 중요한 변화를 놓치지 않고 싶은 분께 맞는 구성이에요. 기업 분석과 포트폴리오 분석을 가장 넓은 횟수로 이용할 수 있고, 여기에 알림과 이메일 리포트까지 더해집니다. 그래서 매번 직접 앱을 열어 확인하지 않아도, 중요한 변화가 생기면 자동으로 소식을 받아보실 수 있어요.',
    features: [
      {
        key: 'diagnosis',
        title: '기업 분석',
        desc: 'PRO 플랜에서는 하루 11개 종목까지 분석할 수 있어서, 관심 있는 종목을 폭넓게 다뤄볼 수 있어요.',
        caption: `하루 ${PLAN_USAGE_LIMITS.pro.diagnosis}회`,
        preview: <DiagnosisThumb />,
        isLive: true,
      },
      {
        key: 'portfolio',
        title: '포트폴리오 분석',
        badge: 'BASIC',
        desc: '월 20회까지 이용할 수 있어서, 포트폴리오 구성이 바뀔 때마다 부담 없이 다시 점검해볼 수 있어요.',
        caption: `월 ${PLAN_USAGE_LIMITS.pro.portfolio}회`,
        preview: <PortfolioThumb />,
        isLive: false,
      },
      {
        key: 'alert',
        title: '관심기업 알림',
        badge: 'PRO',
        desc: '관심 등록해둔 종목을 매번 들여다보지 않아도, 주가가 ±5%·±10%·±20%·±30%처럼 크게 움직이거나 외국인·기관 자금이 1,000억 원 이상 크게 들어오고 나갈 때 바로 알려드려요. 예를 들어 보유 중인 종목이 장중 10% 급등하면, 화면 상단 알림으로 바로 확인하실 수 있어요. 종목 창을 계속 켜두고 지켜보지 않아도 중요한 순간을 놓치지 않을 수 있는 거예요.',
        preview: <AlertThumb />,
        isLive: false,
      },
      {
        key: 'email',
        title: '관심기업 일일 리포트 이메일',
        badge: 'PRO',
        desc: '매일 아침, 관심 등록한 종목들의 전날 등락 현황과 AI가 정리한 코멘트, 그날 발생한 알림 내역까지 한 번에 정리해서 이메일로 보내드려요. 앱을 따로 켜지 않아도 아침에 메일함만 확인하면 관심종목 상황을 파악할 수 있어요.',
        preview: <EmailThumb />,
        isLive: false,
      },
    ],
  },
};

// ── 섹션 렌더링 ──────────────────────────────────────────────────────────────

function FeatureRow({ feature }: { feature: FeatureCopy }) {
  return (
    <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 py-6 border-t border-slate-700/30 first:border-t-0 first:pt-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-[14px] font-bold text-white">{feature.title}</p>
          {feature.badge && <Badge type={feature.badge} />}
        </div>
        <p className="text-[13px] text-slate-300 leading-relaxed">{feature.desc}</p>
        {feature.caption && <p className="text-[11px] text-slate-500 mt-2">{feature.caption}</p>}
      </div>
      <PreviewThumb isLive={feature.isLive}>{feature.preview}</PreviewThumb>
    </div>
  );
}

function TabSection({ tab }: { tab: PlanType }) {
  const copy = TAB_COPY[tab];
  return (
    <div
      className="rounded-2xl border border-indigo-500/20 overflow-hidden"
      style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #13161f 100%)' }}
    >
      <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500" />
      <div className="p-6 sm:p-8">
        <p className="text-[13.5px] text-slate-300 leading-relaxed">{copy.intro}</p>
        <div className="flex flex-col mt-2">
          {copy.features.map(f => <FeatureRow key={f.key} feature={f} />)}
        </div>
        {copy.closingNote && (
          <p className="text-[12px] text-slate-500 leading-relaxed mt-2 pt-6 border-t border-slate-700/30">
            {copy.closingNote}
          </p>
        )}
        {copy.transition && (
          <p className="text-[13px] text-indigo-300/90 leading-relaxed mt-6 pt-6 border-t border-slate-700/30">
            {copy.transition}
          </p>
        )}
      </div>
    </div>
  );
}

// ── 메인 ────────────────────────────────────────────────────────────────────

function WelcomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = sanitizeRedirect(searchParams.get('next'));

  const [activeTab, setActiveTab] = useState<PlanType>('free');

  // 비로그인 방문자도 볼 수 있다(챗봇 위 작은 링크로 누구나 들어올 수 있음) —
  // 로그인 유저일 때만 "이미 봤음" 마커를 갱신한다.
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      fetch('/api/welcome', { method: 'POST' }).catch(() => {});
    })();
  }, []);

  const handleSkip = () => router.push(next);

  return (
    <div className="max-w-3xl mx-auto px-4 py-16">

      {/* 히어로 */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-[11px] text-indigo-400 font-semibold tracking-wide mb-6">
          <Sparkles className="w-3 h-3" />
          Finance Park 가입을 환영합니다
        </div>
        <h1 className="text-3xl md:text-4xl font-black text-white mb-4 leading-tight">
          fpark에서<br />
          <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-sky-400 bg-clip-text text-transparent">
            이런 걸 할 수 있어요
          </span>
        </h1>
        <p className="text-slate-400 text-[14px] leading-relaxed">
          AI가 분석하는 실시간 시장 데이터로, 스스로 판단할 수 있도록 돕습니다
        </p>
      </div>

      {/* 플랜 탭 */}
      <div className="flex justify-center mb-8">
        <div
          className="inline-flex items-center gap-1 rounded-full p-1"
          style={{ background: 'rgba(15,17,23,0.7)', border: '1px solid rgba(51,65,85,0.6)' }}
        >
          {TABS.map(t => (
            <button
              key={t.type}
              onClick={() => setActiveTab(t.type)}
              className={`px-6 py-2 rounded-full text-[13px] font-bold tracking-wide transition-all cursor-pointer ${
                activeTab === t.type ? 'bg-white text-slate-900 shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 = 통합 소개 섹션 */}
      <div className="mb-10">
        <TabSection key={activeTab} tab={activeTab} />
      </div>

      {/* CTA */}
      <div className="text-center flex flex-col items-center gap-4">
        <Link href="/pricing" className="text-[13px] text-indigo-400 hover:underline">
          요금제 자세히 보기 →
        </Link>
        <button
          onClick={handleSkip}
          className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-[14px] text-white transition-all hover:opacity-90 cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #0ea5e9 50%, #10b981 100%)' }}
        >
          건너뛰고 시작하기 →
        </button>
      </div>

    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomeContent />
    </Suspense>
  );
}
