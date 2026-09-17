import { cached } from './cache';

// s3://bucket/region[/prefix] -> https://bucket.s3.region.amazonaws.com[/prefix]
// gs://bucket[/prefix] -> https://storage.googleapis.com/bucket[/prefix]
export function storageToHttp(location: string): string | null {
  const s3 = /^s3:\/\/([^/]+)\/([^/]+)(\/.*)?$/.exec(location);
  if (s3) return `https://${s3[1]}.s3.${s3[2]}.amazonaws.com${s3[3] ?? ''}`;
  const gcs = /^gs:\/\/([^/]+)(\/.*)?$/.exec(location);
  if (gcs) return `https://storage.googleapis.com/${gcs[1]}${gcs[2] ?? ''}`;
  if (location.startsWith('https://')) return location.replace(/\/$/, '');
  return null;
}

export interface LatestCheckpoint {
  index: number;
  lastModified: number | null; // epoch ms
}

export async function fetchLatestCheckpoint(location: string): Promise<LatestCheckpoint> {
  const base = storageToHttp(location);
  if (!base) throw new Error(`unsupported storage location: ${location}`);
  return cached(`ckpt:${base}`, 20_000, async () => {
    const res = await fetch(`${base}/checkpoint_latest_index.json`, {
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} reading ${base}/checkpoint_latest_index.json`);
    const text = (await res.text()).trim();
    const index = Number(text);
    if (!Number.isFinite(index)) throw new Error(`unexpected latest index "${text.slice(0, 20)}"`);
    const lm = res.headers.get('last-modified');
    return { index, lastModified: lm ? new Date(lm).getTime() : null };
  });
}
