'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'motion/react';
import {
  Sparkles, TrendingUp, Newspaper, BarChart3, ShieldAlert,
  ArrowRight, Check, Minus,
} from 'lucide-react';
import { PLAN_AMOUNTS } from '@/lib/payment-constants';
import { INVESTMENT_DISCLAIMER } from '@/lib/ai-compliance';
import DiagnosisReport, { type DiagnosisResult } from '@/components/diagnosis/DiagnosisReport';

// 파티클 배경은 캔버스 애니메이션이라 초기 렌더링에서 제외 (lazy)
const PageBackground = dynamic(() => import('@/components/layout/PageBackground'), { ssr: false });

// ── 공용 애니메이션 래퍼 ────────────────────────────────────────────────────

function Reveal({
  children, delay = 0, className = '',
}: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.55, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function CountUp({
  to, duration = 1.1, suffix = '', decimals = 0, className = '', as = 'span', comma = false,
}: {
  to: number; duration?: number; suffix?: string; decimals?: number; className?: string;
  as?: 'span' | 'tspan'; comma?: boolean;
}) {
  // SVG <text> 안에서 쓸 때는 HTML <span>이 아니라 <tspan>이어야 함
  // (그렇지 않으면 잘못된 태그 중첩으로 하이드레이션 불일치 발생)
  const Tag = as;
  const ref = useRef<HTMLSpanElement & SVGTSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const [val, setVal] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    let raf: number;
    const tick = (now: number) => {
      const p = Math.min((now - start) / (duration * 1000), 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(to * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, to, duration]);

  const display = comma
    ? Number(val.toFixed(decimals)).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : val.toFixed(decimals);

  return <Tag ref={ref} className={className}>{display}{suffix}</Tag>;
}

// 실제 /diagnosis 리포트에서 나온 삼성전자 진단 결과를 그대로 예시 데이터로 사용
// (app/diagnosis/page.tsx와 동일한 DiagnosisReport 컴포넌트를 공유하므로,
//  리포트 UI가 바뀌면 이 예시 카드도 자동으로 최신 상태를 따라간다)
const SAMPLE_DIAGNOSIS: DiagnosisResult = {
  summary: '삼성전자는 현재 92일 보유 기간 동안 +316.43%의 수익률이 관찰되는 가운데, 금일 -7.31%의 급락이 나타났습니다. 최근 5영업일 동안 외국인이 총 8만4,433억원 규모의 순유출을 지속하고 있으며, 같은 기간 개인이 대규모 순유입으로 대응하는 패턴이 관찰됩니다. 이는 대형 자금의 차익 실현 흐름과 개인 자금의 반대 방향 대응이 교차하는 구간에서 자주 관찰되는 수급 구조라는 특징이 있습니다. 같은 기간 KOSPI는 +26.43% 상승에 그쳐, 이 기업이 시장 대비 약 +290%p 더 상승한 점이 관찰됩니다.',
  currentPrice: 291500,
  avgPrice: 70000,
  quantity: 10,
  profitRate: 316.43,
  profitAmount: 2215000,
  news: [
    {
      title: '[특징주] 삼성전자, 급반등해 3%대 상승 마감…하닉은 0.8%↑(종합)',
      description: '삼성전자가 30일 3% 가까이 상승하며 정규장 거래를 마무리했다. 하닉 등 관련주도 소폭 상승세를 보였다.',
      url: 'https://www.yna.co.kr/view/AKR20260630040451008',
    },
  ],
  newsBasis: 'news',
  institutionalFlow: '기관은 최근 5영업일 중 6월 25일(+12,226억원)과 6월 29일(+8,010억원), 6월 30일(+9,093억원)에 순유입을 기록했으나, 6월 26일(-12,094억원)과 7월 1일(-5,854억원)에는 순유출로 전환하는 등 방향성이 혼재된 흐름이 관찰됩니다. 5영업일 누적 기준으로는 약 +11,531억원의 소폭 순유입 기조가 관찰됩니다.',
  foreignFlow: '외국인은 최근 5영업일 동안 단 하루도 순유입이 없는 연속 순유출 흐름이 관찰되며, 누적 순유출 규모는 약 -84,433억원에 달합니다. 특히 6월 29일 하루에만 -38,498억원의 집중 유출이 관찰된 점은 글로벌 매크로 환경 변화 또는 차익 실현 목적의 대규모 이탈로 시장 참여자들이 해석하는 경우가 많은 패턴이라는 특징이 있습니다.',
  reasons: [
    '금일 -7.31% 급락의 직접적인 뉴스 근거는 제공된 기사에서 확인되지 않으며, 6월 30일 기사에서는 오히려 삼성전자가 3%대 급반등을 기록했다는 사실이 관찰됩니다.',
    '최근 5영업일 외국인 순유출 누적액이 약 8만4,433억원에 달하며, 특히 6월 29일 하루에만 -38,498억원의 대규모 이탈이 관찰됩니다.',
    '현재 PER 44.4배, PBR 4.55배로, EPS 6,564원 대비 현재가 291,500원 수준의 밸류에이션이 형성되어 있다는 점이 관찰됩니다.',
  ],
  technicalAnalysis: [
    '현재가 291,500원은 52주 저가 59,800원과 고가 374,500원 사이의 74% 구간에 위치해 있습니다.',
    '금일 거래량은 25,075,902주로 관찰되며, -7.31%의 급락과 함께 대량 거래가 동반된 점이 관찰됩니다.',
  ],
  resistance: 374500,
  support: 59800,
  benchmark: {
    indexName: 'KOSPI',
    indexChangeRate: 26.43,
    stockProfitRate: 316.43,
    fromDate: '2026-04-20',
    toDate: '2026-07-02',
  },
  riskFactors: [
    '외국인이 최근 5영업일 누적 -84,433억원의 대규모 순유출을 지속하고 있으며, 이 추세가 이어질 경우 추가적인 수급 압력이 관찰될 수 있습니다.',
    'PER 44.4배, PBR 4.55배 수준은 반도체 업종 평균 대비 높은 밸류에이션 구간으로 관찰됩니다.',
    '금일 -7.31% 급락의 명확한 뉴스 근거가 확인되지 않아, 시장 불확실성 또는 외부 매크로 변수에 의한 변동성 확대 가능성이 관찰 포인트로 남아 있습니다.',
  ],
  opportunityFactors: [
    '6월 30일 뉴스 기준으로 삼성전자가 3%대 급반등을 기록하는 등 단기 반등 모멘텀이 관찰된 사례가 있습니다.',
    '보유 평균가 70,000원 대비 현재가 291,500원으로 +316.43%의 수익률이 누적되어 있으며, 같은 기간 KOSPI 상승률(+26.43%) 대비 약 +290%p의 초과 수익이 관찰됩니다.',
    '52주 저가 59,800원 대비 현재 수준은 충분한 상승 폭이 누적된 구간으로, 개인이 최근 5영업일 누적 대규모 순유입으로 대응하고 있다는 점이 관찰됩니다.',
  ],
  flowType: 'SELL',
  flowPercentage: 89,
  shortTermOutlook: '단기적으로는 52주 고점인 374,500원이 주요 저항선으로 관찰되며, 외국인 순유출 지속 여부와 개인 유입세의 규모가 단기 방향성을 가늠하는 관찰 포인트로 작용할 수 있습니다.',
  midTermOutlook: '중기적으로는 반도체 업황 회복 속도와 외국인 수급 방향 전환 여부가 주요 변수로 관찰되며, 현재 PER 44.4배 수준의 밸류에이션이 실적 개선으로 정당화되는지 여부가 주가 방향성에 영향을 미치는 요인으로 언급됩니다.',
};

// ── 데이터 ──────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: TrendingUp, color: 'text-indigo-400', bg: 'bg-indigo-500/10 border-indigo-500/25',
    title: '실시간 수급 분석',
    desc: '외국인·기관·개인의 순유입·순유출 흐름을 관찰해 수급 방향을 한눈에 정리해드립니다.',
  },
  {
    icon: Newspaper, color: 'text-sky-400', bg: 'bg-sky-500/10 border-sky-500/25',
    title: '뉴스 자동 매칭',
    desc: '급등락이 발생하면 관련도 높은 실제 뉴스를 자동으로 연결해 원인을 설명해드립니다.',
  },
  {
    icon: BarChart3, color: 'text-violet-400', bg: 'bg-violet-500/10 border-violet-500/25',
    title: 'KOSPI/KOSDAQ 벤치마크 비교',
    desc: '내 기업·포트폴리오 수익률과 같은 기간 시장 지수 등락률을 사실 그대로 비교합니다.',
  },
  {
    icon: ShieldAlert, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/25',
    title: '리스크 관찰 지표',
    desc: '52주 신고가·신저가, 최대낙폭(MDD) 등 위험을 가늠할 수 있는 지표를 함께 제공합니다.',
  },
];

