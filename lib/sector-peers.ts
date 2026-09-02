// app/api/stock/[ticker]/sector/route.ts에 있던 네이버 동종업계 스크래핑 로직을
// 재사용 가능한 함수로 추출(2026-07-13, 기업분석 페이지 업종 대비 비교 기능과 공유).

import { fetchMarketCapsCached } from './kis-api';

async function fetchNaverHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Naver HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  return new TextDecoder('euc-kr').decode(buf);
}

function parseSectorNo(html: string): string | null {
  const m = html.match(/sise_group_detail\.naver\?type=upjong&no=(\d+)/);
  return m ? m[1] : null;
}

// 업종 그룹 페이지의 <title>은 "반도체와반도체장비 : Npay 증권"처럼 실제 분류명(네이버가
// 쓰는 WICS 기반 하위산업명)을 담고 있다 — 2026-09-02: 카드에 표시되던 업종명은 이 값이
// 아니라 KIS bstp_kor_isnm("전기·전자" 같은 훨씬 넓은 대분류)이라, peer 6종목이 실제로
// 어느 분류에서 뽑혔는지와 화면 표시가 어긋났다(삼성전자 실측: 화면엔 "전기·전자"인데
// peer는 "반도체와반도체장비"에서 선정). peer 선정에 실제로 쓰인 이 이름으로 카드 표시를
// 맞춘다.
function parseSectorGroupName(html: string): string | null {
  const m = html.match(/<title>([\s\S]*?)<\/title>/);
  if (!m) return null;
  const title = m[1].trim();
  const colonIdx = title.indexOf(':');
  const name = (colonIdx > 0 ? title.slice(0, colonIdx) : title).trim();
  return name || null;
}

export interface SectorPeer {
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
}

interface SectorPeerWithTrading extends SectorPeer {
  _trading: number;
}

function parseSectorPeers(html: string, excludeTicker: string): SectorPeerWithTrading[] {
  const peers: SectorPeerWithTrading[] = [];

  // Split on <tr> boundaries (may have attributes like onMouseOver)
  const blocks = html.split(/<tr(?:\s[^>]*)?>/);

  for (const block of blocks) {
    const codeMatch = block.match(/code=(\d{6})"/);
    if (!codeMatch) continue;
    const ticker = codeMatch[1];
    // 2026-09-02 실사용 발견: 우선주 코드는 보통주와 앞 5자리를 공유하고 마지막 1자리만
    // 다르다(KRX 관행 — 예: 삼성전자 005930→005935(우), 현대차 005380→005385(우)·
    // 005387(2우B)·005389(3우B)). excludeTicker만 정확히 걸러서는 자기 자신의 우선주가
    // "동종업계 peer"로 잡히는데(현대차 리포트 실측: peer 6개 중 3개가 현대차 자기 우선주),
    // 앞 5자리가 같으면 같은 발행사로 보고 제외한다.
    if (ticker === excludeTicker || ticker.slice(0, 5) === excludeTicker.slice(0, 5)) continue;

    const nameMatch = block.match(/code=\d{6}"[^>]*>([^<]+)<\/a>/);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();

    // Extract all <td>…</td> contents, strip inner HTML tags, keep only numeric values
    const tdNums: number[] = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(block)) !== null) {
      const text = td[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, '').replace(/,/g, '');
      if (/^-?\d+\.?\d*$/.test(text)) {
        tdNums.push(parseFloat(text));
      }
    }

    // Numeric td layout (non-numeric tds like name/direction are excluded):
    // [0]=price [1]=bid [2]=ask [3]=volume [4]=tradingValue(백만원) [5]=전일거래량
    // 2026-09-02 실측 확인: 예전 주석은 [5]를 "marketCap?"으로 추측했지만, 실제 값을
    // KIS 라이브 시가총액과 대조해보니 자릿수가 전혀 안 맞고 당일 거래량(td[3])과
    // 비슷한 규모였다 — 시가총액이 아니라 전일 거래량이다(이 페이지엔 시가총액 컬럼이
    // 없음 — 시가총액 필터가 필요하면 별도로 KIS를 조회해야 함, fetchMarketCapsCached 참고).
    if (tdNums.length < 5) continue;
    const price = tdNums[0];
    const tradingValue = tdNums[4];
    if (price <= 0) continue;

    // Change rate: parse from span with mandatory sign (+/-)
    const rateMatch = block.match(/([+-]\d+\.?\d*)%/);
    const changeRate = rateMatch ? parseFloat(rateMatch[1]) : 0;

    peers.push({ ticker, name, price, changeRate, _trading: tradingValue });
  }

  return peers;
}

// 업종 회원 수가 이 값을 넘으면 "넓은 업종"으로 보고 시가총액 유사도 필터를 추가 적용한다.
// 2026-09-02 실측(오늘자 네이버 upjong 회원 수) — 좁은 업종: 자동차 12·석유와가스 17·
// 양방향미디어와서비스 16 / 넓은 업종: 반도체와반도체장비 170·제약 171·화학 121. 두 그룹
// 사이에 큰 간극이 있어(17 vs 121) 그 사이 40을 기준선으로 잡았다 — 좁은 쪽 최댓값의
// 2배 이상 여유를 두고, 넓은 쪽 최솟값의 1/3 이하라 오탐 여지가 작다.
const BROAD_SECTOR_MEMBER_THRESHOLD = 40;

