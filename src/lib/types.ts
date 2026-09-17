export type Health = 'ok' | 'warn' | 'down' | 'unknown';

export type ChainName = 'terraclassic' | 'bsc' | 'ethereum' | 'solanamainnet';
export type Protocol = 'cosmos' | 'ethereum' | 'sealevel';

export interface ChainInfo {
  name: ChainName;
  displayName: string;
  domainId: number;
  protocol: Protocol;
  nativeSymbol: string;
  nativeDecimals: number;
  explorerUrl?: string;
  rpcUrls: string[];
  restUrls: string[];
  mailbox: string;
  validatorAnnounce: string;
  merkleTreeHook: string;
  interchainGasPaymaster: string;
  bech32Prefix?: string;
}

export interface BalanceStatus {
  chain: ChainName;
  displayName: string;
  address: string;
  balance: number | null;
  balanceUsd: number | null;
  symbol: string;
  warnBelow: number;
  criticalBelow: number;
  health: Health;
  explorerUrl?: string;
  error?: string;
}

export interface ValidatorStatus {
  address: string;
  name: string;
  inSet: boolean; // enrolled in the ISM (counts for the threshold); false = announced only
  storageLocation: string | null;
  latestIndex: number | null;
  lastCheckpointAt: number | null; // epoch ms
  lag: number | null; // chainCount - 1 - latestIndex
  health: Health;
  error?: string;
}

export interface ValidatorSetStatus {
  origin: ChainName;
  originDisplayName: string;
  ismDescription: string; // where the set was read from
  isms: Array<{ chain: ChainName; chainDisplayName: string; address: string; explorerUrl?: string; note?: string }>;
  threshold: number;
  chainCount: number | null; // merkle tree count on origin
  validators: ValidatorStatus[];
  syncedCount: number;
  health: Health;
  error?: string;
}

export interface RecentMessage {
  id: string;
  nonce: number | null;
  dispatchedAt: number | null; // epoch ms
  originTx: string;
  delivered: boolean | null;
  ageMinutes: number | null;
}

export interface RouteStatus {
  origin: ChainName;
  destination: ChainName;
  originDisplayName: string;
  destinationDisplayName: string;
  recent: RecentMessage[];
  lastDispatchAt: number | null;
  lastDeliveredAt: number | null;
  pendingCount: number;
  oldestPendingMinutes: number | null;
  health: Health;
  note?: string;
  error?: string;
}

export interface IgpQuote {
  destination: ChainName;
  destinationDisplayName: string;
  gasAmount: number; // destination gas used for the quote
  gasPrice: string | null; // oracle: destination gas price (raw units)
  exchangeRate: string | null; // oracle: token exchange rate (raw, scale 1e10 on CosmWasm, 1e19 on EVM/Solana)
  oracle: string | null; // oracle contract / account
  quote: number | null; // in origin native token
  quoteSymbol: string;
  quoteUsd: number | null;
  note?: string;
  error?: string;
}

export interface IgpStatus {
  chain: ChainName; // origin chain where the fee is paid
  displayName: string;
  contracts: Array<{ role: string; address: string; explorerUrl?: string; note?: string }>;
  quotes: IgpQuote[];
  health: Health;
  error?: string;
}

export interface ContractInfo {
  chain: ChainName;
  role: string;
  address: string;
  explorerUrl?: string;
  owner: string | null; // on-chain owner (Ownable / account owner)
  admin: string | null; // CosmWasm contract admin / EVM proxy admin / Solana upgrade authority
  adminLabel: 'contract admin' | 'proxy admin' | 'upgrade authority' | null;
  note?: string;
}

export interface AgentMetricsSummary {
  configured: boolean;
  reachable: boolean;
  scrapedAt?: number;
  relayer?: {
    criticalErrors: Record<string, number>;
    queueLengths: Array<{ queue: string; remote: string; status: string; length: number }>;
    processedByRoute: Array<{ origin: string; remote: string; count: number }>;
    livenessAgeSec: Record<string, number>;
    observedValidators: Array<{ origin: string; destination: string; validator: string; index: number }>;
  };
  validator?: {
    chain: string;
    announced: boolean;
    latestObserved: number | null;
    latestProcessed: number | null;
    criticalErrors: number;
    livenessAgeSec: number | null;
  };
  error?: string;
}

export interface StatusSnapshot {
  generatedAt: number;
  durationMs: number;
  overall: Health;
  relayer: {
    health: Health;
    operator: Record<ChainName, string>;
    routes: RouteStatus[];
  };
  balances: BalanceStatus[];
  validators: ValidatorSetStatus[];
  igp: IgpStatus[];
  contracts: ContractInfo[];
  prices: Record<string, number>; // USD spot prices (Binance)
  agents: AgentMetricsSummary;
  chains: Array<Pick<ChainInfo, 'name' | 'displayName' | 'domainId' | 'protocol' | 'explorerUrl' | 'mailbox'>>;
  errors: string[];
}
