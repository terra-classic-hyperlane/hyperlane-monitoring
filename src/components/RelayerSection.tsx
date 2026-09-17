'use client';

import { ArrowRight } from 'lucide-react';

import { SITE } from '@/lib/config';
import { fmtMinutes } from '@/lib/format';
import type { RouteStatus, StatusSnapshot } from '@/lib/types';

import { ChainBadge } from './ChainBadge';
import { Card, SectionTitle, Stat, StatusPill, TimeAgo } from './ui';

function RouteCard({ route, explorerByChain }: { route: RouteStatus; explorerByChain: Record<string, string | undefined> }) {
  const originExplorer = explorerByChain[route.origin];
  return (
    <Card accent={route.health} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ChainBadge chain={route.origin} name={route.originDisplayName} size="sm" />
          <ArrowRight size={16} className="text-muted" />
          <ChainBadge chain={route.destination} name={route.destinationDisplayName} size="sm" />
        </div>
        <StatusPill health={route.health} label={route.health === 'unknown' ? 'No data' : undefined} />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Last dispatch" value={<TimeAgo ts={route.lastDispatchAt} />} />
        <Stat label="Last delivered" value={<TimeAgo ts={route.lastDeliveredAt} />} />
        <Stat
          label="Pending"
          value={route.pendingCount}
          sub={route.oldestPendingMinutes !== null ? `oldest ${fmtMinutes(route.oldestPendingMinutes)}` : undefined}
          health={route.pendingCount ? route.health : undefined}
        />
      </div>
      {route.error ? (
        <p className="text-xs text-down">{route.error}</p>
      ) : route.note ? (
        <p className="text-xs text-muted">{route.note}</p>
      ) : (
        <ul className="divide-y divide-white/5 text-xs">
          {route.recent.slice(0, 5).map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 py-1.5">
              <a
                href={`${SITE.explorerUrl}/message/${m.id}`}
                target="_blank"
                rel="noreferrer"
                className="mono truncate text-muted hover:text-accent-2 hover:underline"
                title={m.id}
              >
                {m.id.slice(0, 10)}…{m.id.slice(-6)}
              </a>
              <span className="flex items-center gap-3 whitespace-nowrap">
                <TimeAgo ts={m.dispatchedAt} className="text-muted" />
                {m.delivered === true ? (
                  <span className="text-ok">delivered</span>
                ) : m.delivered === false ? (
                  <span className={route.health === 'ok' ? 'text-warn' : 'text-down'}>pending</span>
                ) : (
                  <span className="text-unknown">unknown</span>
                )}
                {originExplorer && (
                  <a href={`${originExplorer.replace(/\/$/, '')}/tx/${m.originTx}`} target="_blank" rel="noreferrer" className="text-muted hover:text-fg">
                    tx
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function RelayerSection({ snapshot }: { snapshot: StatusSnapshot }) {
  const explorerByChain = Object.fromEntries(snapshot.chains.map((c) => [c.name, c.explorerUrl]));
  const outbound = snapshot.relayer.routes.filter((r) => r.origin === 'terraclassic');
  const inbound = snapshot.relayer.routes.filter((r) => r.destination === 'terraclassic');
  return (
    <div>
      <SectionTitle
        title="Relayer"
        subtitle="Recent transfers per route and whether they were delivered on the destination chain"
        right={<StatusPill health={snapshot.relayer.health} />}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {outbound.map((r) => (
          <RouteCard key={`${r.origin}-${r.destination}`} route={r} explorerByChain={explorerByChain} />
        ))}
        {inbound.map((r) => (
          <RouteCard key={`${r.origin}-${r.destination}`} route={r} explorerByChain={explorerByChain} />
        ))}
      </div>
    </div>
  );
}
