import { operatorBalances } from './balances';
import { cached, errMsg, peek } from './cache';
import { OPERATOR_ADDRESSES, SNAPSHOT_TTL_SECONDS } from './config';
import { agentMetrics } from './metrics';
import { getChains } from './registry';
import { relayerHealth, routeStatuses } from './relayer';
import type { AgentMetricsSummary, Health, StatusSnapshot } from './types';
import { allValidatorSets } from './validators';

function worst(...hs: Health[]): Health {
  if (hs.includes('down')) return 'down';
  if (hs.includes('warn')) return 'warn';
  if (hs.every((h) => h === 'unknown')) return 'unknown';
  return 'ok';
}

async function buildSnapshot(): Promise<StatusSnapshot> {
  const started = Date.now();
  const errors: string[] = [];
  const chains = await getChains();
  const [routes, balances, validators, agents] = await Promise.all([
    routeStatuses(chains).catch((e) => {
      errors.push(`relayer: ${errMsg(e)}`);
      return [];
    }),
    operatorBalances(chains).catch((e) => {
      errors.push(`balances: ${errMsg(e)}`);
      return [];
    }),
    allValidatorSets(chains).catch((e) => {
      errors.push(`validators: ${errMsg(e)}`);
      return [];
    }),
    agentMetrics().catch((e): AgentMetricsSummary => ({ configured: true, reachable: false, error: errMsg(e) })),
  ]);
  for (const r of routes) if (r.error) errors.push(`${r.originDisplayName} → ${r.destinationDisplayName}: ${r.error}`);
  for (const b of balances) if (b.error) errors.push(`${b.displayName} balance: ${b.error}`);
  for (const v of validators) if (v.error) errors.push(`${v.originDisplayName} validators: ${v.error}`);

  const relayer = relayerHealth(routes);
  const balanceHealth = worst(...balances.map((b) => b.health));
  const validatorHealth = worst(...validators.map((v) => v.health));
  // Agent metrics are optional: a critical error or a stuck queue downgrades to warn.
  let agentHealth: Health = 'ok';
  if (agents.relayer) {
    if (Object.values(agents.relayer.criticalErrors).some((v) => v > 0)) agentHealth = 'down';
    else if (agents.relayer.queueLengths.some((q) => q.length > 0)) agentHealth = 'warn';
  }
  return {
    generatedAt: Date.now(),
    durationMs: Date.now() - started,
    overall: worst(relayer, balanceHealth, validatorHealth, agentHealth),
    relayer: { health: relayer, operator: OPERATOR_ADDRESSES, routes },
    balances,
    validators,
    agents,
    chains: Object.values(chains).map((c) => ({ name: c.name, displayName: c.displayName, domainId: c.domainId, protocol: c.protocol, explorerUrl: c.explorerUrl, mailbox: c.mailbox })),
    errors,
  };
}

export async function getStatus(): Promise<StatusSnapshot> {
  return cached('snapshot', SNAPSHOT_TTL_SECONDS * 1000, buildSnapshot);
}

export function getCachedStatus(): StatusSnapshot | undefined {
  return peek<StatusSnapshot>('snapshot')?.value;
}
