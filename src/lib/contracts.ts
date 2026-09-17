import { PublicKey } from '@solana/web3.js';
import { parseAbi } from 'viem';

import { errMsg, withTimeout } from './cache';
import { HUB_CHAIN, REMOTE_CHAINS } from './config';
import { contractAddr, defaultIsm, routedValidatorSet, smartQuery } from './cosmos';
import { evmClient } from './evm';
import { explorerAddressUrl, getTcWarpDeployments } from './registry';
import { withRpc } from './solana';
import type { ChainInfo, ChainName, ContractInfo } from './types';

// ---------------------------------------------------------------- Terra Classic (CosmWasm)
async function cwContractAdmin(
  chain: ChainInfo,
  address: string,
): Promise<{ admin: string | null; label: string | null; codeId: string | null }> {
  for (const base of chain.restUrls) {
    try {
      const res = await fetch(`${base}/cosmwasm/wasm/v1/contract/${address}`, {
        signal: AbortSignal.timeout(10_000),
        cache: 'no-store',
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { contract_info?: { admin?: string; label?: string; code_id?: string } };
      const ci = data.contract_info;
      return { admin: ci?.admin || null, label: ci?.label ?? null, codeId: ci?.code_id ?? null };
    } catch {
      // next LCD
    }
  }
  return { admin: null, label: null, codeId: null };
}

async function cwOwner(chain: ChainInfo, address: string): Promise<string | null> {
  try {
    const r = await smartQuery<{ owner: string }>(chain, address, { ownable: { get_owner: {} } });
    return r.owner ?? null;
  } catch {
    return null;
  }
}

async function tcContracts(chains: Record<ChainName, ChainInfo>): Promise<ContractInfo[]> {
  const tc = chains[HUB_CHAIN];
  const list: Array<{ role: string; address: string; note?: string }> = [
    { role: 'Mailbox', address: contractAddr(tc, tc.mailbox) },
    { role: 'Validator announce', address: contractAddr(tc, tc.validatorAnnounce) },
    { role: 'Merkle tree hook', address: contractAddr(tc, tc.merkleTreeHook) },
  ];
  if (tc.interchainGasPaymaster) list.push({ role: 'IGP', address: contractAddr(tc, tc.interchainGasPaymaster) });
  try {
    const routing = await defaultIsm(tc);
    list.push({ role: 'Routing ISM (default)', address: routing });
    const seen = new Set<string>();
    for (const origin of REMOTE_CHAINS) {
      try {
        const set = await routedValidatorSet(tc, routing, chains[origin].domainId);
        if (!seen.has(set.ism)) {
          seen.add(set.ism);
          list.push({
            role: `Multisig ISM (${chains[origin].displayName} origin)`,
            address: set.ism,
            note: `${set.threshold}-of-${set.validators.length}`,
          });
        }
      } catch {
        // skip
      }
    }
  } catch {
    // no default ISM
  }
  try {
    const igp = tc.interchainGasPaymaster ? contractAddr(tc, tc.interchainGasPaymaster) : null;
    if (igp) {
      const route = await smartQuery<{ route: { route: string | null } }>(tc, igp, {
        router: { get_route: { domain: chains.bsc.domainId } },
      }).catch(() => null);
      if (route?.route?.route) list.push({ role: 'IGP gas oracle', address: route.route.route });
    }
  } catch {
    // skip
  }
  const deployments = await getTcWarpDeployments().catch(() => []);
  for (const d of deployments) {
    const addr = d.tokens.terraclassic;
    if (addr && addr.startsWith('terra1'))
      list.push({
        role: `Warp ${d.symbol}`,
        address: addr,
        note: d.chains.terraclassic?.type ? `${d.chains.terraclassic.type} route` : undefined,
      });
  }
  return Promise.all(
    list.map(async (c): Promise<ContractInfo> => {
      const [owner, info] = await Promise.all([cwOwner(tc, c.address), cwContractAdmin(tc, c.address)]);
      return {
        chain: HUB_CHAIN,
        role: c.role,
        address: c.address,
        explorerUrl: explorerAddressUrl(tc, c.address),
        owner,
        admin: info.admin,
        adminLabel: 'contract admin',
        note:
          [c.note, info.label && `label ${info.label}`, info.codeId && `code ${info.codeId}`]
            .filter(Boolean)
            .join(' · ') || undefined,
      };
    }),
  );
}

// ---------------------------------------------------------------- BSC / Ethereum
const ABI = parseAbi([
  'function owner() view returns (address)',
  'function hook() view returns (address)',
  'function interchainSecurityModule() view returns (address)',
  'function hooks(bytes) view returns (address[])',
  'function hookType() view returns (uint8)',
]);
const EIP1967_ADMIN = '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103';
const EIP1967_IMPL = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';

async function evmContracts(chains: Record<ChainName, ChainInfo>, chainName: ChainName): Promise<ContractInfo[]> {
  const chain = chains[chainName];
  const client = evmClient(chain);
  const list: Array<{ role: string; address: `0x${string}`; note?: string }> = [
    { role: 'Mailbox', address: chain.mailbox as `0x${string}`, note: 'Hyperlane canonical deployment' },
    { role: 'Validator announce', address: chain.validatorAnnounce as `0x${string}` },
    { role: 'Merkle tree hook', address: chain.merkleTreeHook as `0x${string}` },
  ];
  const deployments = await getTcWarpDeployments().catch(() => []);
  const seen = new Set<string>();
  for (const d of deployments) {
    const token = d.tokens[chainName] as `0x${string}` | undefined;
    if (!token) continue;
    list.push({
      role: `Warp ${d.symbol}`,
      address: token,
      note: d.chains[chainName]?.type ? `${d.chains[chainName].type} route` : undefined,
    });
    const ism =
      (d.chains[chainName]?.interchainSecurityModule as `0x${string}` | undefined) ??
      (await client
        .readContract({ address: token, abi: ABI, functionName: 'interchainSecurityModule' })
        .catch(() => null));
    if (ism && !seen.has(ism.toLowerCase())) {
      seen.add(ism.toLowerCase());
      list.push({ role: 'Warp ISM', address: ism });
    }
    const hook = await client.readContract({ address: token, abi: ABI, functionName: 'hook' }).catch(() => null);
    if (hook && !seen.has(hook.toLowerCase())) {
      seen.add(hook.toLowerCase());
      list.push({ role: 'Warp hook', address: hook });
      const inner = await client
        .readContract({ address: hook, abi: ABI, functionName: 'hooks', args: ['0x'] })
        .catch(() => [] as readonly `0x${string}`[]);
      for (const h of inner) {
        if (seen.has(h.toLowerCase()) || h.toLowerCase() === chain.merkleTreeHook.toLowerCase()) continue;
        seen.add(h.toLowerCase());
        const t = await client.readContract({ address: h, abi: ABI, functionName: 'hookType' }).catch(() => -1);
        list.push({ role: Number(t) === 4 ? 'Warp IGP' : 'Warp hook (inner)', address: h });
      }
    }
  }
  return Promise.all(
    list.map(async (c): Promise<ContractInfo> => {
      const [owner, adminSlot, implSlot] = await Promise.all([
        client.readContract({ address: c.address, abi: ABI, functionName: 'owner' }).catch(() => null),
        client.getStorageAt({ address: c.address, slot: EIP1967_ADMIN }).catch(() => null),
        client.getStorageAt({ address: c.address, slot: EIP1967_IMPL }).catch(() => null),
      ]);
      const slotAddr = (v: `0x${string}` | null | undefined) =>
        v && !/^0x0*$/.test(v) ? (`0x${v.slice(-40)}` as `0x${string}`) : null;
      const admin = slotAddr(adminSlot);
      const impl = slotAddr(implSlot);
      return {
        chain: chainName,
        role: c.role,
        address: c.address,
        explorerUrl: explorerAddressUrl(chain, c.address),
        owner,
        admin,
        adminLabel: admin ? 'proxy admin' : null,
        note: [c.note, impl && `impl ${impl.slice(0, 10)}…`].filter(Boolean).join(' · ') || undefined,
      };
    }),
  );
}

// ---------------------------------------------------------------- Solana
const BPF_UPGRADEABLE = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

function pda(seeds: string[], program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    seeds.map((s) => Buffer.from(s)),
    program,
  )[0];
}

async function solContracts(chains: Record<ChainName, ChainInfo>): Promise<ContractInfo[]> {
  const sol = chains.solanamainnet;
  return withRpc(sol, async (conn) => {
    const deployments = await getTcWarpDeployments().catch(() => []);
    const programs: Array<{ role: string; address: string; note?: string }> = [
      { role: 'Mailbox program', address: sol.mailbox, note: 'Hyperlane canonical deployment' },
      { role: 'Validator announce program', address: sol.validatorAnnounce },
    ];
    for (const d of deployments) {
      const p = d.chains.solanamainnet?.foreignDeployment ?? d.tokens.solanamainnet;
      if (p)
        programs.push({
          role: `Warp ${d.symbol} program`,
          address: p,
          note: d.chains.solanamainnet?.type ? `${d.chains.solanamainnet.type} route` : undefined,
        });
    }
    const out: ContractInfo[] = [];
    const isms = new Map<string, string[]>(); // ISM program -> warp symbols using it
    // upgrade authority of each program (BPF upgradeable loader)
    const upgradeAuthority = async (programId: PublicKey): Promise<string | null> => {
      const acc = await conn.getAccountInfo(programId);
      if (!acc || !acc.owner.equals(BPF_UPGRADEABLE) || acc.data.length < 36) return null;
      const programData = new PublicKey(acc.data.subarray(4, 36));
      const pd = await conn.getAccountInfo(programData);
      if (!pd || pd.data.length < 13) return null;
      const hasAuth = pd.data[12];
      return hasAuth ? new PublicKey(pd.data.subarray(13, 45)).toBase58() : 'none (immutable)';
    };
    for (const p of programs) {
      const pk = new PublicKey(p.address);
      let owner: string | null = null;
      let note = p.note;
      try {
        if (p.role.startsWith('Mailbox')) {
          const outbox = await conn.getAccountInfo(pda(['hyperlane', '-', 'outbox'], pk));
          if (outbox) {
            const d = outbox.data;
            owner = d[6] ? new PublicKey(d.subarray(7, 39)).toBase58() : null;
          }
        } else if (p.role.startsWith('Warp')) {
          const tok = await conn.getAccountInfo(
            pda(['hyperlane_message_recipient', '-', 'handle', '-', 'account_metas'], pk),
          );
          if (tok) {
            const d = tok.data;
            let o = 1 + 1 + 32 + 32 + 1 + 1 + 1; // init, bump, mailbox, process authority, dispatch bump, decimals, remote decimals
            owner = d[o] ? new PublicKey(d.subarray(o + 1, o + 33)).toBase58() : null;
            o += d[o] ? 33 : 1;
            const ism = d[o] ? new PublicKey(d.subarray(o + 1, o + 33)).toBase58() : null;
            if (ism) {
              note = [note, `ISM ${ism.slice(0, 8)}…`].filter(Boolean).join(' · ');
              const sym = p.role.split(' ')[1];
              const existing = isms.get(ism);
              if (existing) existing.push(sym);
              else isms.set(ism, [sym]);
            }
          }
        }
      } catch {
        // keep going
      }
      const admin = await upgradeAuthority(pk).catch(() => null);
      out.push({
        chain: 'solanamainnet',
        role: p.role,
        address: p.address,
        explorerUrl: explorerAddressUrl(sol, p.address),
        owner,
        admin,
        adminLabel: admin ? 'upgrade authority' : null,
        note,
      });
    }
    for (const [ism, syms] of isms) {
      const admin = await upgradeAuthority(new PublicKey(ism)).catch(() => null);
      out.push({
        chain: 'solanamainnet',
        role: `Warp ISM program (${syms.join(', ')})`,
        address: ism,
        explorerUrl: explorerAddressUrl(sol, ism),
        owner: null,
        admin,
        adminLabel: admin ? 'upgrade authority' : null,
      });
    }
    return out;
  });
}

export async function contractInventory(
  chains: Record<ChainName, ChainInfo>,
): Promise<{ contracts: ContractInfo[]; errors: string[] }> {
  const errors: string[] = [];
  const settled = await Promise.allSettled([
    withTimeout(tcContracts(chains), 40_000, 'TC contracts'),
    withTimeout(evmContracts(chains, 'bsc'), 40_000, 'BSC contracts'),
    withTimeout(evmContracts(chains, 'ethereum'), 40_000, 'Ethereum contracts'),
    withTimeout(solContracts(chains), 40_000, 'Solana contracts'),
  ]);
  const contracts: ContractInfo[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') contracts.push(...r.value);
    else errors.push(`contracts[${['terraclassic', 'bsc', 'ethereum', 'solanamainnet'][i]}]: ${errMsg(r.reason)}`);
  });
  return { contracts, errors };
}
