'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// 2026-08-12: 기업분석/포트폴리오진단 타이핑효과 조사에서, Claude API 자체가 SSE 델타를
// ~650ms마다 30~90자씩 뭉쳐서 보낸다는 걸 실측으로 확인(.e2e-tmp/typing-delta-measure*.mjs) —
// 서버(StreamingFieldParser)는 받은 델타를 그대로 즉시 전달할 뿐이라 화면도 "글자 단위"가
// 아니라 "델타 단위(문장 조각)"로 뭉텅뭉텅 나타났다. 서버·엔드투엔드 지연은 그대로 두고
// (field-partial은 여전히 도착 즉시 반영), 화면에 "보여주는 길이"만 별도로 들고 있다가
// 일정 속도로 목표 길이까지 따라잡는 방식으로 프론트에서만 매끄럽게 만든다.

const CHARS_PER_SECOND = 35;

interface FieldState {
  target: string;
  shown: string;
  done: boolean; // snap() 이후 — 더 이상 feed()로 자라지 않음(같은 세션 내 재사용 방지)
}

export interface RevealedField {
  text: string;
  active: boolean; // 아직 목표 길이를 못 따라잡은 상태(커서 표시용)
}

export interface SmoothTypingText {
  revealed: Record<string, RevealedField>;
  // field-partial 이벤트마다 호출 — 목표 문자열만 갱신, 화면 반영은 rAF 루프가 서서히 진행.
  feed: (key: string, target: string) => void;
  // 그 필드의 최종 확정값(field 이벤트)이 도착했을 때 호출 — 애니메이션 진행과 무관하게 즉시 전체 노출.
  snap: (key: string, value: string) => void;
  // 스트림 종료/에러 등 모든 종료 경로에서 호출 — 그 시점까지 덜 따라잡은 필드가 있으면 전부 즉시 스냅.
  snapAll: () => void;
  // 새 생성 시작 시 호출 — 이전 세션의 잔여 애니메이션 상태를 전부 지운다.
  reset: () => void;
}

export function useSmoothTypingText(charsPerSecond: number = CHARS_PER_SECOND): SmoothTypingText {
  const [revealed, setRevealed] = useState<Record<string, RevealedField>>({});
  const stateRef = useRef<Record<string, FieldState>>({});
  const carryRef = useRef<Record<string, number>>({}); // 키별 소수점 이월 글자수(누적 후 정수만 반영)
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastTsRef.current = null;
  }, []);

  const ensureLoopRunning = useCallback(() => {
    if (rafRef.current !== null) return;

    const tick = (ts: number) => {
      const last = lastTsRef.current ?? ts;
      const dt = (ts - last) / 1000;
      lastTsRef.current = ts;

      let changed = false;
      let anyActive = false;
      const next: Record<string, RevealedField> = {};

      for (const [key, st] of Object.entries(stateRef.current)) {
        if (st.shown.length < st.target.length) {
          const carry = (carryRef.current[key] ?? 0) + charsPerSecond * dt;
          const advance = Math.floor(carry);
          carryRef.current[key] = carry - advance;
          if (advance > 0) {
            const newLen = Math.min(st.target.length, st.shown.length + advance);
            if (newLen !== st.shown.length) {
              st.shown = st.target.slice(0, newLen);
              changed = true;
            }
          }
        }
        const active = st.shown.length < st.target.length;
        if (active) anyActive = true;
        next[key] = { text: st.shown, active };
      }

      if (changed) setRevealed(next);

      if (anyActive) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        stopLoop();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [charsPerSecond, stopLoop]);

  const feed = useCallback((key: string, target: string) => {
    const st = stateRef.current[key];
    if (st?.done) return; // 이미 확정 스냅된 필드 — 뒤늦게 도착한 partial은 무시(방어적)
    stateRef.current[key] = st
      ? { ...st, target }
      : { target, shown: '', done: false };
    ensureLoopRunning();
  }, [ensureLoopRunning]);

  const snap = useCallback((key: string, value: string) => {
    stateRef.current[key] = { target: value, shown: value, done: true };
    delete carryRef.current[key];
    setRevealed(prev => (
      prev[key]?.text === value && prev[key]?.active === false
        ? prev
        : { ...prev, [key]: { text: value, active: false } }
    ));
  }, []);

  const snapAll = useCallback(() => {
    let changed = false;
    const next: Record<string, RevealedField> = {};
    for (const [key, st] of Object.entries(stateRef.current)) {
      if (st.shown.length !== st.target.length) changed = true;
      st.shown = st.target;
      st.done = true;
      next[key] = { text: st.shown, active: false };
    }
    if (changed) setRevealed(prev => ({ ...prev, ...next }));
    stopLoop();
  }, [stopLoop]);

  const reset = useCallback(() => {
    stopLoop();
    stateRef.current = {};
    carryRef.current = {};
    setRevealed({});
  }, [stopLoop]);

  useEffect(() => stopLoop, [stopLoop]);

  return { revealed, feed, snap, snapAll, reset };
}
