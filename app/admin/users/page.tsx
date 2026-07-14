'use client';

// 관리자 전용 — 전체 회원 목록 + 계좌이체 결제 이력 조회 (읽기 전용).
// 플랜 수동 변경 등 관리 액션은 추후 추가 예정.

import { Fragment, useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users as UsersIcon, RefreshCw, Loader2, Search,
  ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, Receipt, Banknote,
} from 'lucide-react';
import { loginUrlWithRedirect } from '@/lib/auth-redirect';

type Plan = 'free' | 'basic' | 'pro' | 'admin';
type StatusBucket = 'active' | 'pending_renewal' | 'pending_cancellation' | 'expired' | 'free';

interface UserRow {
  id:                 string;
  email:              string | null;
  created_at:         string | null;
  plan:               string;
  subscription_plan:  string | null;
  subscription_status: string | null;
  next_billed_at:     string | null;
  stock_credits:      number;
  portfolio_credits:  number;
  last_sign_in_at:    string | null;
  diagnosis_used_month: number;
  diagnosis_limit:    number;
  portfolio_used:     number;
  portfolio_limit:    number;
  stock_analysis_used: number;
  stock_analysis_limit: number;
  stock_analysis_daily: boolean;
}

interface PaymentHistoryItem {
  id:             string;
  plan:           'basic' | 'pro';
  is_annual:      boolean;
  amount:         number;
  depositor_name: string;
  status:         string;
  request_type:   'new' | 'renewal' | 'upgrade';
  requested_at:   string;
  processed_at:   string | null;
}

interface RefundHistoryItem {
  id:            string;
  plan:          'basic' | 'pro';
  paid_amount:   number;
  elapsed_days:  number;
  refund_amount: number;
  refund_status: 'none' | 'requested' | 'completed' | 'rejected';
  requested_at:  string;
  processed_at:  string | null;
}

const PLAN_LABEL: Record<string, string> = { free: '무료', basic: 'Basic', pro: 'Pro', admin: '관리자' };
const PLAN_COLOR: Record<string, string> = { free: '#64748b', basic: '#818cf8', pro: '#fbbf24', admin: '#f472b6' };
const STATUS_LABEL: Record<StatusBucket, string> = { active: '활성', pending_renewal: '갱신대기', pending_cancellation: '해지예약', expired: '만료', free: '무료' };
const STATUS_COLOR: Record<StatusBucket, string> = { active: '#34d399', pending_renewal: '#fbbf24', pending_cancellation: '#94a3b8', expired: '#f87171', free: '#64748b' };
const REQ_STATUS_LABEL: Record<string, string> = { pending: '대기중', approved: '승인됨', rejected: '거절됨', expired: '만료됨' };
const REFUND_STATUS_LABEL: Record<string, string> = { none: '환불없음(해지예약)', requested: '환불대기', completed: '환불완료', rejected: '환불거절' };
const REFUND_STATUS_COLOR: Record<string, string> = { none: '#94a3b8', requested: '#fbbf24', completed: '#34d399', rejected: '#f87171' };

type PlanFilter = 'all' | Plan;
type StatusFilter = 'all' | StatusBucket;
type SortKey = 'email' | 'created_at' | 'plan' | 'next_billed_at' | 'stock_credits' | 'portfolio_credits' | 'last_sign_in_at';

const PAGE_SIZE = 15;

function normalizeStatus(u: UserRow): StatusBucket {
  if (u.plan === 'free' || !u.subscription_status) return 'free';
  if (u.subscription_status === 'pending_renewal') return 'pending_renewal';
  if (u.subscription_status === 'pending_cancellation') return 'pending_cancellation';
  if (u.subscription_status === 'expired') return 'expired';
  if (u.subscription_status === 'active') return 'active';
  return 'free';
}