// 정가/얼리버드 표시는 app/pricing/PricingClient.tsx의 실제 프로모션과 반드시 동일하게 유지
// (해당 파일에 별도 상수가 없어 하드코딩 — 프로모션 변경 시 두 곳 함께 수정 필요)
const LANDING_PLANS = [
  {
    type: 'basic' as const, name: 'BASIC', price: PLAN_AMOUNTS.basic.monthly, originalPrice: null,
    desc: '더 많은 분석이 필요한 이용자를 위한 플랜',
    features: ['기업 분석 매일 6회', '포트폴리오 분석 월 1회', 'AI 분석 리포트 저장', '뉴스/시장 데이터 무제한'],
    highlight: false,
  },
  {
    type: 'pro' as const, name: 'PRO', price: PLAN_AMOUNTS.pro.monthly, originalPrice: 29900,
    desc: '전문적인 포트폴리오 관리가 필요한 이용자',
    features: ['기업 분석 매일 11회', '포트폴리오 분석 월 20회', '관심기업 주가·수급 알림', '우선순위 분석 처리'],
    highlight: true,
  },
];

// ── 페이지 ──────────────────────────────────────────────────────────────────

export default function AiPortfolioLandingPage() {
  return (
    <div className="overflow-x-hidden">

      {/* ══ 1. 히어로 ══ */}
      <section className="relative">
        <PageBackground />
        <div className="max-w-4xl mx-auto px-4 pt-20 pb-24 md:pt-28 md:pb-32 text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-[11px] text-indigo-300 font-semibold tracking-wide mb-6 relative"
          >
            <Sparkles className="w-3 h-3" /> AI 기업 분석 · 무료로 시작
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08 }}
            className="text-3xl md:text-5xl font-black text-white leading-tight mb-5 relative break-keep"
          >
            내 포트폴리오, AI가 지금 <br className="hidden md:block" />
            무슨 일이 일어나고 있는지{' '}
            <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-pink-400 bg-clip-text text-transparent">
              알려드립니다
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.16 }}
            className="text-slate-400 text-[15px] md:text-lg mb-10 relative"
          >
            수급, 뉴스, 밸류에이션까지 — 기업당{' '}
            <span className="text-white font-bold"><CountUp to={3} />초</span>면 확인
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.24 }}
            className="relative"
          >
            <Link
              href="/auth/signup"
              className="group inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-white font-bold text-[16px]
                transition-all hover:scale-[1.03] active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #ec4899 100%)',
                boxShadow: '0 0 32px rgba(139,92,246,0.35)',
              }}
            >
              <Sparkles className="w-4 h-4" />
              무료로 AI 분석 받기
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <p className="mt-3 text-[12px] text-slate-500">신용카드 등록 없이 바로 시작</p>
          </motion.div>
        </div>
      </section>

      {/* ══ 2. 문제 제기 ══ */}
      <section className="max-w-5xl mx-auto px-4 py-16 md:py-24">
        <Reveal className="text-center mb-12">
          <h2 className="text-2xl md:text-[32px] font-bold text-white mb-3 leading-snug break-keep">
            오늘 왜 급락했는지, 뉴스만 봐도 <span className="text-red-400">모르겠다면?</span>
          </h2>
          <p className="text-slate-400 text-[14px] md:text-[15px]">HTS 숫자만 보고 있으면 놓치는 것들이 있습니다</p>
        </Reveal>

        <div className="grid md:grid-cols-2 gap-5">
          <Reveal className="rounded-2xl border border-slate-700/50 bg-[#1a1f2e] p-6 md:p-7">
            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest mb-5">기존 방식</p>
            <ul className="flex flex-col gap-3.5">
              {[
                '뉴스는 뉴스대로, HTS는 HTS대로 따로 확인',
                '외국인·기관 수급 숫자는 보이지만 해석은 직접',
                '내 수익률이 시장보다 나은지는 계산도 직접',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-[13.5px] text-slate-400">
                  <Minus className="w-4 h-4 text-slate-600 mt-0.5 shrink-0" /> {t}
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal
            delay={0.12}
            className="rounded-2xl border border-indigo-500/30 p-6 md:p-7 relative overflow-hidden"
          >
            <div
              className="absolute inset-0 -z-10"
              style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #171a2b 100%)' }}
            />
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-pink-500" />
            <p className="text-[11px] font-bold text-indigo-300 uppercase tracking-widest mb-5">FPARK</p>
            <ul className="flex flex-col gap-3.5">
              {[
                '급등락 원인을 관련도 높은 실제 뉴스로 자동 매칭',
                '수급 데이터를 관찰형 리포트로 정리해서 제공',
                'KOSPI/KOSDAQ 대비 내 수익률을 자동으로 비교',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2.5 text-[13.5px] text-slate-200">
                  <Check className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" /> {t}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </section>

      {/* ══ 3. 핵심 기능 ══ */}
      <section className="max-w-5xl mx-auto px-4 py-16 md:py-24">
        <Reveal className="text-center mb-12">
          <h2 className="text-2xl md:text-[32px] font-bold text-white break-keep">
            FPARK가 정리해드리는 것들
          </h2>
        </Reveal>

        <div className="grid sm:grid-cols-2 gap-5">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <Reveal key={f.title} delay={i * 0.08}>
                <div
                  className="h-full rounded-2xl border border-slate-700/50 bg-[#1a1f2e] p-6
                    transition-all duration-300 hover:-translate-y-1.5 hover:border-slate-600 hover:shadow-2xl"
                >
                  <div className={`w-11 h-11 rounded-xl border flex items-center justify-center mb-4 ${f.bg}`}>
                    <Icon className={`w-5 h-5 ${f.color}`} />
                  </div>
                  <p className="text-[15px] font-bold text-white mb-2">{f.title}</p>
                  <p className="text-[13px] text-slate-400 leading-relaxed">{f.desc}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ══ 4. 실제 화면 미리보기 ══ */}
      <section className="px-4 py-16 md:py-24">
        <Reveal className="text-center mb-10 max-w-4xl mx-auto">
          <h2 className="text-2xl md:text-[32px] font-bold text-white mb-3 break-keep">
            실제 서비스와 동일한 화면 구성입니다
          </h2>
          <p className="text-slate-400 text-[14px] md:text-[15px]">
            아래는 실제 기업 분석 리포트 컴포넌트에 예시 데이터(삼성전자)를 넣어 그대로 렌더링한 화면입니다
          </p>
        </Reveal>
        <Reveal delay={0.1} className="max-w-5xl mx-auto">
          {/* app/diagnosis/page.tsx와 동일한 DiagnosisReport 컴포넌트 — 목업이 아니라 실제 리포트 화면 그 자체 */}
          <div className="relative rounded-2xl border border-slate-700/50 overflow-hidden shadow-2xl bg-[#0f1117] max-h-[980px] md:max-h-[640px]">
            <DiagnosisReport
              result={SAMPLE_DIAGNOSIS}
              stockName="삼성전자"
              ticker="005930"
              generatedAt="2026. 7. 2. 오후 2:32:10"
              actions={false}
              showBackground={false}
            />
            {/* 하단 페이드 마스크 — 리포트가 이어진다는 것을 시각적으로 암시 */}
            <div className="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-[#0f1117] via-[#0f1117]/95 to-transparent pointer-events-none" />
          </div>
          <div className="text-center mt-6">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white font-semibold text-[14px]
                transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #ec4899 100%)',
                boxShadow: '0 0 24px rgba(139,92,246,0.3)',
              }}
            >
              <Sparkles className="w-4 h-4" />
              가입하고 전체 리포트 보기
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </Reveal>
      </section>

      {/* ══ 5. 가격 안내 ══ */}
      <section className="max-w-4xl mx-auto px-4 py-16 md:py-24">
        <Reveal className="text-center mb-12">
          <h2 className="text-2xl md:text-[32px] font-bold text-white mb-3 break-keep">요금제</h2>
          <p className="text-slate-400 text-[14px] md:text-[15px]">무료로 시작하고, 필요할 때 업그레이드하세요</p>
        </Reveal>

        <div className="grid md:grid-cols-2 gap-6">
          {LANDING_PLANS.map((p, i) => (
            <Reveal key={p.type} delay={i * 0.1}>
              <div
                className={`h-full rounded-2xl p-6 md:p-7 relative overflow-hidden ${
                  p.highlight ? 'border-2 border-transparent' : 'border border-slate-700/50 bg-[#1a1f2e]'
                }`}
                style={p.highlight ? {
                  background: 'linear-gradient(#13161f, #13161f) padding-box, linear-gradient(135deg, #4f46e5, #a855f7, #ec4899) border-box',
                } : undefined}
              >
                {p.highlight && (
                  <span className="absolute top-5 right-5 text-[10px] font-bold px-2.5 py-1 rounded-full text-white"
                    style={{ background: 'linear-gradient(135deg, #7c3aed, #ec4899)' }}
                  >
                    인기
                  </span>
                )}
                <p className={`text-[12px] font-bold uppercase tracking-widest mb-1 ${p.highlight ? 'text-violet-300' : 'text-slate-500'}`}>
                  {p.name}
                </p>
                <p className="text-[13px] text-slate-500 mb-4">{p.desc}</p>
                {p.originalPrice && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] text-slate-500 line-through">정가 {p.originalPrice.toLocaleString()}원</span>
                    <span
                      className="text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap text-[#0f1117]"
                      style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}
                    >
                      🎉 얼리버드
                    </span>
                  </div>
                )}
                <p className="mb-6">
                  <span className="text-3xl font-black text-white">₩{p.price.toLocaleString()}</span>
                  <span className="text-slate-500 text-[13px]"> / 월</span>
                </p>
                <ul className="flex flex-col gap-2.5 mb-7">
                  {p.features.map((t) => (
                    <li key={t} className="flex items-start gap-2 text-[13px] text-slate-300">
                      <Check className={`w-4 h-4 mt-0.5 shrink-0 ${p.highlight ? 'text-violet-400' : 'text-emerald-400'}`} /> {t}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/signup"
                  className={`block text-center py-3 rounded-xl text-[14px] font-semibold transition-all ${
                    p.highlight
                      ? 'text-white hover:opacity-90'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  }`}
                  style={p.highlight ? { background: 'linear-gradient(135deg, #4f46e5, #7c3aed, #ec4899)' } : undefined}
                >
                  가입하고 시작하기
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="text-center text-[12px] text-slate-500 mt-6 leading-relaxed">
          회원가입 자체는 무료이며, 가입 후 무료 플랜으로 기업 분석을 매일 이용할 수 있습니다.<br className="hidden md:block" />
          Basic·Pro는 별도 무료 체험 기간 없이 결제 즉시 이용이 시작되며 매월 자동 결제됩니다 ·{' '}
          <Link href="/pricing" className="text-indigo-400 hover:underline">전체 요금제 비교 보기</Link>
        </p>
      </section>

      {/* ══ 6. 최종 CTA ══ */}
      <section className="relative py-20 md:py-28 overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{ background: 'radial-gradient(ellipse at 50% 50%, rgba(124,58,237,0.15) 0%, transparent 65%)' }}
        />
        <Reveal className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-4xl font-black text-white mb-4 break-keep">
            지금 무료로 시작하세요
          </h2>
          <p className="text-slate-400 text-[14px] md:text-[15px] mb-8">
            가입 후 바로 첫 AI 기업 분석을 받아보실 수 있습니다
          </p>
          <Link
            href="/auth/signup"
            className="group inline-flex items-center gap-2 px-8 py-4 rounded-2xl text-white font-bold text-[16px]
              transition-all hover:scale-[1.03] active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 50%, #ec4899 100%)',
              boxShadow: '0 0 32px rgba(139,92,246,0.35)',
            }}
          >
            <Sparkles className="w-4 h-4" />
            지금 무료로 시작하세요
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </Link>
          <p className="mt-3 text-[12px] text-slate-500">신용카드 등록 없이 바로 시작</p>
        </Reveal>
      </section>

      {/* ══ 면책 문구 ══ */}
      <div className="max-w-3xl mx-auto px-4 pb-16">
        <p className="text-[11px] text-slate-600 text-center leading-relaxed">
          {INVESTMENT_DISCLAIMER}
        </p>
      </div>
    </div>
  );
}
