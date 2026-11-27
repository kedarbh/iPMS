import { getCurrentUser, hasPermission, type CurrentUser } from '../../lib/iam-api';
import { getProject, listTasks, type ProjectDetail } from '../../lib/project-api';
import { listProjectWorkOrders } from '../../lib/work-order-api';
import type { ApiResult } from '../../lib/api-client';
import { StatePage } from '../../shell';
import { ProjectFrame, projectProblem } from './frame';
import { STATUS_LABEL, formatDay, landingFor, myTasks, summarizeProject, workOf, type Work } from './summary';
import { projectWorkOrdersPath, taskKind, workOrderPath } from '../../quality/work-orders/labels';

/** One cell of the tally strip. The note takes a status colour only when it is a judgement. */
function Metric({ label, value, detail, tone }: { label: string; value: number; detail: string; tone?: 'amber' | 'red' | undefined }) {
  return <article className="tally-cell"><p className="tally-label">{label}</p><p className="tally-value">{value}</p><p className={tone ? `tally-note ${tone}` : 'tally-note'}>{detail}</p></article>;
}

/**
 * The project's landing page. Who is looking decides what it is: people who
 * oversee delivery get the overview, field engineers get their own task list
 * and nothing else — see `landingFor`.
 */
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [project, planned, workOrders, user] = await Promise.all([getProject(id), listTasks(id), listProjectWorkOrders(id), getCurrentUser()]);
  if (project.state !== 'ready') return projectProblem(project);
  const tasks = combined(planned, workOrders);

  // Without an identity there is no way to tell whose tasks are whose, and the
  // overview is not something to fall back to for someone who may be in the field.
  if (user.state !== 'ready') {
    return <StatePage title="Cannot confirm your account"><p>{user.state === 'unauthenticated' ? 'Your session has ended.' : user.message}</p><a className="primary-button" href="/login">Sign in again</a></StatePage>;
  }

  return landingFor(user.data) === 'overview'
    ? <ProjectOverview project={project.data} tasks={tasks} user={user.data} />
    : <EngineerTasks project={project.data} tasks={tasks} user={user.data} />;
}

/**
 * The project's planned tasks and QC's work orders for it, as one list. Either
 * can fail on its own; the page says which, and summarises what did load.
 */
function combined(planned: Awaited<ReturnType<typeof listTasks>>, workOrders: Awaited<ReturnType<typeof listProjectWorkOrders>>): ApiResult<Work[]> & { partial?: string } {
  const failed = [planned, workOrders].find((result) => result.state !== 'ready');
  const data = workOf(planned.state === 'ready' ? planned.data : [], workOrders.state === 'ready' ? workOrders.data : []);
  if (!failed) return { state: 'ready', data };
  if (planned.state === 'ready' || workOrders.state === 'ready') {
    const which = planned.state === 'ready' ? 'Work orders' : 'Planned tasks';
    return { state: 'ready', data, partial: `${which} could not be loaded: ${'message' in failed ? failed.message : 'sign in again to continue.'}` };
  }
  return failed as ApiResult<Work[]>;
}

function TasksUnavailable({ tasks }: { tasks: ApiResult<Work[]> & { partial?: string } }) {
  if (tasks.state === 'ready') {
    return tasks.partial ? <section className="panel api-note"><h2>Some work could not be loaded</h2><p>{tasks.partial}</p></section> : null;
  }
  return <section className="panel api-note"><h2>Work could not be loaded</h2><p>{tasks.state === 'unauthenticated' ? 'Sign in again to continue.' : tasks.message}</p></section>;
}

