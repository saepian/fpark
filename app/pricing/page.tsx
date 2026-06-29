import type { Metadata } from 'next';
import PricingClient from './PricingClient';

export const metadata: Metadata = {
  title: '요금제 | fpark',
  description: 'AI 주식 분석 서비스 요금제. 종목진단, 포트폴리오 진단 플랜을 선택하세요.',
  openGraph: {
    title: '요금제 | fpark',
    description: 'AI가 분석하는 실시간 주식 인사이트 — 나에게 맞는 플랜을 선택하세요',
  },
};

export default function PricingPage() {
  return <PricingClient />;
}
