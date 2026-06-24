import Link from 'next/link';

export default function DomesticMarketPage() {
  return (
    <div className="min-h-screen bg-[#0f1117] flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="space-y-3">
        <p className="text-[10px] font-mono font-bold text-blue-400 tracking-widest uppercase">국내증시</p>
        <h1 className="text-3xl font-extrabold text-white">준비 중입니다</h1>
        <p className="text-gray-400 text-sm max-w-sm">
          국내 주요 지수, 업종별 등락, 거래대금 상위 종목 등을 한눈에 볼 수 있는 페이지를 준비 중입니다.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-bold rounded-lg hover:bg-blue-500 transition-colors"
      >
        ← 홈으로 돌아가기
      </Link>
    </div>
  );
}
