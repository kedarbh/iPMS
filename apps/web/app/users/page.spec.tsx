import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const listUsers = vi.fn();
const getCurrentUser = vi.fn();
vi.mock('../lib/user-api', () => ({ listUsers }));
vi.mock('../lib/iam-api', () => ({ getCurrentUser, hasPermission: () => false }));
vi.mock('../shell', () => ({
  Sidebar: () => null, TopActions: () => null, StatePage: ({ title }: { title: string }) => <h1>{title}</h1>,
}));

const { default: UsersPage } = await import('./page');

const person = (over: Record<string, unknown> = {}) => ({
  id: 'u-1', email: 'ann@ipms.local', fullName: 'Ann Lee', employeeCode: null, isActive: true,
  mustChangePassword: false, financeEnabled: true, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z',
  roles: [{ code: 'FIELD_ENGINEER', name: 'Field Engineer' }], ...over,
});
const listed = (items: unknown[]) => ({ state: 'ready', data: { items, total: items.length, page: 1, limit: 20 } });
const render = async () => renderToStaticMarkup(await UsersPage({ searchParams: Promise.resolve({}) }));

beforeEach(() => {
  getCurrentUser.mockReset().mockResolvedValue({ state: 'ready', data: { id: 'u-admin', roles: [], permissions: [], tokenVersion: 0, isActive: true } });
});

describe('users list', () => {
  it('tags an engineer whose finance is handled elsewhere', async () => {
    listUsers.mockResolvedValue(listed([person({ financeEnabled: false })]));
    expect(await render()).toContain('Finance off');
  });

  it('shows no tag when finance is on', async () => {
    listUsers.mockResolvedValue(listed([person()]));
    expect(await render()).not.toContain('Finance off');
  });
});
