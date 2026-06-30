import React from 'react';
import Link from 'next/link';
import Logo from './Logo';

export default function Footer() {
  return (
    <footer id="footer-container" className="w-full pt-10 pb-8 px-4 md:px-8 bg-[#0d1c2d] border-t border-[#2d313e] mt-16">
      <div className="max-w-7xl mx-auto flex flex-col gap-8">

        {/* 상단: 로고 + 링크 */}
        <div className="flex flex-col md:flex-row justify-between items-center md:items-start gap-6">
          <div className="flex flex-col items-center md:items-start gap-2">
            <Link href="/">
              <Logo className="opacity-70 hover:opacity-100 transition-opacity" />
            </Link>
          </div>

          <div className="flex flex-wrap justify-center gap-6 text-xs text-[#8c909f]">
            <Link href="/about"   className="hover:text-[#adc6ff] transition-colors hover:underline">소개</Link>
            <Link href="/terms"   className="hover:text-[#adc6ff] transition-colors hover:underline">이용약관</Link>
            <Link href="/privacy" className="hover:text-[#adc6ff] transition-colors hover:underline">개인정보처리방침</Link>
            <Link href="/contact" className="hover:text-[#adc6ff] transition-colors hover:underline">문의하기</Link>
          </div>
        </div>

        {/* 하단: 사업자 정보 */}
        <div className="border-t border-[#2d313e] pt-6">
          <dl className="flex flex-col gap-y-1 text-[11px] text-[#6b7280]">
            <div className="flex flex-wrap gap-x-6">
              <div className="flex gap-1.5">
                <dt className="text-[#4b5563]">상호</dt>
                <dd>디지웹 디자인</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-[#4b5563]">대표자</dt>
                <dd>김대우</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-[#4b5563]">사업자등록번호</dt>
                <dd>730-08-00465</dd>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-6">
              <div className="flex gap-1.5">
                <dt className="text-[#4b5563]">주소</dt>
                <dd>서울특별시 강동구 암사동</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-[#4b5563]">연락처</dt>
                <dd>010-2198-9685</dd>
              </div>
              <div className="flex gap-1.5">
                <dt className="text-[#4b5563]">이메일</dt>
                <dd>
                  <a href="mailto:saepian2@gmail.com" className="hover:text-[#adc6ff] transition-colors">
                    saepian2@gmail.com
                  </a>
                </dd>
              </div>
            </div>
            <div className="mt-2">
              <p className="text-[11px] text-[#6b7280]">© 2026 Finance Park, All rights reserved.</p>
            </div>
          </dl>
        </div>

      </div>
    </footer>
  );
}
