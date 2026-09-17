import { cached } from './cache';

// Spot prices in USD from Binance (public API, no key). Cached for 60 s.
const SYMBOLS: Record<string, string> = {
  LUNC: 'LUNCUSDT',
  ETH: 'ETHUSDT',
  BNB: 'BNBUSDT',
  SOL: 'SOLUSDT',
  USTC: 'USTCUSDT',
};

export async function usdPrices(): Promise<Record<string, number>> {
  return cached('prices:binance', 60_000, async () => {
    const list = Object.values(SYMBOLS);
    const url = `https://api.binance.com/api/v3/ticker/price?symbols=${encodeURIComponent(JSON.stringify(list))}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), cache: 'no-store' });
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const data = (await res.json()) as Array<{ symbol: string; price: string }>;
    const bySymbol = Object.fromEntries(data.map((d) => [d.symbol, Number(d.price)]));
    const out: Record<string, number> = {};
    for (const [token, pair] of Object.entries(SYMBOLS))
      if (Number.isFinite(bySymbol[pair])) out[token] = bySymbol[pair];
    return out;
  });
}
