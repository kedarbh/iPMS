import { describe, expect, it } from 'vitest';
import { check } from './evaluate.js';
import { FINANCE_OPT_OUT_REASON, financeOptOutOverrides } from './finance-opt-out.js';
import { resolvePermissions } from './permission-resolution.js';
import { PERMISSIONS } from './permissions.js';
import type { AuthzOverride } from './types.js';

const NOW = new Date('2026-10-10T12:00:00Z');

/** What a Field Engineer's role grants today, plus two non-finance permissions. */
const ENGINEER_ROLE = [
  'project.view', 'task.view',
  'finance_request.view', 'finance_request.create', 'finance_request.cancel', 'finance_settlement.submit',
];

describe('financeOptOutOverrides', () => {
  it('denies every finance permission in the catalog, and nothing else', () => {
    const denied = financeOptOutOverrides().map((o) => o.permission).sort();
    const finance = PERMISSIONS.filter((p) => p.module.startsWith('finance_')).map((p) => p.code).sort();
    expect(denied).toEqual(finance);
    expect(denied).toContain('finance_request.view');
    expect(denied).toContain('finance_approval.director');
    expect(denied.every((code) => code.startsWith('finance_'))).toBe(true);
  });

  it('are global DENY overrides with no validity window', () => {
    for (const o of financeOptOutOverrides()) {
      expect(o).toMatchObject({ effect: 'DENY', projectId: null, siteId: null, validFrom: null, validUntil: null });
    }
  });

  it('strip finance from an engineer role and keep everything else', () => {
    const resolved = resolvePermissions(ENGINEER_ROLE, financeOptOutOverrides(), NOW);
    expect([...resolved].sort()).toEqual(['project.view', 'task.view']);
  });

  it('outrank an ALLOW override added by hand', () => {
    const allow: AuthzOverride = {
      permission: 'finance_request.create', effect: 'ALLOW',
      projectId: null, siteId: null, validFrom: null, validUntil: null,
    };
    const resolved = resolvePermissions(ENGINEER_ROLE, [allow, ...financeOptOutOverrides()], NOW);
    expect(resolved).not.toContain('finance_request.create');
  });

  it('make check() refuse a finance permission as a DENY override', () => {
    const decision = check({
      user: { id: 'u-1', roles: ['FIELD_ENGINEER'], permissions: ENGINEER_ROLE, tokenVersion: 0, isActive: true },
      permission: 'finance_request.view',
      scope: { global: true, projectIds: [], siteIds: [] },
      overrides: financeOptOutOverrides(),
      now: NOW,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('DENIED_BY_OVERRIDE');
  });
});

describe('FINANCE_OPT_OUT_REASON', () => {
  it('says whose money it is', () => {
    expect(FINANCE_OPT_OUT_REASON).toBe("Finance is handled by this engineer's own company");
  });
});
