import type { Metadata } from 'next';
import './globals.css';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import KakaoScript from '../components/KakaoScript';
import ChatWidget from '../components/ChatWidget';

export const metadata: Metadata = {
  title: 'FINANCE PARK - AI 기반 기업 데이터 분석 플랫폼',
  description: 'AI가 공개된 시장 데이터와 기업 정보를 분석하여 핵심 내용을 보기 쉽게 제공하는 데이터 분석 플랫폼입니다.',
  keywords: '기업분석, 데이터분석, AI분석, 코스피, 코스닥, 시장뉴스, 기업리포트, 시장데이터, 증시',
  metadataBase: new URL('https://fpark.com'),
  openGraph: {
    title: 'FINANCE PARK - AI 기반 기업 데이터 분석 플랫폼',
    description: 'AI가 분석하는 실시간 시장 데이터',
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
        <ChatWidget />
      </body>
    </html>
  );
}
