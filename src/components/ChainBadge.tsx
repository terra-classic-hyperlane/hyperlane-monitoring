import clsx from 'clsx';

import type { ChainName } from '@/lib/types';

const STYLE: Record<ChainName, { bg: string; short: string }> = {
  terraclassic: { bg: 'bg-amber-400 text-black', short: 'TC' },
  bsc: { bg: 'bg-yellow-300 text-black', short: 'BSC' },
  ethereum: { bg: 'bg-indigo-300 text-black', short: 'ETH' },
  solanamainnet: { bg: 'bg-gradient-to-br from-fuchsia-400 to-cyan-300 text-black', short: 'SOL' },
};

export function ChainBadge({ chain, name, size = 'md' }: { chain: ChainName; name?: string; size?: 'sm' | 'md' }) {
  const s = STYLE[chain] ?? { bg: 'bg-slate-400 text-black', short: chain.slice(0, 3).toUpperCase() };
  return (
    <span className="inline-flex items-center gap-2">
      <span className={clsx('inline-flex items-center justify-center rounded-full font-bold', s.bg, size === 'sm' ? 'h-5 w-9 text-[10px]' : 'h-6 w-11 text-[11px]')}>
        {s.short}
      </span>
      {name && <span className={clsx('font-medium', size === 'sm' && 'text-sm')}>{name}</span>}
    </span>
  );
}
