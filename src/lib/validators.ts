import { errMsg, withTimeout } from './cache';
import { HUB_CHAIN, KNOWN_VALIDATORS, REMOTE_CHAINS, VALIDATOR_LAG_TOLERANCE, VALIDATOR_STALE_MINUTES } from './config';
import { fetchLatestCheckpoint } from './checkpoints';
import { announcedStorageLocations, announcedValidators, defaultIsm, merkleCount, routedValidatorSet } from './cosmos';
import { evmIsmValidators, evmMerkleCount, evmStorageLocations, evmTokenIsm } from './evm';
import { explorerAddressUrl, getTcWarpDeployments } from './registry';
import { contractAddr } from './cosmos';
import { solMerkleCount, solStorageLocations } from './solana';
import type { ChainInfo, ChainName, Health, ValidatorSetStatus, ValidatorStatus } from './types';

function nameFor(addr: string, location: string | null): string {
  const known = KNOWN_VALIDATORS[addr.toLowerCase()];
  if (known) return known;
  const m = location ? /^(?:s3|gs):\/\/([^/]+)/.exec(location) : null;
  if (m) {
    const bucket = m[1];
    if (/^hyperlane-mainnet3-/.test(bucket))
      return `Hyperlane (${bucket.replace(/^hyperlane-mainnet3-/, '').replace(/-validator-/, ' #')})`;
    return bucket.replace(/^hyperlane-validator-signatures-/, '').replace(/-validator$/, '');
  }
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

async function validatorStatuses(
  validators: string[],
  locations: Record<string, string[]>,
  chainCount: number | null,
  inSet: (v: string) => boolean = () => true,
): Promise<ValidatorStatus[]> {
  return Promise.all(
    validators.map(async (v) => {
      const locs = locations[v] ?? [];
      const location = locs.length ? locs[locs.length - 1] : null; // latest announcement wins
      const base: ValidatorStatus = {
        address: `0x${v}`,
        name: nameFor(v, location),
        inSet: inSet(v),
        storageLocation: location,
        latestIndex: null,
        lastCheckpointAt: null,
        lag: null,
        health: 'unknown',
      };
      if (!location) return { ...base, health: 'down', error: 'not announced on this chain' };
      try {
        const ckpt = await withTimeout(fetchLatestCheckpoint(location), 12_000, 'checkpoint');
        const lag = chainCount === null ? null : Math.max(0, chainCount - 1 - ckpt.index);
        let health: Health = 'unknown';
        if (lag !== null) {
          const ageMin = ckpt.lastModified ? (Date.now() - ckpt.lastModified) / 60_000 : null;
          if (lag <= VALIDATOR_LAG_TOLERANCE) health = 'ok';
          else if (ageMin !== null && ageMin > VALIDATOR_STALE_MINUTES) health = 'down';
          else health = 'warn';
        }
        return { ...base, latestIndex: ckpt.index, lastCheckpointAt: ckpt.lastModified, lag, health };
      } catch (e) {
        return { ...base, health: 'down', error: errMsg(e) };
      }
    }),
  );
}

// Only validators enrolled in the ISM count for the threshold; announced-only ones are informative.
function setHealth(validators: ValidatorStatus[], threshold: number): { health: Health; syncedCount: number } {
  const members = validators.filter((v) => v.inSet);
  const syncedCount = members.filter((v) => v.health === 'ok').length;
  const reachable = members.filter((v) => v.health !== 'unknown').length;
  if (!reachable) return { health: 'unknown', syncedCount };
  if (syncedCount >= threshold) return { health: syncedCount === members.length ? 'ok' : 'warn', syncedCount };
  return { health: 'down', syncedCount };
}

// Terra Classic as ORIGIN: the validator set lives in the ISM of the warp routes on the remote
// chains (BSC/ETH synthetics). Announcements + checkpoints are read from TC.
export async function tcOriginValidatorSet(chains: Record<ChainName, ChainInfo>): Promise<ValidatorSetStatus> {
  const tc = chains[HUB_CHAIN];
  const base: ValidatorSetStatus = {
    origin: HUB_CHAIN,
    originDisplayName: tc.displayName,
    ismDescription: '',
    isms: [],
    threshold: 0,
    chainCount: null,
    validators: [],
    syncedCount: 0,
    health: 'unknown',
  };
  try {
    const deployments = await getTcWarpDeployments();
    let set: { validators: string[]; threshold: number } | null = null;
    let desc = '';
    const isms: ValidatorSetStatus['isms'] = [];
    for (const evm of ['bsc', 'ethereum'] as ChainName[]) {
      let ism = deployments.map((d) => d.chains[evm]?.interchainSecurityModule).find(Boolean) as
        `0x${string}` | undefined;
      try {
        if (!ism) {
          const token = deployments.map((d) => d.tokens[evm]).find(Boolean);
          if (token) ism = await evmTokenIsm(chains[evm], token as `0x${string}`);
        }
        if (!ism) continue;
        isms.push({
          chain: evm,
          chainDisplayName: chains[evm].displayName,
          address: ism,
          explorerUrl: explorerAddressUrl(chains[evm], ism),
          note: 'warp routes',
        });
        if (!set) {
          set = await evmIsmValidators(chains[evm], ism);
          desc = `Multisig ISM ${ism.slice(0, 8)}… on ${chains[evm].displayName} (warp routes)`;
        }
      } catch {
        // try next chain
      }
    }
    if (!set) throw new Error('could not read the TC-origin ISM on BSC/Ethereum');
    // Everyone announced on the Terra Classic ValidatorAnnounce contract is listed; the ISM
    // members come first and are the only ones that count for the threshold.
    const announced = await announcedValidators(tc).catch(() => [] as string[]);
    const members = new Set(set.validators);
    const all = [...set.validators, ...announced.filter((v) => !members.has(v))];
    const [count, locations] = await Promise.all([
      merkleCount(tc).catch(() => null),
      announcedStorageLocations(tc, all),
    ]);
    const validators = await validatorStatuses(all, locations, count, (v) => members.has(v));
    return {
      ...base,
      ismDescription: desc,
      isms,
      threshold: set.threshold,
      chainCount: count,
      validators,
      ...setHealth(validators, set.threshold),
    };
  } catch (e) {
    return { ...base, health: 'unknown', error: errMsg(e) };
  }
}

// Remote chain as ORIGIN: the set is enrolled in Terra Classic's routing ISM for that domain.
// Announcements + checkpoints are read from the origin chain.
export async function remoteOriginValidatorSet(
  chains: Record<ChainName, ChainInfo>,
  origin: ChainName,
): Promise<ValidatorSetStatus> {
  const tc = chains[HUB_CHAIN];
  const oc = chains[origin];
  const base: ValidatorSetStatus = {
    origin,
    originDisplayName: oc.displayName,
    ismDescription: '',
    isms: [],
    threshold: 0,
    chainCount: null,
    validators: [],
    syncedCount: 0,
    health: 'unknown',
  };
  try {
    const routing = await defaultIsm(tc);
    const set = await routedValidatorSet(tc, routing, oc.domainId);
    const [count, locations] = await Promise.all([
      (oc.protocol === 'ethereum' ? evmMerkleCount(oc) : solMerkleCount(oc)).catch(() => null),
      oc.protocol === 'ethereum' ? evmStorageLocations(oc, set.validators) : solStorageLocations(oc, set.validators),
    ]);
    const validators = await validatorStatuses(set.validators, locations, count);
    return {
      ...base,
      ismDescription: `Multisig ISM ${set.ism.slice(0, 12)}… on Terra Classic (routing ISM, domain ${oc.domainId})`,
      isms: [
        {
          chain: HUB_CHAIN,
          chainDisplayName: tc.displayName,
          address: set.ism,
          explorerUrl: explorerAddressUrl(tc, set.ism),
          note: `routed by ${contractAddr(tc, routing).slice(0, 12)}…`,
        },
      ],
      threshold: set.threshold,
      chainCount: count,
      validators,
      ...setHealth(validators, set.threshold),
    };
  } catch (e) {
    return { ...base, error: errMsg(e) };
  }
}

export async function allValidatorSets(chains: Record<ChainName, ChainInfo>): Promise<ValidatorSetStatus[]> {
  return Promise.all([tcOriginValidatorSet(chains), ...REMOTE_CHAINS.map((c) => remoteOriginValidatorSet(chains, c))]);
}
