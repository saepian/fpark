'use client';

// 우측 하단 플로팅 고객상담 챗봇 위젯 — app/layout.tsx에 전역 삽입해 페이지 이동해도 유지.
// 대화 히스토리는 sessionStorage에만 저장(서버에 로그 남기지 않음, app/api/chatbot/route.ts
// 주석 참고) — 탭을 닫으면 사라진다.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MessageCircle, X, Send, Maximize2, Minimize2 } from 'lucide-react';
import { CHATBOT_MAX_HISTORY_MESSAGES, CHATBOT_MAX_MESSAGE_LENGTH } from '@/lib/chatbot-constants';
import { useSession } from '@/lib/useSession';
import { shouldResetChatbotHistory, CHATBOT_HISTORY_ANONYMOUS_OWNER } from '@/lib/chatbot-history-owner';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const STORAGE_KEY = 'fpark-chatbot-history';
// 확장(넓은 창) 상태 — 메시지 히스토리와 동일하게 세션 동안(새로고침 포함) 유지.
const EXPANDED_KEY = 'fpark-chatbot-expanded';
// 이 히스토리를 마지막으로 저장한 계정 식별자 — 로그아웃/계정 전환 감지용.
// 로그인 안 한 상태는 'anonymous' sentinel로 저장(비로그인 방문자의 대화는 PII가 아니라서
// 로그인 전환 시에는 굳이 지우지 않음 — 아래 useEffect 주석 참고).
const OWNER_KEY = 'fpark-chatbot-history-owner';
const ANONYMOUS = CHATBOT_HISTORY_ANONYMOUS_OWNER;

const WELCOME_MESSAGE: ChatMessage = {
  role: 'assistant',
  content: '안녕하세요! Finance Park 고객상담 챗봇이에요. 요금제, 결제, 환불, 계정 관리 같은 사이트 이용 관련 질문을 편하게 물어봐주세요 🙂',
};