// 시가총액 유사도 밴드 — 대상 종목 시가총액의 0.1~10배(100배 폭) 밖은 후보에서 제외.
// 2026-09-02 실측 검증: 종근당(9,565억원)에 적용하면 셀트리온(43.3조)·삼성바이오로직스
// (69.5조) 같은 초대형주만 걸러지고 JW신약·현대약품·한미약품·일동제약 같은 실제로 비교
// 가능한 중견 제약사는 그대로 남았다. 삼성전자처럼 국내 시총 최상위권 종목은 이 밴드로도
// SK하이닉스 정도만 남을 수 있는데(국내에 그 규모의 반도체 업종 동종업계가 실제로 드묾),
// 억지로 밴드를 넓혀 소형 장비주를 다시 끌어들이는 것보다 "진짜 비교 가능한 곳만 남긴다"는
// 원칙이 이 기능의 목적(peer 품질 개선)에 맞는다고 판단해 그대로 둔다 — peer가 1~2개로
// 줄어드는 것은 버그가 아니라 그 업종 특성상 나오는 정직한 결과.
const MARKET_CAP_BAND_LOWER = 0.1;
const MARKET_CAP_BAND_UPPER = 10;

// 넓은 업종에서 시가총액을 조회할 후보 상한 — 거래대금 상위 순으로 이만큼만 확인한다.
// (좁은 업종은 이 조회 자체가 없어 0건 그대로.) 대형주라 상위 후보 대부분이 밴드 밖으로
// 걸러지는 경우에도 diagnosis 라우트의 시간 예산(120초) 안에 들어오도록 상한을 둔다.
const BROAD_SECTOR_CANDIDATE_CHECK_LIMIT = 40;

// 넓은 업종에서만 쓰는 2차 필터 — 거래대금 상위 BROAD_SECTOR_CANDIDATE_CHECK_LIMIT개까지
// 시가총액을 조회해(fetchMarketCapsCached, 캐시 우선) 대상 종목과 규모가 비슷한 것만
// 남긴 뒤(거래대금 순서는 그대로 유지) 상위 6개를 취한다. 대상 종목 시가총액 조회 자체가
// 실패하면(드묾) 필터를 건너뛰고 기존 거래대금 정렬 상위 6개로 폴백한다.
async function selectPeersByMarketCapSimilarity(
  ticker: string,
  candidates: SectorPeerWithTrading[],
): Promise<SectorPeerWithTrading[]> {
  const pool = [...candidates].sort((a, b) => b._trading - a._trading).slice(0, BROAD_SECTOR_CANDIDATE_CHECK_LIMIT);
  const caps = await fetchMarketCapsCached([ticker, ...pool.map((p) => p.ticker)]);
  const targetCap = caps.get(ticker);
  if (!targetCap) return pool.slice(0, 6);

  const lower = targetCap * MARKET_CAP_BAND_LOWER;
  const upper = targetCap * MARKET_CAP_BAND_UPPER;
  return pool
    .filter((p) => {
      const cap = caps.get(p.ticker);
      return cap !== undefined && cap >= lower && cap <= upper;
    })
    .slice(0, 6);
}

export interface SectorPeersResult {
  peers: SectorPeer[];
  // peer 선정에 실제로 쓰인 네이버 하위분류명(예: "반도체와반도체장비") — 파싱 실패 시 null.
  sectorName: string | null;
  // 자기 자신(및 같은 발행사 우선주) 제외 후 전체 후보 수.
  totalCandidates: number;
  // totalCandidates > BROAD_SECTOR_MEMBER_THRESHOLD — 시가총액 유사도 필터가 적용됐는지.
  isBroadSector: boolean;
}

export async function fetchSectorPeers(ticker: string): Promise<SectorPeersResult> {
  // 1. Get the Naver upjong no for this ticker
  const itemHtml = await fetchNaverHtml(
    `https://finance.naver.com/item/coinfo.naver?code=${ticker}`,
  );
  const sectorNo = parseSectorNo(itemHtml);
  if (!sectorNo) return { peers: [], sectorName: null, totalCandidates: 0, isBroadSector: false };

  // 2. Get sector member list with prices
  const sectorHtml = await fetchNaverHtml(
    `https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no=${sectorNo}`,
  );
  const sectorName = parseSectorGroupName(sectorHtml);
  const candidates = parseSectorPeers(sectorHtml, ticker);
  const isBroadSector = candidates.length > BROAD_SECTOR_MEMBER_THRESHOLD;

  const selected = isBroadSector
    ? await selectPeersByMarketCapSimilarity(ticker, candidates)
    : [...candidates].sort((a, b) => b._trading - a._trading).slice(0, 6);

  return {
    peers: selected.map(({ ticker, name, price, changeRate }) => ({ ticker, name, price, changeRate })),
    sectorName,
    totalCandidates: candidates.length,
    isBroadSector,
  };
}

