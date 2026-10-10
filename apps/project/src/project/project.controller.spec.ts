import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY, type PermissionMetadata } from '@ipms/authz';
import { ProjectController } from './project.controller.js';
import type { ProjectService } from './project.service.js';
import type { SiteImportService } from './import/site-import.service.js';

function permissionOf(method: keyof ProjectController): string | undefined {
  const handler = ProjectController.prototype[method] as unknown as object;
  return (Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionMetadata | undefined)?.permission;
}

describe('permissions on the destructive routes', () => {
  const EXPECTED: [keyof ProjectController, string][] = [
    ['archive', 'project.archive'],
    ['remove', 'project.delete'],
    ['removeSite', 'site.delete'],
    ['removeTaskType', 'task.update'],
    ['removeMilestone', 'milestone.update'],
    ['removeTask', 'task.delete'],
    ['tasks', 'task.view'],
    ['internalScope', 'task.view'],
    ['siteRefs', 'site.view'],
    ['assignable', 'task.assign'],
    ['portfolio', 'project.view'],
  ];

  for (const [method, permission] of EXPECTED) {
    it(`${String(method)} requires ${permission}`, () => {
      expect(permissionOf(method)).toBe(permission);
    });
  }
});

describe('id parsing', () => {
  it('refuses an id that is not a uuid before the service is reached', () => {
    const service = { deleteProject: vi.fn() };
    // The import service is irrelevant to id parsing, but the constructor takes it.
    const controller = new ProjectController(service as unknown as ProjectService, {} as unknown as SiteImportService);
    const scope = { global: true, projectIds: [], siteIds: [] };
    expect(() => controller.remove(scope, 'not-a-uuid', { user: { id: 'actor' } } as never)).toThrow();
    expect(service.deleteProject).not.toHaveBeenCalled();
  });
});
