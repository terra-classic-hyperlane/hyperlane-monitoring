import { errMsg, withTimeout } from './cache';
import {
  EVM_LOGS_CHUNK,
  EVM_LOOKBACK_BLOCKS,
  HUB_CHAIN,
  PENDING_DOWN_MINUTES,
  PENDING_WARN_MINUTES,
  RECENT_MESSAGES,
  REMOTE_CHAINS,
  SOLANA_SIGS_PER_PROGRAM,
  SOLANA_WARP_PROGRAMS_FALLBACK,
} from './config';
import { messageDelivered, recentMailboxActivity, type MailboxActivity } from './cosmos';
import { evmDelivered, evmRecentDispatches } from './evm';
import { getTcWarpDeployments } from './registry';
import { solDelivered, solRecentDispatches } from './solana';
import type { ChainInfo, ChainName, Health, RecentMessage, RouteStatus } from './types';

async function isDelivered(dest: ChainInfo, msgId: string): Promise<boolean | null> {
  try {
    if (dest.protocol === 'cosmos') return await messageDelivered(dest, msgId);
    if (dest.protocol === 'ethereum') return await evmDelivered(dest, msgId);
    return await solDelivered(dest, msgId);
  } catch {
    return null;
  }
}

function summarize(base: RouteStatus, recent: RecentMessage[], lastDeliveredFromDest: number | null, note?: string): RouteStatus {
  const now = Date.now();
  const delivered = recent.filter((m) => m.delivered === true);
  const pending = recent.filter((m) => m.delivered === false);
  const lastDispatchAt = recent.reduce<number | null>((a, m) => (m.dispatchedAt && (!a || m.dispatchedAt > a) ? m.dispatchedAt : a), null);
  const lastDeliveredAt = delivered.reduce<number | null>(
    (a, m) => (m.dispatchedAt && (!a || m.dispatchedAt > a) ? m.dispatchedAt : a),
    lastDeliveredFromDest,
  );
  const oldestPendingMinutes = pending.reduce<number | null>((a, m) => {
    if (!m.dispatchedAt) return a;
    const age = (now - m.dispatchedAt) / 60_000;
    return a === null || age > a ? age : a;
  }, null);
  let health: Health = 'ok';
  if (!recent.length && lastDeliveredAt === null) health = 'unknown';
  else if (oldestPendingMinutes !== null && oldestPendingMinutes > PENDING_DOWN_MINUTES) health = 'down';
  else if (oldestPendingMinutes !== null && oldestPendingMinutes > PENDING_WARN_MINUTES) health = 'warn';
  return { ...base, recent, lastDispatchAt, lastDeliveredAt, pendingCount: pending.length, oldestPendingMinutes, health, note };
}

type Item = { id: string; nonce: number | null; dispatchedAt: number | null; originTx: string };

async function withDelivery(dest: ChainInfo, items: Item[]): Promise<RecentMessage[]> {
  const now = Date.now();
  return Promise.all(
    items.map(async (m) => ({
      ...m,
      delivered: await isDelivered(dest, m.id),
      ageMinutes: m.dispatchedAt ? Math.round((now - m.dispatchedAt) / 60_000) : null,
    })),
  );
}

export async function routeStatuses(chains: Record<ChainName, ChainInfo>): Promise<RouteStatus[]> {
  const tc = chains[HUB_CHAIN];
  const mk = (origin: ChainName, destination: ChainName): RouteStatus => ({
    origin,
    destination,
    originDisplayName: chains[origin].displayName,
    destinationDisplayName: chains[destination].displayName,
    recent: [],
    lastDispatchAt: null,
    lastDeliveredAt: null,
    pendingCount: 0,
    oldestPendingMinutes: null,
    health: 'unknown',
  });

  // One LCD search gives TC -> remote dispatches AND remote -> TC deliveries.
  const activity: Promise<MailboxActivity> = withTimeout(recentMailboxActivity(tc, 40), 25_000, 'Terra Classic tx search');

  const outbound = REMOTE_CHAINS.map(async (dest): Promise<RouteStatus> => {
    const base = mk(HUB_CHAIN, dest);
    try {
      const { dispatches } = await activity;
      const mine = dispatches.filter((d) => d.destination === chains[dest].domainId).slice(0, RECENT_MESSAGES);
      const recent = await withDelivery(
        chains[dest],
        mine.map((d) => ({ id: d.msgId, nonce: d.nonce, dispatchedAt: d.timestamp, originTx: d.txhash })),
      );
      return summarize(base, recent, null, mine.length ? undefined : 'No recent transfers on this route');
    } catch (e) {
      return { ...base, error: errMsg(e) };
    }
  });

  const inbound = REMOTE_CHAINS.map(async (origin): Promise<RouteStatus> => {
    const base = mk(origin, HUB_CHAIN);
    const oc = chains[origin];
    // Deliveries into TC are cheap to read on TC itself.
    let lastDeliveredFromDest: number | null = null;
    try {
      const { processes } = await activity;
      lastDeliveredFromDest = processes.filter((p) => p.origin === oc.domainId).reduce<number | null>((a, p) => (!a || p.timestamp > a ? p.timestamp : a), null);
    } catch {
      // handled below through the origin scan
    }
    try {
      let items: Item[] = [];
      let note: string | undefined;
      if (oc.protocol === 'ethereum') {
        const lookback = EVM_LOOKBACK_BLOCKS[origin] ?? 3000;
        const logs = await withTimeout(evmRecentDispatches(oc, tc.domainId, lookback, EVM_LOGS_CHUNK, RECENT_MESSAGES), 30_000, `${origin} logs`);
        items = logs.map((l) => ({ id: l.msgId, nonce: null, dispatchedAt: l.timestamp, originTx: l.txhash }));
        if (!items.length) note = `No transfers to Terra Classic in the last ${lookback.toLocaleString('en-US')} ${origin === 'bsc' ? 'BSC' : 'Ethereum'} blocks`;
      } else {
        const deployments = await getTcWarpDeployments().catch(() => []);
        const programs = deployments.map((d) => d.chains.solanamainnet?.foreignDeployment ?? d.tokens.solanamainnet).filter((p): p is string => !!p);
        const list = programs.length ? programs : SOLANA_WARP_PROGRAMS_FALLBACK;
        const sigs = await withTimeout(solRecentDispatches(oc, list, tc.domainId, SOLANA_SIGS_PER_PROGRAM), 30_000, 'solana signatures');
        items = sigs.slice(0, RECENT_MESSAGES).map((s) => ({ id: s.msgId, nonce: null, dispatchedAt: s.timestamp, originTx: s.signature }));
        if (!items.length) note = 'No transfers to Terra Classic among the latest warp route transactions';
      }
      const recent = await withDelivery(tc, items);
      return summarize(base, recent, lastDeliveredFromDest, note);
    } catch (e) {
      // Origin scan failed (rate limit / RPC): still report what TC knows.
      const msg = errMsg(e);
      const friendly = /429|Too many requests/i.test(msg) ? `${oc.displayName} public RPC rate-limited the scan; deliveries are still tracked on Terra Classic` : msg;
      const partial = summarize(base, [], lastDeliveredFromDest, friendly);
      return lastDeliveredFromDest ? partial : { ...partial, error: msg };
    }
  });

  return Promise.all([...outbound, ...inbound]);
}

export function relayerHealth(routes: RouteStatus[]): Health {
  const known = routes.filter((r) => r.health !== 'unknown');
  if (!known.length) return 'unknown';
  if (known.some((r) => r.health === 'down')) return 'down';
  if (known.some((r) => r.health === 'warn')) return 'warn';
  return 'ok';
}
