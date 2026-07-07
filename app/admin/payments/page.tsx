'use client';

// 관리자 전용 — 계좌이체(무통장입금) 승인 화면.
// 실시간 은행 입금 알림을 보고 입금자명·금액으로 빠르게 대조 후 승인 버튼 하나로 처리한다.
// 데스크톱은 표(정렬·필터·검색·페이지네이션), 모바일은 압축 카드로 반응형 분기한다.
// 인증은 클라이언트에서 별도로 검증하지 않고 /api/admin/bank-transfers가 서버에서
// 관리자 이메일을 확인해 401을 내려주면 그걸 보고 리다이렉트한다 (app/mypage와 동일 패턴).

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Landmark, CheckCircle2, XCircle, RefreshCw, Loader2, RotateCcw,
  Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Banknote, Pencil,
} from 'lucide-react';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';

interface RequestItem {
  id:             string;
  user_id:        string;
  email:          string;
  plan:           'basic' | 'pro';
  is_annual:      boolean;
  amount:         number;
  depositor_name: string;
  request_type:   'new' | 'renewal';
  status:         'pending' | 'expired';
  requested_at:   string;
  processed_at:   string | null;
}

interface RefundItem {
  id:                     string;
  user_id:                string;
  email:                  string;
  plan:                   'basic' | 'pro';
  paid_amount:            number;
  usage_detected:         boolean;
  elapsed_days:           number;
  refund_amount:          number;
  refund_reason:          string | null;
  refund_status:          'none' | 'requested' | 'completed' | 'rejected';
  refund_account_bank:    string | null;
  refund_account_number:  string | null;
  refund_account_holder:  string | null;
  requested_at:           string;
  processed_at:           string | null;
  processed_by:           string | null;
}

const PLAN_LABEL: Record<'basic' | 'pro', string> = { basic: 'Basic', pro: 'Pro' };
const PLAN_COLOR: Record<'basic' | 'pro', string> = { basic: '#818cf8', pro: '#fbbf24' };
const TYPE_LABEL: Record<'new' | 'renewal', string> = { new: '신규가입', renewal: '갱신' };
const TYPE_COLOR: Record<'new' | 'renewal', string> = { new: '#38bdf8', renewal: '#a78bfa' };

type Filter = 'all' | 'new' | 'renewal' | 'expired' | 'refund';
type SortKey = 'email' | 'plan' | 'amount' | 'depositor_name' | 'requested_at';
type Action = 'approve' | 'reject' | 'reactivate';

