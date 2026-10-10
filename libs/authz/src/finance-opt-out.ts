import { PERMISSIONS } from './permissions.js';
import type { AuthzOverride } from './types.js';

/** Shown wherever IAM explains why a Field Engineer holds no finance permission. */
export const FINANCE_OPT_OUT_REASON = "Finance is handled by this engineer's own company";

/**
 * Every permission in a `finance_*` module, read from the catalog rather than
 * listed, so a finance permission added later is closed to an opted-out
 * engineer without anyone remembering to add it here.
 */
const FINANCE_CODES: readonly string[] = PERMISSIONS
  .filter((p) => p.module.startsWith('finance_'))
  .map((p) => p.code);

/**
 * The global DENY overrides that stand in for "this engineer's company handles
 * their money".
 *
 * Synthesised in memory for a user whose `financeEnabled` is false, never
 * stored. A DENY outranks a role grant and an ALLOW override alike
 * (`resolvePermissions`, `check()`), so the token claim, the effective-permissions
 * read and `holders` all agree, and an ALLOW added by hand cannot bring finance back.
 */
export function financeOptOutOverrides(): AuthzOverride[] {
  return FINANCE_CODES.map((permission) => ({
    permission, effect: 'DENY', projectId: null, siteId: null, validFrom: null, validUntil: null,
  }));
}