function ProjectOverview({ project, tasks, user }: { project: ProjectDetail; tasks: ApiResult<Work[]> & { partial?: string }; user: CurrentUser }) {
  const summary = summarizeProject(project, tasks.state === 'ready' ? tasks.data : [], new Date());
  const base = `/projects/${project.id}`;

  return (
    <ProjectFrame
      project={project}
      active="overview"
      actions={hasPermission(user, 'project.update') ? <a className="ghost-button" href={`${base}/edit`}>Edit project</a> : null}
    >
      <TasksUnavailable tasks={tasks} />

      <section className="tally" aria-label="Project summary">
        <Metric label="Sites" value={summary.siteCount} detail={`${summary.sitesInDelivery} in delivery`} />
        <Metric label="Open tasks" value={summary.openTaskCount} detail={`${summary.completedTaskCount} of ${summary.taskCount} completed`} />
        <Metric label="Pending reviews" value={summary.reviewingCount} detail={summary.reviewingCount > 0 ? 'Awaiting QC' : 'Nothing to review'} tone={summary.reviewingCount > 0 ? 'amber' : undefined} />
        <Metric label="Needs rework" value={summary.rectifyingCount} detail={summary.rectifyingCount > 0 ? 'Returned to the field' : 'Nothing returned'} tone={summary.rectifyingCount > 0 ? 'red' : undefined} />
      </section>

      <section className="main-grid">
        <article className="panel progress-panel">
          <div className="panel-header"><div><h2>Milestone progress</h2><p>{summary.siteCount} sites</p></div><a href={`${base}/setup`}>Milestones <span>→</span></a></div>
          <div className="project-summary">
            <div className="ring" style={{ '--progress': `${summary.completion}%` } as React.CSSProperties}><div><strong>{summary.completion}%</strong><span>complete</span></div></div>
            <div className="summary-copy">
              {summary.sitesComplete === null
                ? <><strong>{summary.completedTaskCount} of {summary.taskCount} tasks</strong><span>completed — no milestone declares its requirements yet</span></>
                : <><strong>{summary.sitesComplete} of {summary.siteCount} sites</strong><span>have met all milestone requirements</span></>}
            </div>
          </div>
          {summary.milestones.length === 0
            ? <div className="empty-list"><strong>No milestones yet</strong><p><a href={`${base}/setup`}>Declare milestones</a> to track site progress against them.</p></div>
            : <div className="milestone-list">
                {summary.milestones.map((milestone) => (
                  <div className="milestone" key={milestone.id}>
                    <div className="milestone-name"><strong>{milestone.name}</strong><span className={`badge ${milestone.tone}`}>{milestone.label}</span></div>
                    <div className="bar"><span style={{ width: `${milestone.percent}%` }} className={milestone.tone} /></div>
                    <b>{milestone.percent}%</b>
                  </div>
                ))}
              </div>}
        </article>

        <article className="panel attention-panel">
          <div className="panel-header"><div><h2>Needs your attention</h2><p>{summary.attentionTotal === 0 ? 'Nothing needs follow-up' : `${summary.attentionTotal} item${summary.attentionTotal === 1 ? '' : 's'} require follow-up`}</p></div><a href={projectWorkOrdersPath(project.id)}>See all <span>→</span></a></div>
          {summary.attention.length === 0
            ? <div className="empty-list"><strong>All clear</strong><p>No tasks are in review, returned for rework, or close to their due date.</p></div>
            : <div className="attention-list">
                {summary.attention.map((item) => (
                  <div className="attention-item" key={item.taskId}>
                    <span className={`site-mark ${item.tone}`}>⌖</span>
                    <div><strong>{item.siteCode}</strong><p>{item.title}</p><small>{item.detail}</small></div>
                    <span className={`status ${item.tone}`}>{item.status}</span>
                  </div>
                ))}
              </div>}
        </article>
      </section>

      <section className="bottom-grid">
        <article className="panel activity-panel">
          <div className="panel-header"><div><h2>Upcoming deadlines</h2><p>Open tasks by planned completion</p></div><a href={projectWorkOrdersPath(project.id)}>All work orders <span>→</span></a></div>
          {summary.deadlines.length === 0
            ? <div className="empty-list"><strong>No upcoming deadlines</strong><p>Open tasks with a planned completion date appear here.</p></div>
            : <div className="activity-list">
                {summary.deadlines.map((deadline) => (
                  <div className="activity" key={deadline.taskId}>
                    <span className="avatar">{deadline.day}</span>
                    <p><strong>{deadline.title}</strong> at <a href={`${base}/sites`}>{deadline.siteCode}</a><small>Due {deadline.due} · {deadline.inDays === 0 ? 'today' : deadline.inDays === 1 ? 'tomorrow' : `in ${deadline.inDays} days`}</small></p>
                  </div>
                ))}
              </div>}
        </article>

        <article className="panel region-panel">
          <div className="panel-header"><div><h2>Regional delivery</h2><p>Task completion by region</p></div></div>
          {summary.regions.length === 0
            ? <div className="empty-list"><strong>No sites yet</strong><p><a href={`${base}/sites`}>Add sites</a> to see delivery by region.</p></div>
            : <div className="region-list">
                {summary.regions.map((region) => (
                  <div key={region.name}><span title={`${region.sites} site${region.sites === 1 ? '' : 's'}`}>{region.name}</span><div className="bar"><i style={{ width: `${region.percent}%` }} /></div><b>{region.percent}%</b></div>
                ))}
              </div>}
        </article>
      </section>
    </ProjectFrame>
  );
}

function EngineerTasks({ project, tasks, user }: { project: ProjectDetail; tasks: ApiResult<Work[]> & { partial?: string }; user: CurrentUser }) {
  const mine = myTasks(tasks.state === 'ready' ? tasks.data : [], user.id);
  const siteCode = new Map(project.sites.map((site) => [site.id, site.siteCode]));
  const taskType = new Map(project.taskTypes.map((type) => [type.id, type.name]));
  const count = (...statuses: Work['status'][]) => mine.filter((task) => statuses.includes(task.status)).length;

  return (
    <ProjectFrame project={project} active="overview" tabs={false}>
      <TasksUnavailable tasks={tasks} />

      <section className="tally" aria-label="My task summary">
        <Metric label="Assigned to me" value={mine.length} detail="In this project" />
        <Metric label="To do" value={count('NOT_STARTED', 'ONGOING')} detail={`${count('ONGOING')} in progress`} />
        <Metric label="In review" value={count('REVIEWING')} detail="Waiting on QC" />
        <Metric label="Needs rework" value={count('RECTIFYING')} detail={count('RECTIFYING') > 0 ? 'Returned from QC' : 'Nothing returned'} tone={count('RECTIFYING') > 0 ? 'red' : undefined} />
      </section>

      <section className="panel" id="my-tasks">
        <div className="panel-header"><div><h2>My tasks</h2><p>Rework first, then work in hand</p></div></div>
        {mine.length === 0
          ? <div className="empty-list"><strong>No tasks assigned to you</strong><p>Tasks appear here once a manager assigns them to you.</p></div>
          : <table className="data-table">
              <thead><tr><th>Task</th><th>Site</th><th>Type</th><th>Status</th><th>Due</th></tr></thead>
              <tbody>
                {mine.map((task) => (
                  <tr key={task.id}>
                    <td>{task.workOrderType ? <a className="link" href={workOrderPath(task.id)}>{task.title}</a> : task.title}</td>
                    <td><code>{siteCode.get(task.siteId) ?? '—'}</code></td>
                    <td>{taskKind(task, taskType)}</td>
                    <td><span className={`badge ${STATUS_LABEL[task.status].tone}`}>{STATUS_LABEL[task.status].label}</span></td>
                    <td>{task.plannedCompletionAt ? formatDay(task.plannedCompletionAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>}
      </section>
    </ProjectFrame>
  );
}
