'use client';

import { fmtNum } from '@/lib/format';
import type { Health, IgpStatus } from '@/lib/types';

import { ChainBadge } from './ChainBadge';
import { Address, Card, SectionTitle, StatusPill } from './ui';

function usd(n: number | null): string {
  return n === null ? '' : `≈ $${n < 0.01 ? n.toFixed(4) : fmtNum(n, 2)}`;
}

function IgpCard({ igp }: { igp: IgpStatus }) {
  return (
    <Card accent={igp.health} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted">Paid on</span>
          <ChainBadge chain={igp.chain} name={igp.displayName} size="sm" />
        </div>
        <StatusPill
          health={igp.health}
          label={
            igp.health === 'ok'
              ? 'Quoting'
              : igp.health === 'warn'
                ? 'Partial'
                : igp.health === 'down'
                  ? 'No quote'
                  : 'Unknown'
          }
        />
      </div>
      {igp.contracts.length > 0 && (
        <div className="flex flex-col gap-1 text-xs">
          {igp.contracts.map((c) => (
            <div key={`${c.role}-${c.address}`} className="flex flex-wrap items-center gap-x-2">
              <span className="w-32 shrink-0 text-muted">{c.role}</span>
              <Address value={c.address} href={c.explorerUrl} chars={8} />
              {c.note && <span className="text-muted/70">({c.note})</span>}
            </div>
          ))}
        </div>
      )}
      {igp.error ? (
        <p className="text-xs text-down">{igp.error}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">To</th>
                <th className="py-1 pr-2 font-medium">Gas</th>
                <th className="py-1 pr-2 font-medium">Oracle gas price</th>
                <th className="py-1 pr-2 font-medium">Exchange rate</th>
                <th className="py-1 font-medium">Fee per transfer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {igp.quotes.map((q) => (
                <tr key={q.destination}>
                  <td className="py-1.5 pr-2">
                    <ChainBadge chain={q.destination} name={q.destinationDisplayName} size="sm" />
                  </td>
                  <td className="mono py-1.5 pr-2">{fmtNum(q.gasAmount, 0)}</td>
                  <td className="mono py-1.5 pr-2" title={q.oracle ? `oracle ${q.oracle}` : undefined}>
                    {q.gasPrice ?? '—'}
                  </td>
                  <td className="mono py-1.5 pr-2">{q.exchangeRate ?? '—'}</td>
                  <td className="py-1.5">
                    {q.quote === null ? (
                      <span className="text-down" title={q.error}>
                        {q.error ? 'error' : '—'}
                      </span>
                    ) : (
                      <span className="mono">
                        <span className="font-semibold">
                          {fmtNum(q.quote, 6)} {q.quoteSymbol}
                        </span>{' '}
                        <span className="text-muted">{usd(q.quoteUsd)}</span>
                      </span>
                    )}
                    {q.note && <div className="text-[11px] text-muted">{q.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function IgpSection({
  igp,
  overall,
  prices,
}: {
  igp: IgpStatus[];
  overall: Health;
  prices: Record<string, number>;
}) {
  const priceLine = ['LUNC', 'BNB', 'ETH', 'SOL']
    .filter((s) => prices[s])
    .map((s) => `${s} $${prices[s] < 1 ? prices[s].toFixed(6) : fmtNum(prices[s], 2)}`)
    .join(' · ');
  return (
    <div>
      <SectionTitle
        title="Interchain gas payments (IGP)"
        subtitle={`Gas fee quoted on the origin chain for one transfer, from the on-chain IGP and its gas oracle.${priceLine ? ` Prices (Binance): ${priceLine}` : ''}`}
        right={<StatusPill health={overall} />}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        {igp.map((g) => (
          <IgpCard key={g.chain} igp={g} />
        ))}
      </div>
    </div>
  );
}
