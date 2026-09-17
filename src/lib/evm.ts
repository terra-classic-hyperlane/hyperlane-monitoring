import { createPublicClient, fallback, http, parseAbi, parseAbiItem, type PublicClient } from 'viem';

import type { ChainInfo } from './types';

const clients = new Map<string, PublicClient>();
export function evmClient(chain: ChainInfo): PublicClient {
  const key = chain.name;
  const hit = clients.get(key);
  if (hit) return hit;
  const client = createPublicClient({
    transport: fallback(
      chain.rpcUrls.map((u) => http(u, { timeout: 15_000, retryCount: 1 })),
      { rank: false },
    ),
  });
  clients.set(key, client);
  return client;
}

const ABI = parseAbi([
  'function validatorsAndThreshold(bytes) view returns (address[] validators, uint8 threshold)',
  'function count() view returns (uint32)',
  'function latestCheckpoint() view returns (bytes32 root, uint32 index)',
  'function getAnnouncedStorageLocations(address[]) view returns (string[][])',
  'function delivered(bytes32) view returns (bool)',
  'function interchainSecurityModule() view returns (address)',
]);
const DISPATCH_EVENT = parseAbiItem(
  'event Dispatch(address indexed sender, uint32 indexed destination, bytes32 indexed recipient, bytes message)',
);
const DISPATCH_ID_EVENT = parseAbiItem('event DispatchId(bytes32 indexed messageId)');

export async function evmIsmValidators(chain: ChainInfo, ism: `0x${string}`): Promise<{ validators: string[]; threshold: number }> {
  const [validators, threshold] = await evmClient(chain).readContract({
    address: ism,
    abi: ABI,
    functionName: 'validatorsAndThreshold',
    args: ['0x'],
  });
  return { validators: validators.map((v) => v.slice(2).toLowerCase()), threshold: Number(threshold) };
}

// ISM configured on a warp token contract (HypERC20 / HypERC20Collateral).
export async function evmTokenIsm(chain: ChainInfo, token: `0x${string}`): Promise<`0x${string}`> {
  return evmClient(chain).readContract({ address: token, abi: ABI, functionName: 'interchainSecurityModule' });
}

export async function evmMerkleCount(chain: ChainInfo): Promise<number> {
  const c = await evmClient(chain).readContract({
    address: chain.merkleTreeHook as `0x${string}`,
    abi: ABI,
    functionName: 'count',
  });
  return Number(c);
}

export async function evmStorageLocations(chain: ChainInfo, validators: string[]): Promise<Record<string, string[]>> {
  const locs = await evmClient(chain).readContract({
    address: chain.validatorAnnounce as `0x${string}`,
    abi: ABI,
    functionName: 'getAnnouncedStorageLocations',
    args: [validators.map((v) => `0x${v.replace(/^0x/, '')}` as `0x${string}`)],
  });
  return Object.fromEntries(validators.map((v, i) => [v.replace(/^0x/, '').toLowerCase(), [...locs[i]]]));
}

export async function evmDelivered(chain: ChainInfo, msgId: string): Promise<boolean> {
  return evmClient(chain).readContract({
    address: chain.mailbox as `0x${string}`,
    abi: ABI,
    functionName: 'delivered',
    args: [msgId as `0x${string}`],
  });
}

export async function evmBalance(chain: ChainInfo, address: string): Promise<number> {
  const wei = await evmClient(chain).getBalance({ address: address as `0x${string}` });
  return Number(wei) / 10 ** chain.nativeDecimals;
}

export interface EvmDispatch {
  txhash: string;
  blockNumber: number;
  timestamp: number | null;
  msgId: string;
  destination: number;
}

// Dispatch events to `destinationDomain` in the last `lookback` blocks. Chunks are queried in
// parallel (public RPCs cap eth_getLogs ranges) and only the newest `limit` hits get timestamps.
export async function evmRecentDispatches(
  chain: ChainInfo,
  destinationDomain: number,
  lookback: number,
  chunk: number,
  limit: number,
): Promise<EvmDispatch[]> {
  const client = evmClient(chain);
  const latest = Number(await client.getBlockNumber());
  const from = Math.max(0, latest - lookback);
  const ranges: Array<[number, number]> = [];
  for (let to = latest; to > from; to -= chunk) ranges.push([Math.max(from, to - chunk + 1), to]);
  const perRange = await Promise.all(
    ranges.map(async ([start, to]) => {
      const [logs, idLogs] = await Promise.all([
        client.getLogs({
          address: chain.mailbox as `0x${string}`,
          event: DISPATCH_EVENT,
          args: { destination: destinationDomain },
          fromBlock: BigInt(start),
          toBlock: BigInt(to),
        }),
        client.getLogs({ address: chain.mailbox as `0x${string}`, event: DISPATCH_ID_EVENT, fromBlock: BigInt(start), toBlock: BigInt(to) }),
      ]);
      const idByTx = new Map<string, string>();
      for (const l of idLogs) if (l.transactionHash && l.args.messageId) idByTx.set(`${l.transactionHash}:${l.logIndex}`, l.args.messageId);
      const out: EvmDispatch[] = [];
      for (const l of logs) {
        // DispatchId is the log right after Dispatch in the same tx
        const id = l.transactionHash ? idByTx.get(`${l.transactionHash}:${(l.logIndex ?? 0) + 1}`) : undefined;
        if (!id || !l.transactionHash) continue;
        out.push({ txhash: l.transactionHash, blockNumber: Number(l.blockNumber), timestamp: null, msgId: id.toLowerCase(), destination: destinationDomain });
      }
      return out;
    }),
  );
  const found = perRange.flat().sort((a, b) => b.blockNumber - a.blockNumber).slice(0, limit);
  const blockCache = new Map<number, number>();
  await Promise.all(
    [...new Set(found.map((d) => d.blockNumber))].map(async (bn) => {
      try {
        const b = await client.getBlock({ blockNumber: BigInt(bn) });
        blockCache.set(bn, Number(b.timestamp) * 1000);
      } catch {
        blockCache.set(bn, 0);
      }
    }),
  );
  for (const d of found) d.timestamp = blockCache.get(d.blockNumber) || null;
  return found;
}

