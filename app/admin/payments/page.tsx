'use client';

// 관리자 전용 — 계좌이체(무통장입금) 승인 화면.
// 실시간 은행 입금 알림을 보고 입금자명·금액으로 빠르게 대조 후 승인 버튼 하나로 처리한다.
// 인증은 클라이언트에서 별도로 검증하지 않고 /api/admin/bank-transfers가 서버에서
// 관리자 이메일을 확인해 401을 내려주면 그걸 보고 리다이렉트한다 (app/mypage와 동일 패턴).

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Landmark, CheckCircle2, XCircle, RefreshCw, Loader2 } from 'lucide-react';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';

interface PendingRequest {
  id:             string;
  user_id:        string;
  email:          string;
  plan:           'basic' | 'pro';
  is_annual:      boolean;
  amount:         number;
  depositor_name: string;
  requested_at:   string;
}

const PLAN_LABEL: Record<'basic' | 'pro', string> = { basic: 'Basic', pro: 'Pro' };
const PLAN_COLOR: Record<'basic' | 'pro', string> = { basic: '#818cf8', pro: '#fbbf24' };

function formatElapsed(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

export default function AdminPaymentsPage() {
  const router = useRouter();
  const [items, setItems]     = useState<PendingRequest[] | null>(null);
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [error, setError]     = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setError('');
    else setRefreshing(true);
    try {
      const res = await fetch('/api/admin/bank-transfers');
      if (res.status === 401) {
        router.push(loginUrlWithRedirect('/admin/payments'));
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? '조회 실패');
      setItems(json.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
    } finally {
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    load();
    // 은행 알림을 실시간으로 보고 바로 승인하는 화면이라, 다른 관리자/창에서
    // 먼저 처리한 항목이 자동으로 사라지도록 짧은 주기로 조용히 갱신
    const timer = setInterval(() => load(true), 20_000);
    return () => clearInterval(timer);
  }, [load]);

  async function handleAction(id: string, action: 'approve' | 'reject') {
    if (busyId) return;
    if (action === 'reject' && !confirm('이 신청을 거절하시겠습니까?')) return;

    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/bank-transfers/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? '처리 실패');
      // 처리 완료 — 목록에서 즉시 제거
      setItems((prev) => (prev ?? []).filter((it) => it.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : '처리 중 오류가 발생했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#0a0c12] px-4 py-8 sm:py-12">
      <div className="max-w-2xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6 sm:mb-8">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(99,102,241,0.15)' }}>
              <Landmark className="w-5 h-5 text-indigo-400" />
            </span>
            <div>
              <h1 className="text-[18px] sm:text-[20px] font-bold text-white leading-tight">계좌이체 승인</h1>
              <p className="text-[12px] text-slate-500">대기중 {items?.length ?? 0}건</p>
            </div>
          </div>
          <button
            onClick={() => load()}
            disabled={refreshing}
            aria-label="새로고침"
            className="w-11 h-11 rounded-xl flex items-center justify-center bg-[#1a1f2e] border border-slate-700/50 hover:border-slate-500 active:scale-95 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4.5 h-4.5 text-slate-300 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error && (
          <div className="mb-5 rounded-xl px-4 py-3 text-[13px] text-red-300" style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)' }}>
            {error}
          </div>
        )}

        {items === null ? (
          <div className="flex flex-col items-center gap-3 py-24">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <p className="text-[13px] text-slate-500">불러오는 중...</p>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <CheckCircle2 className="w-10 h-10 text-slate-700" />
            <p className="text-[14px] text-slate-500">대기중인 신청이 없습니다</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {items.map((it) => {
              const isBusy = busyId === it.id;
              return (
                <div
                  key={it.id}
                  className="rounded-2xl p-5 sm:p-6"
                  style={{ background: '#12151f', border: '1px solid rgba(51,65,85,0.5)' }}
                >
                  {/* 상단: 이메일 + 경과시간 */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <p className="text-[14px] font-semibold text-white break-all">{it.email}</p>
                    <span className="text-[11px] text-slate-500 shrink-0 whitespace-nowrap pt-0.5">
                      {formatElapsed(it.requested_at)}
                    </span>
                  </div>

                  {/* 플랜/금액 */}
                  <div className="flex items-center gap-2 mb-4">
                    <span
                      className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                      style={{ background: `${PLAN_COLOR[it.plan]}22`, color: PLAN_COLOR[it.plan] }}
                    >
                      {PLAN_LABEL[it.plan]} · {it.is_annual ? '연간' : '월간'}
                    </span>
                    <span className="text-[15px] font-bold text-white">{it.amount.toLocaleString()}원</span>
                  </div>

                  {/* 입금자명 — 가장 중요한 매칭 키라 크게 강조 */}
                  <div
                    className="rounded-xl px-4 py-3 mb-5 flex items-center justify-between"
                    style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}
                  >
                    <span className="text-[12px] text-amber-300/80">입금자명</span>
                    <span className="text-[18px] font-bold text-amber-300 tabular-nums">{it.depositor_name}</span>
                  </div>

                  {/* 액션 버튼 — 모바일에서도 크고 누르기 쉽게 */}
                  <div className="flex gap-2.5">
                    <button
                      onClick={() => handleAction(it.id, 'approve')}
                      disabled={isBusy}
                      className="flex-1 flex items-center justify-center gap-2 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white text-[14px] font-bold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isBusy ? <Loader2 className="w-4.5 h-4.5 animate-spin" /> : <CheckCircle2 className="w-4.5 h-4.5" />}
                      승인
                    </button>
                    <button
                      onClick={() => handleAction(it.id, 'reject')}
                      disabled={isBusy}
                      className="flex items-center justify-center gap-1.5 px-5 py-3.5 rounded-xl bg-[#1a1f2e] hover:bg-slate-800 active:scale-[0.98] border border-slate-700/60 text-slate-400 hover:text-red-400 text-[13.5px] font-semibold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <XCircle className="w-4 h-4" />
                      거절
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
