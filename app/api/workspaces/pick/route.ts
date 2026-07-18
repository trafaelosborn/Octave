import { pickFolder } from '../../../lib/folder-picker';
import { jsonError } from '../../../lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  try {
    return Response.json({ path: await pickFolder() });
  } catch (error) {
    return jsonError(error, 500);
  }
}
