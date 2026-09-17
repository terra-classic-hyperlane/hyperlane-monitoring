import type { ChainName } from './types';

// ---------------------------------------------------------------------------
// Static configuration. Everything chain-related (mailboxes, ISMs, RPCs, explorers)
// comes from the Terra Classic Hyperlane registry at runtime (see registry.ts).
// Only operator identity, thresholds and optional private endpoints live here.
// ---------------------------------------------------------------------------

export const REGISTRY_URL =
  process.env.REGISTRY_URL || 'https://github.com/terra-classic-hyperlane/hyperlane-registry';
export const REGISTRY_BRANCH = process.env.REGISTRY_BRANCH || 'public-warp';

export const HUB_CHAIN: ChainName = 'terraclassic';
export const REMOTE_CHAINS: ChainName[] = ['bsc', 'ethereum', 'solanamainnet'];
export const ALL_CHAINS: ChainName[] = [HUB_CHAIN, ...REMOTE_CHAINS];

// Relayer / operator wallets (public addresses). Override with OPERATOR_<CHAIN> env vars.
export const OPERATOR_ADDRESSES: Record<ChainName, string> = {
  terraclassic: process.env.OPERATOR_TERRACLASSIC || 'terra1run9wz09uhh6pu7ggcwwetrgye4wu7wn26mawp',
  bsc: process.env.OPERATOR_BSC || '0x8f085bAD1a15ee9ceeE58C83EFFFa72518975291',
  ethereum: process.env.OPERATOR_ETHEREUM || '0xEF8181201Ce6C83120035Ffbcc11945E67Ba00ae',
  solanamainnet: process.env.OPERATOR_SOLANAMAINNET || 'PbEo7Fn2eJ6LYa4B8YU4MexB6s1BEQquWKCM1cwwrkS',
};

// Balance thresholds in native units. Override with BALANCE_THRESHOLDS='{"bsc":{"warn":0.05,"critical":0.01}}'.
const DEFAULT_THRESHOLDS: Record<ChainName, { warn: number; critical: number }> = {
  terraclassic: { warn: 5000, critical: 1000 }, // a delivery on TC costs ~15-25 LUNC
  bsc: { warn: 0.03, critical: 0.01 },
  ethereum: { warn: 0.05, critical: 0.015 },
  solanamainnet: { warn: 0.05, critical: 0.01 },
};
export function balanceThresholds(): Record<ChainName, { warn: number; critical: number }> {
  try {
    const override = process.env.BALANCE_THRESHOLDS ? JSON.parse(process.env.BALANCE_THRESHOLDS) : {};
    return { ...DEFAULT_THRESHOLDS, ...override };
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

// Optional private RPCs (server-side only). Public RPCs are read from the registry.
export const PRIVATE_RPC: Partial<Record<ChainName, string>> = {
  terraclassic: process.env.RPC_TERRACLASSIC_LCD, // LCD/REST url
  bsc: process.env.RPC_BSC,
  ethereum: process.env.RPC_ETHEREUM,
  solanamainnet: process.env.RPC_SOLANAMAINNET,
};

// Optional Prometheus endpoints of the operator's own agents (see README: expose them read-only).
export const RELAYER_METRICS_URL = process.env.RELAYER_METRICS_URL;
export const VALIDATOR_METRICS_URL = process.env.VALIDATOR_METRICS_URL;
export const METRICS_AUTH_HEADER = process.env.METRICS_AUTH_HEADER; // e.g. "Bearer xxx" or "Basic base64"

// Relayer health windows
export const PENDING_WARN_MINUTES = Number(process.env.PENDING_WARN_MINUTES || 20);
export const PENDING_DOWN_MINUTES = Number(process.env.PENDING_DOWN_MINUTES || 90);
export const RECENT_MESSAGES = Number(process.env.RECENT_MESSAGES || 8);
// How far back to look for dispatches on EVM origins (blocks). ~7h on BSC (3s), ~10h on ETH (12s).
// Public RPCs cap eth_getLogs ranges, so the window is scanned in parallel chunks.
export const EVM_LOOKBACK_BLOCKS: Record<string, number> = {
  bsc: Number(process.env.LOOKBACK_BLOCKS_BSC || 8000),
  ethereum: Number(process.env.LOOKBACK_BLOCKS_ETHEREUM || 3000),
};
export const EVM_LOGS_CHUNK = Number(process.env.EVM_LOGS_CHUNK || 2000);
// Solana: signatures inspected per warp program (each costs a getTransaction call).
export const SOLANA_SIGS_PER_PROGRAM = Number(process.env.SOLANA_SIGS_PER_PROGRAM || 3);

// Validator sync tolerance: a validator is "synced" when its latest signed index is within
// this many checkpoints of the origin merkle tree (count - 1).
export const VALIDATOR_LAG_TOLERANCE = Number(process.env.VALIDATOR_LAG_TOLERANCE || 1);
// A checkpoint older than this (minutes) while the chain has newer messages is considered stale.
export const VALIDATOR_STALE_MINUTES = Number(process.env.VALIDATOR_STALE_MINUTES || 60);

// Snapshot cache (seconds). Every visitor shares one snapshot; RPCs are hit at most once per TTL.
export const SNAPSHOT_TTL_SECONDS = Number(process.env.SNAPSHOT_TTL_SECONDS || 45);

// Friendly names for known validator signers (lowercase hex, no 0x).
export const KNOWN_VALIDATORS: Record<string, string> = {
  '71b2b8c36a0c76b74be92eb7915e26a69b3b03eb': 'Igor Veras',
  '1afd3d07abd2aaa19a9f7993f334a926e253b90c': 'TCV',
  'e6bb040164a0ebbcb7e2d584f066c8b57dd74383': 'DarkSun',
  '5c374754892ebac52702475726b67f822efdfacc': 'BurnItAll',
  '0c737caf34a1b8ae4a285c5e94726de6d9b7e028': 'LuncGoblins',
};

// Warp route programs on Solana whose dispatches we watch (Solana -> Terra Classic).
// Read from the registry warp routes at runtime; this is only the fallback.
export const SOLANA_WARP_PROGRAMS_FALLBACK = [
  'Dd3ajD8WbEyx7z3HqPnDyvUgFqEBzvF1VePjYd1NGnbr', // LUNC
  '7CUdBt1Qn2R2StE7MDPhQW2EhmnGg8zKK8oJXwAGEoyf', // USTC
  '8pktAA5FdXJta2V1U1xzRz5GBcpqH7gTjfFQirJTpZfm', // JURIS
];

export const SITE = {
  title: 'Terra Classic Bridge Monitor',
  description:
    'Live health of the Terra Classic Hyperlane bridge: relayer, operator balances and validator checkpoints across Terra Classic, BSC, Ethereum and Solana.',
  bridgeUrl: 'https://bridge.terra-classic.io',
  explorerUrl: 'https://explorer.terraclassic-bridge.xyz',
  registryUrl: REGISTRY_URL,
};
