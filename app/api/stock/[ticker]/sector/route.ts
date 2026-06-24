import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

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

interface SectorPeer {
  ticker: string;
  name: string;
  price: number;
  changeRate: number;
  _trading: number;
}

function parseSectorPeers(html: string, excludeTicker: string): SectorPeer[] {
  const peers: SectorPeer[] = [];

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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;

  try {
    // 1. Get the Naver upjong no for this ticker
    const itemHtml = await fetchNaverHtml(
      `https://finance.naver.com/item/coinfo.naver?code=${ticker}`,
    );
    const sectorNo = parseSectorNo(itemHtml);
    if (!sectorNo) return Response.json([]);

    // 2. Get sector member list with prices
    const sectorHtml = await fetchNaverHtml(
      `https://finance.naver.com/sise/sise_group_detail.naver?type=upjong&no=${sectorNo}`,
    );
    const peers = parseSectorPeers(sectorHtml, ticker);

    // Sort by trading value (most active = most relevant large-caps first)
    peers.sort((a, b) => b._trading - a._trading);

    return Response.json(
      peers.slice(0, 6).map(({ ticker, name, price, changeRate }) => ({
        ticker,
        name,
        price,
        changeRate,
      })),
    );
  } catch (err) {
    console.error(`[sector] ${ticker}:`, err);
    return Response.json([]);
  }
}
