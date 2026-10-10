import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { PERMISSION_KEY, PERMISSION_CODES, type PermissionMetadata } from '@ipms/authz';
import { CategoryController } from './category.controller.js';
import { OverviewController } from './overview.controller.js';
import { ReportController } from './report.controller.js';
import { RequestController } from './request.controller.js';

// RequestMethod enum values from @nestjs/common.
const VERBS = { GET: 0, POST: 1, PUT: 2, DELETE: 3, PATCH: 4 } as const;
type Verb = keyof typeof VERBS;

interface Route {
  controller: { name: string; prototype: object };
  handler: string;
  verb: Verb;
  path: string;
  permission: string;
}

// Single source of truth: every route handler of every finance controller.
const ROUTES: Route[] = [
  { controller: RequestController, handler: 'create', verb: 'POST', path: 'finance/requests', permission: 'finance_request.view' },
  { controller: RequestController, handler: 'update', verb: 'PATCH', path: 'finance/requests/:id', permission: 'finance_request.view' },
  { controller: RequestController, handler: 'submit', verb: 'POST', path: 'finance/requests/:id/submit', permission: 'finance_request.view' },
  { controller: RequestController, handler: 'cancel', verb: 'POST', path: 'finance/requests/:id/cancel', permission: 'finance_request.view' },
  { controller: RequestController, handler: 'approve', verb: 'POST', path: 'finance/requests/:id/approve', permission: 'finance_request.view' },
  { controller: RequestController, handler: 'returnToRequester', verb: 'POST', path: 'finance/requests/:id/return', permission: 'finance_request.view' },
  { controller: RequestController, handler: 'reject', verb: 'POST', path: 'finance/requests/:id/reject', permission: 'finance_request.view' },
  { controller: RequestController, handler: 'pay', verb: 'POST', path: 'finance/requests/:id/pay', permission: 'finance_payment.record' },
  { controller: RequestController, handler: 'returnCash', verb: 'POST', path: 'finance/advances/:id/cash-return', permission: 'finance_payment.record' },
  { controller: RequestController, handler: 'remind', verb: 'POST', path: 'finance/advances/:id/remind', permission: 'finance_request.view' },
  { controller: RequestController, handler: 'list', verb: 'GET', path: 'finance/requests', permission: 'finance_request.view' },
  { controller: RequestController, handler: 'get', verb: 'GET', path: 'finance/requests/:id', permission: 'finance_request.view' },
  { controller: RequestController, handler: 'advance', verb: 'GET', path: 'finance/advances/:id', permission: 'finance_request.view' },
  { controller: CategoryController, handler: 'list', verb: 'GET', path: 'finance/categories', permission: 'finance_request.view' },
  { controller: CategoryController, handler: 'create', verb: 'POST', path: 'finance/categories', permission: 'finance_category.manage' },
  { controller: CategoryController, handler: 'update', verb: 'PATCH', path: 'finance/categories/:id', permission: 'finance_category.manage' },
  { controller: ReportController, handler: 'spend', verb: 'GET', path: 'finance/reports/project-spend', permission: 'finance_request.view_all' },
  { controller: OverviewController, handler: 'overview', verb: 'GET', path: 'finance/overview', permission: 'finance_request.view_all' },
];

const CONTROLLERS = [RequestController, CategoryController, ReportController, OverviewController];

const fn = (c: { prototype: object }, name: string): object =>
  (c.prototype as Record<string, object>)[name]!;

const join = (...parts: string[]): string =>
  parts.map((p) => p.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');

describe('finance route wiring', () => {
  it.each(ROUTES.map((r) => [`${r.controller.name}.${r.handler}`, r] as const))('%s', (_label, r) => {
    const handler = fn(r.controller, r.handler);
    expect(handler, 'handler exists').toBeTypeOf('function');

    const meta = Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionMetadata | undefined;
    expect(meta?.permission).toBe(r.permission);
    expect(PERMISSION_CODES.has(r.permission)).toBe(true);

    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(VERBS[r.verb]);
    const prefix = Reflect.getMetadata(PATH_METADATA, r.controller) as string;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
    expect(join(prefix, path)).toBe(r.path);
  });

  it('table lists every route handler and nothing else', () => {
    const actual: string[] = [];
    for (const c of CONTROLLERS) {
      for (const name of Object.getOwnPropertyNames(c.prototype)) {
        if (name === 'constructor') continue;
        const value = Object.getOwnPropertyDescriptor(c.prototype, name)?.value as object | undefined;
        if (typeof value === 'function' && Reflect.getMetadata(METHOD_METADATA, value) !== undefined) {
          actual.push(`${c.name}.${name}`);
        }
      }
    }
    const expected = ROUTES.map((r) => `${r.controller.name}.${r.handler}`);
    expect(new Set(expected).size).toBe(expected.length);
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});
