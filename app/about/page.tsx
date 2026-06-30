import Link from 'next/link';
import { Sparkles, Newspaper, TrendingUp, BarChart2, Search } from 'lucide-react';

export const metadata = {
  title: 'About | Finance Park',
  description: 'AI 기술로 모든 투자자에게 전문가 수준의 주식 분석을 제공합니다.',
};

const FEATURES = [
  {
    icon: <Search className="w-5 h-5 text-indigo-400" />,
    iconBg: 'bg-indigo-500/10 border-indigo-500/25',
    title: 'AI 종목진단',
    desc: '보유 종목의 수급·뉴스·재무를 종합 분석해 매수/보유/매도 의견과 목표가를 제시합니다.',
  },
  {
    icon: <BarChart2 className="w-5 h-5 text-violet-400" />,
    iconBg: 'bg-violet-500/10 border-violet-500/25',
    title: '포트폴리오 진단',
    desc: '보유 종목 전체를 한 번에 분석하고 섹터 편중도·리스크·포트폴리오 개선 제안을 제공합니다.',
  },
  {
    icon: <Newspaper className="w-5 h-5 text-sky-400" />,
    iconBg: 'bg-sky-500/10 border-sky-500/25',
    title: '실시간 뉴스',
    desc: '국내외 주요 경제·주식 뉴스를 실시간으로 수집하고 종목별 관련 뉴스를 자동으로 연결합니다.',
  },
  {
    icon: <TrendingUp className="w-5 h-5 text-emerald-400" />,
    iconBg: 'bg-emerald-500/10 border-emerald-500/25',
    title: '시장 데이터',
    desc: 'KOSPI·KOSDAQ·해외증시 실시간 데이터와 급등·급락 종목을 실시간으로 모니터링합니다.',
  },
];

const TECH_STACK = [
  { name: 'Next.js 15', color: 'text-white', bg: 'bg-slate-800' },
  { name: 'Supabase', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border border-emerald-500/20' },
  { name: 'Claude AI', color: 'text-violet-400', bg: 'bg-violet-500/10 border border-violet-500/20' },
  { name: 'KIS API', color: 'text-sky-400', bg: 'bg-sky-500/10 border border-sky-500/20' },
  { name: 'TypeScript', color: 'text-blue-400', bg: 'bg-blue-500/10 border border-blue-500/20' },
  { name: 'Tailwind CSS', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border border-cyan-500/20' },
];

export default function AboutPage() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-16">

      {/* 히어로 */}
      <div className="text-center mb-20">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-500/10 border border-indigo-500/25 text-[11px] text-indigo-400 font-semibold tracking-wide mb-6">
          <Sparkles className="w-3 h-3" />
          AI-Powered Stock Analysis Platform
        </div>
        <h1 className="text-4xl md:text-5xl font-black text-white mb-5 leading-tight">
          Finance Park를<br />
          <span className="bg-gradient-to-r from-indigo-400 via-violet-400 to-sky-400 bg-clip-text text-transparent">
            소개합니다
          </span>
        </h1>
        <p className="text-slate-400 text-[15px] leading-relaxed max-w-xl mx-auto">
          AI 기술로 모든 투자자에게 전문가 수준의 분석을
        </p>
      </div>

      {/* 서비스 소개 */}
      <div
        className="rounded-2xl border border-indigo-500/20 overflow-hidden mb-16"
        style={{ background: 'linear-gradient(135deg, #1a1f2e 0%, #13161f 100%)' }}
      >
        <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-violet-500 to-sky-500" />
        <div className="p-8 md:p-10">
          <p className="text-[10px] font-bold text-indigo-400/70 uppercase tracking-widest mb-4">About Us</p>
          <p className="text-[15px] text-slate-300 leading-[1.9]">
            Finance Park는 최신 AI 기술을 활용해 실시간 주식 데이터와 뉴스를 종합 분석하는
            <span className="text-white font-semibold"> AI 기반 주식 분석 플랫폼</span>입니다.
            복잡한 시장 데이터를 누구나 이해하기 쉬운 인사이트로 변환해,
            개인 투자자가 전문가 수준의 분석을 통해 더 나은 투자 결정을 내릴 수 있도록 돕습니다.
          </p>
        </div>
      </div>

      {/* 핵심 기능 카드 */}
      <div className="mb-16">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-6 text-center">Core Features</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURES.map(f => (
            <div
              key={f.title}
              className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-6 hover:border-slate-600/70 transition-colors"
            >
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center border mb-4 ${f.iconBg}`}>
                {f.icon}
              </div>
              <p className="text-[14px] font-bold text-white mb-2">{f.title}</p>
              <p className="text-[13px] text-slate-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 기술 스택 */}
      <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-7 mb-16">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-5">Tech Stack</p>
        <div className="flex flex-wrap gap-2.5">
          {TECH_STACK.map(t => (
            <span
              key={t.name}
              className={`px-3.5 py-1.5 rounded-xl text-[12px] font-semibold ${t.bg} ${t.color}`}
            >
              {t.name}
            </span>
          ))}
        </div>
      </div>

      {/* 운영 정보 */}
      <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-7 mb-16">
        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-5">Company Info</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8 text-[13px]">
          {[
            { label: '서비스명', value: 'Finance Park (fpark.com)' },
            { label: '운영사', value: '디지웹 디자인' },
            { label: '대표', value: '김대우' },
            { label: '이메일', value: 'saepian2@gmail.com', href: 'mailto:saepian2@gmail.com' },
          ].map(row => (
            <div key={row.label} className="flex items-baseline gap-3">
              <span className="text-slate-500 w-24 shrink-0">{row.label}</span>
              {row.href ? (
                <a href={row.href} className="text-indigo-300 hover:underline">{row.value}</a>
              ) : (
                <span className="text-white font-medium">{row.value}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="text-center">
        <p className="text-slate-500 text-[13px] mb-6">지금 바로 시작해보세요</p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-[14px] text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #0ea5e9 50%, #10b981 100%)' }}
          >
            <Sparkles className="w-4 h-4" />
            지금 시작하기 →
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-[14px] text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 transition-colors"
          >
            요금제 보기 →
          </Link>
        </div>
      </div>

    </div>
  );
}
