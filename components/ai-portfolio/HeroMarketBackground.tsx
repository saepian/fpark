// 히어로 배경 — 은은하게 움직이는 라인차트/캔들 패턴 (SVG + CSS 애니메이션).
// 정적 SVG라 서버에서 바로 렌더 가능 — 'use client' 불필요, JS 상태도 없음.
// prefers-reduced-motion: reduce 환경에서는 globals.css의 미디어쿼리로 애니메이션이 꺼진다.

type Candle = { x: number; open: number; close: number; up: boolean; delay: number };

const CANDLE_BASE_Y = 440;

const CANDLES: Candle[] = [
  { x: 40,   open: 30,  close: 55,  up: true,  delay: 0.0 },
  { x: 112,  open: 55,  close: 40,  up: false, delay: 0.3 },
  { x: 184,  open: 40,  close: 70,  up: true,  delay: 0.6 },
  { x: 256,  open: 70,  close: 58,  up: false, delay: 0.9 },
  { x: 328,  open: 58,  close: 90,  up: true,  delay: 1.2 },
  { x: 400,  open: 90,  close: 75,  up: false, delay: 1.5 },
  { x: 472,  open: 75,  close: 110, up: true,  delay: 1.8 },
  { x: 544,  open: 110, close: 95,  up: false, delay: 2.1 },
  { x: 616,  open: 95,  close: 60,  up: false, delay: 2.4 },
  { x: 688,  open: 60,  close: 100, up: true,  delay: 2.7 },
  { x: 760,  open: 100, close: 130, up: true,  delay: 3.0 },
  { x: 832,  open: 130, close: 112, up: false, delay: 3.3 },
  { x: 904,  open: 112, close: 145, up: true,  delay: 3.6 },
  { x: 976,  open: 145, close: 128, up: false, delay: 3.9 },
  { x: 1048, open: 128, close: 160, up: true,  delay: 4.2 },
  { x: 1120, open: 160, close: 150, up: false, delay: 4.5 },
  { x: 1192, open: 150, close: 180, up: true,  delay: 4.8 },
  { x: 1264, open: 180, close: 165, up: false, delay: 5.1 },
  { x: 1336, open: 165, close: 195, up: true,  delay: 5.4 },
  { x: 1400, open: 195, close: 178, up: false, delay: 5.7 },
];

// 캔들 종가를 따라가는 라인차트 — 자금 흐름을 관찰하는 서비스 톤에 맞춰 단조로운 상승보다
// 오르내림이 섞인 경로로 구성
const LINE_PATH =
  'M0,300 L80,270 L160,285 L240,230 L320,255 L400,190 L480,215 L560,150 ' +
  'L640,185 L720,130 L800,160 L880,110 L960,145 L1040,95 L1120,135 L1200,90 ' +
  'L1280,120 L1360,80 L1440,105';

export default function HeroMarketBackground() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden="true">
      <svg
        viewBox="0 0 1440 480"
        preserveAspectRatio="xMidYMid slice"
        className="w-full h-full opacity-[0.16]"
      >
        {/* 격자 — 차트 느낌의 배경 텍스처 */}
        {Array.from({ length: 6 }).map((_, i) => (
          <line
            key={i}
            x1={0}
            x2={1440}
            y1={i * 80}
            y2={i * 80}
            stroke="#8B92A8"
            strokeWidth={1}
            strokeOpacity={0.25}
          />
        ))}

        {/* 캔들스틱 — 종가 기준 상승/하락, 최소한만 레드 사용 */}
        {CANDLES.map((c, i) => {
          const top = CANDLE_BASE_Y - Math.max(c.open, c.close);
          const height = Math.max(Math.abs(c.close - c.open), 6);
          const color = c.up ? '#3ECF8E' : '#F0483E';
          return (
            <g key={i} className="lp-candle" style={{ animationDelay: `${c.delay}s` }}>
              <line
                x1={c.x + 6} x2={c.x + 6}
                y1={CANDLE_BASE_Y - Math.max(c.open, c.close) - 14}
                y2={CANDLE_BASE_Y - Math.min(c.open, c.close) + 6}
                stroke={color}
                strokeOpacity={0.5}
                strokeWidth={1.5}
              />
              <rect
                x={c.x} y={top}
                width={12} height={height}
                fill={color}
                fillOpacity={0.55}
                rx={1.5}
              />
            </g>
          );
        })}

        {/* 흐르는 라인차트 */}
        <path
          d={LINE_PATH}
          fill="none"
          stroke="#3ECF8E"
          strokeWidth={2}
          strokeOpacity={0.7}
          strokeDasharray="10 6"
          className="lp-chart-line"
        />
      </svg>

      {/* 하단 페이드 — 텍스트 영역과 자연스럽게 섞이도록 */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(180deg, rgba(11,13,18,0) 0%, #0B0D12 92%)' }}
      />
    </div>
  );
}
