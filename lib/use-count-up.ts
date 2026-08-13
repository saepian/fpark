'use client';

import { useEffect, useRef, useState } from 'react';

const COUNT_UP_DURATION_MS = 500;

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

// 스탯카드 숫자가 5분 폴링 등으로 바뀔 때 이전값→새값으로 롤링되는 카운팅 애니메이션.
// 최초 마운트 시에는 0부터 세지 않고 바로 실제값을 보여준다 — 값이 바뀔 때만 애니메이션.
// 포맷팅(콤마·원·% 등)은 호출부가 반환된 숫자에 그대로 적용하면 된다.
export function useCountUp(value: number, durationMs = COUNT_UP_DURATION_MS): number {
  const [displayed, setDisplayed] = useState(value);
  const rafRef = useRef<number | undefined>(undefined);
  const hasMountedRef = useRef(false);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      setDisplayed(value);
      return;
    }

    const from = displayed;
    const to = value;
    if (from === to) return;

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setDisplayed(from + (to - from) * easeOutCubic(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs]);

  return displayed;
}
