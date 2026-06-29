import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';
import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';

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
      <body className="antialiased min-h-screen bg-[#f4f6f9] dark:bg-[#0f1117] text-[#0f1117] dark:text-[#d4e4fa] font-sans transition-colors duration-300">
        <Header />
        {children}
        <Footer />
        {process.env.NEXT_PUBLIC_KAKAO_JS_KEY && (
          <Script
            src="https://t1.kakaocdn.net/kakao_js_sdk/2.7.2/kakao.min.js"
            strategy="afterInteractive"
            onLoad={() => {
              if (window.Kakao && !window.Kakao.isInitialized()) {
                window.Kakao.init(process.env.NEXT_PUBLIC_KAKAO_JS_KEY!);
              }
            }}
          />
        )}
      </body>
    </html>
  );
}
