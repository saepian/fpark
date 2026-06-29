'use client';

import { useEffect, useRef, useState } from 'react';
import { Share2, Link2, MessageCircle, Twitter, Check } from 'lucide-react';

interface ShareDropdownProps {
  title: string;
  description: string;
  hashtags?: string; // 쉼표 구분 (공백 없이)
}

declare global {
  interface Window {
    Kakao?: {
      isInitialized: () => boolean;
      init: (key: string) => void;
      Share: {
        sendDefault: (options: object) => void;
      };
    };
  }
}

const KAKAO_JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
const OG_IMAGE     = 'https://fpark.com/og-image.png';


export default function ShareDropdown({ title, description, hashtags = 'fpark,주식' }: ShareDropdownProps) {
  const [open,   setOpen]   = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentUrl = typeof window !== 'undefined' ? window.location.href : '';

  // ── 링크 복사 ────────────────────────────────────────────────────
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API 미지원 시 fallback
      const el = document.createElement('textarea');
      el.value = currentUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
    setOpen(false);
  };

  // ── 카카오톡 공유 ────────────────────────────────────────────────
  const handleKakao = () => {
    if (!KAKAO_JS_KEY || !window.Kakao?.isInitialized()) {
      alert('카카오 공유 기능을 준비 중입니다.');
      setOpen(false);
      return;
    }
    try {
      window.Kakao!.Share.sendDefault({
        objectType: 'feed',
        content: {
          title,
          description,
          imageUrl: OG_IMAGE,
          link: { mobileWebUrl: currentUrl, webUrl: currentUrl },
        },
        buttons: [{ title: '리포트 보기', link: { mobileWebUrl: currentUrl, webUrl: currentUrl } }],
      });
    } catch (e) {
      console.error('[Kakao Share]', e);
      alert('카카오 공유에 실패했습니다.');
    }
    setOpen(false);
  };

  // ── 트위터/X 공유 ─────────────────────────────────────────────────
  const handleTwitter = () => {
    const tags = hashtags.split(',').join(' #');
    const text = `${description} #${tags}`;
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(currentUrl)}`;
    window.open(tweetUrl, '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700
          border border-slate-700 text-slate-400 text-[11px] font-semibold tracking-wide transition-colors cursor-pointer"
      >
        <Share2 className="w-3 h-3" /> SHARE
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl bg-[#1e2130] border border-slate-700/60 shadow-xl shadow-black/40 z-50 overflow-hidden">
          {/* 링크 복사 */}
          <button
            onClick={handleCopyLink}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-[12px] text-slate-300 hover:bg-slate-700/50 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5 text-slate-400" />}
            {copied ? '복사되었습니다!' : '링크 복사'}
          </button>

          <div className="h-px bg-slate-700/50 mx-3" />

          {/* 카카오톡 */}
          <button
            onClick={handleKakao}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-[12px] text-slate-300 hover:bg-slate-700/50 transition-colors cursor-pointer"
          >
            <MessageCircle className="w-3.5 h-3.5 text-yellow-400" />
            카카오톡 공유
          </button>

          <div className="h-px bg-slate-700/50 mx-3" />

          {/* 트위터/X */}
          <button
            onClick={handleTwitter}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-[12px] text-slate-300 hover:bg-slate-700/50 transition-colors cursor-pointer"
          >
            <Twitter className="w-3.5 h-3.5 text-sky-400" />
            트위터(X) 공유
          </button>
        </div>
      )}
    </div>
  );
}
