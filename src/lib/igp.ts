import {
  Message as SolMessage,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  VersionedTransaction,
} from '@solana/web3.js';
import { parseAbi } from 'viem';

import { errMsg, withTimeout } from './cache';
import { ALL_CHAINS, HUB_CHAIN, OPERATOR_ADDRESSES, REMOTE_CHAINS } from './config';
import { contractAddr, smartQuery } from './cosmos';
import { evmClient } from './evm';
import { probeMessageHex } from './message';
import { explorerAddressUrl, getTcWarpDeployments } from './registry';
import { withRpc } from './solana';
import type { ChainInfo, ChainName, IgpQuote, IgpStatus } from './types';

// Gas amount used for quotes when the route does not define one on-chain.
const DEFAULT_QUOTE_GAS = 200_000;

// ---------------------------------------------------------------- Terra Classic (CosmWasm)
async function tcIgp(chains: Record<ChainName, ChainInfo>, prices: Record<string, number>): Promise<IgpStatus> {
  const tc = chains[HUB_CHAIN];
  const igp = contractAddr(tc, tc.interchainGasPaymaster);
  const base: IgpStatus = {
    chain: HUB_CHAIN,
    displayName: tc.displayName,
    contracts: [],
    quotes: [],
    health: 'unknown',
  };
  try {
    const [gasDefault, beneficiary] = await Promise.all([
      smartQuery<{ gas: string }>(tc, igp, { igp: { default_gas: {} } }),
      smartQuery<{ beneficiary: string }>(tc, igp, { igp: { beneficiary: {} } }).catch(() => ({ beneficiary: '' })),
    ]);
    base.contracts.push({ role: 'IGP', address: igp, explorerUrl: explorerAddressUrl(tc, igp) });
    if (beneficiary.beneficiary)
      base.contracts.push({
        role: 'Beneficiary',
        address: beneficiary.beneficiary,
        explorerUrl: explorerAddressUrl(tc, beneficiary.beneficiary),
        note: 'receives the gas payments',
      });
    const oracles = new Set<string>();
    const quotes = await Promise.all(
      REMOTE_CHAINS.map(async (dest): Promise<IgpQuote> => {
        const d = chains[dest].domainId;
        const q: IgpQuote = {
          destination: dest,
          destinationDisplayName: chains[dest].displayName,
          gasAmount: Number(gasDefault.gas),
          gasPrice: null,
          exchangeRate: null,
          oracle: null,
          quote: null,
          quoteSymbol: tc.nativeSymbol,
          quoteUsd: null,
        };
        try {
          const gfd = await smartQuery<{ gas: Array<[number, string]> }>(tc, igp, {
            igp: { gas_for_domain: { domains: [d] } },
          }).catch(() => ({ gas: [] }));
          const specific = gfd.gas.find(([dom]) => dom === d);
          if (specific) q.gasAmount = Number(specific[1]);
          const route = await smartQuery<{ route: { domain: number; route: string | null } }>(tc, igp, {
            router: { get_route: { domain: d } },
          }).catch(() => null);
          q.oracle = route?.route?.route ?? null;
          if (q.oracle) {
            oracles.add(q.oracle);
            const o = await smartQuery<{ gas_price: string; exchange_rate: string }>(tc, q.oracle, {
              oracle: { get_exchange_rate_and_gas_price: { dest_domain: d } },
            });
            q.gasPrice = o.gas_price;
            q.exchangeRate = o.exchange_rate;
          }
          const r = await smartQuery<{ gas_needed: string }>(tc, igp, {
            igp: { quote_gas_payment: { dest_domain: d, gas_amount: String(q.gasAmount) } },
          });
          q.quote = Number(r.gas_needed) / 10 ** tc.nativeDecimals;
          q.quoteUsd = prices[tc.nativeSymbol] ? q.quote * prices[tc.nativeSymbol] : null;
        } catch (e) {
          q.error = errMsg(e);
        }
        return q;
      }),
    );
    for (const o of oracles)
      base.contracts.push({ role: 'Gas oracle', address: o, explorerUrl: explorerAddressUrl(tc, o) });
    base.quotes = quotes;
    base.health = quotes.every((q) => q.quote !== null) ? 'ok' : quotes.some((q) => q.quote !== null) ? 'warn' : 'down';
    return base;
  } catch (e) {
    return { ...base, error: errMsg(e) };
  }
}

