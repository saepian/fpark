'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion, useReducedMotion } from 'motion/react';
import {
  Search, PieChart, Trophy, BellRing, Mail, Sunrise,
  Database, Cpu, Send, ArrowRight, Check,
} from 'lucide-react';
import { PLAN_AMOUNTS } from '@/lib/payment-constants';

// 랜딩페이지 전용 화려한 배경(오로라 블롭 + 파티클 + 슈팅스타) — 대시보드와는 분리해서
// 마케팅 임팩트를 더 크게. 캔버스 애니메이션이라 초기 렌더링에서 제외 (lazy)
const LandingBackground = dynamic(() => import('@/components/layout/LandingBackground'), { ssr: false });
// 마우스를 따라다니는 AI 오브 — 카드 등 콘텐츠보다 위(z-40)에 그려서 뒤로 숨지 않게 별도 레이어로 분리
const AiCompanion = dynamic(() => import('@/components/layout/AiCompanion'), { ssr: false });

// ── 디자인 토큰 (이 페이지 전용) ───────────────────────────────────────────
// bg-main #0B0D12 · bg-card #151922 · text #E8EAED · text-sub #8B92A8
// accent-green #3ECF8E(신뢰/포인트) · accent-red #F0483E(경고·하락, 최소 사용)

const CTA_FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3ECF8E] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0B0D12]';

// ── 공용 애니메이션 래퍼 — prefers-reduced-motion 존중 ─────────────────────

