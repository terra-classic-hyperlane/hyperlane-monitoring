import { Connection, PublicKey } from '@solana/web3.js';

import { strip0x } from './message';
import type { ChainInfo } from './types';

const conns = new Map<string, Connection[]>();
function connections(chain: ChainInfo): Connection[] {
  const hit = conns.get(chain.name);
  if (hit) return hit;
  const list = chain.rpcUrls.map((u) => new Connection(u, { commitment: 'confirmed', disableRetryOnRateLimit: true }));
  conns.set(chain.name, list);
  return list;
}

// Try each RPC in order (private first when configured).
export async function withRpc<T>(chain: ChainInfo, fn: (c: Connection) => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (const c of connections(chain)) {
    try {
      return await fn(c);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('all Solana RPCs failed');
}

function pda(seeds: (string | Buffer)[], program: string): PublicKey {
  const [key] = PublicKey.findProgramAddressSync(
    seeds.map((s) => (typeof s === 'string' ? Buffer.from(s) : s)),
    new PublicKey(program),
  );
  return key;
}

export function processedPda(mailbox: string, msgId: string): PublicKey {
  return pda(['hyperlane', '-', 'processed_message', '-', Buffer.from(strip0x(msgId), 'hex')], mailbox);
}

export async function solDelivered(chain: ChainInfo, msgId: string): Promise<boolean> {
  return withRpc(chain, async (c) => {
    const info = await c.getAccountInfo(processedPda(chain.mailbox, msgId));
    return !!info && info.data.length > 0;
  });
}

// Outbox account: [initialized u8][local_domain u32][bump u8][owner Option<Pubkey>][tree: branch 32x32][count u64]
export async function solMerkleCount(chain: ChainInfo): Promise<number> {
  return withRpc(chain, async (c) => {
    const outbox = pda(['hyperlane', '-', 'outbox'], chain.mailbox);
    const info = await c.getAccountInfo(outbox);
    if (!info) throw new Error('outbox account not found');
    const d = info.data;
    let o = 1 + 4 + 1;
    const hasOwner = d[o];
    o += 1 + (hasOwner ? 32 : 0);
    o += 32 * 32;
    return Number(d.readBigUInt64LE(o));
  });
}

// ValidatorStorageLocations account: [initialized u8][bump u8][Vec<String> borsh]
export async function solStorageLocations(chain: ChainInfo, validators: string[]): Promise<Record<string, string[]>> {
  return withRpc(chain, async (c) => {
    const keys = validators.map((v) =>
      pda(
        ['hyperlane_validator_announce', '-', 'storage_locations', '-', Buffer.from(strip0x(v), 'hex')],
        chain.validatorAnnounce,
      ),
    );
    const infos = await c.getMultipleAccountsInfo(keys);
    const out: Record<string, string[]> = {};
    validators.forEach((v, i) => {
      const info = infos[i];
      const locs: string[] = [];
      if (info) {
        const d = info.data;
        let o = 2;
        const n = d.readUInt32LE(o);
        o += 4;
        for (let k = 0; k < n; k++) {
          const len = d.readUInt32LE(o);
          o += 4;
          locs.push(d.subarray(o, o + len).toString());
          o += len;
        }
      }
      out[strip0x(v).toLowerCase()] = locs;
    });
    return out;
  });
}

export async function solBalance(chain: ChainInfo, address: string): Promise<number> {
  return withRpc(chain, async (c) => (await c.getBalance(new PublicKey(address))) / 10 ** chain.nativeDecimals);
}

export interface SolDispatch {
  signature: string;
  slot: number;
  timestamp: number | null;
  msgId: string;
  destination: number;
}

const DISPATCH_RE = /Dispatched message to (\d+), ID (0x[0-9a-fA-F]{64})/;

// Recent dispatches made through the given warp programs (their txs invoke the mailbox).
export async function solRecentDispatches(
  chain: ChainInfo,
  programs: string[],
  destinationDomain: number,
  perProgram: number,
): Promise<SolDispatch[]> {
  return withRpc(chain, async (c) => {
    const out: SolDispatch[] = [];
    for (const p of programs) {
      const sigs = await c.getSignaturesForAddress(new PublicKey(p), { limit: perProgram });
      for (const s of sigs) {
        if (s.err) continue;
        const tx = await c.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
        for (const line of tx?.meta?.logMessages ?? []) {
          const m = DISPATCH_RE.exec(line);
          if (m && Number(m[1]) === destinationDomain) {
            out.push({
              signature: s.signature,
              slot: s.slot,
              timestamp: s.blockTime ? s.blockTime * 1000 : null,
              msgId: m[2].toLowerCase(),
              destination: destinationDomain,
            });
          }
        }
      }
    }
    return out.sort((a, b) => b.slot - a.slot);
  });
}