const FILTER_LABEL: Record<Filter, string> = {
  all: '전체 대기', new: '신규가입 대기', renewal: '갱신 대기', expired: '만료됨', refund: '환불 대기',
};
const PAGE_SIZE = 20;

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

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminPaymentsPage() {
  const router = useRouter();
  const [pending, setPending] = useState<RequestItem[] | null>(null);
  const [expired, setExpired] = useState<RequestItem[] | null>(null);
  const [refunds, setRefunds] = useState<RefundItem[] | null>(null);
  const [busyId, setBusyId]   = useState<string | null>(null);
  const [refundBusyId, setRefundBusyId] = useState<string | null>(null);
  const [error, setError]     = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [filter, setFilter]   = useState<Filter>('all');
  const [search, setSearch]   = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('requested_at');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage]       = useState(1);

  const load = useCallback(async (silent = false) => {
    if (!silent) setError('');
    else setRefreshing(true);
    try {
      const [btRes, refundRes] = await Promise.all([
        fetch('/api/admin/bank-transfers'),
        fetch('/api/admin/refunds'),
      ]);
      if (btRes.status === 401 || refundRes.status === 401) {
        router.push(loginUrlWithRedirect('/admin/payments'));
        return;
      }
      const btJson = await btRes.json();
      if (!btRes.ok || !btJson.ok) throw new Error(btJson.error ?? '조회 실패');
      setPending(btJson.pending);
      setExpired(btJson.expired);

      const refundJson = await refundRes.json();
      if (!refundRes.ok || !refundJson.ok) throw new Error(refundJson.error ?? '환불 목록 조회 실패');
      setRefunds(refundJson.refunds);
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

  const pendingRefunds = useMemo(() => (refunds ?? []).filter((r) => r.refund_status === 'requested'), [refunds]);

  const allItems = useMemo(() => [...(pending ?? []), ...(expired ?? [])], [pending, expired]);

  const filtered = useMemo(() => {
    let list = allItems;
    if (filter === 'expired') list = list.filter((it) => it.status === 'expired');
    else if (filter === 'new') list = list.filter((it) => it.status === 'pending' && it.request_type === 'new');
    else if (filter === 'renewal') list = list.filter((it) => it.status === 'pending' && it.request_type === 'renewal');
    else list = list.filter((it) => it.status === 'pending');

    const q = search.trim().toLowerCase();
    if (q) list = list.filter((it) => it.email.toLowerCase().includes(q));
    return list;
  }, [allItems, filter, search]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let av: string | number = a[sortKey];
      let bv: string | number = b[sortKey];
      if (sortKey === 'requested_at') { av = new Date(a.requested_at).getTime(); bv = new Date(b.requested_at).getTime(); }
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const paged = sorted.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);

  const filteredRefunds = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pendingRefunds;
    return pendingRefunds.filter((r) => r.email.toLowerCase().includes(q));
  }, [pendingRefunds, search]);
  const refundTotalPages = Math.max(1, Math.ceil(filteredRefunds.length / PAGE_SIZE));
  const refundPageClamped = Math.min(page, refundTotalPages);
  const pagedRefunds = filteredRefunds.slice((refundPageClamped - 1) * PAGE_SIZE, refundPageClamped * PAGE_SIZE);

  // 필터/검색이 바뀌면 첫 페이지로
  useEffect(() => { setPage(1); }, [filter, search]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortKey(key); setSortDir(key === 'requested_at' ? 'desc' : 'asc'); }
  }

  async function handleAction(id: string, action: Action, fromList: 'pending' | 'expired') {
    if (busyId) return;
    if (action === 'reject' && !confirm('이 신청을 거절하시겠습니까?')) return;
    if (action === 'reactivate' && !confirm('만료된 구독을 오늘부터 새 주기로 재활성화하시겠습니까?')) return;

    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/bank-transfers/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? '처리 실패');
      if (fromList === 'pending') setPending((prev) => (prev ?? []).filter((it) => it.id !== id));
      else setExpired((prev) => (prev ?? []).filter((it) => it.id !== id));
    } catch (e) {
      alert(e instanceof Error ? e.message : '처리 중 오류가 발생했습니다.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCompleteRefund(id: string) {
    if (refundBusyId) return;
    if (!confirm('실제로 송금을 완료하셨습니까? 완료 처리 시 유저에게 환불 완료 안내 메일이 자동 발송됩니다.')) return;
    setRefundBusyId(id);
    try {
      const res = await fetch(`/api/admin/refunds/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'complete' }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? '처리 실패');
      setRefunds((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, refund_status: 'completed' } : r)));
    } catch (e) {
      alert(e instanceof Error ? e.message : '처리 중 오류가 발생했습니다.');
    } finally {
      setRefundBusyId(null);
    }
  }

  async function handleUpdateRefundAmount(id: string, currentAmount: number) {
    if (refundBusyId) return;
    const input = prompt('수정할 환불 금액을 입력하세요 (원)', String(currentAmount));
    if (input === null) return;
    const amount = Number(input.replace(/[^0-9]/g, ''));
    if (!Number.isFinite(amount) || amount < 0) {
      alert('올바른 금액을 입력해주세요.');
      return;
    }
    setRefundBusyId(id);
    try {
      const res = await fetch(`/api/admin/refunds/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'update_amount', amount }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? '수정 실패');
      setRefunds((prev) => (prev ?? []).map((r) => (r.id === id ? { ...r, refund_amount: json.refundAmount } : r)));
    } catch (e) {
      alert(e instanceof Error ? e.message : '수정 중 오류가 발생했습니다.');
    } finally {
      setRefundBusyId(null);
    }
  }

  function RefundActionButtons({ r, compact }: { r: RefundItem; compact?: boolean }) {
    const isBusy = refundBusyId === r.id;
    return (
      <div className="flex gap-2">
        <button
          onClick={() => handleCompleteRefund(r.id)}
          disabled={isBusy}
          className={`flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-bold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed ${compact ? 'flex-1 py-3 text-[13.5px]' : 'px-3 py-2 text-[12.5px] whitespace-nowrap'}`}
        >
          {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
          송금 완료
        </button>
        <button
          onClick={() => handleUpdateRefundAmount(r.id, r.refund_amount)}
          disabled={isBusy}
          className={`flex items-center justify-center gap-1.5 rounded-lg bg-[#1a1f2e] hover:bg-slate-800 active:scale-[0.98] border border-slate-700/60 text-slate-400 hover:text-slate-200 font-semibold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed ${compact ? 'px-4 py-3 text-[13px]' : 'px-3 py-2 text-[12.5px] whitespace-nowrap'}`}
        >
          <Pencil className="w-3.5 h-3.5" />
          금액 수정
        </button>
      </div>
    );
  }

  function ActionButtons({ it, compact }: { it: RequestItem; compact?: boolean }) {
    const isBusy = busyId === it.id;
    const fromList = it.status === 'pending' ? 'pending' : 'expired';
    if (it.status === 'expired') {
      return (
        <button
          onClick={() => handleAction(it.id, 'reactivate', fromList)}
          disabled={isBusy}
          className={`flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] text-white font-bold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed ${compact ? 'w-full py-3 text-[13.5px]' : 'px-3 py-2 text-[12.5px] whitespace-nowrap'}`}
        >
          {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
          재활성화
        </button>
      );
    }
    return (
      <div className={`flex gap-2 ${compact ? '' : ''}`}>
        <button
          onClick={() => handleAction(it.id, 'approve', fromList)}
          disabled={isBusy}
          className={`flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-bold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed ${compact ? 'flex-1 py-3 text-[13.5px]' : 'px-3 py-2 text-[12.5px] whitespace-nowrap'}`}
        >
          {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          승인
        </button>
        <button
          onClick={() => handleAction(it.id, 'reject', fromList)}
          disabled={isBusy}
          className={`flex items-center justify-center gap-1.5 rounded-lg bg-[#1a1f2e] hover:bg-slate-800 active:scale-[0.98] border border-slate-700/60 text-slate-400 hover:text-red-400 font-semibold cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed ${compact ? 'px-4 py-3 text-[13px]' : 'px-3 py-2 text-[12.5px] whitespace-nowrap'}`}
        >
          <XCircle className="w-3.5 h-3.5" />
          거절
        </button>
      </div>
    );
  }

  function SortHeader({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-slate-300 transition-colors whitespace-nowrap"
      >
        <span className="inline-flex items-center gap-1">
          {label}
          {active && (sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
        </span>
      </th>
    );
  }

  const isLoading = pending === null;

  return (
    <div className="px-4 py-8 sm:py-12">
      <div className="max-w-6xl mx-auto">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(99,102,241,0.15)' }}>
              <Landmark className="w-5 h-5 text-indigo-400" />
            </span>
            <div>
              <h1 className="text-[18px] sm:text-[20px] font-bold text-white leading-tight">계좌이체 승인</h1>
              <p className="text-[12px] text-slate-500">대기중 {pending?.length ?? 0}건 · 만료 {expired?.length ?? 0}건 · 환불대기 {pendingRefunds.length}건</p>
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

        {/* 필터 탭 + 검색 */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-1.5 flex-wrap">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3.5 py-2 rounded-lg text-[12.5px] font-semibold cursor-pointer transition-colors ${
                  filter === f
                    ? 'bg-indigo-600 text-white'
                    : 'bg-[#1a1f2e] text-slate-400 hover:text-slate-200 border border-slate-700/50'
                }`}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이메일로 검색"
              className="pl-9 pr-3 py-2 rounded-lg text-[12.5px] text-white placeholder-slate-600 outline-none w-48 sm:w-56"
              style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center gap-3 py-24">
            <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
            <p className="text-[13px] text-slate-500">불러오는 중...</p>
          </div>
        ) : filter === 'refund' ? (
          filteredRefunds.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Banknote className="w-10 h-10 text-slate-700" />
              <p className="text-[14px] text-slate-500">{search ? '검색 결과가 없습니다' : '환불 대기 항목이 없습니다'}</p>
            </div>
          ) : (
            <>
              {/* ── 데스크톱: 환불 대기 표 ── */}
              <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-700/50">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-700/50" style={{ background: '#12151f' }}>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide">이메일</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide">플랜</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide">계산 근거</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">환불 예정액</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide">환불 계좌</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">신청일시</th>
                      <th className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide">액션</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedRefunds.map((r, i) => (
                      <tr
                        key={r.id}
                        className="border-b border-slate-800/60 last:border-0 hover:bg-white/[0.02] transition-colors"
                        style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)' }}
                      >
                        <td className="px-3 py-3 text-[13px] text-white font-medium max-w-[200px] truncate" title={r.email}>{r.email}</td>
                        <td className="px-3 py-3">
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${PLAN_COLOR[r.plan]}22`, color: PLAN_COLOR[r.plan] }}>
                            {PLAN_LABEL[r.plan]}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-[12px] text-slate-400 max-w-[260px]">
                          <span className={`font-semibold ${r.usage_detected ? 'text-amber-300' : 'text-emerald-400'}`}>
                            {r.usage_detected ? '사용함' : '미사용'}
                          </span>
                          {' · '}{r.elapsed_days}일 경과
                        </td>
                        <td className="px-3 py-3 text-[13.5px] text-white font-bold whitespace-nowrap tabular-nums">{r.refund_amount.toLocaleString()}원</td>
                        <td className="px-3 py-3 text-[12.5px] text-slate-300 whitespace-nowrap">
                          {r.refund_account_bank} {r.refund_account_number}
                          <span className="text-slate-500"> ({r.refund_account_holder})</span>
                        </td>
                        <td className="px-3 py-3 text-[12.5px] text-slate-400 whitespace-nowrap tabular-nums">{formatDateTime(r.requested_at)}</td>
                        <td className="px-3 py-3">
                          <RefundActionButtons r={r} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* ── 모바일: 환불 대기 압축 카드 ── */}
              <div className="md:hidden flex flex-col gap-2.5">
                {pagedRefunds.map((r) => (
                  <div key={r.id} className="rounded-xl p-3.5" style={{ background: '#12151f', border: '1px solid rgba(51,65,85,0.5)' }}>
                    <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${PLAN_COLOR[r.plan]}22`, color: PLAN_COLOR[r.plan] }}>
                        {PLAN_LABEL[r.plan]}
                      </span>
                      <span className={`text-[10px] font-bold ${r.usage_detected ? 'text-amber-300' : 'text-emerald-400'}`}>
                        {r.usage_detected ? '사용함' : '미사용'} · {r.elapsed_days}일 경과
                      </span>
                      <span className="text-[13px] font-bold text-white ml-auto">{r.refund_amount.toLocaleString()}원</span>
                    </div>
                    <p className="text-[13px] font-semibold text-white truncate mb-1">{r.email}</p>
                    <p className="text-[12.5px] text-slate-400 mb-2.5">
                      {r.refund_account_bank} {r.refund_account_number} ({r.refund_account_holder})
                    </p>
                    <RefundActionButtons r={r} compact />
                  </div>
                ))}
              </div>

              {refundTotalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-6">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={refundPageClamped <= 1}
                    className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#1a1f2e] border border-slate-700/50 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer hover:border-slate-500 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <span className="text-[12.5px] text-slate-400 tabular-nums">
                    {refundPageClamped} / {refundTotalPages} 페이지 · 총 {filteredRefunds.length}건
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(refundTotalPages, p + 1))}
                    disabled={refundPageClamped >= refundTotalPages}
                    className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#1a1f2e] border border-slate-700/50 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer hover:border-slate-500 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              )}
            </>
          )
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <CheckCircle2 className="w-10 h-10 text-slate-700" />
            <p className="text-[14px] text-slate-500">
              {search ? '검색 결과가 없습니다' : `${FILTER_LABEL[filter]} 항목이 없습니다`}
            </p>
          </div>
        ) : (
          <>
            {/* ── 데스크톱: 표 ── */}
            <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-700/50">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700/50" style={{ background: '#12151f' }}>
                    <th className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide">유형</th>
                    <SortHeader label="이메일" k="email" />
                    <SortHeader label="플랜" k="plan" />
                    <SortHeader label="금액" k="amount" />
                    <SortHeader label="입금자명" k="depositor_name" />
                    <SortHeader label="신청일시" k="requested_at" />
                    <th className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">경과</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide">상태</th>
                    <th className="text-left px-3 py-2.5 text-[11px] font-bold text-slate-500 uppercase tracking-wide">액션</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((it, i) => (
                    <tr
                      key={it.id}
                      className="border-b border-slate-800/60 last:border-0 hover:bg-white/[0.02] transition-colors"
                      style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)' }}
                    >
                      <td className="px-3 py-3">
                        <span
                          className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ background: `${TYPE_COLOR[it.request_type]}22`, color: TYPE_COLOR[it.request_type] }}
                        >
                          {TYPE_LABEL[it.request_type]}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-white font-medium max-w-[220px] truncate" title={it.email}>{it.email}</td>
                      <td className="px-3 py-3">
                        <span
                          className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={{ background: `${PLAN_COLOR[it.plan]}22`, color: PLAN_COLOR[it.plan] }}
                        >
                          {PLAN_LABEL[it.plan]} · {it.is_annual ? '연간' : '월간'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[13px] text-white font-semibold whitespace-nowrap">{it.amount.toLocaleString()}원</td>
                      <td className="px-3 py-3">
                        <span className="text-[13.5px] font-bold text-amber-300 tabular-nums">{it.depositor_name}</span>
                      </td>
                      <td className="px-3 py-3 text-[12.5px] text-slate-400 whitespace-nowrap tabular-nums">{formatDateTime(it.requested_at)}</td>
                      <td className="px-3 py-3 text-[12px] text-slate-500 whitespace-nowrap">{formatElapsed(it.requested_at)}</td>
                      <td className="px-3 py-3">
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                          it.status === 'expired' ? 'text-red-300' : 'text-amber-300'
                        }`} style={{ background: it.status === 'expired' ? 'rgba(248,113,113,0.12)' : 'rgba(245,158,11,0.12)' }}>
                          {it.status === 'expired' ? '만료됨' : '대기중'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <ActionButtons it={it} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── 모바일: 압축 카드 ── */}
            <div className="md:hidden flex flex-col gap-2.5">
              {paged.map((it) => (
                <div
                  key={it.id}
                  className="rounded-xl p-3.5"
                  style={{ background: '#12151f', border: '1px solid rgba(51,65,85,0.5)' }}
                >
                  <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: `${TYPE_COLOR[it.request_type]}22`, color: TYPE_COLOR[it.request_type] }}
                    >
                      {TYPE_LABEL[it.request_type]}
                    </span>
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                      style={{ background: `${PLAN_COLOR[it.plan]}22`, color: PLAN_COLOR[it.plan] }}
                    >
                      {PLAN_LABEL[it.plan]}·{it.is_annual ? '연' : '월'}
                    </span>
                    <span className="text-[12.5px] font-bold text-white ml-auto">{it.amount.toLocaleString()}원</span>
                  </div>
                  <p className="text-[13px] font-semibold text-white truncate mb-1.5">{it.email}</p>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[15px] font-bold text-amber-300 tabular-nums">{it.depositor_name}</span>
                    <span className="text-[10.5px] text-slate-500 shrink-0">{formatElapsed(it.requested_at)}</span>
                  </div>
                  <ActionButtons it={it} compact />
                </div>
              ))}
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-6">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageClamped <= 1}
                  className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#1a1f2e] border border-slate-700/50 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer hover:border-slate-500 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-[12.5px] text-slate-400 tabular-nums">
                  {pageClamped} / {totalPages} 페이지 · 총 {sorted.length}건
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={pageClamped >= totalPages}
                  className="w-9 h-9 rounded-lg flex items-center justify-center bg-[#1a1f2e] border border-slate-700/50 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer hover:border-slate-500 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

}
