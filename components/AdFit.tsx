'use client';
import { useEffect, useRef } from 'react';

interface AdFitProps {
  unit: string;
  width: number;
  height: number;
}

export default function AdFit({ unit, width, height }: AdFitProps) {
  const adRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!adRef.current) return;
    if (!document.querySelector('script[src*="ba.min.js"]')) {
      const script = document.createElement('script');
      script.src = '//t1.kakaocdn.net/kas/static/ba.min.js';
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  return (
    <div ref={adRef} style={{ width, minHeight: height }}>
      <ins
        className="kakao_ad_area"
        style={{ display: 'none' }}
        data-ad-unit={unit}
        data-ad-width={String(width)}
        data-ad-height={String(height)}
      />
    </div>
  );
}
