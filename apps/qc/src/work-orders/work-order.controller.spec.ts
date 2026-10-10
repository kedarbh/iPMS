import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { PERMISSION_KEY, type AuthzScope, type PermissionMetadata } from '@ipms/authz';
import { WorkOrderController } from './work-order.controller.js';
import type { ProjectDirectoryClient } from './project-directory.client.js';
import type { WorkOrderService } from './work-order.service.js';

const SCOPE: AuthzScope = { global: false, projectIds: ['p-1'], siteIds: [] };
const ID = '0192f7a0-0000-7000-8000-000000000001';
const BODY = { projectId: ID, workOrderType: 'EHS_SELF_CHECK', templateId: ID, siteIds: [ID], assigneeId: ID, plannedCompletionAt: '2026-09-30' };

function permissionOf(method: keyof WorkOrderController): string | undefined {
  const handler = WorkOrderController.prototype[method] as unknown as object;
  return (Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionMetadata | undefined)?.permission;
}

const make = (scope: unknown = { state: 'found', value: SCOPE }) => {
  const service = { create: vi.fn(), list: vi.fn(), summary: vi.fn(), brief: vi.fn(), get: vi.fn(), update: vi.fn(), cancel: vi.fn() };
  const projects = { scope: vi.fn().mockResolvedValue(scope) };
  return { service, projects, controller: new WorkOrderController(service as unknown as WorkOrderService, projects as unknown as ProjectDirectoryClient) };
};
const req = (permissions: string[]) => ({ user: { id: 'u-1', permissions }, headers: { authorization: 'Bearer t' } }) as never;

describe('WorkOrderController', () => {
  it.each([
    ['list', 'task.view'], ['brief', 'task.view'], ['get', 'task.view'], ['update', 'task.assign'],
    ['cancel', 'task.cancel'], ['create', 'task.create'], ['summary', 'task.view'],
  ] as [keyof WorkOrderController, string][])('%s requires %s', (method, permission) => {
    expect(permissionOf(method)).toBe(permission);
  });

  it('also requires task.assign to create, since a work order is created assigned', () => {
    const { controller, service } = make();
    expect(() => controller.create(BODY, req(['task.create']))).toThrow(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('forwards the caller’s token so project checks the sites and the assignee as them', () => {
    const { controller, service } = make();
    controller.create(BODY, req(['task.create', 'task.assign']));
    expect(service.create).toHaveBeenCalledWith(expect.objectContaining({ projectId: ID, siteIds: [ID] }), 'u-1', 'Bearer t');
  });

  it('lists within the scope project resolves for the caller', async () => {
    const { controller, service, projects } = make();
    await controller.list({ page: '2', view: 'overdue', projectId: ID }, req(['task.view']));
    expect(projects.scope).toHaveBeenCalledWith('Bearer t');
    expect(service.list).toHaveBeenCalledWith({ ...SCOPE, onlyAssignee: 'u-1' }, { page: 2, limit: 20, view: 'overdue', projectId: ID });
  });

  it('summarises within the caller’s reach', async () => {
    const { controller, service } = make();
    await controller.summary(req(['task.view']));
    await controller.summary(req(['task.view', 'task.view_all']));
    expect(service.summary.mock.calls[0]![0]).toEqual({ ...SCOPE, onlyAssignee: 'u-1' });
    expect(service.summary.mock.calls[1]![0]).toEqual(SCOPE);
  });

  it('lets a caller holding task.view_all see every work order in scope', async () => {
    const { controller, service } = make();
    await controller.list({}, req(['task.view', 'task.view_all']));
    await controller.brief(ID, req(['task.view', 'task.view_all']));
    await controller.get(ID, req(['task.view', 'task.view_all']));
    expect(service.list.mock.calls[0]![0]).toEqual(SCOPE);
    expect(service.brief).toHaveBeenCalledWith(SCOPE, ID);
    expect(service.get).toHaveBeenCalledWith(SCOPE, ID);
  });

  it('restricts a caller without task.view_all to their own work on every read', async () => {
    const { controller, service } = make();
    await controller.brief(ID, req(['task.view']));
    await controller.get(ID, req(['task.view']));
    expect(service.brief).toHaveBeenCalledWith({ ...SCOPE, onlyAssignee: 'u-1' }, ID);
    expect(service.get).toHaveBeenCalledWith({ ...SCOPE, onlyAssignee: 'u-1' }, ID);
  });

  it('shows nothing when project cannot say what the caller may see', async () => {
    const { controller, service } = make({ state: 'unavailable' });
    await expect(controller.list({}, req(['task.view']))).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('refuses an empty update and a reasonless cancel before the service', async () => {
    const { controller, service } = make();
    await expect(controller.update(ID, {}, req([]))).rejects.toThrow();
    await expect(controller.cancel(ID, {}, req([]))).rejects.toThrow();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.cancel).not.toHaveBeenCalled();
  });
});
