import React from 'react';
import Link from 'next/link';
import Logo from './Logo';

export default function Footer() {
  return (
    <footer id="footer-container" className="w-full py-8 px-4 md:px-8 bg-[#0d1c2d] border-t border-[#2d313e] mt-16">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
        <div className="flex flex-col items-center md:items-start gap-2">
          <Link href="/">
            <Logo className="opacity-70 hover:opacity-100 transition-opacity" />
          </Link>
          <p className="font-sans text-xs text-[#c2c6d6] text-center md:text-left">
            © 2026 fpark.com. All financial data is delayed by at least 15 minutes. Professional Terminal-Grade Insights.
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-6 text-xs text-[#8c909f]">
          <Link href="/terms" className="hover:text-[#adc6ff] transition-colors hover:underline">이용약관</Link>
          <Link href="/privacy" className="hover:text-[#adc6ff] transition-colors hover:underline">개인정보처리방침</Link>
          <a href="mailto:ad@fpark.com" className="hover:text-[#adc6ff] transition-colors hover:underline">Contact</a>
        </div>
      </div>
    </footer>
  );
}
