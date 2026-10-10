import 'server-only';
import type {
  AssignTaskDto,
  CreateMilestoneDto,
  CreateProjectDto,
  CreateSiteInput,
  CreateTaskDto,
  CreateTaskTypeDto,
  PortfolioProject,
  SiteImportCommitDto,
  SiteImportPreviewDto,
  UpdateMilestoneDto,
  UpdateProjectDto,
  UpdateSiteDto,
  UpdateTaskDto,
  UpdateTaskTypeDto,
} from '@ipms/contracts';
import { authFetch, type ApiResult } from './api-client';

/**
 * The Project service's public surface, as reached through the gateway.
 *
 * Request shapes come from `@ipms/contracts` — the same schemas the service
 * parses with — so a field renamed there stops this app from compiling rather
 * than producing a 422 at runtime. The imports are type-only on purpose: the
 * contracts barrel pulls in `node:crypto` and zod, which have no business in
 * this app's bundle when only the shapes are needed.
 *
 * Response shapes are declared here rather than in contracts because they are
 * Prisma models, which contracts does not describe. They are written as the
 * wire sees them, which is not quite the service's own types: `DateTime`
 * arrives as an ISO string and `Decimal` as a string, because that is what
 * JSON.stringify makes of them.
 */

export type ProjectStatus = 'DRAFT' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type SiteStatus = 'PLANNED' | 'IN_DELIVERY' | 'COMPLETED' | 'BLOCKED';
export type TaskStatus = 'NOT_STARTED' | 'ONGOING' | 'REVIEWING' | 'RECTIFYING' | 'COMPLETED' | 'CANCELLED';

