'use client';

import { useEffect } from 'react';

interface Props {
  message: string;
  onClose: () => void;
  type?: 'error' | 'success';
}

export default function Toast({ message, onClose, type = 'error' }: Props) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className={[
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999]',
        'text-white text-sm font-medium px-5 py-3 rounded-xl shadow-lg',
        'animate-fade-in whitespace-nowrap',
        type === 'error' ? 'bg-red-500' : 'bg-emerald-500',
      ].join(' ')}
    >
      {message}
    </div>
  );
}
