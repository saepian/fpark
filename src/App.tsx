/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';

import Header from '../components/layout/Header';
import Footer from '../components/layout/Footer';
import HeroNews from '../components/main/HeroNews';
import NewsFeed from '../components/main/NewsFeed';
import TopMovers from '../components/main/TopMovers';
import MarketSummary from '../components/main/MarketSummary';
import AiInsightCard from '../components/main/AiInsightCard';
import AdSlot from '../components/main/AdSlot';

import StockHeader from '../components/stock/StockHeader';
import StockMetrics from '../components/stock/StockMetrics';
import StockChart from '../components/stock/StockChart';
import AiAnalysis from '../components/stock/AiAnalysis';
import RelatedNews from '../components/stock/RelatedNews';
import SectorStocks from '../components/stock/SectorStocks';

import { mockStocks, getStockData, getRelatedNews, NewsItem } from '../lib/mock-data';

export default function App() {
  const [view, setView] = useState<'main' | 'stock'>('main');
  const [selectedTicker, setSelectedTicker] = useState<string>('005930');
  const [stock, setStock] = useState<typeof mockStocks[string] | null>(null);
  const [relatedNews, setRelatedNews] = useState<NewsItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeTheme, setActiveTheme] = useState<'dark' | 'light'>('dark');

  useEffect(() => {
    // Sync current HTML element theme class
    const root = window.document.documentElement;
    if (activeTheme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [activeTheme]);

  useEffect(() => {
    // Fetch data matching current ticker on change
    const updateStockDetail = async () => {
      const stockData = await getStockData(selectedTicker);
      setStock(stockData);
      
      const newsData = await getRelatedNews(selectedTicker);
      setRelatedNews(newsData);
    };
    updateStockDetail();
  }, [selectedTicker]);

  const handleSelectStock = (ticker: string) => {
    setSelectedTicker(ticker);
    setView('stock');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGoHome = () => {
    setView('main');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectNews = (id: string) => {
    // Simply route to respective stock details based on news indexing
    if (id === 's1' || id === 'n1') {
      handleSelectStock('005930'); // Samsung Electronics
    } else if (id === 'n3') {
      handleSelectStock('000660'); // SK Hynix
    } else {
      handleSelectStock('035420'); // NAVER
    }
  };

  const toggleTheme = () => {
    setActiveTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  return (
    <div id="app-root" className="min-h-screen bg-[#f4f6f9] dark:bg-[#0f1117] text-[#0f1117] dark:text-[#d4e4fa] font-sans transition-colors duration-300">
      {/* Floating Theme Controller for visual quality checking */}
      <button
        id="theme-toggler"
        onClick={toggleTheme}
        className="fixed bottom-6 right-6 z-[120] p-3 rounded-full bg-blue-600 dark:bg-[#122131] text-white dark:text-[#adc6ff] shadow-2xl border border-blue-500/30 font-bold text-xs select-none hover:opacity-90 active:scale-95 transition-all"
        title="화면 테마 전환"
      >
        {activeTheme === 'dark' ? '☀️ 라이트모드' : '🌙 다크모드'}
      </button>

      {/* Shared Layout Header */}
      <Header
        onSelectStock={handleSelectStock}
        onGoHome={handleGoHome}
        activeCategory={activeCategory}
        onSelectCategory={setActiveCategory}
      />

      {/* Main Pages router viewport */}
      <AnimatePresence mode="wait">
        {view === 'main' ? (
          <motion.div
            key="main"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            id="main-view"
            className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-8"
          >
            {/* Top Banner News */}
            <HeroNews onClick={() => handleSelectStock('005930')} />

            {/* Layout grids */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Left Column: high density news segments (8 cols) */}
              <div className="col-span-12 lg:col-span-8 space-y-8">
                <NewsFeed onSelectNews={handleSelectNews} onSelectStock={handleSelectStock} />
              </div>

              {/* Right Column: analytics widgets sidebars (4 cols) */}
              <aside className="col-span-12 lg:col-span-4 space-y-8">
                <MarketSummary />
                <TopMovers onSelectStock={handleSelectStock} />
                <AiInsightCard onReadReport={handleSelectStock} />
                <AdSlot size="sidebar" />
              </aside>
            </div>
          </motion.div>
        ) : (
          stock && (
            <motion.div
              key="stock-detail"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.35, ease: 'easeInOut' }}
              id="stock-view"
              className="max-w-7xl mx-auto px-4 md:px-8 py-8 space-y-6"
            >
              {/* Navigation Return Button */}
              <button
                id="back-to-home"
                onClick={handleGoHome}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-gray-500 hover:text-blue-600 dark:text-[#8c909f] dark:hover:text-blue-400 bg-white dark:bg-[#1a1d27]/40 border border-gray-200 dark:border-[#2d313e] rounded-lg transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>메인화면으로 돌아가기</span>
              </button>

              {/* Dynamic stock header components */}
              <StockHeader stock={stock} />

              <div className="grid grid-cols-12 gap-8">
                {/* Main chart, metrics and news grids */}
                <div className="col-span-12 lg:col-span-8 space-y-6">
                  <StockMetrics stock={stock} />
                  <StockChart stock={stock} />
                  <AiAnalysis stock={stock} />
                  <AdSlot size="banner" />
                  <RelatedNews news={relatedNews} onSelectNews={handleSelectNews} />
                </div>

                {/* Right side suggestions panels */}
                <aside className="col-span-12 lg:col-span-4 space-y-6 animate-fade-in">
                  <SectorStocks
                    currentTicker={stock.ticker}
                    sectorName={stock.sector}
                    onSelectStock={handleSelectStock}
                  />

                  {/* High Quality Kampaign ad visualizer */}
                  <div className="aspect-square bg-white dark:bg-[#122131] border border-gray-200 dark:border-[#2d313e] flex flex-col items-center justify-center p-8 text-center relative overflow-hidden rounded-lg shadow-sm">
                    <div className="absolute inset-0 opacity-5 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-500 via-transparent to-transparent"></div>
                    <span className="text-[9px] font-mono font-bold tracking-widest text-gray-400 dark:text-outline-variant uppercase absolute top-2 right-3">AD</span>
                    <div className="w-12 h-12 rounded-full bg-blue-50 dark:bg-[#1a1d27] text-blue-500 dark:text-blue-400 flex items-center justify-center mb-4 shadow-sm">
                      <span className="material-symbols-outlined text-3xl">monitoring</span>
                    </div>
                    <h4 className="font-sans font-extrabold text-[#d4e4fa] mb-1.5 text-sm uppercase tracking-wide">
                      실시간 호가 체결 엔진
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
                      0.001초의 극미세 트레이딩 지연성 개선으로<br />진정한 프로들의 포트폴리오 자산을 리드합니다.
                    </p>
                    <button className="w-full py-2.5 bg-gray-900 text-white dark:bg-white dark:text-black font-extrabold text-xs tracking-wider rounded border border-gray-300 dark:border-white shadow-md hover:bg-blue-600 dark:hover:bg-blue-500 dark:hover:text-white transition-all">
                      GET PRO ACCESS
                    </button>
                  </div>

                  {/* Simulated analysis histogram trend bars matching mockup */}
                  <div className="bg-[#122131] dark:bg-[#122131] border border-gray-200 dark:border-[#2d313e] p-5 rounded-lg shadow-sm">
                    <p className="text-[10px] font-bold text-gray-400 dark:text-[#8c909f] uppercase mb-4 tracking-wider">
                      Term Dynamics Analysis
                    </p>
                    <div className="h-24 w-full flex items-end gap-1.5 pt-2">
                      <div className="flex-1 bg-blue-500/20 dark:bg-blue-400/20 h-1/2 rounded-t-sm"></div>
                      <div className="flex-1 bg-blue-500/30 dark:bg-blue-400/30 h-3/4 rounded-t-sm"></div>
                      <div className="flex-1 bg-blue-500/20 dark:bg-blue-400/20 h-2/3 rounded-t-sm"></div>
                      <div className="flex-1 bg-blue-500/40 dark:bg-blue-400/40 h-[92%] rounded-t-sm"></div>
                      <div className="flex-1 bg-blue-500/30 dark:bg-blue-400/30 h-5/6 rounded-t-sm"></div>
                      <div className="flex-1 bg-blue-500/50 dark:bg-blue-400/50 h-[80%] rounded-t-sm animate-pulse"></div>
                      <div className="flex-1 bg-blue-500/60 dark:bg-blue-400/60 h-[98%] rounded-t-sm"></div>
                    </div>
                    <div className="flex justify-between mt-2.5 text-[9px] text-gray-400 dark:text-gray-500 font-mono font-bold uppercase tracking-widest">
                      <span>MON</span>
                      <span>WED</span>
                      <span>FRI</span>
                    </div>
                  </div>
                </aside>
              </div>
            </motion.div>
          )
        )}
      </AnimatePresence>

      {/* Shared Layout Footer */}
      <Footer />
    </div>
  );
}
