/**
 * What a set of roles lets someone do, for the role picker to show as boxes are
 * ticked. Pure and dependency-free so the client form can import it.
 *
 * Roles only. A user's effective access can also include per-user overrides and
 * is limited by project scope; neither is a property of the roles chosen here.
 */

export interface PermissionInfo { code: string; module: string; description: string }
export interface RolePermissions { code: string; name: string; permissionCodes: string[] }

export interface GrantedPermission { code: string; description: string; grantedBy: string[] }
export interface AccessGroup { module: string; label: string; permissions: GrantedPermission[] }
export interface AccessSummary { total: number; groups: AccessGroup[] }

/** `qc_review` → `QC review`. */
function moduleLabel(module: string): string {
  const words = module.split('_').map((word) => (word === 'qc' ? 'QC' : word));
  const [first = '', ...rest] = words;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
}

/** Finance permissions live in `finance_*` modules: `finance_request.view`, `finance_payment.record`, … */
export function isFinancePermission(code: string): boolean {
  return code.startsWith('finance_');
}

export function summarizeAccess(
  selected: readonly string[],
  roles: readonly RolePermissions[],
  catalog: readonly PermissionInfo[],
  options: { financeEnabled?: boolean } = {},
): AccessSummary {
  const withFinance = options.financeEnabled ?? true;
  const grantedBy = new Map<string, string[]>();
  for (const role of roles) {
    if (!selected.includes(role.code)) continue;
    for (const code of role.permissionCodes) {
      // An engineer created with finance off never holds these; iam withholds them.
      if (!withFinance && isFinancePermission(code)) continue;
      grantedBy.set(code, [...(grantedBy.get(code) ?? []), role.name]);
    }
  }

  // Catalog order first, so related permissions sit together the way the
  // catalog declares them. Codes the catalog does not know — it may not have
  // loaded, since reading it needs `permission.view` — follow in code order.
  const known = new Map(catalog.map((p) => [p.code, p]));
  const ordered = [
    ...catalog.filter((p) => grantedBy.has(p.code)),
    ...[...grantedBy.keys()].filter((code) => !known.has(code)).sort()
      .map((code) => ({ code, module: code.split('.')[0] ?? code, description: code })),
  ];

  const groups = new Map<string, AccessGroup>();
  for (const p of ordered) {
    const group = groups.get(p.module) ?? { module: p.module, label: moduleLabel(p.module), permissions: [] };
    group.permissions.push({ code: p.code, description: p.description, grantedBy: grantedBy.get(p.code) ?? [] });
    groups.set(p.module, group);
  }
  return { total: ordered.length, groups: [...groups.values()] };
}
