export default function Logo({ className }: { className?: string }) {
  return (
    <svg
      width="180"
      height="36"
      viewBox="0 0 180 36"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="50%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
      </defs>

      {/* 차트 상승선 아이콘 */}
      <polyline
        points="4,28 10,20 16,24 22,12 28,16 34,6"
        stroke="url(#logoGrad)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* 마지막 점 강조 */}
      <circle cx="34" cy="6" r="2.5" fill="#10b981" />

      {/* FINANCE 텍스트 */}
      <text
        x="42"
        y="16"
        fontFamily="'Inter', 'Pretendard', sans-serif"
        fontWeight="800"
        fontSize="13"
        letterSpacing="2"
        fill="white"
      >
        FINANCE
      </text>

      {/* PARK 텍스트 — 그라디언트 */}
      <text
        x="42"
        y="30"
        fontFamily="'Inter', 'Pretendard', sans-serif"
        fontWeight="800"
        fontSize="13"
        letterSpacing="2"
        fill="url(#logoGrad)"
      >
        PARK
      </text>

      {/* 구분선 */}
      <line
        x1="108"
        y1="8"
        x2="108"
        y2="30"
        stroke="#334155"
        strokeWidth="1"
      />

      {/* fpark.com 서브텍스트 */}
      <text
        x="114"
        y="22"
        fontFamily="'JetBrains Mono', monospace"
        fontWeight="500"
        fontSize="10"
        fill="#64748b"
        letterSpacing="0.5"
      >
        fpark.com
      </text>
    </svg>
  );
}
