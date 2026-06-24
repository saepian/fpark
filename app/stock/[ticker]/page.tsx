import type { Metadata } from 'next';
import StockHeader from '../../../components/stock/StockHeader';
import StockMetrics from '../../../components/stock/StockMetrics';
import StockChart from '../../../components/stock/StockChart';
import DailyPriceTable from '../../../components/stock/DailyPriceTable';
import AiAnalysis from '../../../components/stock/AiAnalysis';
import RelatedNews from '../../../components/stock/RelatedNews';
import WeeklyChart from '../../../components/stock/WeeklyChart';
import InvestorFlow from '../../../components/stock/InvestorFlow';
import SectorPeers from '../../../components/stock/SectorPeers';
import FinanceSummary from '../../../components/stock/FinanceSummary';
import AdFit from '../../../components/AdFit';
import { fetchStockPrice } from '../../../lib/kis-api';

interface PageProps {
  params: Promise<{ ticker: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { ticker } = await params;
  try {
    const price = await fetchStockPrice(ticker);
    return { title: `${price.name} (${ticker}) | fpark` };
  } catch {
    return { title: `${ticker} | fpark` };
  }
}

export default async function StockDetailPage({ params }: PageProps) {
  const { ticker } = await params;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-6">
      <StockHeader ticker={ticker} />
      <div className="grid grid-cols-12 gap-8">
        {/* 좌측: 지표 + 차트 + 일별동향 + AI분석 */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          <StockMetrics ticker={ticker} />
          <StockChart ticker={ticker} />
          <DailyPriceTable ticker={ticker} />
          <AiAnalysis ticker={ticker} />
        </div>
        {/* 우측: 5일 등락률 → 투자자별 매매동향 → 동일업종 → 관련뉴스 → 재무요약 */}
        <div className="flex flex-col gap-4 col-span-12 lg:col-span-4">
          <WeeklyChart ticker={ticker} />
          <InvestorFlow ticker={ticker} />
          <SectorPeers ticker={ticker} />
          <RelatedNews ticker={ticker} />
          <FinanceSummary ticker={ticker} />
          <a href="https://devkitpack.com/tools/stock-avg" target="_blank" rel="noopener noreferrer"
            className="group block rounded-xl border border-slate-700 bg-[#0f1629] p-4 hover:border-blue-500/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-950 flex items-center justify-center flex-shrink-0">
                  <span className="text-blue-400 text-xl">⌗</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs text-blue-400 font-medium">무료 도구</span>
                    <span className="text-[11px] bg-blue-950 text-blue-400 border border-blue-900 px-2 py-0.5 rounded-full">DevKitPack</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-100">주식 평균단가 계산기</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">분할매수 시 평균 매입단가를 빠르게 계산하세요</p>
                </div>
              </div>
              <span className="arrow-slide text-blue-400 text-base flex-shrink-0">→</span>
            </div>
          </a>
          <div>
            <p className="text-[10px] text-slate-600 mb-1 text-right">광고</p>
            <AdFit unit="DAN-srccfxvxgEOdHPPB" width={300} height={250} />
          </div>
        </div>
      </div>
    </div>
  );
}
