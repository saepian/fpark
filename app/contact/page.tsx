'use client';

import { useState } from 'react';
import { Send, Mail, Clock, MessageSquare, CheckCircle2, Loader2 } from 'lucide-react';

const CATEGORIES = [
  '서비스 이용 문의',
  '결제 문의',
  '버그 신고',
  '제휴 문의',
  '기타',
];

type Status = 'idle' | 'loading' | 'success' | 'error';

export default function ContactPage() {
  const [form, setForm] = useState({
    name: '', email: '', category: '', subject: '', message: '',
  });
  const [status, setStatus] = useState<Status>('idle');

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    try {
      await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setStatus('success');
      setForm({ name: '', email: '', category: '', subject: '', message: '' });
    } catch {
      setStatus('error');
    }
  };

  const inputCls = `w-full bg-[#1a1f2e] border border-slate-700/60 rounded-xl px-4 py-3
    text-[13px] text-white placeholder:text-slate-600
    focus:outline-none focus:border-indigo-500/70 focus:ring-1 focus:ring-indigo-500/30
    transition-all`;

  return (
    <div className="max-w-5xl mx-auto px-4 py-16">

      {/* 헤더 */}
      <div className="mb-12 text-center">
        <p className="text-[10px] font-bold tracking-[0.25em] text-indigo-400 uppercase mb-3">Contact Us</p>
        <h1 className="text-3xl font-bold text-white mb-3">문의하기</h1>
        <p className="text-slate-400 text-[14px]">궁금한 점이 있으시면 언제든지 연락해주세요</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8">

        {/* 문의 폼 */}
        <div className="p-px rounded-2xl" style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed, #0ea5e9)' }}>
          <div className="rounded-[15px] p-6 md:p-8" style={{ backgroundColor: '#0d1117' }}>
            {status === 'success' ? (
              <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
                <div className="w-16 h-16 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400" />
                </div>
                <div>
                  <p className="text-white font-bold text-lg mb-1">문의가 접수되었습니다</p>
                  <p className="text-slate-400 text-[13px]">영업일 기준 1~2일 이내에 답변드리겠습니다</p>
                </div>
                <button
                  onClick={() => setStatus('idle')}
                  className="mt-2 px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-[13px] transition-colors cursor-pointer"
                >
                  새 문의 작성
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1.5 font-medium tracking-wide">이름 *</label>
                    <input
                      type="text"
                      placeholder="홍길동"
                      value={form.name}
                      onChange={set('name')}
                      required
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1.5 font-medium tracking-wide">이메일 *</label>
                    <input
                      type="email"
                      placeholder="example@email.com"
                      value={form.email}
                      onChange={set('email')}
                      required
                      className={inputCls}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1.5 font-medium tracking-wide">문의 유형</label>
                  <select
                    value={form.category}
                    onChange={set('category')}
                    className={`${inputCls} cursor-pointer`}
                    style={{ colorScheme: 'dark' }}
                  >
                    <option value="">문의 유형을 선택해주세요</option>
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1.5 font-medium tracking-wide">제목 *</label>
                  <input
                    type="text"
                    placeholder="문의 제목을 입력해주세요"
                    value={form.subject}
                    onChange={set('subject')}
                    required
                    className={inputCls}
                  />
                </div>

                <div>
                  <label className="block text-[11px] text-slate-400 mb-1.5 font-medium tracking-wide">내용 *</label>
                  <textarea
                    placeholder="문의 내용을 자세히 입력해주세요"
                    value={form.message}
                    onChange={set('message')}
                    required
                    rows={7}
                    className={`${inputCls} resize-none`}
                  />
                </div>

                {status === 'error' && (
                  <p className="text-red-400 text-[12px]">전송 중 오류가 발생했습니다. 직접 이메일(ad@fpark.com)로 연락해주세요.</p>
                )}

                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl font-bold text-[14px] text-white transition-all hover:opacity-90 disabled:opacity-60 cursor-pointer"
                  style={{ background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' }}
                >
                  {status === 'loading'
                    ? <><Loader2 className="w-4 h-4 animate-spin" /> 전송 중...</>
                    : <><Send className="w-4 h-4" /> 문의 보내기</>}
                </button>
              </form>
            )}
          </div>
        </div>

        {/* 사이드 정보 */}
        <div className="flex flex-col gap-4">
          {[
            {
              icon: <Mail className="w-4 h-4 text-indigo-400" />,
              label: '이메일',
              value: 'ad@fpark.com',
              sub: '이메일로도 직접 문의 가능합니다',
              href: 'mailto:ad@fpark.com',
            },
            {
              icon: <Clock className="w-4 h-4 text-sky-400" />,
              label: '운영 시간',
              value: '평일 09:00 ~ 18:00',
              sub: '주말 · 공휴일 제외',
            },
            {
              icon: <MessageSquare className="w-4 h-4 text-emerald-400" />,
              label: '답변 소요 시간',
              value: '영업일 기준 1~2일',
              sub: '문의량에 따라 다소 지연될 수 있습니다',
            },
          ].map(item => (
            <div
              key={item.label}
              className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5"
            >
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
                  {item.icon}
                </div>
                <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">{item.label}</p>
              </div>
              {item.href ? (
                <a href={item.href} className="text-[14px] font-semibold text-white hover:text-indigo-300 transition-colors block mb-1">
                  {item.value}
                </a>
              ) : (
                <p className="text-[14px] font-semibold text-white mb-1">{item.value}</p>
              )}
              <p className="text-[12px] text-slate-500">{item.sub}</p>
            </div>
          ))}

          {/* 빠른 FAQ */}
          <div className="bg-[#1a1f2e] border border-slate-700/50 rounded-2xl p-5 mt-2">
            <p className="text-[11px] text-slate-500 font-medium uppercase tracking-wider mb-3">자주 묻는 질문</p>
            <div className="flex flex-col gap-2 text-[12px] text-slate-400">
              <a href="/pricing#faq" className="hover:text-indigo-300 transition-colors">→ 요금제 관련 질문</a>
              <a href="/terms" className="hover:text-indigo-300 transition-colors">→ 이용약관 확인</a>
              <a href="/privacy" className="hover:text-indigo-300 transition-colors">→ 개인정보처리방침</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
