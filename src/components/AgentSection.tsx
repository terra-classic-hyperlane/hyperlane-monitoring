'use client';

import type { AgentMetricsSummary } from '@/lib/types';

import { Card, SectionTitle, Stat, StatusPill } from './ui';

export function AgentSection({ agents }: { agents: AgentMetricsSummary }) {
  if (!agents.configured) return null;
  const r = agents.relayer;
  const v = agents.validator;
  const criticals = r ? Object.entries(r.criticalErrors).filter(([, n]) => n > 0) : [];
  const health = !agents.reachable ? 'unknown' : criticals.length || (v && v.criticalErrors > 0) ? 'down' : r?.queueLengths.length ? 'warn' : 'ok';
  return (
    <div>
      <SectionTitle
        title="Operator agents"
        subtitle="Internal metrics of the community relayer and validator (Prometheus)"
        right={<StatusPill health={health} label={!agents.reachable ? 'Unreachable' : undefined} />}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {r && (
          <Card className="flex flex-col gap-3">
            <div className="font-medium">Relayer</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(r.livenessAgeSec).map(([chain, age]) => (
                <Stat key={chain} label={`${chain} sync`} value={`${age}s ago`} health={age > 600 ? 'warn' : 'ok'} />
              ))}
            </div>
            {criticals.length > 0 && <p className="text-xs text-down">Critical errors: {criticals.map(([c, n]) => `${c} (${n})`).join(', ')}</p>}
            {r.queueLengths.length > 0 ? (
              <ul className="text-xs text-warn">
                {r.queueLengths.map((q, i) => (
                  <li key={i}>
                    {q.length} in {q.queue} → {q.remote}: {q.status}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">Submission queues empty</p>
            )}
            {r.processedByRoute.length > 0 && (
              <p className="text-xs text-muted">
                Processed since restart: {r.processedByRoute.map((p) => `${p.origin}→${p.remote} ${p.count}`).join(' · ')}
              </p>
            )}
          </Card>
        )}
        {v && (
          <Card className="flex flex-col gap-3">
            <div className="font-medium">Validator ({v.chain})</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Announced" value={v.announced ? 'yes' : 'no'} health={v.announced ? 'ok' : 'down'} />
              <Stat label="Observed" value={v.latestObserved ?? '—'} />
              <Stat label="Signed" value={v.latestProcessed ?? '—'} />
              <Stat label="Sync" value={v.livenessAgeSec === null ? '—' : `${v.livenessAgeSec}s ago`} health={v.livenessAgeSec !== null && v.livenessAgeSec > 600 ? 'warn' : 'ok'} />
            </div>
            {v.criticalErrors > 0 && <p className="text-xs text-down">Critical errors: {v.criticalErrors}</p>}
          </Card>
        )}
        {agents.error && <p className="text-xs text-down md:col-span-2">{agents.error}</p>}
      </div>
    </div>
  );
}
