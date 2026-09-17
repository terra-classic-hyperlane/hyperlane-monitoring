import { getStatus } from '@/lib/status';

export const dynamic = 'force-dynamic';

// Uptime-monitor friendly: 200 when the bridge is healthy or degraded, 503 when something is down.
export async function GET() {
  const s = await getStatus();
  const body = {
    status: s.overall,
    relayer: s.relayer.health,
    balances: Object.fromEntries(s.balances.map((b) => [b.chain, b.health])),
    validators: Object.fromEntries(s.validators.map((v) => [v.origin, v.health])),
    generatedAt: new Date(s.generatedAt).toISOString(),
  };
  return Response.json(body, { status: s.overall === 'down' ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
}
