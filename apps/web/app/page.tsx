import { redirect } from 'next/navigation';
import { getCurrentUser, hasPermission } from './lib/iam-api';
import { AdminOverview } from './overview/admin-overview';
import { DirectorOverview } from './overview/director-overview';
import { EngineerOverview } from './overview/engineer-overview';
import { ManagerOverview } from './overview/manager-overview';
import { homeFor } from './overview/model';
import { QcOverview } from './overview/qc-overview';

/**
 * One address, six homes, chosen by role: managers land on their decision
 * queue, QC on the review desk, Project Directors on their portfolio, Finance on the finance
 * workspace, engineers on their own work, and everyone else (administrators
 * included) on the organisation overview. Which home is a view
 * choice, never a boundary — every one reads through the gateway as the
 * signed-in person.
 */
export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ log?: string; decided?: string }> }) {
  const viewer = await getCurrentUser();
  switch (viewer.state === 'ready' ? homeFor(viewer.data.roles) : 'admin') {
    case 'manager': return <ManagerOverview />;
    case 'director': return <DirectorOverview decided={(await searchParams).decided} />;
    case 'qc': return <QcOverview />;
    case 'finance': redirect('/finance?view=awaiting');
    case 'engineer': return <EngineerOverview canViewFinance={viewer.state === 'ready' && hasPermission(viewer.data, 'finance_request.view')} />;
    default: return <AdminOverview searchParams={searchParams} />;
  }
}
