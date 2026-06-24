'use client';

import React, { useState, useEffect, useRef } from 'react';
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
  const containerRef = useRef<HTMLDivElement>(null);

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
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
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
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          className="bg-transparent border-none p-0 text-sm text-gray-900 dark:text-[#d4e4fa] focus:ring-0 w-full placeholder:text-gray-400 dark:placeholder:text-[#8c909f] focus:outline-none"
          placeholder="종목명 또는 코드 검색"
          type="text"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
            }}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-white"
          >
            ✕
          </button>
        )}
      </div>

      {isOpen && (
        <SearchDropdown
          results={results}
          onSelect={onSelectStock}
          onClose={() => setIsOpen(false)}
          query={query}
        />
      )}
    </div>
  );
}
