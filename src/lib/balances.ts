import { errMsg, withTimeout } from './cache';
import { ALL_CHAINS, OPERATOR_ADDRESSES, balanceThresholds } from './config';
import { nativeBalance } from './cosmos';
import { evmBalance } from './evm';
import { explorerAddressUrl } from './registry';
import { solBalance } from './solana';
import type { BalanceStatus, ChainInfo, ChainName, Health } from './types';

export async function operatorBalances(
  chains: Record<ChainName, ChainInfo>,
  prices: Record<string, number> = {},
): Promise<BalanceStatus[]> {
  const thresholds = balanceThresholds();
  return Promise.all(
    ALL_CHAINS.map(async (name): Promise<BalanceStatus> => {
      const chain = chains[name];
      const address = OPERATOR_ADDRESSES[name];
      const t = thresholds[name];
      const base: BalanceStatus = {
        chain: name,
        displayName: chain.displayName,
        address,
        balance: null,
        balanceUsd: null,
        symbol: chain.nativeSymbol,
        warnBelow: t.warn,
        criticalBelow: t.critical,
        health: 'unknown',
        explorerUrl: explorerAddressUrl(chain, address),
      };
      try {
        const fetcher =
          chain.protocol === 'cosmos'
            ? nativeBalance(chain, address)
            : chain.protocol === 'ethereum'
              ? evmBalance(chain, address)
              : solBalance(chain, address);
        const balance = await withTimeout(fetcher, 20_000, `${name} balance`);
        let health: Health = 'ok';
        if (balance < t.critical) health = 'down';
        else if (balance < t.warn) health = 'warn';
        return {
          ...base,
          balance,
          balanceUsd: prices[chain.nativeSymbol] ? balance * prices[chain.nativeSymbol] : null,
          health,
        };
      } catch (e) {
        return { ...base, error: errMsg(e) };
      }
    }),
  );
}
