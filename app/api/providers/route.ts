import { listProviderStatus } from '../../lib/providers';
import { jsonError } from '../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    return Response.json({ providers: await listProviderStatus() });
  } catch (error) {
    return jsonError(error, 500);
  }
}
