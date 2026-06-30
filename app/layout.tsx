import type { Metadata } from 'next';
import './globals.css';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import KakaoScript from '../components/KakaoScript';

export const metadata: Metadata = {
  title: 'FINANCE PARK - AI 기반 실시간 주식 분석',
  description: 'AI가 분석하는 실시간 주식 인사이트. 최신 뉴스와 시장 데이터를 종합한 맞춤형 투자 정보를 제공합니다.',
  keywords: '주식, 주식분석, AI투자, 코스피, 코스닥, 주식뉴스, 종목분석, 주가, 증시',
  metadataBase: new URL('https://fpark.com'),
  openGraph: {
    title: 'FINANCE PARK - AI 기반 실시간 주식 분석',
    description: 'AI가 분석하는 실시간 주식 인사이트',
    url: 'https://fpark.com',
    siteName: 'FINANCE PARK',
    locale: 'ko_KR',
    type: 'website',
  },
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
  },
  verification: {
    google: '_zLUDAWsjlMCVk0mOCIMy3dThe_H97QfGDJNXeXYXfY',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <body className="antialiased min-h-screen flex flex-col bg-[#f4f6f9] dark:bg-[#0f1117] text-[#0f1117] dark:text-[#d4e4fa] font-sans transition-colors duration-300">
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
        <KakaoScript />
      </body>
    </html>
  );
}