// ---------------------------------------------------------------- BSC / Ethereum (viem)
const EVM_ABI = parseAbi([
  'function hook() view returns (address)',
  'function destinationGas(uint32) view returns (uint256)',
  'function quoteDispatch(bytes metadata, bytes message) view returns (uint256)',
  'function hookType() view returns (uint8)',
  'function hooks(bytes) view returns (address[])',
  'function beneficiary() view returns (address)',
  'function owner() view returns (address)',
  'function getExchangeRateAndGasPrice(uint32) view returns (uint128 tokenExchangeRate, uint128 gasPrice)',
  'function destinationGasConfigs(uint32) view returns (address gasOracle, uint96 gasOverhead)',
]);
const HOOK_TYPE_IGP = 4;

async function evmIgp(
  chains: Record<ChainName, ChainInfo>,
  origin: ChainName,
  prices: Record<string, number>,
): Promise<IgpStatus> {
  const oc = chains[origin];
  const tc = chains[HUB_CHAIN];
  const base: IgpStatus = { chain: origin, displayName: oc.displayName, contracts: [], quotes: [], health: 'unknown' };
  try {
    const client = evmClient(oc);
    const deployments = await getTcWarpDeployments();
    const token = deployments.map((d) => d.tokens[origin]).find(Boolean) as `0x${string}` | undefined;
    if (!token) throw new Error('no warp token on this chain');
    const hook = await client.readContract({ address: token, abi: EVM_ABI, functionName: 'hook' });
    base.contracts.push({
      role: 'Warp hook',
      address: hook,
      explorerUrl: explorerAddressUrl(oc, hook),
      note: 'post-dispatch hook of the warp routes',
    });
    // Find the IGP inside an aggregation hook (or the hook itself)
    let igp: `0x${string}` | null = null;
    try {
      const type = await client.readContract({ address: hook, abi: EVM_ABI, functionName: 'hookType' });
      if (Number(type) === HOOK_TYPE_IGP) igp = hook;
      else {
        const inner = await client
          .readContract({ address: hook, abi: EVM_ABI, functionName: 'hooks', args: ['0x'] })
          .catch(() => [] as readonly `0x${string}`[]);
        for (const h of inner) {
          const t = await client.readContract({ address: h, abi: EVM_ABI, functionName: 'hookType' }).catch(() => -1);
          if (Number(t) === HOOK_TYPE_IGP) igp = h;
        }
      }
    } catch {
      // hook without hookType(): keep going with quoteDispatch only
    }
    if (igp) {
      const [beneficiary, owner] = await Promise.all([
        client.readContract({ address: igp, abi: EVM_ABI, functionName: 'beneficiary' }).catch(() => null),
        client.readContract({ address: igp, abi: EVM_ABI, functionName: 'owner' }).catch(() => null),
      ]);
      base.contracts.push({ role: 'IGP', address: igp, explorerUrl: explorerAddressUrl(oc, igp) });
      if (beneficiary)
        base.contracts.push({
          role: 'Beneficiary',
          address: beneficiary,
          explorerUrl: explorerAddressUrl(oc, beneficiary),
          note: 'receives the gas payments',
        });
      if (owner) base.contracts.push({ role: 'Owner', address: owner, explorerUrl: explorerAddressUrl(oc, owner) });
    }
    const q: IgpQuote = {
      destination: HUB_CHAIN,
      destinationDisplayName: tc.displayName,
      gasAmount: DEFAULT_QUOTE_GAS,
      gasPrice: null,
      exchangeRate: null,
      oracle: null,
      quote: null,
      quoteSymbol: oc.nativeSymbol,
      quoteUsd: null,
    };
    try {
      const gas = await client
        .readContract({ address: token, abi: EVM_ABI, functionName: 'destinationGas', args: [tc.domainId] })
        .catch(() => null);
      if (gas !== null) q.gasAmount = Number(gas);
      if (igp) {
        const cfg = await client
          .readContract({ address: igp, abi: EVM_ABI, functionName: 'destinationGasConfigs', args: [tc.domainId] })
          .catch(() => null);
        if (cfg) q.oracle = cfg[0];
        const rp = await client
          .readContract({ address: igp, abi: EVM_ABI, functionName: 'getExchangeRateAndGasPrice', args: [tc.domainId] })
          .catch(() => null);
        if (rp) {
          q.exchangeRate = rp[0].toString();
          q.gasPrice = rp[1].toString();
        }
      }
      const fee = await client.readContract({
        address: hook,
        abi: EVM_ABI,
        functionName: 'quoteDispatch',
        args: ['0x', `0x${probeMessageHex(oc.domainId, tc.domainId)}`],
      });
      q.quote = Number(fee) / 10 ** oc.nativeDecimals;
      q.quoteUsd = prices[oc.nativeSymbol] ? q.quote * prices[oc.nativeSymbol] : null;
      if (!q.oracle && !q.gasPrice)
        q.note =
          q.quote === 0
            ? 'No gas oracle for Terra Classic on this IGP: transfers pay no on-chain gas fee'
            : 'IGP has no gas oracle for Terra Classic; fee quoted by the hook';
    } catch (e) {
      q.error = errMsg(e);
    }
    base.quotes = [q];
    base.health = q.quote !== null ? 'ok' : 'down';
    return base;
  } catch (e) {
    return { ...base, error: errMsg(e) };
  }
}