function Reveal({
  children, delay = 0, className = '',
}: { children: React.ReactNode; delay?: number; className?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? { opacity: 1 } : { opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.55, delay, ease: 'easeOut' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ── 데이터 ──────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: Search, title: '종목진단',
    desc: '궁금한 기업 하나, 수급·뉴스·밸류에이션을 AI가 한 번에 정리해드립니다.',
    mini: (
      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-[#1E232D] overflow-hidden">
          <div className="h-full rounded-full bg-[#3ECF8E]" style={{ width: '72%' }} />
        </div>
        <span className="text-[10px] text-[#8B92A8] tabular-nums shrink-0">자금 유입 72</span>
      </div>
    ),
  },
  {
    icon: PieChart, title: '포트폴리오 진단',
    desc: '보유 종목 전체를 한 번에 진단하고, 같은 기간 시장 지수 대비 성과를 비교합니다.',
    mini: (
      <div className="mt-4 flex h-1.5 rounded-full overflow-hidden bg-[#1E232D]">
        <div className="h-full bg-[#3ECF8E]" style={{ width: '42%' }} />
        <div className="h-full bg-[#3ECF8E]/55" style={{ width: '31%' }} />
        <div className="h-full bg-[#3ECF8E]/25" style={{ width: '18%' }} />
      </div>
    ),
  },
  {
    icon: Trophy, title: '시장 랭킹',
    desc: '외국인·기관 자금이 몰리는 종목을 매일 스크리닝해서 정리해드립니다.',
    mini: (
      <div className="mt-4 flex flex-col gap-1.5 text-[11px]">
        {[
          { rank: 1, name: '삼성전자', rate: '+2.1%', up: true },
          { rank: 2, name: 'SK하이닉스', rate: '+1.8%', up: true },
          { rank: 3, name: 'NAVER', rate: '-0.4%', up: false },
        ].map((r) => (
          <div key={r.rank} className="flex items-center gap-2 text-[#8B92A8]">
            <span className="w-3 tabular-nums text-[#5A6172]">{r.rank}</span>
            <span className="flex-1 truncate">{r.name}</span>
            <span className={`tabular-nums font-semibold ${r.up ? 'text-[#3ECF8E]' : 'text-[#F0483E]'}`}>{r.rate}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: BellRing, title: '워치리스트 알림',
    desc: '관심 등록한 종목의 주가·수급 변화가 감지되면 실시간으로 알려드립니다.',
    mini: (
      <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#3ECF8E]/25 bg-[#3ECF8E]/[0.06] px-2.5 py-1.5 text-[11px] text-[#8B92A8]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#3ECF8E] shrink-0" />
        SK하이닉스 자금 유입 5일 연속 관찰
      </div>
    ),
  },
  {
    icon: Sunrise, title: '장 시작 전 브리핑',
    desc: '새로운 뉴스가 있는 관심기업을 AI가 분석해 장 시작 전 이메일로 보내드립니다.',
    mini: (
      <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-700/60 bg-[#1E232D] px-2.5 py-1.5 text-[11px] text-[#8B92A8] tabular-nums">
        오전 7:00 · 관심기업 뉴스 분석
      </div>
    ),
  },
  {
    icon: Mail, title: '장 마감 후 리포트',
    desc: '매일 장 마감 후, 관심기업 등락 현황과 AI 분석을 이메일로 보내드립니다.',
    mini: (
      <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-700/60 bg-[#1E232D] px-2.5 py-1.5 text-[11px] text-[#8B92A8] tabular-nums">
        오후 3:45 · 등락 현황·AI 분석
      </div>
    ),
  },
];

const PRINCIPLES = [
  {
    title: '가격 전망이나 거래 신호를 만들지 않습니다',
    desc: '수급, 거래량, 기술적 지표 같은 객관적으로 관찰 가능한 데이터만 정리해서 보여드립니다.',
  },
  {
    title: '모든 서술은 관찰된 사실에 근거합니다',
    desc: '방향을 단정하지 않고, 데이터에서 무엇이 관찰되는지를 있는 그대로 전달하는 데 집중합니다.',
  },
  {
    title: '최종 판단은 항상 투자자 본인의 몫입니다',
    desc: '저희는 판단에 필요한 재료를 정리해드릴 뿐, 결정과 그 책임은 투자자 본인에게 있습니다.',
  },
];

const PROCESS_STEPS = [
  {
    no: '01', icon: Database, title: '데이터 수집',
    desc: 'KIS(한국투자증권) Open API 등 공식 소스에서 시세·수급·뉴스 데이터를 수집합니다.',
  },
  {
    no: '02', icon: Cpu, title: 'AI 분석',
    desc: '수집된 데이터를 교차 분석해 수급 흐름과 관찰 포인트를 정리합니다.',
  },
  {
    no: '03', icon: Send, title: '리포트·알림 전달',
    desc: '종목·포트폴리오 리포트, 워치리스트 알림, 데일리 리포트로 전달해드립니다.',
  },
];

const LANDING_PLANS = [
  {
    type: 'basic' as const, name: 'BASIC', price: PLAN_AMOUNTS.basic.monthly,
    desc: '더 많은 분석이 필요한 이용자를 위한 플랜',
    features: ['기업 분석 매일 6회', '포트폴리오 분석 월 1회', 'AI 분석 리포트 저장', '뉴스/시장 데이터 무제한'],
    highlight: false,
  },
  {
    type: 'pro' as const, name: 'PRO', price: PLAN_AMOUNTS.pro.monthly,
    desc: '전문적인 포트폴리오 관리가 필요한 이용자',
    features: ['기업 분석 매일 11회', '포트폴리오 분석 월 20회', '관심기업 주가·수급 알림', '우선순위 분석 처리'],
    highlight: true,
  },
];

// ── 재사용 CTA 버튼 ────────────────────────────────────────────────────────

function PrimaryCta({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <Link
      href="/auth/signup"
      className={`group inline-flex items-center gap-2 px-8 py-4 rounded-xl font-bold text-[16px] text-[#0B0D12]
        bg-[#3ECF8E] transition-all hover:brightness-110 hover:scale-[1.02] active:scale-[0.98] ${CTA_FOCUS} ${className}`}
    >
      {children}
      <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
    </Link>
  );
}

// ── 페이지 ──────────────────────────────────────────────────────────────────

export default function AiPortfolioLandingPage() {
  return (
    <div className="overflow-x-hidden text-[#E8EAED]">
      {/* 기업분석 페이지와 동일하게, 페이지 전체에 배경 하나만 고정 마운트 — 섹션별 배경 없음 */}
      <LandingBackground />
      <AiCompanion />

      {/* ══ 1. 히어로 ══ */}
      <section className="relative">
        <div className="max-w-4xl mx-auto px-4 pt-20 pb-20 md:pt-28 md:pb-28 text-center relative">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#3ECF8E]/10 border border-[#3ECF8E]/25 text-[11px] text-[#3ECF8E] font-semibold tracking-wide mb-6"
          >
            AI 기업 데이터 분석 플랫폼
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08 }}
            className="text-3xl md:text-5xl font-black leading-tight mb-5 break-keep"
          >
            AI가 정리하는<br />
            <span className="bg-gradient-to-r from-[#3ECF8E] to-[#7EE8BB] bg-clip-text text-transparent">기업 핵심 정보</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.16 }}
            className="text-[#8B92A8] text-[15px] md:text-lg mb-3"
          >
            외국인·기관 자금 흐름, 뉴스, 밸류에이션까지 — 흩어진 정보를 AI가 한 번에 정리해드립니다.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-[#8B92A8]/80 text-[12px] mb-10"
          >
            투자자문이 아니며, 특정 종목에 대한 거래를 권유하지 않습니다.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.28 }}
          >
            <PrimaryCta>무료로 시작하기</PrimaryCta>
            <p className="mt-3 text-[12px] text-[#8B92A8]">신용카드 등록 없이 바로 시작</p>
          </motion.div>
        </div>
      </section>

      {/* ══ 2. 핵심 기능 그리드 ══ */}
      <section className="max-w-5xl mx-auto px-4 py-16 md:py-24">
        <Reveal className="text-center mb-12">
          <h2 className="text-2xl md:text-[32px] font-bold break-keep">FPARK가 정리해드리는 것들</h2>
          <p className="text-[#8B92A8] text-[14px] md:text-[15px] mt-3">여섯 가지 기능으로 데이터를 확인하세요</p>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => {
            const Icon = f.icon;
            return (
              <Reveal key={f.title} delay={i * 0.06}>
                <div className="h-full rounded-2xl border border-slate-700/40 bg-[#151922] p-6 transition-all duration-300 hover:-translate-y-1 hover:border-[#3ECF8E]/30">
                  <div className="w-11 h-11 rounded-xl border border-[#3ECF8E]/25 bg-[#3ECF8E]/10 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-[#3ECF8E]" />
                  </div>
                  <p className="text-[15px] font-bold mb-2">{f.title}</p>
                  <p className="text-[13px] text-[#8B92A8] leading-relaxed">{f.desc}</p>
                  {f.mini}
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ══ 3. 우리는 다릅니다 ══ */}
      <section className="max-w-5xl mx-auto px-4 py-16 md:py-24">
        <Reveal className="text-center mb-12 max-w-2xl mx-auto">
          <h2 className="text-2xl md:text-[32px] font-bold mb-3 break-keep">가격 전망을 제시하지 않는 이유</h2>
          <p className="text-[#8B92A8] text-[14px] md:text-[15px] leading-relaxed break-keep">
            FPARK는 무엇을 사고팔지 말하는 서비스가 아닙니다.<br className="hidden md:block" />
            판단에 필요한 객관적인 데이터를 정리해서 보여드리는 데 집중합니다.
          </p>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-5">
          {PRINCIPLES.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.08}>
              <div className="h-full rounded-2xl border border-slate-700/40 bg-[#151922] p-6">
                <div className="w-9 h-9 rounded-lg bg-[#3ECF8E]/10 border border-[#3ECF8E]/25 flex items-center justify-center mb-4">
                  <Check className="w-4 h-4 text-[#3ECF8E]" />
                </div>
                <p className="text-[14.5px] font-bold mb-2 leading-snug break-keep">{p.title}</p>
                <p className="text-[13px] text-[#8B92A8] leading-relaxed">{p.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ══ 4. 작동 방식 ══ */}
      <section className="max-w-5xl mx-auto px-4 py-16 md:py-24">
        <Reveal className="text-center mb-14">
          <h2 className="text-2xl md:text-[32px] font-bold break-keep">작동 방식</h2>
          <p className="text-[#8B92A8] text-[14px] md:text-[15px] mt-3">공식 데이터 수집부터 리포트 전달까지, 3단계로 진행됩니다</p>
        </Reveal>

        <div className="grid md:grid-cols-3 gap-6 relative">
          {PROCESS_STEPS.map((s, i) => {
            const Icon = s.icon;
            return (
              <Reveal key={s.no} delay={i * 0.1} className="relative">
                <div className="h-full rounded-2xl border border-slate-700/40 bg-[#151922] p-6 md:p-7">
                  <span className="block text-[13px] font-black text-[#3ECF8E] tabular-nums mb-4 tracking-wide">{s.no}</span>
                  <div className="w-11 h-11 rounded-xl border border-slate-700/60 bg-[#1E232D] flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-[#8B92A8]" />
                  </div>
                  <p className="text-[15px] font-bold mb-2">{s.title}</p>
                  <p className="text-[13px] text-[#8B92A8] leading-relaxed">{s.desc}</p>
                </div>
                {i < PROCESS_STEPS.length - 1 && (
                  <ArrowRight className="hidden md:block absolute top-1/2 -right-4 -translate-y-1/2 w-5 h-5 text-[#3ECF8E]/40 z-10" />
                )}
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ══ 5. 요금제 미리보기 ══ */}
      <section className="max-w-4xl mx-auto px-4 py-16 md:py-24">
        <Reveal className="text-center mb-12">
          <h2 className="text-2xl md:text-[32px] font-bold mb-3 break-keep">요금제</h2>
          <p className="text-[#8B92A8] text-[14px] md:text-[15px]">무료로 시작하고, 필요할 때 업그레이드하세요</p>
        </Reveal>

        <div className="grid md:grid-cols-2 gap-6">
          {LANDING_PLANS.map((p, i) => (
            <Reveal key={p.type} delay={i * 0.1}>
              <div
                className={`h-full rounded-2xl p-6 md:p-7 relative bg-[#151922] ${
                  p.highlight ? 'border-2 border-[#3ECF8E]/50' : 'border border-slate-700/40'
                }`}
              >
                {p.highlight && (
                  <span className="absolute top-5 right-5 text-[10px] font-bold px-2.5 py-1 rounded-full text-[#0B0D12] bg-[#3ECF8E]">
                    인기
                  </span>
                )}
                <p className={`text-[12px] font-bold uppercase tracking-widest mb-1 ${p.highlight ? 'text-[#3ECF8E]' : 'text-[#8B92A8]'}`}>
                  {p.name}
                </p>
                <p className="text-[13px] text-[#8B92A8] mb-4">{p.desc}</p>
                <p className="mb-1">
                  <span className="text-3xl font-black tabular-nums">₩{p.price.toLocaleString()}</span>
                  <span className="text-[#8B92A8] text-[13px]"> / 월</span>
                </p>
                <p className="text-[10px] text-[#5A6172] mb-5 leading-snug">
                  결제 시 부가세가 별도로 계산될 수 있습니다. (Taxes may apply and will be calculated at checkout.)
                </p>
                <ul className="flex flex-col gap-2.5 mb-7">
                  {p.features.map((t) => (
                    <li key={t} className="flex items-start gap-2 text-[13px] text-[#E8EAED]/90">
                      <Check className="w-4 h-4 mt-0.5 shrink-0 text-[#3ECF8E]" /> {t}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/signup"
                  className={`block text-center py-3 rounded-xl text-[14px] font-semibold transition-all ${CTA_FOCUS} ${
                    p.highlight
                      ? 'text-[#0B0D12] bg-[#3ECF8E] hover:brightness-110'
                      : 'bg-[#1E232D] hover:bg-[#262c38] text-[#E8EAED] border border-slate-700/60'
                  }`}
                >
                  회원가입하고 무료로 시작하기
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="text-center text-[12px] text-[#8B92A8] mt-6 leading-relaxed">
          회원가입 자체는 무료이며, 가입 후 무료 플랜으로 기업 분석을 매일 이용할 수 있습니다.<br className="hidden md:block" />
          Basic·Pro는 별도 무료 체험 기간 없이 결제 즉시 이용이 시작되며 매월 자동 결제됩니다 ·{' '}
          <Link href="/pricing" className="text-[#3ECF8E] hover:underline">전체 요금제 비교 보기</Link>
        </p>
      </section>

      {/* ══ 6. 마무리 CTA ══ */}
      <section className="relative py-20 md:py-28 overflow-hidden">
        <Reveal className="max-w-2xl mx-auto px-4 text-center">
          <h2 className="text-2xl md:text-4xl font-black mb-4 break-keep">지금 무료로 시작하세요</h2>
          <p className="text-[#8B92A8] text-[14px] md:text-[15px] mb-8">
            가입 후 바로 첫 AI 기업 분석을 받아보실 수 있습니다
          </p>
          <PrimaryCta>지금 무료로 시작하세요</PrimaryCta>
          <p className="mt-3 text-[12px] text-[#8B92A8]">신용카드 등록 없이 바로 시작</p>
        </Reveal>
      </section>
    </div>
  );
}
