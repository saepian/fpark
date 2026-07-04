import type { Metadata } from 'next';
import PricingClient from './PricingClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '요금제 | fpark',
  description: 'AI 기업 데이터 분석 서비스 요금제. 기업 분석, 포트폴리오 분석 플랜을 선택하세요.',
  openGraph: {
    title: '요금제 | fpark',
    description: 'AI가 분석하는 실시간 시장 데이터 — 나에게 맞는 플랜을 선택하세요',
  },
};

export default function PricingPage() {
  return <PricingClient />;
}
