import { bech32 } from 'bech32';

import { withTimeout } from './cache';
import { parseMessage, strip0x } from './message';
import type { ChainInfo } from './types';

const TIMEOUT = 15_000;

async function lcdGet<T>(chain: ChainInfo, path: string): Promise<T> {
  let lastErr: unknown;
  for (const base of chain.restUrls) {
    try {
      const res = await withTimeout(
        fetch(`${base}${path}`, { signal: AbortSignal.timeout(TIMEOUT), cache: 'no-store' }),
        TIMEOUT,
        `LCD ${base}`,
      );
      if (!res.ok) {
        lastErr = new Error(`LCD ${base} HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as T & { code?: number; message?: string };
      if (data && typeof data === 'object' && 'code' in data && data.code) {
        lastErr = new Error(`LCD ${base}: ${data.message}`);
        continue;
      }
      return data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('all LCDs failed');
}

export async function smartQuery<T>(chain: ChainInfo, contract: string, query: unknown): Promise<T> {
  const q = Buffer.from(JSON.stringify(query)).toString('base64');
  const data = await lcdGet<{ data: T }>(chain, `/cosmwasm/wasm/v1/contract/${contract}/smart/${q}`);
  return data.data;
}

// Registry stores CosmWasm contract addresses as bytes32 hex; convert to bech32.
export function hexToBech32(hex: string, prefix: string): string {
  const bytes = Buffer.from(strip0x(hex), 'hex');
  return bech32.encode(prefix, bech32.toWords(bytes), 1023);
}
export function contractAddr(chain: ChainInfo, hexOrBech32: string): string {
  if (hexOrBech32.startsWith(chain.bech32Prefix || 'terra')) return hexOrBech32;
  return hexToBech32(hexOrBech32, chain.bech32Prefix || 'terra');
}

export async function nativeBalance(chain: ChainInfo, address: string, denom = 'uluna'): Promise<number> {
  const data = await lcdGet<{ balance?: { amount: string } }>(
    chain,
    `/cosmos/bank/v1beta1/balances/${address}/by_denom?denom=${denom}`,
  );
  return Number(data.balance?.amount ?? 0) / 10 ** chain.nativeDecimals;
}

export async function mailboxNonce(chain: ChainInfo): Promise<number> {
  const r = await smartQuery<{ nonce: number }>(chain, contractAddr(chain, chain.mailbox), { mailbox: { nonce: {} } });
  return r.nonce;
}
export async function merkleCount(chain: ChainInfo): Promise<number> {
  const r = await smartQuery<{ count: number }>(chain, contractAddr(chain, chain.merkleTreeHook), {
    merkle_hook: { count: {} },
  });
  return r.count;
}
export async function messageDelivered(chain: ChainInfo, msgId: string): Promise<boolean> {
  const r = await smartQuery<{ delivered: boolean }>(chain, contractAddr(chain, chain.mailbox), {
    mailbox: { message_delivered: { id: strip0x(msgId) } },
  });
  return r.delivered;
}

export async function announcedValidators(chain: ChainInfo): Promise<string[]> {
  const r = await smartQuery<{ validators: string[] }>(chain, contractAddr(chain, chain.validatorAnnounce), {
    get_announced_validators: {},
  });
  return r.validators.map((v) => strip0x(v).toLowerCase());
}

export async function announcedStorageLocations(
  chain: ChainInfo,
  validators: string[], // hex, no 0x
): Promise<Record<string, string[]>> {
  const r = await smartQuery<{ storage_locations: Array<[string, string[]]> }>(
    chain,
    contractAddr(chain, chain.validatorAnnounce),
    { get_announce_storage_locations: { validators: validators.map(strip0x) } },
  );
  return Object.fromEntries(r.storage_locations.map(([v, locs]) => [strip0x(v).toLowerCase(), locs]));
}

// Terra Classic routing ISM: which multisig ISM (and validator set) secures messages from `origin`.
export async function routedValidatorSet(
  chain: ChainInfo,
  routingIsmHex: string,
  originDomain: number,
): Promise<{ ism: string; validators: string[]; threshold: number }> {
  const { probeMessageHex } = await import('./message');
  const routing = contractAddr(chain, routingIsmHex);
  const route = await smartQuery<{ ism: string }>(chain, routing, {
    routing_ism: { route: { message: probeMessageHex(originDomain, chain.domainId) } },
  });
  const set = await smartQuery<{ validators: string[]; threshold: number }>(chain, route.ism, {
    multisig_ism: { enrolled_validators: { domain: originDomain } },
  });
  return { ism: route.ism, validators: set.validators.map((v) => strip0x(v).toLowerCase()), threshold: set.threshold };
}

export async function defaultIsm(chain: ChainInfo): Promise<string> {
  const r = await smartQuery<{ default_ism: string }>(chain, contractAddr(chain, chain.mailbox), {
    mailbox: { default_ism: {} },
  });
  return r.default_ism;
}

export interface CosmosDispatch {
  txhash: string;
  height: number;
  timestamp: number;
  msgId: string;
  destination: number;
  nonce: number;
}
export interface CosmosProcess {
  txhash: string;
  height: number;
  timestamp: number;
  msgId: string;
  origin: number;
}
export interface MailboxActivity {
  dispatches: CosmosDispatch[];
  processes: CosmosProcess[];
}

// Recent mailbox activity on Terra Classic (LCD tx search, newest first): outgoing dispatches
// and incoming deliveries (process), both from a single query.
export async function recentMailboxActivity(chain: ChainInfo, limit = 40): Promise<MailboxActivity> {
  const mailbox = contractAddr(chain, chain.mailbox);
  const filter = encodeURIComponent(`execute._contract_address='${mailbox}'`);
  let data: {
    tx_responses?: Array<{
      txhash: string;
      height: string;
      timestamp: string;
      logs?: Array<{ events: Array<{ type: string; attributes: Array<{ key: string; value: string }> }> }>;
    }>;
  } | null = null;
  let lastErr: unknown;
  for (const param of ['query', 'events']) {
    try {
      data = await lcdGet(chain, `/cosmos/tx/v1beta1/txs?${param}=${filter}&limit=${limit}&order_by=ORDER_BY_DESC`);
      if (data?.tx_responses) break;
    } catch (e) {
      lastErr = e;
    }
  }
  if (!data?.tx_responses) throw lastErr instanceof Error ? lastErr : new Error('tx search failed');
  const dispatches: CosmosDispatch[] = [];
  const processes: CosmosProcess[] = [];
  const attrsOf = (e: { attributes: Array<{ key: string; value: string }> }) =>
    Object.fromEntries(e.attributes.map((a) => [a.key, a.value]));
  for (const tx of data.tx_responses) {
    const events = (tx.logs ?? []).flatMap((l) => l.events);
    const timestamp = new Date(tx.timestamp).getTime();
    const dispatch = events.find((e) => e.type === 'wasm-mailbox_dispatch');
    const dispatchId = events.find((e) => e.type === 'wasm-mailbox_dispatch_id');
    if (dispatch && dispatchId) {
      const attrs = attrsOf(dispatch);
      const msgId = attrsOf(dispatchId)['message_id'];
      if (attrs['message'] && msgId) {
        try {
          const parsed = parseMessage(attrs['message']);
          dispatches.push({
            txhash: tx.txhash,
            height: Number(tx.height),
            timestamp,
            msgId: `0x${strip0x(msgId).toLowerCase()}`,
            destination: parsed.destination,
            nonce: parsed.nonce,
          });
        } catch {
          // ignore unparsable
        }
      }
    }
    const process = events.find((e) => e.type === 'wasm-mailbox_process');
    const processId = events.find((e) => e.type === 'wasm-mailbox_process_id');
    if (process && processId) {
      const attrs = attrsOf(process);
      const msgId = attrsOf(processId)['message_id'];
      const origin = Number(attrs['origin']);
      if (msgId && Number.isFinite(origin))
        processes.push({
          txhash: tx.txhash,
          height: Number(tx.height),
          timestamp,
          msgId: `0x${strip0x(msgId).toLowerCase()}`,
          origin,
        });
    }
  }
  return { dispatches, processes };
}
