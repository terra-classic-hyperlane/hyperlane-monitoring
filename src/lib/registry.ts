import { parse as parseYaml } from 'yaml';

import { cached } from './cache';
import { ALL_CHAINS, PRIVATE_RPC, REGISTRY_BRANCH, REGISTRY_URL } from './config';
import type { ChainInfo, ChainName, Protocol } from './types';

const RAW_BASE = `${REGISTRY_URL.replace('https://github.com', 'https://raw.githubusercontent.com')}/${REGISTRY_BRANCH}`;
const TTL = 10 * 60_000;

async function fetchYaml<T>(path: string): Promise<T> {
  const res = await fetch(`${RAW_BASE}/${path}`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
  if (!res.ok) throw new Error(`registry ${path}: HTTP ${res.status}`);
  return parseYaml(await res.text()) as T;
}

interface RawMetadata {
  displayName?: string;
  domainId: number;
  protocol: Protocol;
  bech32Prefix?: string;
  nativeToken?: { symbol?: string; decimals?: number };
  blockExplorers?: Array<{ url?: string }>;
  rpcUrls?: Array<{ http?: string }>;
  restUrls?: Array<{ http?: string }>;
}
interface RawAddresses {
  mailbox: string;
  validatorAnnounce: string;
  merkleTreeHook: string;
}

export async function getChain(name: ChainName): Promise<ChainInfo> {
  return cached(`chain:${name}`, TTL, async () => {
    const [m, a] = await Promise.all([
      fetchYaml<RawMetadata>(`chains/${name}/metadata.yaml`),
      fetchYaml<RawAddresses>(`chains/${name}/addresses.yaml`),
    ]);
    const rpcUrls = (m.rpcUrls ?? []).map((u) => u.http).filter((u): u is string => !!u);
    const restUrls = (m.restUrls ?? []).map((u) => u.http).filter((u): u is string => !!u);
    const priv = PRIVATE_RPC[name];
    return {
      name,
      displayName: m.displayName || name,
      domainId: m.domainId,
      protocol: m.protocol,
      nativeSymbol: m.nativeToken?.symbol || '',
      nativeDecimals: m.nativeToken?.decimals ?? 18,
      explorerUrl: m.blockExplorers?.[0]?.url,
      rpcUrls: priv && m.protocol !== 'cosmos' ? [priv, ...rpcUrls] : rpcUrls,
      restUrls: priv && m.protocol === 'cosmos' ? [priv, ...restUrls] : restUrls,
      mailbox: a.mailbox,
      validatorAnnounce: a.validatorAnnounce,
      merkleTreeHook: a.merkleTreeHook,
      bech32Prefix: m.bech32Prefix,
    };
  });
}

export async function getChains(): Promise<Record<ChainName, ChainInfo>> {
  const list = await Promise.all(ALL_CHAINS.map((c) => getChain(c)));
  return Object.fromEntries(list.map((c) => [c.name, c])) as Record<ChainName, ChainInfo>;
}

export interface WarpDeployment {
  routeId: string;
  symbol: string;
  chains: Record<string, { interchainSecurityModule?: string; foreignDeployment?: string; type?: string }>;
  tokens: Record<string, string>; // chainName -> token/program address (from the combined config)
}

// Warp routes that touch Terra Classic: used to find the ISM securing TC-origin messages
// (on EVM) and the Solana programs whose dispatches we watch.
export async function getTcWarpDeployments(): Promise<WarpDeployment[]> {
  return cached('warp:deployments', TTL, async () => {
    const combined = await fetchYaml<Record<string, { tokens?: Array<{ chainName: string; addressOrDenom?: string; symbol?: string }> }>>(
      'deployments/warp_routes/warpRouteConfigs.yaml',
    );
    const ids = Object.keys(combined).filter((id) =>
      combined[id].tokens?.some((t) => t.chainName === 'terraclassic'),
    );
    const out: WarpDeployment[] = [];
    for (const id of ids) {
      const [symbol, chainsPart] = id.split('/');
      const tokens: Record<string, string> = {};
      for (const t of combined[id].tokens ?? []) if (t.addressOrDenom) tokens[t.chainName] = t.addressOrDenom;
      // Deploy files are named with the chain names sorted alphabetically.
      const fileChains = chainsPart.split('-').sort().join('-');
      try {
        const deploy = await fetchYaml<WarpDeployment['chains']>(`deployments/warp_routes/${symbol}/${fileChains}-deploy.yaml`);
        out.push({ routeId: id, symbol, chains: deploy, tokens });
      } catch {
        // deploy file may not exist for every route: keep token addresses only
        const chains: WarpDeployment['chains'] = {};
        for (const [c, a] of Object.entries(tokens)) chains[c] = { foreignDeployment: a };
        out.push({ routeId: id, symbol, chains, tokens });
      }
    }
    return out;
  });
}

export function explorerTxUrl(chain: ChainInfo, hash: string): string | undefined {
  if (!chain.explorerUrl) return undefined;
  const base = chain.explorerUrl.replace(/\/$/, '');
  return `${base}/tx/${hash}`;
}
export function explorerAddressUrl(chain: ChainInfo, address: string): string | undefined {
  if (!chain.explorerUrl) return undefined;
  const base = chain.explorerUrl.replace(/\/$/, '');
  return `${base}/address/${address}`;
}
