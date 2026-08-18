interface AiLoadingOverlayProps {
  title: string;
  subtitle?: string;
}

// diagnosis/portfolio-diagnosis에서 쓰던 이중 링 스피너 오버레이를 공용화(2026-08-18) —
// 대시보드 최초 로딩이 작은 스피너만 써서 화면 대비 아이콘이 너무 작다는 신고로 통일.
export default function AiLoadingOverlay({ title, subtitle }: AiLoadingOverlayProps) {
  return (
    <div className="fixed inset-0 bg-[#0d1117]/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center gap-8">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-indigo-500/20" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-indigo-500 animate-spin" />
        <div className="absolute inset-2 rounded-full border-4 border-transparent border-t-emerald-400 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '0.8s' }} />
      </div>
      <div className="text-center mb-2">
        <p className="text-white font-semibold text-lg mb-1">{title}</p>
        {subtitle && <p className="text-slate-400 text-sm">{subtitle}</p>}
      </div>
    </div>
  );
}
