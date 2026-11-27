import { NextResponse } from 'next/server';
import { getFinanceOverview } from '../../../lib/finance-api';
import { getPortfolio } from '../../../lib/project-api';
import { getWorkOrderSummary } from '../../../lib/work-order-api';
import { kathmanduToday } from '../../../overview/engineer-money';
import { portfolioReport, reportCsv } from '../../../reports/report-model';

/**
 * The portfolio report as CSV: the same rows and columns as the report page's
 * detail table. It reads the session cookie server-side, as the other
 * downloads do, and a service that does not answer leaves its columns blank.
 */
export async function GET() {
  const [portfolio, workOrders, finance] = await Promise.all([getPortfolio(), getWorkOrderSummary(), getFinanceOverview()]);
  if (portfolio.state === 'unauthenticated') return NextResponse.json({ message: 'Sign in to download this file.' }, { status: 401 });
  if (portfolio.state === 'forbidden') return NextResponse.json({ message: 'You need access to project reports to download this.' }, { status: 403 });
  if (portfolio.state !== 'ready') return NextResponse.json({ message: 'The report could not be generated.' }, { status: 503 });

  const now = new Date();
  const report = portfolioReport(
    portfolio.data,
    workOrders.state === 'ready' ? workOrders.data : null,
    finance.state === 'ready' ? finance.data : null,
    now,
  );
  // A byte-order mark so Excel reads the file as UTF-8.
  return new NextResponse(`﻿${reportCsv(report)}`, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="portfolio-report-${kathmanduToday(now)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
