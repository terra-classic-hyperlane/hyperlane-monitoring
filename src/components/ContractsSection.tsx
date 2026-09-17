'use client';

import type { ChainName, ContractInfo } from '@/lib/types';

import { ChainBadge } from './ChainBadge';
import { Address, Card, SectionTitle } from './ui';

const ORDER: ChainName[] = ['terraclassic', 'bsc', 'ethereum', 'solanamainnet'];

export function ContractsSection({ contracts, names }: { contracts: ContractInfo[]; names: Record<string, string> }) {
  if (!contracts.length) return null;
  const byChain = ORDER.map((c) => ({ chain: c, rows: contracts.filter((x) => x.chain === c) })).filter(
    (g) => g.rows.length,
  );
  return (
    <div>
      <SectionTitle
        title="Contracts & ownership"
        subtitle="Who controls each contract of the bridge. Owner is the on-chain owner; admin is the CosmWasm contract admin, the EVM proxy admin or the Solana program upgrade authority."
      />
      <div className="grid gap-4 xl:grid-cols-2">
        {byChain.map((g) => (
          <Card key={g.chain} className="flex flex-col gap-3">
            <ChainBadge chain={g.chain} name={names[g.chain] ?? g.chain} size="sm" />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Contract</th>
                    <th className="py-1 pr-2 font-medium">Address</th>
                    <th className="py-1 pr-2 font-medium">Owner</th>
                    <th className="py-1 font-medium">Admin</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {g.rows.map((r) => (
                    <tr key={`${r.role}-${r.address}`}>
                      <td className="py-1.5 pr-2">
                        <div className="font-medium">{r.role}</div>
                        {r.note && <div className="text-[11px] text-muted">{r.note}</div>}
                      </td>
                      <td className="py-1.5 pr-2">
                        <Address value={r.address} href={r.explorerUrl} chars={6} />
                      </td>
                      <td className="py-1.5 pr-2">
                        {r.owner ? (
                          <Address value={r.owner} href={r.explorerUrl?.replace(r.address, r.owner)} chars={6} />
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="py-1.5">
                        {r.admin ? (
                          <div>
                            {/^[0-9A-Za-z]{25,}$/.test(r.admin) ? (
                              <Address value={r.admin} href={r.explorerUrl?.replace(r.address, r.admin)} chars={6} />
                            ) : (
                              <span>{r.admin}</span>
                            )}
                            {r.adminLabel && <div className="text-[11px] text-muted">{r.adminLabel}</div>}
                          </div>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