export interface Project {
  id: string;
  code: string;
  name: string;
  clientName: string | null;
  phase: string | null;
  status: ProjectStatus;
  startDate: string | null;
  targetDate: string | null;
  defaultGeofenceRadiusM: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Region { id: string; projectId: string; name: string }

export interface Site {
  id: string;
  projectId: string;
  regionId: string | null;
  siteCode: string;
  name: string;
  /** Prisma Decimal, serialized by its own toJSON. */
  latitude: string | null;
  longitude: string | null;
  geofenceMode: 'INHERIT' | 'CUSTOM' | 'OFF';
  geofenceRadiusM: number | null;
  address: string | null;
  city: string | null;
  area: string | null;
  scopeVariant: string | null;
  status: SiteStatus;
}

export interface TaskType {
  id: string; projectId: string; code: string; name: string; category: string;
  templateId: string | null; order: number; isActive: boolean;
}

export interface MilestoneRequirement { milestoneId: string; taskTypeId: string }

export interface Milestone {
  id: string; projectId: string; code: string; name: string;
  kind: 'PROJECT' | 'CONTRACT'; sequence: number; targetDate: string | null;
}

/** Planned work of one of the project's task types. Work orders — checklists assigned to sites — are qc's; see work-order-api. */
export interface Task {
  id: string; projectId: string; siteId: string; taskTypeId: string; templateId: string | null;
  title: string; status: TaskStatus; assigneeId: string | null;
  plannedCompletionAt: string | null; actualCompletionAt: string | null;
  origin: 'PLANNED' | 'AD_HOC'; createdBy: string; createdAt: string;
}

/** Who may be made responsible for work in a project: the whole project, or only the sites listed. */
export interface AssignableUser { userId: string; wholeProject: boolean; siteIds: string[] }

/** `listProjects` counts sites and tasks rather than returning them. */
export type ProjectListEntry = Project & { _count: { sites: number; tasks: number } };

/** `getProject` returns the project with its sites, task types and milestones expanded. */
export type ProjectDetail = Project & {
  sites: (Site & { region: Region | null })[];
  taskTypes: TaskType[];
  milestones: (Milestone & { requirements: MilestoneRequirement[] })[];
  _count: { tasks: number };
};

export interface DashboardProject {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  phase: string | null;
  _count: { sites: number };
}

export interface ProjectDashboard {
  activeProjectCount: number;
  sitesInDelivery: number;
  projects: DashboardProject[];
}

export type DashboardResult = ApiResult<ProjectDashboard>;

/** Calls the gateway, never the Project service directly, preserving one public API boundary. */
export async function getProjectDashboard(): Promise<DashboardResult> {
  return authFetch<ProjectDashboard>('/api/v1/dashboard');
}

/** The Director's portfolio: every ACTIVE or ON_HOLD project in scope, with the counts its health is judged by. */
export async function getPortfolio(): Promise<ApiResult<PortfolioProject[]>> {
  return authFetch<PortfolioProject[]>('/api/v1/dashboard/portfolio');
}

export async function listProjects(): Promise<ApiResult<ProjectListEntry[]>> {
  return authFetch<ProjectListEntry[]>('/api/v1/projects');
}

export async function getProject(id: string): Promise<ApiResult<ProjectDetail>> {
  return authFetch<ProjectDetail>(`/api/v1/projects/${id}`);
}

export async function createProject(project: CreateProjectDto): Promise<ApiResult<Project>> {
  return authFetch<Project>('/api/v1/projects', { method: 'POST', json: project });
}

export async function updateProject(id: string, changes: UpdateProjectDto): Promise<ApiResult<Project>> {
  return authFetch<Project>(`/api/v1/projects/${id}`, { method: 'PATCH', json: changes });
}

export async function createSite(projectId: string, site: CreateSiteInput): Promise<ApiResult<Site>> {
  return authFetch<Site>(`/api/v1/projects/${projectId}/sites`, { method: 'POST', json: site });
}

export async function createTaskType(projectId: string, taskType: CreateTaskTypeDto): Promise<ApiResult<TaskType>> {
  return authFetch<TaskType>(`/api/v1/projects/${projectId}/task-types`, { method: 'POST', json: taskType });
}

export async function createMilestone(projectId: string, milestone: CreateMilestoneDto): Promise<ApiResult<Milestone>> {
  return authFetch<Milestone>(`/api/v1/projects/${projectId}/milestones`, { method: 'POST', json: milestone });
}

export async function createTask(projectId: string, task: CreateTaskDto): Promise<ApiResult<Task>> {
  return authFetch<Task>(`/api/v1/projects/${projectId}/tasks`, { method: 'POST', json: task });
}

/** Assignment is addressed by task, not by project — `/api/v1/tasks` is its own gateway prefix. */
export async function assignTask(taskId: string, assignment: AssignTaskDto): Promise<ApiResult<Task>> {
  return authFetch<Task>(`/api/v1/tasks/${taskId}/assign`, { method: 'POST', json: assignment });
}

export async function listTasks(projectId: string, filter: { siteId?: string; status?: TaskStatus } = {}): Promise<ApiResult<Task[]>> {
  return authFetch<Task[]>(`/api/v1/projects/${projectId}/tasks`, { query: filter });
}

/** Who can be given work in this project — project's to answer, since it holds the replicated scope. */
export async function listAssignable(projectId: string): Promise<ApiResult<AssignableUser[]>> {
  return authFetch<AssignableUser[]>(`/api/v1/projects/${projectId}/assignable`);
}

export async function updateSite(id: string, changes: UpdateSiteDto): Promise<ApiResult<Site>> {
  return authFetch<Site>(`/api/v1/sites/${id}`, { method: 'PATCH', json: changes });
}

export async function updateTaskType(id: string, changes: UpdateTaskTypeDto): Promise<ApiResult<TaskType>> {
  return authFetch<TaskType>(`/api/v1/task-types/${id}`, { method: 'PATCH', json: changes });
}

export async function updateMilestone(id: string, changes: UpdateMilestoneDto): Promise<ApiResult<Milestone>> {
  return authFetch<Milestone>(`/api/v1/milestones/${id}`, { method: 'PATCH', json: changes });
}

export async function updateTask(id: string, changes: UpdateTaskDto): Promise<ApiResult<Task>> {
  return authFetch<Task>(`/api/v1/tasks/${id}`, { method: 'PATCH', json: changes });
}

/** Archiving is the ordinary end of a project's life; `deleteProject` is the irreversible one. */
export async function archiveProject(id: string): Promise<ApiResult<Project>> {
  return authFetch<Project>(`/api/v1/projects/${id}/archive`, { method: 'POST' });
}

export async function deleteProject(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/projects/${id}`, { method: 'DELETE' });
}

export async function deleteSite(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/sites/${id}`, { method: 'DELETE' });
}

export async function deleteTaskType(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/task-types/${id}`, { method: 'DELETE' });
}

export async function deleteMilestone(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/milestones/${id}`, { method: 'DELETE' });
}

export async function deleteTask(id: string): Promise<ApiResult<void>> {
  return authFetch<void>(`/api/v1/tasks/${id}`, { method: 'DELETE' });
}


/**
 * Uploads a workbook for validation. Writes nothing: the report it returns is
 * what the manager confirms, and `importable` is the payload commit takes.
 */
export async function previewSiteImport(projectId: string, file: File): Promise<ApiResult<SiteImportPreviewDto>> {
  const body = new FormData();
  body.set('file', file, file.name);
  return authFetch<SiteImportPreviewDto>(`/api/v1/projects/${projectId}/sites/import/preview`, { method: 'POST', body });
}

export async function commitSiteImport(projectId: string, payload: SiteImportCommitDto): Promise<ApiResult<{ created: number; updated: number }>> {
  return authFetch(`/api/v1/projects/${projectId}/sites/import/commit`, { method: 'POST', json: payload });
}
