import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/finance/domain/approver_overview.dart';
import 'package:mobile/features/finance/domain/finance_models.dart';
import 'package:mobile/features/finance/domain/finance_rules.dart';
import 'package:mobile/features/finance/domain/finance_view.dart';
import 'finance_harness.dart';

final _now = DateTime(2026, 10, 8, 12);

FinanceRequest _req(
  String id,
  String status, {
  String kind = 'ADVANCE',
  String by = 'u-2',
  String amount = '10000.00',
  String? approved,
  String project = 'NP002',
  String? updated,
  Map<String, dynamic>? extra,
}) =>
    FinanceRequest.fromJson(record(id, status, kind: kind, amount: amount, approved: approved, created: isoOn(10, 1), extra: {
      'requesterId': by,
      'projectCode': project,
      'projectName': 'Project $project',
      'updatedAt': updated ?? isoOn(10, 8),
      ...?extra,
    }));

FinanceRequest _paid(String id, {String by = 'u-2', String outstanding = '10000.00', String due = '2026-10-12', String project = 'NP002'}) => _req(id, 'PAID',
    by: by, approved: '10000.00', project: project, extra: {'settlementDueOn': due, 'balance': balance(outstanding, paid: '10000.00')});

const _fin = FinanceViewer(id: 'u-fin', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_payment.record']);
const _dir = FinanceViewer(id: 'u-dir', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_approval.director']);
const _pm = FinanceViewer(id: 'u-pm', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_approval.pm', 'finance_request.create']);

void main() {
  group('roles', () {
    test('paying outranks directing outranks managing', () {
      expect(approverRoleOf(_fin), ApproverRole.finance);
      expect(approverRoleOf(_dir), ApproverRole.projectDirector);
      expect(approverRoleOf(_pm), ApproverRole.projectManager);
      expect(approverRoleOf(const FinanceViewer(id: 'x', permissions: ['finance_approval.pm', 'finance_approval.director'])), ApproverRole.projectDirector);
    });
  });

  group('ageDays', () {
    test('counts calendar days since the request last moved', () {
      expect(ageDays(_req('a', 'PENDING_PM', updated: isoOn(10, 8)), _now), 0);
      expect(ageDays(_req('a', 'PENDING_PM', updated: isoOn(10, 7)), _now), 1);
      expect(ageDays(_req('a', 'PENDING_PM', updated: isoOn(10, 3)), _now), 5);
      expect(ageLabel(0), 'Today');
      expect(ageLabel(1), '1 day');
      expect(ageLabel(3), '3 days');
    });
  });

  group('settlement balance', () {
    final advance = _paid('a1', outstanding: '18000.00');
    final advances = {'a1': advance};
    FinanceRequest settle(String amount) => _req('s', 'PENDING_FINANCE', kind: 'SETTLEMENT', amount: amount, approved: amount, extra: {'advanceId': 'a1'});

    test('says what to return, what is owed, or that it is fully used', () {
      expect(settlementHint(settle('17250.00'), advances), 'Return NPR 750');
      expect(settlementHint(settle('19800.00'), advances), 'Excess NPR 1,800');
      expect(settlementHint(settle('18000.00'), advances), 'Fully utilised');
    });
    test('says nothing when the advance is not known', () {
      expect(settlementHint(settle('100.00'), const {}), '');
    });
  });

  group('Finance overview', () {
    final advance = _paid('a1', outstanding: '18000.00');
    final queue = [
      _req('q1', 'PENDING_FINANCE', approved: '25000.00', amount: '25000.00', updated: isoOn(10, 6)),
      _req('q2', 'PENDING_FINANCE', kind: 'REIMBURSEMENT', approved: '3800.00', amount: '3800.00', updated: isoOn(10, 7)),
      _req('q3', 'PENDING_FINANCE', kind: 'SETTLEMENT', approved: '17250.00', amount: '17250.00', updated: isoOn(10, 7), extra: {'advanceId': 'a1'}),
      _req('q4', 'PENDING_FINANCE', kind: 'SETTLEMENT', approved: '19800.00', amount: '19800.00', updated: isoOn(10, 8), extra: {'advanceId': 'a1'}),
    ];
    final o = buildApproverOverview(queue: queue, scope: [advance, ...queue], viewerId: 'u-fin', role: ApproverRole.finance, monthKey: '2026-10', now: _now);

    test('totals what to pay out: advances, reimbursements and the excess on settlements', () {
      expect(o.hero.label, 'To pay out');
      expect(o.hero.total, 'NPR 30,600'); // 25,000 + 3,800 + 1,800 excess
      expect(o.hero.count, '4 requests ready · oldest 2 days');
      expect(o.hero.stats.map((s) => s.value), ['NPR 25,000', 'NPR 3,800', '2 to close']);
      expect(o.hero.stats.last.sub, 'NPR 750 to receive');
    });
    test('lists the oldest first', () {
      expect(o.preview.map((v) => v.request.id), ['q1', 'q2', 'q3']);
    });
  });

  group('manager and director overview', () {
    final queue = [
      _req('q1', 'PENDING_PM', amount: '12500.00', updated: isoOn(10, 8)),
      _req('q2', 'PENDING_PM', kind: 'REIMBURSEMENT', amount: '2400.00', updated: isoOn(10, 5)),
    ];
    test('words the hero for the role and splits it by kind', () {
      final pm = buildApproverOverview(queue: queue, scope: queue, viewerId: 'u-pm', role: ApproverRole.projectManager, monthKey: '2026-10', now: _now);
      expect(pm.hero.label, 'Waiting for your approval');
      expect(pm.hero.total, 'NPR 14,900');
      expect(pm.hero.stats.map((s) => '${s.label} ${s.value} ${s.sub}'), ['Advances NPR 12,500 1 waiting', 'Settlements NPR 0 0 waiting', 'Reimburse NPR 2,400 1 waiting']);
      final dir = buildApproverOverview(queue: queue, scope: queue, viewerId: 'u-dir', role: ApproverRole.projectDirector, monthKey: '2026-10', now: _now);
      expect(dir.hero.label, 'Waiting for director approval');
    });
  });

  group('cash with engineers and overdue', () {
    final scope = [
      _paid('a1', by: 'u-2', due: '2026-10-04', outstanding: '30000.00'),
      _paid('a2', by: 'u-2', due: '2026-10-14', outstanding: '8500.00'),
      _paid('a3', by: 'u-3', due: '2026-10-12', outstanding: '10000.00'),
      _paid('own', by: 'u-pm', due: '2026-10-01', outstanding: '5000.00'),
      _req('s3', 'PENDING_PM', kind: 'SETTLEMENT', by: 'u-3', extra: {'advanceId': 'a3'}),
    ];
    final o = buildApproverOverview(queue: const [], scope: scope, viewerId: 'u-pm', role: ApproverRole.projectManager, monthKey: '2026-10', now: _now);

    test('groups open advances by engineer, biggest first, leaving out the viewer\'s own', () {
      expect(o.cash.map((c) => c.requesterId), ['u-2', 'u-3']);
      expect(o.cash.first.total, 3850000);
      expect(o.cash.first.open, 2);
      expect(o.cash.first.overdue, 1);
      expect(o.cash.last.inReview, isTrue);
      expect(o.cashTotal, 4850000);
    });
    test('flags only advances past their day with nothing under review, and never the viewer\'s own', () {
      expect(o.overdue.map((v) => v.request.id), ['a1']);
      expect(o.overdueTotal, 3000000);
    });
  });

  group('by project', () {
    test('counts this month\'s live requests, split into paid and still in approval', () {
      final scope = [
        _req('a', 'PAID', approved: '10000.00', project: 'NP002'),
        _req('b', 'PENDING_PM', amount: '4000.00', project: 'NP002'),
        _req('c', 'PENDING_DIRECTOR', amount: '9000.00', project: 'NP003'),
        _req('d', 'REJECTED', amount: '99999.00', project: 'NP003'),
        _req('e', 'PENDING_PM', kind: 'SETTLEMENT', amount: '5000.00', project: 'NP002', extra: {'advanceId': 'a'}),
      ];
      final o = buildApproverOverview(queue: const [], scope: scope, viewerId: 'u-pm', role: ApproverRole.projectManager, monthKey: '2026-10', now: _now);
      expect(o.projects.map((p) => (p.code, p.total, p.paid)), [('NP002', 1400000, 1000000), ('NP003', 900000, 0)]);
    });
  });

  group('history filters', () {
    final mine = _req('m', 'PAID', by: 'u-pm', approved: '1000.00', extra: {'settlementDueOn': '2026-10-12'});
    final open = _paid('o');
    final paidReimbursement = _req('r', 'PAID', kind: 'REIMBURSEMENT', approved: '500.00');
    final all = [mine, open, paidReimbursement, _req('p', 'PENDING_PM'), _req('x', 'RETURNED'), _req('y', 'REJECTED')];
    List<String> ids(String f) => [for (final r in all) if (matchesHistoryFilter(f, viewOf(r, all, _now), 'u-pm')) r.id];

    test('apply the design\'s chips, plus Mine', () {
      expect(ids('All'), hasLength(6));
      expect(ids('In approval'), ['p']);
      expect(ids('Open advances'), ['m', 'o']);
      expect(ids('Paid & settled'), ['r']);
      expect(ids('Returned'), ['x']);
      expect(ids('Rejected'), ['y']);
      expect(ids('Mine'), ['m']);
    });
  });
}
