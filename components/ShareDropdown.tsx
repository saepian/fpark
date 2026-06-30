'use client';

import { useEffect, useRef, useState } from 'react';
import { Share2, Link2, MessageCircle, Twitter, Check, Loader2 } from 'lucide-react';

interface ShareDropdownProps {
  title: string;
  description: string;
  hashtags?: string;
  reportType?: 'diagnosis' | 'portfolio';
  reportData?: unknown;
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


export default function ShareDropdown({ title, description, hashtags = 'fpark,주식', reportType, reportData }: ShareDropdownProps) {
  const [open,            setOpen]            = useState(false);
  const [copied,          setCopied]          = useState(false);
  const [shareUrl,        setShareUrl]        = useState<string | null>(null);
  const [isCreatingLink,  setIsCreatingLink]  = useState(false);
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
  const activeUrl  = shareUrl ?? currentUrl;

  const createShareLink = async () => {
    if (!reportData || shareUrl || isCreatingLink) return;
    setIsCreatingLink(true);
    try {
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: reportType, data: reportData }),
      });
      if (res.ok) {
        const { id } = await res.json();
        setShareUrl(`https://fpark.com/share/${id}`);
      }
    } catch {
      // 실패 시 현재 URL 사용
    } finally {
      setIsCreatingLink(false);
    }
  };

  const handleToggle = () => {
    const next = !open;
    console.log('[SHARE] 버튼 클릭 — open:', next, '/ shareUrl:', shareUrl, '/ isCreatingLink:', isCreatingLink);
    setOpen(next);
    if (next && reportData && !shareUrl) createShareLink();
  };

  // ── 링크 복사 ────────────────────────────────────────────────────
  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(activeUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API 미지원 시 fallback
      const el = document.createElement('textarea');
      el.value = activeUrl;
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
    console.log('[KAKAO] 카카오 공유 실행');
    console.log('[KAKAO] KAKAO_JS_KEY:', KAKAO_JS_KEY);
    console.log('[KAKAO] isInitialized:', window.Kakao?.isInitialized());
    console.log('[KAKAO] shareUrl:', shareUrl);
    console.log('[KAKAO] currentUrl:', currentUrl);
    console.log('[KAKAO] activeUrl (실제 전달 URL):', activeUrl);

    if (!KAKAO_JS_KEY || !window.Kakao?.isInitialized()) {
      console.warn('[Kakao Debug] ❌ 초기화 실패 — KAKAO_JS_KEY:', KAKAO_JS_KEY, '/ isInitialized:', window.Kakao?.isInitialized());
      alert('카카오 공유 기능을 준비 중입니다.');
      setOpen(false);
      return;
    }
    const linkUrl = activeUrl.startsWith('https://fpark.com')
      ? activeUrl
      : reportType === 'portfolio'
        ? 'https://fpark.com/portfolio-diagnosis'
        : 'https://fpark.com/diagnosis';

    const payload = {
      objectType: 'feed' as const,
      content: {
        title,
        description,
        imageUrl: OG_IMAGE,
        link: { mobileWebUrl: linkUrl, webUrl: linkUrl },
      },
      buttons: [
        { title: '리포트 보기', link: { mobileWebUrl: linkUrl, webUrl: linkUrl } },
      ],
    };
    console.log('[KAKAO] sendDefault payload:', JSON.stringify(payload, null, 2));

    try {
      window.Kakao!.Share.sendDefault(payload);
    } catch (e) {
      console.error('[Kakao Share] error:', e);
    }
    setOpen(false);
  };

  // ── 트위터/X 공유 ─────────────────────────────────────────────────
  const handleTwitter = () => {
    const tags = hashtags.split(',').join(' #');
    const text = `${description} #${tags}`;
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(activeUrl)}`;
    window.open(tweetUrl, '_blank', 'noopener,noreferrer');
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={handleToggle}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800/80 hover:bg-slate-700
          border border-slate-700 text-slate-400 text-[11px] font-semibold tracking-wide transition-colors cursor-pointer"
      >
        <Share2 className="w-3 h-3" /> SHARE
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl bg-[#1e2130] border border-slate-700/60 shadow-xl shadow-black/40 z-50 overflow-hidden">
          {/* 링크 생성 중 표시 */}
          {isCreatingLink && (
            <div className="flex items-center gap-2.5 px-4 py-3 text-[12px] text-slate-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              공유 링크 생성 중...
            </div>
          )}
          {/* 링크 복사 */}
          {!isCreatingLink && (
            <button
              onClick={handleCopyLink}
              className="w-full flex items-center gap-2.5 px-4 py-3 text-[12px] text-slate-300 hover:bg-slate-700/50 transition-colors cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Link2 className="w-3.5 h-3.5 text-slate-400" />}
              {copied ? '복사되었습니다!' : '링크 복사'}
            </button>
          )}

          <div className="h-px bg-slate-700/50 mx-3" />

          {/* 카카오톡 — 링크 생성 중에도 현재 URL로 즉시 공유 가능 */}
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
