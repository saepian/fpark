'use client';

import { useState } from 'react';
import type { StockPrice } from '../../lib/types';
import StockHeader from './StockHeader';
import PriceChangeBadges from './PriceChangeBadges';

interface StockHeaderSectionProps {
  ticker: string;
}

export default function StockHeaderSection({ ticker }: StockHeaderSectionProps) {
  const [price, setPrice] = useState<StockPrice | null>(null);

  return (
    <>
      <StockHeader ticker={ticker} onPriceUpdate={setPrice} />
      {price && price.price > 0 && (
        <PriceChangeBadges ticker={ticker} currentPrice={price.price} />
      )}
    </>
  );
}