export default function ChatWidget() {
  const { user, loading: sessionLoading } = useSession();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [ownerResolved, setOwnerResolved] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const TEXTAREA_MAX_HEIGHT = 96; // px — max-h-24, textarea 자체 스크롤이 시작되는 지점

  // 로그아웃/계정 전환 시 이전 계정의 대화가 그대로 보이던 프라이버시 버그 수정
  // (2026-07-09). sessionStorage는 탭을 닫을 때까지 남아있고 로그아웃도 대부분
  // window.location.href 풀 리로드라 자동으로는 안 지워진다 — 로그아웃 버튼마다
  // 따로 정리 코드를 심는 대신, useSession()으로 로그인 상태 자체를 구독해서 저장된
  // 히스토리의 "소유자"와 현재 로그인 사용자가 다르면 이 컴포넌트가 스스로 초기화한다.
  // 이렇게 하면 로그아웃 버튼이 앞으로 몇 개가 더 생기든(PersonalButton, 마이페이지,
  // useSession의 clearInvalidSession 등) 전부 자동으로 커버된다.
  //
  // 단, 비로그인 → 로그인 전환은 초기화하지 않는다 — 비로그인 방문자가 요금제 등을
  // 물어본 대화에는 계정 고유 정보가 없어 프라이버시 리스크가 낮고, 회원가입 직전까지
  // 나눈 대화 맥락을 그대로 이어가는 게 UX상 낫다고 판단(2026-07-09 결정). 반대로
  // "로그인된 계정이 있었는데 그 사이 바뀐" 경우(로그아웃, 다른 계정으로 전환)는 항상 초기화.
  useEffect(() => {
    if (sessionLoading) return;
    const currentOwner = user?.id ?? ANONYMOUS;
    let storedOwner: string | null = null;
    try {
      storedOwner = sessionStorage.getItem(OWNER_KEY);
    } catch {
      // sessionStorage 접근 실패 시 소유자 비교 없이 안전하게 새 세션으로 취급
    }

    const shouldReset = shouldResetChatbotHistory(storedOwner, currentOwner);

    if (shouldReset) {
      setMessages([WELCOME_MESSAGE]);
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {}
    } else {
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as ChatMessage[];
          if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
        }
      } catch {
        // sessionStorage 파싱 실패 시 기본 welcome 메시지 그대로 유지
      }
    }

    try {
      sessionStorage.setItem(OWNER_KEY, currentOwner);
    } catch {}
    setOwnerResolved(true);
  }, [sessionLoading, user?.id]);

  // 소유자 확인이 끝나기 전에는 저장하지 않는다 — 먼저 저장해버리면 아직 비교 전인
  // 초기 welcome 메시지가 다른 계정의 실제 대화 기록을 덮어써버릴 수 있다.
  useEffect(() => {
    if (!ownerResolved) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // 저장 실패해도 대화 자체는 계속 가능하므로 무시
    }
  }, [messages, ownerResolved]);

  // 확장 상태 복원(마운트 1회) — 새로고침해도 직전 확장 여부를 그대로 유지.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(EXPANDED_KEY) === 'true') setExpanded(true);
    } catch {
      // sessionStorage 접근 실패 시 기본값(축소) 유지
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(EXPANDED_KEY, String(expanded));
    } catch {
      // 저장 실패해도 이번 세션 내 토글 자체는 계속 가능하므로 무시
    }
  }, [expanded]);

  // expanded도 의존성에 포함 — 확장/축소 직후에도 최신 메시지가 보이도록 재스크롤.
  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, open, expanded]);

  // textarea 높이를 입력 내용에 맞춰 자동 조절 — rows={1} 고정 높이에 여러 줄을 입력하면
  // 내부 스크롤이 바로 생겨 "스크롤이 이상하다"는 문제로 이어졌다(2026-07-09). 내용이 늘면
  // TEXTAREA_MAX_HEIGHT까지는 높이 자체가 커지고, 그 이상만 textarea 내부 스크롤을 쓴다.
  //
  // 2026-07-09 프로덕션 재현 후 발견한 추가 버그: box-sizing:border-box인 상태에서
  // `el.style.height = scrollHeight + 'px'`만 하면 border(위+아래 2px)만큼 content 영역이
  // 부족해져(clientHeight가 scrollHeight보다 2px 작아짐) 내용이 한 줄뿐이어도 빈 스크롤바가
  // 생겼다. offsetHeight - clientHeight로 border 두께를 구해 보정하고, 실제로 내용이 넘칠
  // 때만 overflow-y: auto를 켜도록 명시적으로 토글해 스크롤바가 필요할 때만 나오게 한다.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const borderHeight = el.offsetHeight - el.clientHeight; // box-sizing:border-box의 테두리 두께
    const contentHeight = el.scrollHeight + borderHeight;
    el.style.height = `${Math.min(contentHeight, TEXTAREA_MAX_HEIGHT)}px`;
    el.style.overflowY = contentHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
  }, [input]);

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
    // 한글 IME 조합 중 Enter는 "조합 확정" 용도이지 전송 트리거가 아니다 — isComposing 체크
    // 없이 그냥 Enter만 보면, 조합 중 Enter를 눌러 확정하는 순간 메시지가 잘못 전송되거나
    // 이벤트가 씹히는 것처럼 느껴질 수 있다(2026-07-09 스크롤 버그 조사 중 함께 발견).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {open && (
        <div
          className={[
            'fixed bottom-24 right-4 sm:right-6 z-[9999] flex flex-col rounded-2xl border border-[#1e2537]',
            'bg-[#0d1117] shadow-2xl animate-fade-in overflow-hidden transition-[width,height] duration-200',
            expanded
              ? 'w-[calc(100vw-2rem)] sm:w-[480px] h-[90vh] sm:h-[80vh] max-h-[800px]'
              : 'w-[calc(100vw-2rem)] sm:w-[380px] h-[70vh] sm:h-[520px] max-h-[600px]',
          ].join(' ')}
        >
          <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#1e2537] bg-[#0f1320]">
            <div>
              <p className="text-sm font-bold text-[#e2e8f0]">Finance Park 고객상담</p>
              <p className="text-[11px] text-[#64748b]">보통 몇 초 안에 답변해요</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setExpanded((v) => !v)}
                aria-label={expanded ? '창 축소' : '창 확장'}
                className="p-1.5 rounded-lg text-[#64748b] hover:text-[#e2e8f0] hover:bg-[#1e2537] transition-colors"
              >
                {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="p-1.5 rounded-lg text-[#64748b] hover:text-[#e2e8f0] hover:bg-[#1e2537] transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
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

          <div className="p-3 border-t border-[#33406e] bg-[#181f3d] shadow-[inset_0_1px_0_rgba(129,140,248,0.08)]">
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, CHATBOT_MAX_MESSAGE_LENGTH))}
                onKeyDown={handleKeyDown}
                placeholder="궁금한 점을 물어보세요"
                rows={1}
                className="flex-1 resize-none bg-[#212a52] border border-[#4a5690] rounded-xl px-3 py-2.5 text-[13.5px] text-[#e2e8f0] placeholder:text-[#7883b3] focus:outline-none focus:border-indigo-400 max-h-24 overscroll-contain"
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
