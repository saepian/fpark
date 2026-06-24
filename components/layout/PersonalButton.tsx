'use client';

import { useState } from 'react';

export default function PersonalButton() {
  const [hovered, setHovered] = useState(false);

  return (
    <div className="relative">
      <button
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className="relative p-2 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
        aria-label="개인화"
      >
        <svg
          className="w-4 h-4 text-slate-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth="2"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </button>

      {hovered && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 whitespace-nowrap shadow-xl">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-xs text-slate-300 font-medium">준비 중입니다</span>
          </div>
          <div className="absolute -top-1.5 right-3 w-3 h-3 bg-slate-800 border-l border-t border-slate-700 rotate-45" />
        </div>
      )}
    </div>
  );
}
