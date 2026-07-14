'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Landmark, Users } from 'lucide-react';

const TABS = [
  { href: '/admin/payments', label: '결제 승인', icon: Landmark },
  { href: '/admin/users',    label: '회원 관리', icon: Users },
];

export default function AdminTabs() {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-20 border-b border-slate-800/70" style={{ background: 'rgba(10,12,18,0.9)', backdropFilter: 'blur(8px)' }}>
      <div className="max-w-6xl mx-auto px-4 flex items-center gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const active = pathname?.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex items-center gap-1.5 px-4 py-3.5 text-[13.5px] font-semibold whitespace-nowrap border-b-2 transition-colors ${
                active ? 'text-white border-indigo-500' : 'text-slate-500 border-transparent hover:text-slate-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
