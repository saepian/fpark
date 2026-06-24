'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import SearchDropdown from './SearchDropdown';
import type { SearchResult } from '../../lib/types';

interface SearchBarProps {
  onSelectStock: (ticker: string) => void;
}

export default function SearchBar({ onSelectStock }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const updateDropPos = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDropPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handler = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`);
        if (res.ok) {
          const data: SearchResult[] = await res.json();
          setResults(Array.isArray(data) ? data : []);
        }
      } catch {
        setResults([]);
      }
    }, 200);
    return () => clearTimeout(handler);
  }, [query]);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      const inContainer = containerRef.current?.contains(target);
      const inPortal = portalRef.current?.contains(target);
      if (!inContainer && !inPortal) setIsOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div id="search-bar-container" ref={containerRef} className="relative w-full max-w-sm">
      <div className="relative flex items-center bg-gray-100 dark:bg-[#010f1f] border border-gray-300 dark:border-[#2d313e] rounded-lg px-3.5 py-2 w-full transition-all focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
        <Search className="text-gray-400 dark:text-[#8c909f] w-4 h-4 mr-2" />
        <input
          id="search-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            updateDropPos();
            setIsOpen(true);
          }}
          onFocus={() => {
            updateDropPos();
            setIsOpen(true);
          }}
          className="bg-transparent border-none p-0 text-sm text-gray-900 dark:text-[#d4e4fa] focus:ring-0 w-full placeholder:text-gray-400 dark:placeholder:text-[#8c909f] focus:outline-none"
          placeholder="종목명 또는 코드 검색"
          type="text"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults([]); }}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-white"
          >
            ✕
          </button>
        )}
      </div>

      {mounted && isOpen && createPortal(
        <div
          ref={portalRef}
          style={{
            position: 'fixed',
            top: dropPos.top,
            left: dropPos.left,
            width: dropPos.width,
            zIndex: 99999,
          }}
        >
          <SearchDropdown
            results={results}
            onSelect={(ticker) => {
              onSelectStock(ticker);
              setIsOpen(false);
              setQuery('');
            }}
            onClose={() => setIsOpen(false)}
            query={query}
          />
        </div>,
        document.body
      )}
    </div>
  );
}
