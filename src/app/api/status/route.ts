import { getStatus } from '@/lib/status';

export const dynamic = 'force-dynamic';

export async function GET() {
  const snapshot = await getStatus();
  return Response.json(snapshot, {
    headers: {
      'Cache-Control': 'public, max-age=15, s-maxage=30, stale-while-revalidate=60',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