// 오늘 이 종목의 등락률이 동종업계 peer 평균 등락률 대비 몇 %p 높은/낮은지 —
// 기업분석 페이지의 "업종 대비" 비교용. peer가 없으면 null(섹션 자체 생략).
export function computeSectorRelativeChange(
  todayChangeRate: number,
  peers: SectorPeer[],
): { peerAvgChangeRate: number; deltaVsPeer: number } | null {
  if (peers.length === 0) return null;
  const peerAvgChangeRate = peers.reduce((sum, p) => sum + p.changeRate, 0) / peers.length;
  return {
    peerAvgChangeRate: parseFloat(peerAvgChangeRate.toFixed(2)),
    deltaVsPeer: parseFloat((todayChangeRate - peerAvgChangeRate).toFixed(2)),
  };
}

// ── 개장 전 생성 시 "전일 마감 기준" 업종 대비 (2026-09-02) ─────────────────────────────
// 2026-09-02 08:38 S-Oil 실화면: 개장 전엔 네이버 업종 페이지의 peer 등락률이 전부 0.00%이고
// KIS 현재가의 당일 등락률도 0이라 "업종 평균 +0.00% / 차이 +0.00%p"라는 무의미한 카드가
// 나왔다. AI 서술(주가 배경)은 이미 "어제 상승"으로 전일 기준을 쓰고 있으므로 업종 대비도 같은
// 기준으로 맞춘다 — 평일 개장(09:00) 전이면서 차트에 오늘 행이 없으면(lib/market-day-context.ts의
// "개장 전 보류" 구간) 이미 받아둔 일별 차트(종목 1Y, peer 1M)의 마지막 두 종가로 전일 등락률을
// 계산하고 basis='prevClose'·basisDate(그 마감일)를 함께 내려 카드/프롬프트가 "전일 기준"임을 밝힌다.
// 장중·장마감 후는 기존대로 당일 등락률(basis='today').
import type { MarketDayContext } from './market-day-context';
import { isKoreanMarketPreOpen } from './market-utils';

export type SectorBasis = 'today' | 'prevClose';

export interface SectorRelativeChangeFromCloses {
  peerAvgChangeRate: number;
  deltaVsPeer: number;
  stockChangeRate: number; // 같은 기준(전일 마감)으로 계산한 이 종목의 등락률 — 프롬프트용
  basis: 'prevClose';
  basisDate: string;       // YYYY-MM-DD — 등락률의 마감일(= 차트 마지막 행)
  peerNames: string[];     // 실제 평균에 들어간 peer(마감일이 종목과 같은 것만)
}

export function shouldUsePrevCloseSectorBasis(ctx: MarketDayContext, now: Date = new Date()): boolean {
  // 거래일(주말·공휴일 확정 아님) + 차트에 오늘 행이 아직 없음 + 09:00 전 — 세 조건이 모두 맞을 때만.
  // 주말 새벽은 isTradingDay=false라 제외되고(네이버가 금요일 등락률을 그대로 보여주므로 기존 계산이
  // 유효), 09:00 이후엔 오늘 행이 곧 생기므로 당일 기준으로 돌아간다.
  return ctx.isTradingDay && ctx.daysSinceLastTradingDate > 0 && isKoreanMarketPreOpen(now);
}

function lastTwoCloses(chart: { date: string; close: number }[]): { date: string; rate: number } | null {
  if (chart.length < 2) return null;
  const last = chart[chart.length - 1];
  const prev = chart[chart.length - 2];
  if (!(prev.close > 0) || !(last.close > 0)) return null;
  return { date: last.date, rate: ((last.close - prev.close) / prev.close) * 100 };
}

export function computeSectorRelativeChangeFromCloses(
  stockChart: { date: string; close: number }[],
  peerCharts: { peer: SectorPeer; chart: { date: string; close: number }[] }[],
): SectorRelativeChangeFromCloses | null {
  const stock = lastTwoCloses(stockChart);
  if (!stock) return null;
  // 마감일이 종목과 다른 peer(거래정지·조회 실패 등)는 다른 날짜의 등락률이라 평균에서 제외
  const usable = peerCharts
    .map(({ peer, chart }) => ({ peer, last: lastTwoCloses(chart) }))
    .filter((x): x is { peer: SectorPeer; last: { date: string; rate: number } } => x.last !== null && x.last.date === stock.date);
  if (usable.length === 0) return null;
  const peerAvg = usable.reduce((s, x) => s + x.last.rate, 0) / usable.length;
  return {
    peerAvgChangeRate: parseFloat(peerAvg.toFixed(2)),
    deltaVsPeer: parseFloat((stock.rate - peerAvg).toFixed(2)),
    stockChangeRate: parseFloat(stock.rate.toFixed(2)),
    basis: 'prevClose',
    basisDate: stock.date,
    peerNames: usable.map((x) => x.peer.name),
  };
}
