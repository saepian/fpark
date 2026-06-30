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
      Share: { sendDefault: (options: object) => void };
    };
  }
}

const OG_IMAGE = 'https://fpark.com/og-image.png';

export default function ShareDropdown({
  title, description, hashtags = 'fpark,주식', reportType, reportData,
}: ShareDropdownProps) {
  const [open,           setOpen]           = useState(false);
  const [copied,         setCopied]         = useState(false);
  const [shareUrl,       setShareUrl]       = useState<string | null>(null);
  const [isCreatingLink, setIsCreatingLink] = useState(false);
  const ref        = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const fallbackUrl = reportType === 'portfolio'
    ? 'https://fpark.com/portfolio-diagnosis'
    : 'https://fpark.com/diagnosis';

  // UUID 공유 URL 반환 (이미 있으면 즉시, 없으면 생성 후 반환)
  // 동시 호출이 여러 번 와도 단일 fetch만 실행
  const getOrCreateShareUrl = (): Promise<string> => {
    if (shareUrl) return Promise.resolve(shareUrl);
    if (pendingRef.current) return pendingRef.current;
    if (!reportData) return Promise.resolve(fallbackUrl);

    setIsCreatingLink(true);
    const p = fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: reportType, data: reportData }),
    })
      .then(res => (res.ok ? res.json() : null))
      .then(json => {
        if (json?.id) {
          const url = `https://fpark.com/share/${json.id}`;
          setShareUrl(url);
          return url;
        }
        return fallbackUrl;
      })
      .catch(() => fallbackUrl)
      .finally(() => {
        setIsCreatingLink(false);
        pendingRef.current = null;
      });

    pendingRef.current = p;
    return p;
  };

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    // 드롭다운 열릴 때 미리 링크 생성 시작 (완료 전에 각 버튼 클릭해도 같은 promise 재사용)
    if (next) getOrCreateShareUrl();
  };

  // ── 링크 복사 ────────────────────────────────────────────────────
  const handleCopyLink = async () => {
    const url = await getOrCreateShareUrl();
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setOpen(false);
  };

  // ── 카카오톡 공유 (임시: navigator.share / 클립보드 폴백) ──────────
  // TODO: Kakao 비즈니스 채널 연결 해제 후 아래 _handleKakaoSDK 로 교체
  const handleKakao = async () => {
    setOpen(false);
    const kakaoUrl = await getOrCreateShareUrl();

    if (typeof navigator !== 'undefined' && navigator.share) {
      // 모바일: OS 네이티브 공유 시트 → 카카오톡 선택 가능
      try {
        await navigator.share({ title, text: description, url: kakaoUrl });
      } catch {
        // 사용자가 공유 취소한 경우 무시
      }
    } else {
      // 데스크톱: 클립보드 복사 후 안내
      try {
        await navigator.clipboard.writeText(kakaoUrl);
      } catch {
        const el = document.createElement('textarea');
        el.value = kakaoUrl;
        document.body.appendChild(el);
        el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── (보존) 카카오 SDK sendDefault — 채널 연결 해제 후 재활성화 ────
  // const _handleKakaoSDK = async () => {
  //   if (!window.Kakao?.isInitialized()) return;
  //   const kakaoUrl = await getOrCreateShareUrl();
  //   window.Kakao!.Share.sendDefault({
  //     objectType: 'feed',
  //     content: {
  //       title, description,
  //       imageUrl: OG_IMAGE,
  //       link: { webUrl: kakaoUrl, mobileWebUrl: kakaoUrl },
  //     },
  //     buttons: [{ title: '리포트 보기', link: { webUrl: kakaoUrl, mobileWebUrl: kakaoUrl } }],
  //   });
  // };

  // ── 트위터/X 공유 ─────────────────────────────────────────────────
  const handleTwitter = async () => {
    const url = await getOrCreateShareUrl();
    const tags = hashtags.split(',').join(' #');
    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${description} #${tags}`)}&url=${encodeURIComponent(url)}`;
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

          {/* 링크 복사 */}
          <button
            onClick={handleCopyLink}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-[12px] text-slate-300 hover:bg-slate-700/50 transition-colors cursor-pointer"
          >
            {copied
              ? <Check className="w-3.5 h-3.5 text-emerald-400" />
              : isCreatingLink
                ? <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" />
                : <Link2 className="w-3.5 h-3.5 text-slate-400" />}
            {copied ? '복사되었습니다!' : '링크 복사'}
          </button>

          <div className="h-px bg-slate-700/50 mx-3" />

          {/* 카카오톡 */}
          <button
            onClick={handleKakao}
            className="w-full flex items-center gap-2.5 px-4 py-3 text-[12px] text-slate-300 hover:bg-slate-700/50 transition-colors cursor-pointer"
          >
            {isCreatingLink
              ? <Loader2 className="w-3.5 h-3.5 text-yellow-400/60 animate-spin" />
              : <MessageCircle className="w-3.5 h-3.5 text-yellow-400" />}
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
