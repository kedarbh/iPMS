import { getRequest } from '../lib/finance-api';
import { decisionLine } from './model';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One line confirming what the viewer just decided. The URL carries only the
 * request's id; the words come from the normal, scope-checked read of it, so
 * nothing typed into the URL is ever shown.
 */
export async function DecidedNotice({ id, viewerId }: { id: string | undefined; viewerId: string }) {
  if (!id || !UUID.test(id)) return null;
  const result = await getRequest(id);
  const line = result.state === 'ready' ? decisionLine(result.data, viewerId) : null;
  return line ? <p className="finance-decided" role="status">{line}</p> : null;
}