// 포트폴리오는 원래 "월간" 한도라 이번 달 누적치와 직접 비교해도 의미가 맞는다 —
// 한도를 넘겼다면(크레딧으로 추가 이용 등) 참고할 만한 신호라 경고색으로 구분한다.
function usageColorClass(used: number, limit: number): string {
  return limit > 0 && used > limit ? 'text-amber-400' : 'text-slate-200';
}

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<Record<string, PaymentHistoryItem[]>>({});
  const [refundHistory, setRefundHistory] = useState<Record<string, RefundHistoryItem[]>>({});
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [planFilter, setPlanFilter]     = useState<PlanFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [search, setSearch]             = useState('');
  const [sortKey, setSortKey]           = useState<SortKey>('created_at');
  const [sortDir, setSortDir]           = useState<'asc' | 'desc'>('desc');
  const [page, setPage]                 = useState(1);

  const load = useCallback(async (silent = false) => {
    if (!silent) setError('');
    else setRefreshing(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.status === 401) {
        router.push(loginUrlWithRedirect('/admin/users'));
        return;
      }
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error ?? '조회 실패');
      setUsers(json.users);
      setPaymentHistory(json.paymentHistory ?? {});
      setRefundHistory(json.refundHistory ?? {});
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
    } finally {
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let list = users ?? [];
    if (planFilter !== 'all') list = list.filter((u) => u.plan === planFilter);
    if (statusFilter !== 'all') list = list.filter((u) => normalizeStatus(u) === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((u) => (u.email ?? '').toLowerCase().includes(q));
    return list;
  }, [users, planFilter, statusFilter, search]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let av: string | number = a[sortKey] ?? '';
      let bv: string | number = b[sortKey] ?? '';
      if (sortKey === 'created_at' || sortKey === 'next_billed_at' || sortKey === 'last_sign_in_at') {
        av = av ? new Date(av).getTime() : 0;
        bv = bv ? new Date(bv).getTime() : 0;
      }
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageClamped = Math.min(page, totalPages);
  const paged = sorted.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE);

  useEffect(() => { setPage(1); }, [planFilter, statusFilter, search]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); }
    else { setSortKey(key); setSortDir(key === 'email' ? 'asc' : 'desc'); }
  }

  function SortHeader({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k;
    return (
      <th
        onClick={() => toggleSort(k)}
        className="text-left px-4 py-3 text-[11.5px] font-bold text-slate-500 uppercase tracking-wide cursor-pointer select-none hover:text-slate-300 transition-colors whitespace-nowrap"
      >
        <span className="inline-flex items-center gap-1.5">
          {label}
          {active ? (sortDir === 'asc' ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />) : <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />}
        </span>
      </th>
    );
  }

  function PaymentHistoryPanel({ userId }: { userId: string }) {
    const history = paymentHistory[userId] ?? [];
    if (history.length === 0) {
      return <p className="text-[12.5px] text-slate-500 px-4 py-3">결제 이력이 없습니다.</p>;
    }
    return (
      <div className="px-4 py-3 flex flex-col gap-1.5">
        {history.map((h) => (
          <div key={h.id} className="flex items-center gap-2.5 text-[12px] py-1.5 flex-wrap">
            <span className="font-semibold text-slate-300 w-14 shrink-0">
              {h.request_type === 'new' ? '신규가입' : h.request_type === 'upgrade' ? '업그레이드' : '갱신'}
            </span>
            <span className="text-slate-400 w-16 shrink-0">{PLAN_LABEL[h.plan]}{h.is_annual ? '·연' : '·월'}</span>
            <span className="text-white font-medium w-20 shrink-0">{h.amount.toLocaleString()}원</span>
            <span className="text-amber-300 w-20 shrink-0 truncate">{h.depositor_name}</span>
            <span className="text-slate-500 whitespace-nowrap">{formatDateTime(h.requested_at)}</span>
            <span
              className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ml-auto"
              style={{
                background: h.status === 'approved' ? 'rgba(52,211,153,0.12)' : h.status === 'rejected' ? 'rgba(248,113,113,0.12)' : h.status === 'expired' ? 'rgba(248,113,113,0.12)' : 'rgba(245,158,11,0.12)',
                color: h.status === 'approved' ? '#34d399' : h.status === 'rejected' ? '#f87171' : h.status === 'expired' ? '#f87171' : '#fbbf24',
              }}
            >
              {REQ_STATUS_LABEL[h.status] ?? h.status}
            </span>
          </div>
        ))}
      </div>
    );
  }

  function RefundHistoryPanel({ userId }: { userId: string }) {
    const history = refundHistory[userId] ?? [];
    if (history.length === 0) return null;
    return (
      <div className="px-4 py-3 flex flex-col gap-1.5 border-t border-slate-800/60">
        <p className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wide mb-0.5">환불 내역</p>
        {history.map((h) => (
          <div key={h.id} className="flex items-center gap-2.5 text-[12px] py-1.5 flex-wrap">
            <span className="text-slate-400 w-16 shrink-0">{PLAN_LABEL[h.plan]}</span>
            <span className="text-white font-medium w-24 shrink-0">{h.refund_amount.toLocaleString()}원</span>
            <span className="text-slate-500 w-20 shrink-0">경과 {h.elapsed_days}일</span>
            <span className="text-slate-500 whitespace-nowrap">{formatDateTime(h.requested_at)}</span>
            <span
              className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-full ml-auto whitespace-nowrap"
              style={{ background: `${REFUND_STATUS_COLOR[h.refund_status]}1f`, color: REFUND_STATUS_COLOR[h.refund_status] }}
            >
              {REFUND_STATUS_LABEL[h.refund_status] ?? h.refund_status}
            </span>
          </div>
        ))}
      </div>
    );
  }

  const isLoading = users === null;

  return (
    <div className="px-4 sm:px-6 py-8 sm:py-12">
      <div className="w-full">
        {/* 헤더 */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(99,102,241,0.15)' }}>
              <UsersIcon className="w-5 h-5 text-indigo-400" />
            </span>
            <div>
              <h1 className="text-[18px] sm:text-[20px] font-bold text-white leading-tight">회원 관리</h1>
              <p className="text-[12px] text-slate-500">전체 {users?.length ?? 0}명</p>
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

        {/* 필터 + 검색 */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value as PlanFilter)}
              className="px-3 py-2 rounded-lg text-[12.5px] font-semibold text-slate-300 outline-none cursor-pointer"
              style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
            >
              <option value="all">전체 플랜</option>
              <option value="free">무료</option>
              <option value="basic">Basic</option>
              <option value="pro">Pro</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="px-3 py-2 rounded-lg text-[12.5px] font-semibold text-slate-300 outline-none cursor-pointer"
              style={{ background: '#1a1f2e', border: '1px solid rgba(51,65,85,0.6)' }}
            >
              <option value="all">전체 상태</option>
              <option value="active">활성</option>
              <option value="pending_renewal">갱신대기</option>
              <option value="pending_cancellation">해지예약</option>
              <option value="expired">만료</option>
              <option value="free">무료</option>
            </select>
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
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <UsersIcon className="w-10 h-10 text-slate-700" />
            <p className="text-[14px] text-slate-500">{search ? '검색 결과가 없습니다' : '조건에 맞는 회원이 없습니다'}</p>
          </div>
        ) : (
          <>
            {/* ── 데스크톱: 표 ── */}
            <div className="hidden md:block overflow-x-auto rounded-2xl border border-slate-700/50">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-700/50" style={{ background: '#12151f' }}>
                    <SortHeader label="이메일" k="email" />
                    <SortHeader label="가입일" k="created_at" />
                    <SortHeader label="플랜" k="plan" />
                    <th className="text-left px-4 py-3 text-[11.5px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap">구독 상태</th>
                    <SortHeader label="다음 결제일" k="next_billed_at" />
                    <th
                      className="text-left px-4 py-3 text-[11.5px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                      title="월간 한도라 이번 결제 사이클(무료 유저는 매월 1일 기준) 누적 이용 건수 / 월간한도로 표시"
                    >
                      기업분석
                    </th>
                    <th
                      className="text-left px-4 py-3 text-[11.5px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                      title="월간 한도라 이번 결제 사이클(무료 유저는 매월 1일 기준) 누적 이용 건수 / 월간한도로 표시"
                    >
                      포트폴리오
                    </th>
                    <th
                      className="text-left px-4 py-3 text-[11.5px] font-bold text-slate-500 uppercase tracking-wide whitespace-nowrap"
                      title="무료 회원은 일간 한도(오늘 건수/1), 베이직·프로는 월간 한도(이번 사이클 누적/한도)로 표시"
                    >
                      종목분석
                    </th>
                    <SortHeader label="종목크레딧(1회권)" k="stock_credits" />
                    <SortHeader label="포트폴리오크레딧(1회권)" k="portfolio_credits" />
                    <SortHeader label="최근 로그인" k="last_sign_in_at" />
                    <th className="text-left px-4 py-3 text-[11.5px] font-bold text-slate-500 uppercase tracking-wide">결제 이력</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((u, i) => {
                    const status = normalizeStatus(u);
                    const historyCount = (paymentHistory[u.id] ?? []).length;
                    const refundCount = (refundHistory[u.id] ?? []).length;
                    const expanded = expandedId === u.id;
                    return (
                      <Fragment key={u.id}>
                        <tr
                          className="border-b border-slate-800/60 last:border-0 hover:bg-white/[0.02] transition-colors"
                          style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)' }}
                        >
                          <td className="px-4 py-3 text-[13.5px] text-white font-medium max-w-[220px] truncate" title={u.email ?? ''}>{u.email ?? '-'}</td>
                          <td className="px-4 py-3 text-[13px] text-slate-400 whitespace-nowrap tabular-nums">{formatDate(u.created_at)}</td>
                          <td className="px-4 py-3">
                            <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: `${PLAN_COLOR[u.plan] ?? PLAN_COLOR.free}22`, color: PLAN_COLOR[u.plan] ?? PLAN_COLOR.free }}>
                              {PLAN_LABEL[u.plan] ?? u.plan}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[11.5px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: `${STATUS_COLOR[status]}1f`, color: STATUS_COLOR[status] }}>
                              {STATUS_LABEL[status]}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-[13px] text-slate-400 whitespace-nowrap tabular-nums">{formatDate(u.next_billed_at)}</td>
                          <td className="px-4 py-3 text-[13px] whitespace-nowrap">
                            <span className={`tabular-nums font-medium ${usageColorClass(u.diagnosis_used_month, u.diagnosis_limit)}`}>{u.diagnosis_used_month}/{u.diagnosis_limit}</span>
                          </td>
                          <td className="px-4 py-3 text-[13px] whitespace-nowrap">
                            <span className={`tabular-nums font-medium ${usageColorClass(u.portfolio_used, u.portfolio_limit)}`}>{u.portfolio_used}/{u.portfolio_limit}</span>
                          </td>
                          <td className="px-4 py-3 text-[13px] whitespace-nowrap">
                            <span className={`tabular-nums font-medium ${usageColorClass(u.stock_analysis_used, u.stock_analysis_limit)}`}>{u.stock_analysis_used}/{u.stock_analysis_limit}</span>
                            {u.stock_analysis_daily && <span className="text-[10px] text-slate-600 ml-1">(오늘)</span>}
                          </td>
                          <td className="px-4 py-3 text-[13.5px] text-slate-300 tabular-nums">{u.stock_credits}</td>
                          <td className="px-4 py-3 text-[13.5px] text-slate-300 tabular-nums">{u.portfolio_credits}</td>
                          <td className="px-4 py-3 text-[13px] text-slate-400 whitespace-nowrap tabular-nums">{formatDateTime(u.last_sign_in_at)}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5 whitespace-nowrap">
                              <button
                                onClick={() => setExpandedId(expanded ? null : u.id)}
                                disabled={historyCount === 0 && refundCount === 0}
                                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[#1a1f2e] border border-slate-700/50 text-slate-300 hover:border-slate-500 whitespace-nowrap shrink-0"
                              >
                                <Receipt className="w-3.5 h-3.5 shrink-0" />
                                {historyCount}건
                              </button>
                              {refundCount > 0 && (
                                <button
                                  onClick={() => setExpandedId(expanded ? null : u.id)}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12.5px] font-semibold cursor-pointer transition-colors bg-[#1a1f2e] border border-amber-700/40 text-amber-400 hover:border-amber-500 whitespace-nowrap shrink-0"
                                >
                                  <Banknote className="w-3.5 h-3.5 shrink-0" />
                                  환불 {refundCount}건
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-b border-slate-800/60" style={{ background: 'rgba(99,102,241,0.04)' }}>
                            <td colSpan={11}>
                              <PaymentHistoryPanel userId={u.id} />
                              <RefundHistoryPanel userId={u.id} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── 모바일: 압축 카드 ── */}
            <div className="md:hidden flex flex-col gap-2.5">
              {paged.map((u) => {
                const status = normalizeStatus(u);
                const historyCount = (paymentHistory[u.id] ?? []).length;
                const refundCount = (refundHistory[u.id] ?? []).length;
                const expanded = expandedId === u.id;
                return (
                  <div key={u.id} className="rounded-xl p-3.5" style={{ background: '#12151f', border: '1px solid rgba(51,65,85,0.5)' }}>
                    <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: `${PLAN_COLOR[u.plan] ?? PLAN_COLOR.free}22`, color: PLAN_COLOR[u.plan] ?? PLAN_COLOR.free }}>
                        {PLAN_LABEL[u.plan] ?? u.plan}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: `${STATUS_COLOR[status]}1f`, color: STATUS_COLOR[status] }}>
                        {STATUS_LABEL[status]}
                      </span>
                      <span className="text-[10.5px] text-slate-500 ml-auto">가입 {formatDate(u.created_at)}</span>
                    </div>
                    <p className="text-[13px] font-semibold text-white truncate mb-1.5">{u.email ?? '-'}</p>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span>
                        기업분석 <span className={usageColorClass(u.diagnosis_used_month, u.diagnosis_limit)}>{u.diagnosis_used_month}/{u.diagnosis_limit}</span>
                        {' · 포트폴리오 '}
                        <span className={usageColorClass(u.portfolio_used, u.portfolio_limit)}>{u.portfolio_used}/{u.portfolio_limit}</span>
                        {' · 종목분석 '}
                        <span className={usageColorClass(u.stock_analysis_used, u.stock_analysis_limit)}>{u.stock_analysis_used}/{u.stock_analysis_limit}{u.stock_analysis_daily ? '(오늘)' : ''}</span>
                      </span>
                      <span>다음결제 {formatDate(u.next_billed_at)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                      <span>1회권 잔여 종목 {u.stock_credits} · 포트폴리오 {u.portfolio_credits}</span>
                    </div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="text-[11px] text-slate-500">최근 로그인 {formatDateTime(u.last_sign_in_at)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setExpandedId(expanded ? null : u.id)}
                        disabled={historyCount === 0 && refundCount === 0}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[12.5px] font-semibold cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-[#1a1f2e] border border-slate-700/50 text-slate-300"
                      >
                        <Receipt className="w-3.5 h-3.5" />
                        결제 이력 {historyCount}건
                      </button>
                      {refundCount > 0 && (
                        <button
                          onClick={() => setExpandedId(expanded ? null : u.id)}
                          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[12.5px] font-semibold cursor-pointer transition-colors bg-[#1a1f2e] border border-amber-700/40 text-amber-400 whitespace-nowrap"
                        >
                          <Banknote className="w-3.5 h-3.5 shrink-0" />
                          환불 {refundCount}건
                        </button>
                      )}
                    </div>
                    {expanded && (
                      <div className="mt-2 rounded-lg" style={{ background: 'rgba(99,102,241,0.06)' }}>
                        <PaymentHistoryPanel userId={u.id} />
                        <RefundHistoryPanel userId={u.id} />
                      </div>
                    )}
                  </div>
                );
              })}
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
                  {pageClamped} / {totalPages} 페이지 · 총 {sorted.length}명
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
