'use client';

import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

import { SITE } from '@/lib/config';
import type { Health, StatusSnapshot } from '@/lib/types';

import { AgentSection } from './AgentSection';
import { BalancesSection } from './BalancesSection';
import { IgpSection } from './IgpSection';
import { RelayerSection } from './RelayerSection';
import { Card, HEALTH_LABEL, HealthDot, Skeleton, StatusPill, TimeAgo } from './ui';
import { ValidatorsSection } from './ValidatorsSection';

const REFRESH_MS = 30_000;

function worst(...hs: Health[]): Health {
  if (hs.includes('down')) return 'down';
  if (hs.includes('warn')) return 'warn';
  if (hs.length && hs.every((h) => h === 'unknown')) return 'unknown';
  return 'ok';
}

const HEADLINE: Record<Health, string> = {
  ok: 'All systems operational',
  warn: 'Bridge operational with warnings',
  down: 'Attention required',
  unknown: 'Status unknown',
};

async function fetchStatus(): Promise<StatusSnapshot> {
  const res = await fetch('/api/status', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as StatusSnapshot;
}

export function Dashboard() {
  const [client] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={client}>
      <DashboardInner />
    </QueryClientProvider>
  );
}

function DashboardInner() {
  const {
    data: snapshot,
    error: queryError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['status'],
    queryFn: fetchStatus,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    retry: 2,
  });
  const error = queryError ? (queryError instanceof Error ? queryError.message : String(queryError)) : null;
  const loading = isFetching;
  const load = () => refetch();

  const balancesHealth = snapshot ? worst(...snapshot.balances.map((b) => b.health)) : 'unknown';
  const validatorsHealth = snapshot ? worst(...snapshot.validators.map((v) => v.health)) : 'unknown';
  const igpHealth = snapshot ? worst(...snapshot.igp.map((g) => g.health)) : 'unknown';
  const explorers = snapshot ? Object.fromEntries(snapshot.chains.map((c) => [c.name, c.explorerUrl])) : {};

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent-2 text-black shadow-lg shadow-accent/30">
            <span className="text-lg font-black">TC</span>
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{SITE.title}</h1>
            <p className="text-sm text-muted">Hyperlane bridge · Terra Classic ↔ BSC · Ethereum · Solana</p>
          </div>
        </div>
        <nav className="flex items-center gap-4 text-sm text-muted">
          <a href={SITE.bridgeUrl} target="_blank" rel="noreferrer" className="hover:text-fg">
            Bridge
          </a>
          <a href={SITE.explorerUrl} target="_blank" rel="noreferrer" className="hover:text-fg">
            Explorer
          </a>
          <a href="/api/status" target="_blank" rel="noreferrer" className="hover:text-fg">
            API
          </a>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-full border border-card-border px-3 py-1 hover:text-fg"
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Refresh
          </button>
        </nav>
      </header>

      {snapshot ? (
        <Card accent={snapshot.overall} className="flex flex-wrap items-center justify-between gap-4 py-4">
          <div className="flex items-center gap-3">
            <HealthDot health={snapshot.overall} live size={14} />
            <div>
              <div className="text-lg font-semibold">{HEADLINE[snapshot.overall]}</div>
              <div className="text-sm text-muted">
                Updated <TimeAgo ts={snapshot.generatedAt} /> · checked in {(snapshot.durationMs / 1000).toFixed(1)}s ·
                auto-refresh every 30s
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill health={snapshot.relayer.health} label={`Relayer: ${HEALTH_LABEL[snapshot.relayer.health]}`} />
            <StatusPill health={balancesHealth} label={`Balances: ${HEALTH_LABEL[balancesHealth]}`} />
            <StatusPill health={validatorsHealth} label={`Validators: ${HEALTH_LABEL[validatorsHealth]}`} />
          </div>
        </Card>
      ) : error ? (
        <Card accent="down">
          <div className="font-medium text-down">Could not load status: {error}</div>
          <div className="text-sm text-muted">Retrying automatically.</div>
        </Card>
      ) : (
        <Card className="flex items-center gap-3 py-4">
          <RefreshCw size={16} className="animate-spin text-muted" />
          <div>
            <div className="font-medium">Checking the bridge…</div>
            <div className="text-sm text-muted">
              Reading 4 chains, validator buckets and recent transfers. First load can take up to a minute.
            </div>
          </div>
        </Card>
      )}

      {snapshot ? (
        <>
          <RelayerSection snapshot={snapshot} />
          <BalancesSection balances={snapshot.balances} overall={balancesHealth} />
          <ValidatorsSection sets={snapshot.validators} overall={validatorsHealth} explorers={explorers} />
          <IgpSection igp={snapshot.igp} overall={igpHealth} prices={snapshot.prices} />
          <AgentSection agents={snapshot.agents} />
          {snapshot.errors.length > 0 && (
            <details className="text-xs text-muted">
              <summary className="cursor-pointer">Data source warnings ({snapshot.errors.length})</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {snapshot.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      )}

      <footer className="mt-auto border-t border-card-border pt-4 text-xs text-muted">
        Data is read live from Terra Classic, BSC, Ethereum and Solana public RPCs, the validators&apos; public
        checkpoint buckets and the{' '}
        <a href={SITE.registryUrl} target="_blank" rel="noreferrer" className="underline hover:text-fg">
          Terra Classic Hyperlane registry
        </a>
        . Machine-readable:{' '}
        <a href="/api/status" className="underline hover:text-fg">
          /api/status
        </a>{' '}
        ·{' '}
        <a href="/api/health" className="underline hover:text-fg">
          /api/health
        </a>
      </footer>
    </main>
  );
}
