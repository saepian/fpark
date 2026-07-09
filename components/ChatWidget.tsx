'use client';

// 우측 하단 플로팅 고객상담 챗봇 위젯 — app/layout.tsx에 전역 삽입해 페이지 이동해도 유지.
// 대화 히스토리는 sessionStorage에만 저장(서버에 로그 남기지 않음, app/api/chatbot/route.ts
// 주석 참고) — 탭을 닫으면 사라진다.

import { useEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send } from 'lucide-react';
import { CHATBOT_MAX_HISTORY_MESSAGES, CHATBOT_MAX_MESSAGE_LENGTH } from '@/lib/chatbot-constants';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'fpark-chatbot-history';

const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: '안녕하세요! Finance Park 고객상담 챗봇이에요. 요금제, 결제, 환불, 계정 관리 같은 사이트 이용 관련 질문을 편하게 물어봐주세요 🙂',
};

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as ChatMessage[];
        if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
      }
    } catch {
      // sessionStorage 파싱 실패 시 기본 welcome 메시지 그대로 유지
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // 저장 실패해도 대화 자체는 계속 가능하므로 무시
    }
  }, [messages]);

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open]);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const nextMessages = [...messages, { role: 'user' as const, content: text }].slice(-CHATBOT_MAX_HISTORY_MESSAGES);
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chatbot', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: nextMessages }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.error || '답변 생성에 실패했어요. 잠시 후 다시 시도해주세요.' }]);
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: '네트워크 오류가 발생했어요. 잠시 후 다시 시도해주세요.' }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 sm:right-6 z-[9999] w-[calc(100vw-2rem)] sm:w-[380px] h-[70vh] sm:h-[520px] max-h-[600px] flex flex-col rounded-2xl border border-[#1e2537] bg-[#0d1117] shadow-2xl animate-fade-in overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#1e2537] bg-[#0f1320]">
            <div>
              <p className="text-sm font-bold text-[#e2e8f0]">Finance Park 고객상담</p>
              <p className="text-[11px] text-[#64748b]">보통 몇 초 안에 답변해요</p>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="닫기"
              className="p-1.5 rounded-lg text-[#64748b] hover:text-[#e2e8f0] hover:bg-[#1e2537] transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={[
                    'max-w-[85%] px-3.5 py-2.5 rounded-2xl text-[13.5px] leading-relaxed whitespace-pre-wrap',
                    m.role === 'user'
                      ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white rounded-br-sm'
                      : 'bg-[#161b2b] text-[#cbd5e1] rounded-bl-sm',
                  ].join(' ')}
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-[#161b2b] text-[#64748b] px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-[13.5px]">
                  답변을 준비하고 있어요...
                </div>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-[#1e2537] bg-[#0f1320]">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, CHATBOT_MAX_MESSAGE_LENGTH))}
                onKeyDown={handleKeyDown}
                placeholder="궁금한 점을 물어보세요"
                rows={1}
                className="flex-1 resize-none bg-[#161b2b] border border-[#2d3348] rounded-xl px-3 py-2.5 text-[13.5px] text-[#e2e8f0] placeholder:text-[#475569] focus:outline-none focus:border-indigo-500 max-h-24"
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                aria-label="전송"
                className="shrink-0 p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? '챗봇 닫기' : '챗봇 열기'}
        className="fixed bottom-5 right-4 sm:right-6 z-[9999] w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
      </button>
    </>
  );
}
