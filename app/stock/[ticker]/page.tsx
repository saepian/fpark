import type { Metadata } from 'next';
import StockHeader from '../../../components/stock/StockHeader';
import StockMetrics from '../../../components/stock/StockMetrics';
import StockChart from '../../../components/stock/StockChart';
import DailyPriceTable from '../../../components/stock/DailyPriceTable';
import AiAnalysis from '../../../components/stock/AiAnalysis';
import RelatedNews from '../../../components/stock/RelatedNews';
import WeeklyChart from '../../../components/stock/WeeklyChart';
import InvestorFlow from '../../../components/stock/InvestorFlow';
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
        {/* 좌측: 지표 + 차트 + 일별동향 + AI분석 + 관련뉴스 */}
        <div className="col-span-12 lg:col-span-8 space-y-6">
          <StockMetrics ticker={ticker} />
          <StockChart ticker={ticker} />
          <DailyPriceTable ticker={ticker} />
          <AiAnalysis ticker={ticker} />
          <RelatedNews ticker={ticker} />
        </div>
        {/* 우측: 5일 등락률 + 투자자별 매매 동향 */}
        <div className="flex flex-col gap-4 col-span-12 lg:col-span-4">
          <WeeklyChart ticker={ticker} />
          <InvestorFlow ticker={ticker} />
        </div>
      </div>
    </div>
  );
}
