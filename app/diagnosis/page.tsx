'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

interface DiagnosisResult {
  summary: string;
  currentPrice: number;
  avgPrice: number;
  quantity: number;
  profitRate: number;
  profitAmount: number;
  news: { title: string; description: string }[];
  institutional: string;
  foreign: string;
  technical: string;
  recommendation: '홀딩' | '매도' | '분할매도' | '추가매수' | '손절';
  reason: string;
  targetPrice: number;
  stopLoss: number;
  risk: string;
  opportunity: string;
}

const REC_STYLE: Record<string, { bg: string; text: string; border: string }> = {
  홀딩:   { bg: 'bg-blue-500/20',   text: 'text-blue-300',   border: 'border-blue-500/40' },
  매도:   { bg: 'bg-red-500/20',    text: 'text-red-300',    border: 'border-red-500/40' },
  분할매도: { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/40' },
  추가매수: { bg: 'bg-green-500/20',  text: 'text-green-300',  border: 'border-green-500/40' },
  손절:   { bg: 'bg-red-700/20',    text: 'text-red-400',    border: 'border-red-700/40' },
};

function InfoCard({ label, value, sub, positive }: {
  label: string; value: string; sub?: string; positive?: boolean;
}) {
  return (
    <div className="bg-[#1e2130] rounded-xl p-4 flex flex-col gap-1">
      <p className="text-[11px] text-slate-500 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold font-mono ${
        positive === undefined ? 'text-white' : positive ? 'text-red-400' : 'text-blue-400'
      }`}>{value}</p>
      {sub && <p className="text-[12px] text-slate-500">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#1e2130] rounded-xl p-5">
      <h3 className="text-[13px] font-semibold text-slate-400 uppercase tracking-wider mb-3">{title}</h3>
      {children}
    </div>
  );
}

export default function DiagnosisPage() {
  const router = useRouter();
  const supabase = createClient();

  const [authChecked, setAuthChecked] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  const [ticker, setTicker] = useState('');
  const [stockName, setStockName] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ ticker: string; name: string }[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);

  const [avgPrice, setAvgPrice] = useState('');
  const [quantity, setQuantity] = useState('');
  const [buyDate, setBuyDate] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DiagnosisResult | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace('/auth/login');
      } else {
        setAuthChecked(true);
        fetch('/api/diagnosis').then(r => r.json()).then(d => setRemaining(d.remaining ?? 0));
      }
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json();
        setSearchResults(Array.isArray(data) ? data.slice(0, 6) : []);
        setShowDropdown(true);
      } catch { setSearchResults([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [searchQuery]);

  const selectStock = (t: string, n: string) => {
    setTicker(t);
    setStockName(n);
    setSearchQuery(n);
    setShowDropdown(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ticker) { setError('종목을 선택해주세요.'); return; }
    if (!avgPrice || !quantity) { setError('매수 평균가와 보유 수량을 입력해주세요.'); return; }

    setError('');
    setLoading(true);
    setResult(null);

    try {
      const res = await fetch('/api/diagnosis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          name: stockName,
          avgPrice: parseInt(avgPrice.replace(/,/g, '')),
          quantity: parseInt(quantity),
          buyDate: buyDate || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '진단 실패');
        return;
      }

      setResult(data);
      setRemaining(prev => Math.max(0, (prev ?? 1) - 1));
    } catch {
      setError('네트워크 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const recStyle = result ? (REC_STYLE[result.recommendation] ?? REC_STYLE['홀딩']) : null;

  return (
    <div className="min-h-screen bg-[#0f1117] pb-16">
      <div className="max-w-2xl mx-auto px-4 pt-8">

        {/* 헤더 */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">종목 진단</h1>
          <p className="text-[13px] text-slate-400">보유 종목의 현재 상황을 AI가 분석합니다</p>
        </div>

        {/* 무료 횟수 */}
        <div className={`flex items-center gap-3 rounded-xl px-4 py-3 mb-6 ${
          remaining === 0
            ? 'bg-slate-800/60 border border-slate-700'
            : 'bg-indigo-500/10 border border-indigo-500/30'
        }`}>
          <span className="text-lg">{remaining === 0 ? '🔒' : '✨'}</span>
          <div>
            <p className="text-[13px] font-medium text-white">
              오늘 무료 진단 {remaining === 0 ? '소진' : `${remaining}회 남음`}
            </p>
            <p className="text-[11px] text-slate-500">매일 자정 초기화 · 1일 1회 무료</p>
          </div>
        </div>

        {/* 입력 폼 */}
        <form onSubmit={handleSubmit} className="bg-[#1e2130] rounded-2xl p-6 mb-6 flex flex-col gap-4">

          {/* 종목 검색 */}
          <div className="relative">
            <label className="block text-[12px] text-slate-400 mb-1.5">종목 검색</label>
            <input
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setTicker(''); setStockName(''); }}
              onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
              placeholder="종목명 또는 코드 입력"
              className="w-full bg-[#13161f] border border-slate-700 rounded-lg px-4 py-3
                text-[14px] text-white placeholder-slate-500
                focus:border-indigo-500 focus:outline-none transition-colors"
            />
            {ticker && (
              <span className="absolute right-3 top-[38px] text-[11px] text-indigo-400 font-mono">{ticker}</span>
            )}
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-[#1e2130] border border-slate-700
                rounded-xl shadow-2xl z-50 overflow-hidden">
                {searchResults.map(s => (
                  <button
                    key={s.ticker}
                    type="button"
                    onClick={() => selectStock(s.ticker, s.name)}
                    className="flex items-center justify-between w-full px-4 py-3
                      hover:bg-slate-700/50 transition-colors text-left"
                  >
                    <span className="text-[14px] text-white">{s.name}</span>
                    <span className="text-[12px] text-slate-500 font-mono">{s.ticker}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 매수 평균가 */}
          <div>
            <label className="block text-[12px] text-slate-400 mb-1.5">매수 평균가 (원)</label>
            <input
              value={avgPrice}
              onChange={e => setAvgPrice(e.target.value.replace(/[^0-9,]/g, ''))}
              placeholder="예: 75,000"
              className="w-full bg-[#13161f] border border-slate-700 rounded-lg px-4 py-3
                text-[14px] text-white placeholder-slate-500
                focus:border-indigo-500 focus:outline-none transition-colors"
            />
          </div>

          {/* 보유 수량 */}
          <div>
            <label className="block text-[12px] text-slate-400 mb-1.5">보유 수량 (주)</label>
            <input
              value={quantity}
              onChange={e => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="예: 10"
              className="w-full bg-[#13161f] border border-slate-700 rounded-lg px-4 py-3
                text-[14px] text-white placeholder-slate-500
                focus:border-indigo-500 focus:outline-none transition-colors"
            />
          </div>

          {/* 매수 시점 */}
          <div>
            <label className="block text-[12px] text-slate-400 mb-1.5">매수 시점 (선택)</label>
            <input
              type="date"
              value={buyDate}
              onChange={e => setBuyDate(e.target.value)}
              className="w-full bg-[#13161f] border border-slate-700 rounded-lg px-4 py-3
                text-[14px] text-white
                focus:border-indigo-500 focus:outline-none transition-colors
                [color-scheme:dark]"
            />
          </div>

          {error && <p className="text-red-400 text-[13px]">{error}</p>}

          <button
            type="submit"
            disabled={loading || remaining === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50
              disabled:cursor-not-allowed text-white font-semibold text-[14px]
              py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2 mt-1"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                AI 분석 중... (약 10~20초)
              </>
            ) : remaining === 0 ? (
              '오늘 진단 횟수를 모두 사용했습니다'
            ) : (
              '진단하기'
            )}
          </button>
        </form>

        {/* 결과 */}
        {result && recStyle && (
          <div className="flex flex-col gap-4">

            {/* 추천 의견 */}
            <div className={`rounded-2xl p-6 border ${recStyle.bg} ${recStyle.border}`}>
              <p className="text-[11px] text-slate-400 uppercase tracking-wider mb-2">AI 추천 의견</p>
              <p className={`text-4xl font-black mb-3 ${recStyle.text}`}>{result.recommendation}</p>
              <p className="text-[14px] text-slate-300 leading-relaxed">{result.summary}</p>
            </div>

            {/* 수익 현황 */}
            <div className="grid grid-cols-3 gap-3">
              <InfoCard
                label="현재가"
                value={`${result.currentPrice.toLocaleString()}원`}
              />
              <InfoCard
                label="수익률"
                value={`${result.profitRate > 0 ? '+' : ''}${result.profitRate.toFixed(2)}%`}
                positive={result.profitRate >= 0}
              />
              <InfoCard
                label="평가손익"
                value={`${result.profitAmount > 0 ? '+' : ''}${Math.abs(result.profitAmount).toLocaleString()}`}
                sub="원"
                positive={result.profitAmount >= 0}
              />
            </div>

            {/* 목표가 / 손절가 */}
            <div className="grid grid-cols-2 gap-3">
              <InfoCard label="목표가" value={`${result.targetPrice.toLocaleString()}원`} />
              <InfoCard label="손절가" value={`${result.stopLoss.toLocaleString()}원`} />
            </div>

            {/* 추천 이유 */}
            <Section title="추천 이유">
              <p className="text-[14px] text-slate-300 leading-relaxed whitespace-pre-line">{result.reason}</p>
            </Section>

            {/* 기술적 분석 */}
            <Section title="기술적 분석">
              <p className="text-[14px] text-slate-300 leading-relaxed">{result.technical}</p>
            </Section>

            {/* 수급 동향 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Section title="기관 동향">
                <p className="text-[14px] text-slate-300 leading-relaxed">{result.institutional}</p>
              </Section>
              <Section title="외국인 동향">
                <p className="text-[14px] text-slate-300 leading-relaxed">{result.foreign}</p>
              </Section>
            </div>

            {/* 리스크 / 기회 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Section title="⚠️ 리스크 요인">
                <p className="text-[14px] text-slate-300 leading-relaxed">{result.risk}</p>
              </Section>
              <Section title="💡 기회 요인">
                <p className="text-[14px] text-slate-300 leading-relaxed">{result.opportunity}</p>
              </Section>
            </div>

            {/* 뉴스 동향 */}
            {result.news?.length > 0 && (
              <Section title="최근 뉴스">
                <div className="flex flex-col gap-3">
                  {result.news.map((n, i) => (
                    <div key={i} className="border-b border-slate-700/50 last:border-0 pb-3 last:pb-0">
                      <p className="text-[13px] font-medium text-white leading-snug">{n.title}</p>
                      {n.description && (
                        <p className="text-[12px] text-slate-500 mt-1 leading-relaxed">{n.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* PDF 다운로드 */}
            <button
              disabled
              className="w-full py-3 rounded-xl border border-slate-700 text-slate-600
                text-[14px] cursor-not-allowed flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              PDF 다운로드 (준비중)
            </button>

            {/* 면책 */}
            <p className="text-[11px] text-slate-600 text-center leading-relaxed px-2">
              본 분석은 AI가 공개 정보를 바탕으로 생성한 참고 자료입니다. 투자 판단의 책임은 본인에게 있습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