// ---------------------------------------------------------------- Solana (borsh by hand)
class Reader {
  o = 0;
  constructor(private d: Buffer) {}
  u8() {
    return this.d[this.o++];
  }
  u32() {
    const v = this.d.readUInt32LE(this.o);
    this.o += 4;
    return v;
  }
  u64() {
    const v = this.d.readBigUInt64LE(this.o);
    this.o += 8;
    return v;
  }
  u128() {
    const lo = this.d.readBigUInt64LE(this.o);
    const hi = this.d.readBigUInt64LE(this.o + 8);
    this.o += 16;
    return (hi << 64n) | lo;
  }
  bytes(n: number) {
    const v = this.d.subarray(this.o, this.o + n);
    this.o += n;
    return v;
  }
  pubkey() {
    return new PublicKey(this.bytes(32));
  }
  option<T>(f: () => T): T | null {
    return this.u8() ? f() : null;
  }
}

interface SolTokenIgp {
  program: PublicKey;
  type: number;
  account: PublicKey;
}

function pda(seeds: (string | Buffer)[], program: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    seeds.map((s) => (typeof s === 'string' ? Buffer.from(s) : s)),
    program,
  )[0];
}

async function solIgp(chains: Record<ChainName, ChainInfo>, prices: Record<string, number>): Promise<IgpStatus> {
  const sol = chains.solanamainnet;
  const tc = chains[HUB_CHAIN];
  const base: IgpStatus = {
    chain: 'solanamainnet',
    displayName: sol.displayName,
    contracts: [],
    quotes: [],
    health: 'unknown',
  };
  try {
    const deployments = await getTcWarpDeployments();
    const program = deployments
      .map((d) => d.chains.solanamainnet?.foreignDeployment ?? d.tokens.solanamainnet)
      .find(Boolean);
    if (!program) throw new Error('no warp program on Solana');
    const warp = new PublicKey(program);
    return await withRpc(sol, async (conn) => {
      // Token account: [initialized u8][bump u8][mailbox][process_authority][dispatch_bump u8][decimals u8][remote_decimals u8]
      // [owner Option][ism Option][igp Option<{program, type u8, account}>][destination_gas map u32->u64]...
      const tokenPda = pda(['hyperlane_message_recipient', '-', 'handle', '-', 'account_metas'], warp);
      const info = await conn.getAccountInfo(tokenPda);
      if (!info) throw new Error(`warp token account ${tokenPda.toBase58()} of program ${program} not found`);
      const r = new Reader(info.data);
      r.u8();
      r.u8();
      r.pubkey();
      r.pubkey();
      r.u8();
      r.u8();
      r.u8();
      r.option(() => r.pubkey());
      r.option(() => r.pubkey());
      const igpCfg: SolTokenIgp | null = r.option(() => ({ program: r.pubkey(), type: r.u8(), account: r.pubkey() }));
      const nGas = r.u32();
      const destinationGas = new Map<number, bigint>();
      for (let i = 0; i < nGas; i++) destinationGas.set(r.u32(), r.u64());
      if (!igpCfg) throw new Error('warp token has no IGP configured');
      base.contracts.push({
        role: 'IGP program',
        address: igpCfg.program.toBase58(),
        explorerUrl: explorerAddressUrl(sol, igpCfg.program.toBase58()),
      });
      base.contracts.push({
        role: igpCfg.type === 1 ? 'Overhead IGP account' : 'IGP account',
        address: igpCfg.account.toBase58(),
        explorerUrl: explorerAddressUrl(sol, igpCfg.account.toBase58()),
      });

      // Resolve inner IGP (when overhead) and read the gas oracle for Terra Classic
      let igpAccount = igpCfg.account;
      let overheadAccount: PublicKey | null = null;
      let overhead = 0n;
      if (igpCfg.type === 1) {
        overheadAccount = igpCfg.account;
        const oi = await conn.getAccountInfo(overheadAccount);
        if (oi) {
          const o = new Reader(oi.data);
          o.u8(); // initialized
          o.bytes(8); // discriminator "OVRHDIGP"
          o.u8(); // bump
          o.bytes(32);
          o.option(() => o.pubkey());
          igpAccount = o.pubkey();
          const n = o.u32();
          for (let i = 0; i < n; i++) {
            const dom = o.u32();
            const g = o.u64();
            if (dom === tc.domainId) overhead = g;
          }
        }
        base.contracts.push({
          role: 'IGP account',
          address: igpAccount.toBase58(),
          explorerUrl: explorerAddressUrl(sol, igpAccount.toBase58()),
        });
      }
      const q: IgpQuote = {
        destination: HUB_CHAIN,
        destinationDisplayName: tc.displayName,
        gasAmount: Number(destinationGas.get(tc.domainId) ?? BigInt(DEFAULT_QUOTE_GAS)),
        gasPrice: null,
        exchangeRate: null,
        oracle: igpAccount.toBase58(),
        quote: null,
        quoteSymbol: sol.nativeSymbol,
        quoteUsd: null,
      };
      const ii = await conn.getAccountInfo(igpAccount);
      if (ii) {
        const g = new Reader(ii.data);
        g.u8(); // initialized
        g.bytes(8); // discriminator
        g.u8(); // bump
        g.bytes(32);
        g.option(() => g.pubkey());
        g.pubkey(); // beneficiary
        const n = g.u32();
        for (let i = 0; i < n; i++) {
          const dom = g.u32();
          g.u8();
          const rate = g.u128();
          const price = g.u128();
          g.u8();
          if (dom === tc.domainId) {
            q.exchangeRate = rate.toString();
            q.gasPrice = price.toString();
          }
        }
      }
      if (overhead) q.note = `includes ${overhead.toString()} gas overhead`;
      // Quote by simulating the IGP QuoteGasPayment instruction (same as the Hyperlane SDK)
      try {
        const data = Buffer.alloc(1 + 4 + 8);
        data[0] = 4;
        data.writeUInt32LE(tc.domainId, 1);
        data.writeBigUInt64LE(BigInt(q.gasAmount), 5);
        const keys = [
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: igpAccount, isSigner: false, isWritable: false },
          ...(overheadAccount ? [{ pubkey: overheadAccount, isSigner: false, isWritable: false }] : []),
        ];
        const ix = new TransactionInstruction({ keys, programId: igpCfg.program, data });
        const msg = SolMessage.compile({
          recentBlockhash: PublicKey.default.toBase58(),
          instructions: [ix],
          payerKey: new PublicKey(OPERATOR_ADDRESSES.solanamainnet), // any funded system account; simulation only,
        });
        const sim = await conn.simulateTransaction(new VersionedTransaction(msg), {
          replaceRecentBlockhash: true,
          sigVerify: false,
        });
        const ret = sim.value.returnData?.data?.[0];
        if (!ret) throw new Error(sim.value.err ? JSON.stringify(sim.value.err) : 'no return data');
        const lamports = Buffer.from(ret, 'base64').readBigUInt64LE(0);
        q.quote = Number(lamports) / 10 ** sol.nativeDecimals;
        q.quoteUsd = prices[sol.nativeSymbol] ? q.quote * prices[sol.nativeSymbol] : null;
      } catch (e) {
        q.error = `quote simulation: ${errMsg(e)}`;
      }
      base.quotes = [q];
      base.health = q.quote !== null ? 'ok' : 'warn';
      return base;
    });
  } catch (e) {
    return { ...base, error: errMsg(e) };
  }
}

export async function igpStatuses(
  chains: Record<ChainName, ChainInfo>,
  prices: Record<string, number>,
): Promise<IgpStatus[]> {
  return Promise.all(
    ALL_CHAINS.map((c) =>
      withTimeout(
        c === HUB_CHAIN
          ? tcIgp(chains, prices)
          : c === 'solanamainnet'
            ? solIgp(chains, prices)
            : evmIgp(chains, c, prices),
        40_000,
        `${c} igp`,
      ).catch((e): IgpStatus => ({
        chain: c,
        displayName: chains[c].displayName,
        contracts: [],
        quotes: [],
        health: 'unknown',
        error: errMsg(e),
      })),
    ),
  );
}
