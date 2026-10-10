import { describe, expect, it } from 'vitest';
import { isFinancePermission, summarizeAccess } from './role-access';

const catalog = [
  { code: 'user.view', module: 'user', description: 'View users' },
  { code: 'user.create', module: 'user', description: 'Create users' },
  { code: 'qc_review.approve', module: 'qc_review', description: 'Approve submissions' },
  { code: 'project.view', module: 'project', description: 'View projects' },
];

const roles = [
  { code: 'VIEWER', name: 'Viewer', permissionCodes: ['project.view', 'user.view'] },
  { code: 'ADMIN', name: 'Admin', permissionCodes: ['user.view', 'user.create', 'qc_review.approve'] },
];

describe('summarizeAccess', () => {
  it('is empty when no role is selected', () => {
    expect(summarizeAccess([], roles, catalog)).toEqual({ total: 0, groups: [] });
  });

  it('groups the union of the selected roles by module, in catalog order', () => {
    const summary = summarizeAccess(['VIEWER', 'ADMIN'], roles, catalog);
    expect(summary.total).toBe(4);
    expect(summary.groups.map((g) => g.label)).toEqual(['User', 'QC review', 'Project']);
    expect(summary.groups[0]!.permissions.map((p) => p.description)).toEqual(['View users', 'Create users']);
  });

  it('names every selected role that grants a permission', () => {
    const summary = summarizeAccess(['VIEWER', 'ADMIN'], roles, catalog);
    expect(summary.groups[0]!.permissions[0]).toMatchObject({ code: 'user.view', grantedBy: ['Viewer', 'Admin'] });
  });

  it('falls back to the raw code when the catalog could not be loaded', () => {
    const summary = summarizeAccess(['VIEWER'], roles, []);
    expect(summary.groups).toEqual([
      { module: 'project', label: 'Project', permissions: [{ code: 'project.view', description: 'project.view', grantedBy: ['Viewer'] }] },
      { module: 'user', label: 'User', permissions: [{ code: 'user.view', description: 'user.view', grantedBy: ['Viewer'] }] },
    ]);
  });

  it('ignores a selected code with no matching role', () => {
    expect(summarizeAccess(['GONE'], roles, catalog).total).toBe(0);
  });
});

describe('summarizeAccess with finance switched off', () => {
  const financeCatalog = [
    ...catalog,
    { code: 'finance_request.view', module: 'finance_request', description: 'View your own finance requests' },
    { code: 'finance_request.create', module: 'finance_request', description: 'Raise an advance or reimbursement request' },
  ];
  const engineer = [{
    code: 'FIELD_ENGINEER', name: 'Field Engineer',
    permissionCodes: ['project.view', 'finance_request.view', 'finance_request.create'],
  }];

  it('lists finance by default', () => {
    const summary = summarizeAccess(['FIELD_ENGINEER'], engineer, financeCatalog);
    expect(summary.total).toBe(3);
    expect(summary.groups.map((g) => g.label)).toContain('Finance request');
  });

  it('leaves finance out when it is switched off, and keeps the rest', () => {
    const summary = summarizeAccess(['FIELD_ENGINEER'], engineer, financeCatalog, { financeEnabled: false });
    expect(summary.total).toBe(1);
    expect(summary.groups.map((g) => g.module)).toEqual(['project']);
  });

  it('knows a finance permission by its module', () => {
    expect(isFinancePermission('finance_payment.record')).toBe(true);
    expect(isFinancePermission('project.view')).toBe(false);
  });
});
