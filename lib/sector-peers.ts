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
