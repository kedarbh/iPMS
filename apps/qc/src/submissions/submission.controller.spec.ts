import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PERMISSION_KEY, type AuthzScope, type PermissionMetadata } from '@ipms/authz';
import { SubmissionController } from './submission.controller.js';
import type { ProjectDirectoryClient } from '../work-orders/project-directory.client.js';
import type { SubmissionService } from './submission.service.js';

const SCOPE: AuthzScope = { global: false, projectIds: ['p-1'], siteIds: [] };
const ID = '0192f7a0-0000-7000-8000-000000000001';
const REVIEW = { decision: 'APPROVE', itemReviews: [{ itemId: ID, result: 'APPROVED' }] };

function permissionOf(method: keyof SubmissionController): string | undefined {
  const handler = SubmissionController.prototype[method] as unknown as object;
  return (Reflect.getMetadata(PERMISSION_KEY, handler) as PermissionMetadata | undefined)?.permission;
}

const make = (scope: unknown = { state: 'found', value: SCOPE }) => {
  const service = { getSubmission: vi.fn(), createSubmission: vi.fn(), reviewSubmission: vi.fn() };
  const projects = { scope: vi.fn().mockResolvedValue(scope) };
  return { service, projects, controller: new SubmissionController(service as unknown as SubmissionService, projects as unknown as ProjectDirectoryClient) };
};
const req = { user: { id: 'u-1', permissions: [] }, headers: { authorization: 'Bearer t' } } as never;

describe('SubmissionController', () => {
  it.each([
    ['get', 'qc_submission.view'], ['submit', 'qc_submission.create'], ['review', 'qc_review.approve'],
  ] as [keyof SubmissionController, string][])('%s requires %s', (method, permission) => {
    expect(permissionOf(method)).toBe(permission);
  });

  it('reads a submission within the scope project resolves for the caller', async () => {
    const { controller, service, projects } = make();
    await controller.get(ID, req);
    expect(projects.scope).toHaveBeenCalledWith('Bearer t');
    expect(service.getSubmission).toHaveBeenCalledWith(ID, SCOPE);
  });

  it('reviews within the scope project resolves for the caller', async () => {
    const { controller, service, projects } = make();
    await controller.review(ID, REVIEW, req);
    expect(projects.scope).toHaveBeenCalledWith('Bearer t');
    expect(service.reviewSubmission).toHaveBeenCalledWith(ID, REVIEW, 'u-1', SCOPE);
  });

  it('reviews nothing when project cannot say what the caller may see', async () => {
    const { controller, service } = make({ state: 'unavailable' });
    await expect(controller.review(ID, REVIEW, req)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(service.reviewSubmission).not.toHaveBeenCalled();
  });

  it('passes the service’s not-found through for a submission out of scope', async () => {
    const { controller, service } = make();
    service.reviewSubmission.mockRejectedValue(new NotFoundException('Submission not found'));
    await expect(controller.review(ID, REVIEW, req)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a malformed review before resolving scope', async () => {
    const { controller, service, projects } = make();
    await expect(controller.review(ID, { decision: 'MAYBE' }, req)).rejects.toThrow();
    expect(projects.scope).not.toHaveBeenCalled();
    expect(service.reviewSubmission).not.toHaveBeenCalled();
  });
});
