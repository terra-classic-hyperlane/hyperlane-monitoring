'use client';

import clsx from 'clsx';

import { fmtNum } from '@/lib/format';
import type { BalanceStatus, Health } from '@/lib/types';

import { ChainBadge } from './ChainBadge';
import { Address, Card, SectionTitle, StatusPill } from './ui';

function pct(b: BalanceStatus): number {
  if (b.balance === null) return 0;
  const full = b.warnBelow * 3; // bar is "full" at 3x the warning level
  return Math.max(2, Math.min(100, (b.balance / full) * 100));
}
const BAR: Record<Health, string> = { ok: 'bg-ok', warn: 'bg-warn', down: 'bg-down', unknown: 'bg-unknown' };

export function BalancesSection({ balances, overall }: { balances: BalanceStatus[]; overall: Health }) {
  return (
    <div>
      <SectionTitle
        title="Operator balances"
        subtitle="Gas wallets used by the relayer to deliver messages. Deliveries stop when a wallet runs dry."
        right={<StatusPill health={overall} />}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {balances.map((b) => (
          <Card key={b.chain} accent={b.health} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <ChainBadge chain={b.chain} name={b.displayName} size="sm" />
              <StatusPill
                health={b.health}
                label={
                  b.health === 'down'
                    ? 'Low'
                    : b.health === 'warn'
                      ? 'Refill soon'
                      : b.health === 'ok'
                        ? 'Funded'
                        : 'Unknown'
                }
              />
            </div>
            <div>
              <div
                className={clsx(
                  'mono text-2xl font-semibold',
                  b.health === 'down' && 'text-down',
                  b.health === 'warn' && 'text-warn',
                )}
              >
                {b.balance === null ? '—' : fmtNum(b.balance)} <span className="text-sm text-muted">{b.symbol}</span>
              </div>
              {b.balanceUsd !== null && <div className="mono text-sm text-muted">≈ ${fmtNum(b.balanceUsd, 2)}</div>}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/8">
                <div
                  className={clsx('h-full rounded-full transition-all', BAR[b.health])}
                  style={{ width: `${pct(b)}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[11px] text-muted">
                <span>alert &lt; {fmtNum(b.criticalBelow)}</span>
                <span>warn &lt; {fmtNum(b.warnBelow)}</span>
              </div>
            </div>
            <Address value={b.address} href={b.explorerUrl} />
            {b.error && <p className="text-xs text-down">{b.error}</p>}
          </Card>
        ))}
      </div>
    </div>
  );
}
