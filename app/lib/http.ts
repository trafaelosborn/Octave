export function jsonError(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : String(error || 'Unknown error');
  return Response.json({ error: message }, { status });
}

export async function readJsonBody<T>(request: Request): Promise<T> {
  try {
    return await request.json() as T;
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}
