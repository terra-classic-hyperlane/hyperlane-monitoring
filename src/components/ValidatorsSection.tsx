'use client';

import clsx from 'clsx';

import { fmtNum } from '@/lib/format';
import type { Health, ValidatorSetStatus } from '@/lib/types';

import { ChainBadge } from './ChainBadge';
import { Address, Card, HEALTH_COLOR, HealthDot, SectionTitle, StatusPill, TimeAgo } from './ui';

function SetCard({ set, explorerUrl }: { set: ValidatorSetStatus; explorerUrl?: string }) {
  const members = set.validators.filter((v) => v.inSet);
  const announcedOnly = set.validators.length - members.length;
  return (
    <Card accent={set.health} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-muted">Origin</span>
          <ChainBadge chain={set.origin} name={set.originDisplayName} size="sm" />
        </div>
        <StatusPill
          health={set.health}
          label={members.length ? `${set.syncedCount}/${members.length} synced · need ${set.threshold}` : undefined}
        />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
        <span>
          Merkle tree count:{' '}
          <span className="mono text-fg">{set.chainCount === null ? '—' : fmtNum(set.chainCount, 0)}</span>
        </span>
        <span title={set.ismDescription}>
          Threshold {set.threshold}-of-{members.length}
        </span>
        {announcedOnly > 0 && <span>{announcedOnly} announced but not in the ISM</span>}
      </div>
      {set.isms.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="uppercase tracking-wider text-muted">ISM</span>
          {set.isms.map((i) => (
            <span key={`${i.chain}-${i.address}`} className="inline-flex items-center gap-1.5">
              <span className="text-muted">{i.chainDisplayName}:</span>
              <Address value={i.address} href={i.explorerUrl} chars={6} />
              {i.note && <span className="text-muted/70">({i.note})</span>}
            </span>
          ))}
        </div>
      )}
      {set.error ? (
        <p className="text-xs text-down">{set.error}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
              <tr>
                <th className="py-1 pr-2 font-medium">Validator</th>
                <th className="py-1 pr-2 font-medium">Signed index</th>
                <th className="py-1 pr-2 font-medium">Lag</th>
                <th className="py-1 pr-2 font-medium">Last checkpoint</th>
                <th className="py-1 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {set.validators.map((v) => (
                <tr key={v.address}>
                  <td className="py-1.5 pr-2">
                    <div className="flex items-center gap-1.5 font-medium">
                      {v.name}
                      {!v.inSet && (
                        <span
                          className="rounded border border-white/15 px-1 text-[10px] font-normal text-muted"
                          title="Announced on the ValidatorAnnounce contract, but not enrolled in the ISM: does not count for the threshold"
                        >
                          announced only
                        </span>
                      )}
                    </div>
                    <Address
                      value={v.address}
                      href={explorerUrl ? `${explorerUrl.replace(/\/$/, '')}/address/${v.address}` : undefined}
                      chars={5}
                    />
                  </td>
                  <td className="mono py-1.5 pr-2">{v.latestIndex === null ? '—' : fmtNum(v.latestIndex, 0)}</td>
                  <td className={clsx('mono py-1.5 pr-2', v.lag !== null && v.lag > 1 && HEALTH_COLOR[v.health])}>
                    {v.lag === null ? '—' : v.lag}
                  </td>
                  <td className="py-1.5 pr-2 text-muted">
                    <TimeAgo ts={v.lastCheckpointAt} />
                  </td>
                  <td className="py-1.5">
                    <span
                      className={clsx('inline-flex items-center gap-1.5', HEALTH_COLOR[v.health])}
                      title={v.error ?? v.storageLocation ?? undefined}
                    >
                      <HealthDot health={v.health} size={7} />
                      {v.health === 'ok'
                        ? 'synced'
                        : v.health === 'warn'
                          ? 'behind'
                          : v.health === 'down'
                            ? v.error
                              ? 'unreachable'
                              : 'stale'
                            : 'unknown'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function ValidatorsSection({
  sets,
  overall,
  explorers,
}: {
  sets: ValidatorSetStatus[];
  overall: Health;
  explorers: Record<string, string | undefined>;
}) {
  return (
    <div>
      <SectionTitle
        title="Validator checkpoints"
        subtitle="Each origin chain is secured by a multisig of validators. A validator is synced when its latest signed checkpoint matches the chain's merkle tree."
        right={<StatusPill health={overall} />}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        {sets.map((s) => (
          <SetCard key={s.origin} set={s} explorerUrl={s.origin === 'terraclassic' ? undefined : explorers[s.origin]} />
        ))}
      </div>
    </div>
  );
}
