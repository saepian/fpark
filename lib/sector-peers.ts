// app/api/stock/[ticker]/sector/route.ts에 있던 네이버 동종업계 스크래핑 로직을
// 재사용 가능한 함수로 추출(2026-07-13, 기업분석 페이지 업종 대비 비교 기능과 공유).

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
    if (ticker === excludeTicker) continue;

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
    // [0]=price [1]=ask [2]=bid [3]=volume [4]=tradingValue [5]=marketCap?
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

export async function fetchSectorPeers(ticker: string): Promise<SectorPeer[]> {
  // 1. Get the Naver upjong no for this ticker
  const itemHtml = await fetchNaverHtml(
    `https://finance.naver.com/item/coinfo.naver?code=${ticker}`,
  );
  const sectorNo = parseSectorNo(itemHtml);
  if (!sectorNo) return [];

  // 2. Get sector member list with prices
  const sectorHtml = await fetchNaverHtml(
    `https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no=${sectorNo}`,
  );
  const peers = parseSectorPeers(sectorHtml, ticker);

  // Sort by trading value (most active = most relevant large-caps first)
  peers.sort((a, b) => b._trading - a._trading);

  return peers.slice(0, 6).map(({ ticker, name, price, changeRate }) => ({ ticker, name, price, changeRate }));
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
