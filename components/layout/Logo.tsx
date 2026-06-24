export default function Logo({ className }: { className?: string }) {
  return (
    <svg
      width="140"
      height="40"
      viewBox="0 0 140 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="chartGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <linearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#818cf8" />
          <stop offset="100%" stopColor="#34d399" />
        </linearGradient>
      </defs>

      {/* 차트 아이콘 */}
      <polyline
        points="2,30 8,20 14,25 20,12 26,17 32,5"
        stroke="url(#chartGrad)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="32" cy="5" r="2.5" fill="#10b981" />

      {/* FINANCE */}
      <text
        x="38"
        y="18"
        fontFamily="Inter, Pretendard, sans-serif"
        fontWeight="800"
        fontSize="14"
        letterSpacing="1.5"
        fill="white"
      >
        FINANCE
      </text>

      {/* PARK — 그라디언트 */}
      <text
        x="38"
        y="34"
        fontFamily="Inter, Pretendard, sans-serif"
        fontWeight="800"
        fontSize="14"
        letterSpacing="1.5"
        fill="url(#textGrad)"
      >
        PARK
      </text>
    </svg>
  );
}
