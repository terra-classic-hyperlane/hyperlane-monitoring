import { errMsg } from './cache';
import { METRICS_AUTH_HEADER, RELAYER_METRICS_URL, VALIDATOR_METRICS_URL } from './config';
import type { AgentMetricsSummary } from './types';

interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function parseProm(text: string): Sample[] {
  const out: Sample[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{([^}]*)\})?\s+(\S+)/.exec(line);
    if (!m) continue;
    const labels: Record<string, string> = {};
    if (m[3]) {
      for (const kv of m[3].match(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g) ?? []) {
        const eq = kv.indexOf('=');
        labels[kv.slice(0, eq)] = kv.slice(eq + 2, -1).replace(/\\"/g, '"');
      }
    }
    const value = Number(m[4]);
    if (Number.isFinite(value)) out.push({ name: m[1], labels, value });
  }
  return out;
}

async function scrape(url: string): Promise<Sample[]> {
  const res = await fetch(url, {
    headers: METRICS_AUTH_HEADER ? { Authorization: METRICS_AUTH_HEADER } : undefined,
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseProm(await res.text());
}

export async function agentMetrics(): Promise<AgentMetricsSummary> {
  if (!RELAYER_METRICS_URL && !VALIDATOR_METRICS_URL) return { configured: false, reachable: false };
  const now = Date.now() / 1000;
  const summary: AgentMetricsSummary = { configured: true, reachable: false, scrapedAt: Date.now() };
  const errors: string[] = [];
  if (RELAYER_METRICS_URL) {
    try {
      const s = await scrape(RELAYER_METRICS_URL);
      const by = (n: string) => s.filter((x) => x.name === n);
      summary.relayer = {
        criticalErrors: Object.fromEntries(by('hyperlane_critical_error').map((x) => [x.labels.chain, x.value])),
        queueLengths: by('hyperlane_submitter_queue_length')
          .filter((x) => x.value > 0)
          .map((x) => ({
            queue: x.labels.queue_name,
            remote: x.labels.remote,
            status: x.labels.operation_status,
            length: x.value,
          })),
        processedByRoute: by('hyperlane_messages_processed_count')
          .filter((x) => x.value > 0)
          .map((x) => ({ origin: x.labels.origin, remote: x.labels.remote, count: x.value })),
        livenessAgeSec: Object.fromEntries(
          by('hyperlane_contract_sync_liveness')
            .filter((x) => x.labels.data_type === 'dispatched_messages' && x.labels.task === 'cursor_task')
            .map((x) => [x.labels.chain, Math.max(0, Math.round(now - x.value))]),
        ),
        observedValidators: by('hyperlane_observed_validator_latest_index').map((x) => ({
          origin: x.labels.origin,
          destination: x.labels.destination,
          validator: x.labels.validator,
          index: x.value,
        })),
      };
      summary.reachable = true;
    } catch (e) {
      errors.push(`relayer metrics: ${errMsg(e)}`);
    }
  }
  if (VALIDATOR_METRICS_URL) {
    try {
      const s = await scrape(VALIDATOR_METRICS_URL);
      const one = (n: string, phase?: string) => s.find((x) => x.name === n && (!phase || x.labels.phase === phase));
      const liveness = s.find((x) => x.name === 'hyperlane_contract_sync_liveness');
      summary.validator = {
        chain: one('hyperlane_announced')?.labels.chain ?? 'terraclassic',
        announced: (one('hyperlane_announced')?.value ?? 0) === 1,
        latestObserved: one('hyperlane_latest_checkpoint', 'validator_observed')?.value ?? null,
        latestProcessed: one('hyperlane_latest_checkpoint', 'validator_processed')?.value ?? null,
        criticalErrors: one('hyperlane_critical_error')?.value ?? 0,
        livenessAgeSec: liveness ? Math.max(0, Math.round(now - liveness.value)) : null,
      };
      summary.reachable = true;
    } catch (e) {
      errors.push(`validator metrics: ${errMsg(e)}`);
    }
  }
  if (errors.length) summary.error = errors.join('; ');
  return summary;
}
