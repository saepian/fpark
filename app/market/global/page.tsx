import Link from 'next/link';

export default function GlobalMarketPage() {
  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="space-y-3">
        <p className="text-[10px] font-mono font-bold text-violet-400 tracking-widest uppercase">해외증시</p>
        <h1 className="text-3xl font-extrabold text-white">준비 중입니다</h1>
        <p className="text-gray-400 text-sm max-w-sm">
          나스닥, S&amp;P500, 다우존스 등 해외 주요 지수와 종목 현황을 볼 수 있는 페이지를 준비 중입니다.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-violet-600 text-white text-sm font-bold rounded-lg hover:bg-violet-500 transition-colors"
      >
        ← 홈으로 돌아가기
      </Link>
    </div>
  );
}
