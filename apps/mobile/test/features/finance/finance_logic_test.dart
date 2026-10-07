import 'package:flutter/painting.dart' show Color;
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/finance/domain/finance_models.dart';
import 'package:mobile/features/finance/domain/finance_overview.dart';
import 'package:mobile/features/finance/domain/finance_rules.dart';
import 'package:mobile/features/finance/domain/finance_statement.dart';
import 'package:mobile/features/finance/domain/finance_view.dart';
import 'package:mobile/features/finance/presentation/notifications_screen.dart';
import 'package:mobile/features/finance/presentation/request_detail_screen.dart';

import 'finance_harness.dart';

FinanceRequest req(String id, String status, {String kind = 'ADVANCE', Map<String, dynamic>? extra, String? created, String amount = '1000.00', String? approved}) =>
    FinanceRequest.fromJson(record(id, status, kind: kind, extra: extra, created: created ?? isoOn(10, 4), amount: amount, approved: approved));

final DateTime now = DateTime(2026, 10, 10, 9);

void main() {
  group('money', () {
    test('is formatted with Indian grouping and two decimals', () {
      expect(formatMoney('150000'), 'NPR 1,50,000.00');
      expect(formatMoney('1500.5'), 'NPR 1,500.50');
      expect(formatMoney(null), '—');
    });

    test('is summed in whole paisa, not floating point', () {
      expect(sumMoney(['0.10', '0.20']), '0.30');
      expect(sumMoney(['1500.50', '499.5', '1']), '2001.00');
      expect(sumMoney([]), '0.00');
    });

    test('is accepted only as the server accepts it', () {
      for (final ok in ['1', '50000', '1500.5', '0.01']) {
        expect(isValidMoney(ok), isTrue, reason: ok);
      }
      for (final bad in ['', '0', '0.00', '-5', '12.345', '1,000', 'abc', '01']) {
        expect(isValidMoney(bad), isFalse, reason: bad);
      }
    });

    test('shows whole rupees on the overview', () {
      expect(formatRupees(2500000), 'NPR 25,000');
      expect(formatRupees(15000050), 'NPR 1,50,001'); // rounds at the paisa
      expect(formatRupees(0), 'NPR 0');
    });
  });

  group('VAT', () {
    test('is the 13% inside an amount that includes it, to the paisa', () {
      expect(vatIncluded('113'), '13.00');
      expect(vatIncluded('15000'), '1725.66');
      expect(vatIncluded('2250'), '258.85');
      expect(vatIncluded('0.50'), '0.06');
      expect(vatIncluded('0'), '0.00');
    });

    test('rides on an invoice only when it is a VAT bill', () {
      final bill = RequestInvoice.fromJson({'vendor': 'Hardware', 'invoiceDate': '2026-10-01', 'amount': '113.00', 'vat': true, 'supplierTaxNo': '301'});
      final plain = RequestInvoice.fromJson({'vendor': 'Bus', 'invoiceDate': '2026-10-01', 'amount': '113.00'});
      expect(bill.vatAmount, '13.00');
      expect(plain.vatAmount, '0.00');
      expect(plain.invoiceNumber, isNull);
    });

    test('is sent as the server takes it: number and tax number only when given', () {
      final bill = RequestInvoice(vendor: ' Hardware ', invoiceDate: DateTime(2026, 10, 1), amount: '113.00', vat: true, supplierTaxNo: ' 301 ', invoiceNumber: '');
      expect(bill.toJson(), {'vendor': 'Hardware', 'invoiceDate': '2026-10-01', 'amount': '113.00', 'vat': true, 'supplierTaxNo': '301'});
      final plain = RequestInvoice(vendor: 'Bus', invoiceDate: DateTime(2026, 10, 1), amount: '50', supplierTaxNo: '301', mediaId: 'm-1');
      expect(plain.toJson(), {'mediaId': 'm-1', 'vendor': 'Bus', 'invoiceDate': '2026-10-01', 'amount': '50'});
    });
  });

  group('a request', () {
    test('reads the reviewer comment of the last return', () {
      final r = req('abc', 'RETURNED', extra: {
        'actions': [
          {'step': 'REQUESTER', 'action': 'SUBMITTED', 'at': '2026-10-01T05:00:00Z', 'revision': 1},
          {'step': 'PM', 'action': 'RETURNED', 'comment': 'Attach the quotation', 'at': '2026-10-02T05:00:00Z', 'revision': 1},
        ],
      });
      expect(r.lastReviewComment, 'Returned by the project manager: Attach the quotation');
    });

    test('says what the requester may do', () {
      expect(req('a', 'DRAFT').isEditable('u-1'), isTrue);
      expect(req('a', 'RETURNED').isEditable('u-1'), isTrue);
      expect(req('a', 'PENDING_PM').isEditable('u-1'), isFalse);
      expect(req('a', 'PENDING_PM').canCancel('u-1'), isTrue);
      expect(req('a', 'PENDING_PM').canCancel('u-2'), isFalse);
      expect(req('a', 'PAID').canSettle, isTrue);
      expect(req('a', 'PAID', extra: {'balance': balance('0.00', status: 'CLOSED')}).canSettle, isFalse);
    });
  });

  group('settlement window', () {
    FinanceRequest advance({String? due, String status = 'PAID'}) =>
        req('abc', 'PAID', extra: {'settlementDueOn': due, 'balance': balance('1000.00', status: status)});

    test('is a due day, in time up to and including it', () {
      final r = advance(due: '2026-10-14');
      expect(r.settlementDueOn, DateTime(2026, 10, 14));
      expect(r.settlementWindow(DateTime(2026, 10, 10, 9))!.label, 'Settle by 14 Oct 2026');
      expect(r.settlementWindow(DateTime(2026, 10, 14, 23, 59))!.overdue, isFalse);
    });

    test('is overdue from the day after, and counts the days late', () {
      final w = advance(due: '2026-10-14').settlementWindow(DateTime(2026, 10, 17, 8))!;
      expect(w.overdue, isTrue);
      expect(w.label, 'Overdue since 14 Oct 2026');
      expect(w.daysLate, 3);
    });

    test('is off the clock for a closed advance, or one with no due day', () {
      expect(advance(due: '2026-10-14', status: 'CLOSED').settlementWindow(DateTime(2026, 11, 1)), isNull);
      expect(advance().settlementWindow(DateTime(2026, 11, 1)), isNull);
    });
  });

  group('stage', () {
    test('reads each status as the engineer thinks of it', () {
      final all = <FinanceRequest>[];
      Stage of(String status, {String kind = 'ADVANCE', Map<String, dynamic>? extra}) => stageOf(req('x', status, kind: kind, extra: extra), all);
      expect(of('DRAFT'), Stage.draft);
      expect(of('PENDING_PM'), Stage.pm);
      expect(of('PENDING_DIRECTOR'), Stage.director);
      expect(of('PENDING_FINANCE'), Stage.admin);
      expect(of('RETURNED'), Stage.returned);
      expect(of('REJECTED'), Stage.rejected);
      expect(of('CANCELLED'), Stage.cancelled);
      expect(of('SETTLED', kind: 'SETTLEMENT'), Stage.settled);
      expect(of('PAID', extra: {'balance': balance('500.00')}), Stage.paid);
    });

    test('a paid advance is settled once nothing is outstanding, though the service still says PAID', () {
      expect(stageOf(req('a', 'PAID', extra: {'balance': balance('0.00', status: 'CLOSED')}), const []), Stage.settled);
    });

    test('a paid advance with a settlement waiting on approval is "in review"', () {
      final advance = req('a', 'PAID', extra: {'balance': balance('500.00')});
      final settlement = req('s', 'PENDING_PM', kind: 'SETTLEMENT', extra: {'advanceId': 'a'});
      expect(stageOf(advance, [advance, settlement]), Stage.review);
      final rejected = req('s2', 'REJECTED', kind: 'SETTLEMENT', extra: {'advanceId': 'a'});
      expect(stageOf(advance, [advance, rejected]), Stage.paid);
    });
  });

  group('the line under the amount', () {
    test('says how long a paid advance has, in colour', () {
      RecordView view(String due) => viewOf(req('a', 'PAID', extra: {'settlementDueOn': due, 'balance': balance('1.00')}), const [], now);
      final soon = view('2026-10-14');
      expect(soon.hint, 'Settle by 14 Oct 2026');
      expect(soon.daysLeft, 4);
      expect(soon.hintColor, const Color(0xFF3A3FB0));
      expect(view('2026-10-11').hintColor, const Color(0xFF9A5B00)); // a day or two left
      final late = view('2026-10-08');
      expect(late.hint, 'Settlement overdue by 2 days');
      expect(late.isOverdue, isTrue);
      expect(late.hintColor, const Color(0xFFB4372A));
      expect(view('2026-10-09').hint, 'Settlement overdue by 1 day');
    });

    test('says who has it, or what is wanted', () {
      String hint(String status, {String kind = 'ADVANCE'}) => viewOf(req('a', status, kind: kind), const [], now).hint;
      expect(hint('DRAFT'), 'Not submitted');
      expect(hint('PENDING_PM'), 'Waiting for project manager');
      expect(hint('PENDING_DIRECTOR'), 'Waiting for project director');
      expect(hint('PENDING_FINANCE'), 'Waiting for finance to disburse');
      expect(hint('RETURNED'), 'Changes requested');
      expect(hint('PENDING_PM', kind: 'SETTLEMENT'), 'Waiting for project manager');
    });

    test('says what a settled settlement claimed beyond its advance', () {
      final claimed = viewOf(req('s', 'SETTLED', kind: 'SETTLEMENT', amount: '3600.00', approved: '3600.00', extra: {'appliedAmount': '3200.00'}), const [], now);
      expect(claimed.hint, 'NPR 400.00 claimed');
      final even = viewOf(req('s', 'SETTLED', kind: 'SETTLEMENT', approved: '3200.00', extra: {'appliedAmount': '3200.00'}), const [], now);
      expect(even.hint, 'Closed');
    });
  });

  group('the overview', () {
    final records = [
      req('a1', 'PAID', created: isoOn(10, 4), approved: '25000.00', extra: {'settlementDueOn': '2026-10-14', 'balance': balance('25000.00')}),
      req('a2', 'PAID', created: isoOn(10, 2), approved: '15000.00', extra: {'settlementDueOn': '2026-10-09', 'balance': balance('15000.00')}),
      req('a3', 'PAID', created: isoOn(10, 1), approved: '18000.00', extra: {'balance': balance('0.00', status: 'CLOSED')}),
      req('a4', 'PENDING_PM', created: isoOn(10, 7), amount: '6000.00'),
      req('a5', 'DRAFT', created: isoOn(10, 7), amount: '7500.00'),
      req('a6', 'RETURNED', created: isoOn(10, 1), amount: '9000.00'),
      req('a7', 'PAID', created: isoOn(9, 10), approved: '2000.00', extra: {'balance': balance('2000.00'), 'settlementDueOn': '2026-09-17'}),
      req('s1', 'SETTLED', kind: 'SETTLEMENT', created: isoOn(10, 6), amount: '17250.00', approved: '17250.00', extra: {'advanceId': 'a3', 'appliedAmount': '17250.00', 'vatAmount': '1984.51'}),
      req('s2', 'PENDING_PM', kind: 'SETTLEMENT', created: isoOn(10, 8), amount: '5000.00', extra: {'advanceId': 'a1'}),
    ];
    final o = buildOverview(records, '2026-10', now);

    test('totals the live advances of the month and splits them by where they stand', () {
      expect(o.counted, 4); // not the draft, the returned one, or September's
      expect(o.total, 6400000);
      expect(o.settled, 1800000);
      expect(o.toSettle, 4000000); // a1 in review, a2 paid
      expect(o.approval, 600000);
    });

    test('lists every open advance, soonest due first, whatever month it was raised', () {
      expect(o.outstanding.map((v) => v.request.id), ['a7', 'a2']); // a1 is in review
      expect(o.overdue.map((v) => v.request.id), ['a7', 'a2']);
      expect(o.outstandingTotal, 1700000);
    });

    test('adds up the month\'s settlements', () {
      expect(o.settlements.count, 2);
      expect(o.settlements.spent, 2225000);
      expect(o.settlements.vat, 198451);
      expect(o.settlements.returned, 75000 + 2000000); // a3 less s1, a1 less s2
      expect(o.settlements.claimed, 0);
    });

    test('shows the projects with their settled, open and approval shares', () {
      expect(o.byProject.single.code, 'KOS');
      expect(o.byProject.single.total, 6400000);
      expect(o.byProject.single.settled, 1800000);
      expect(o.byProject.single.open, 4000000);
      expect(o.byProject.single.approval, 600000);
    });

    test('has the latest three of the month as recent', () {
      expect(o.recent.length, 3);
    });

    test('lists the months that have anything, oldest first, and always this one', () {
      expect(monthsOf(records, now), ['2026-09', '2026-10']);
      expect(monthsOf(const [], now), ['2026-10']);
      expect(monthLabel('2026-10'), 'October 2026');
    });

    test('is empty, not broken, for a month with nothing', () {
      final empty = buildOverview(records, '2026-08', now);
      expect(empty.total, 0);
      expect(empty.byProject, isEmpty);
      expect(empty.recent, isEmpty);
    });
  });

  group('the statement', () {
    final records = [
      req('a1', 'PAID', created: isoOn(10, 4), approved: '25000.00', extra: {'balance': balance('25000.00')}),
      req('a3', 'PAID', created: isoOn(10, 1), approved: '18000.00', extra: {'balance': balance('0.00', status: 'CLOSED')}),
      req('a5', 'DRAFT', created: isoOn(10, 7), amount: '7500.00'),
      req('a8', 'PAID', created: isoOn(9, 4), approved: '3200.00', extra: {'balance': balance('0.00', status: 'CLOSED')}),
      req('s1', 'SETTLED', kind: 'SETTLEMENT', created: isoOn(10, 6), amount: '17250.00', approved: '17250.00', extra: {'advanceId': 'a3', 'appliedAmount': '17250.00'}),
      req('s8', 'SETTLED', kind: 'SETTLEMENT', created: isoOn(9, 10), amount: '3600.00', approved: '3600.00', extra: {'advanceId': 'a8', 'appliedAmount': '3200.00'}),
    ];

    test('adds up a month', () {
      final s = buildStatement(records, '2026-10', now);
      expect(s.received, 4300000);
      expect(s.spent, 1725000);
      expect(s.returned, 75000);
      expect(s.claimed, 0);
      expect(s.outstanding, 2500000);
      expect(s.rows.map((v) => v.request.id).toSet(), {'a1', 'a3', 's1'}); // no drafts
    });

    test('adds up all time, with what was claimed', () {
      final s = buildStatement(records, 'all', now);
      expect(s.received, 4620000);
      expect(s.spent, 2085000);
      expect(s.claimed, 40000);
      expect(s.rows.length, 5);
    });
  });

  group('the viewer\'s buttons', () {
    const pm = FinanceViewer(id: 'u-pm', permissions: ['finance_request.view_all', 'finance_approval.pm']);
    const director = FinanceViewer(id: 'u-dir', permissions: ['finance_request.view_all', 'finance_approval.director']);
    const finance = FinanceViewer(id: 'u-fin', permissions: ['finance_request.view_all', 'finance_payment.record']);
    const me = FinanceViewer(id: 'u-1', permissions: ['finance_request.view', 'finance_request.create', 'finance_settlement.submit']);
    FinanceRequest theirs(String status, {Map<String, dynamic>? extra}) => req('abc', status, extra: {'requesterId': 'u-2', ...?extra});
    const decide = [FinanceAction.approve, FinanceAction.returnToRequester, FinanceAction.reject];

    test('the right person is offered the right step', () {
      expect(availableActions(theirs('PENDING_PM'), pm), decide);
      expect(availableActions(theirs('PENDING_PM'), director), isEmpty);
      expect(availableActions(theirs('PENDING_DIRECTOR'), director), decide);
      expect(availableActions(theirs('PENDING_FINANCE'), finance), [FinanceAction.pay, FinanceAction.returnToRequester, FinanceAction.reject]);
      expect(availableActions(theirs('PENDING_PM'), me), isEmpty);
    });

    test('the requester edits, cancels and settles their own', () {
      expect(availableActions(req('a', 'DRAFT'), me), [FinanceAction.edit, FinanceAction.submit]);
      expect(availableActions(req('a', 'PENDING_PM'), me), [FinanceAction.cancel]);
      expect(availableActions(req('a', 'PAID', extra: {'balance': balance('5.00')}), me), [FinanceAction.settle]);
      expect(availableActions(req('a', 'PAID', extra: {'balance': balance('0.00', status: 'CLOSED')}), me), isEmpty);
    });

    test('nobody acts on two steps of one revision', () {
      final approvedByFinance = theirs('PENDING_FINANCE', extra: {
        'actions': [
          {'step': 'DIRECTOR', 'action': 'APPROVED', 'actorId': 'u-fin', 'revision': 1, 'at': '2026-10-02T05:00:00Z'},
        ],
      });
      expect(availableActions(approvedByFinance, finance), isEmpty);
    });

    test('finance takes returned cash on an open paid advance only', () {
      expect(availableActions(theirs('PAID', extra: {'balance': balance('100.00')}), finance), [FinanceAction.cashReturn]);
      expect(availableActions(theirs('PAID', extra: {'balance': balance('0.00', status: 'CLOSED')}), finance), isEmpty);
    });
  });

  group('progress', () {
    FinanceRequest withHistory(String status, List<Map<String, dynamic>> actions, {String kind = 'ADVANCE', Map<String, dynamic>? extra}) =>
        req('abc', status, kind: kind, extra: {'actions': actions, ...?extra});
    Map<String, dynamic> act(String step, String action, {String actor = 'u-pm', String? comment}) =>
        {'step': step, 'action': action, 'actorId': actor, 'revision': 1, 'at': '2026-10-05T05:00:00Z', 'comment': comment};
    const names = {'u-pm': 'Rajesh Shrestha', 'u-dir': 'Anita Rai'};

    test('walks an advance from submitted to settlement, marking what is done', () {
      final r = withHistory('PAID', [act('REQUESTER', 'SUBMITTED', actor: 'u-1'), act('PM', 'APPROVED'), act('DIRECTOR', 'APPROVED', actor: 'u-dir'), act('FINANCE', 'PAID', actor: 'u-fin')],
          extra: {'settlementDueOn': '2026-10-14', 'balance': balance('1.00')});
      final steps = progressSteps(r, Stage.paid, names);
      expect(steps.map((s) => s.title), ['Submitted', 'Project manager approval', 'Project director approval', 'Finance disbursal', 'Settlement']);
      expect(steps.map((s) => s.done), [true, true, true, true, false]);
      expect(steps.last.current, isTrue);
      expect(steps[1].sub, 'Rajesh Shrestha · 5 Oct');
      expect(steps.last.sub, 'Due 14 Oct 2026');
    });

    test('shows a return at the step that returned it', () {
      final r = withHistory('RETURNED', [act('REQUESTER', 'SUBMITTED', actor: 'u-1'), act('PM', 'RETURNED', comment: 'Attach the quote')]);
      final steps = progressSteps(r, Stage.returned, names);
      final bad = steps.firstWhere((s) => s.error);
      expect(bad.title, 'Returned for changes');
    });

    test('leaves out the manager step for a request a manager raised', () {
      final r = withHistory('PENDING_DIRECTOR', [act('REQUESTER', 'SUBMITTED', actor: 'u-pm')]);
      final steps = progressSteps(r, Stage.director, names);
      expect(steps.map((s) => s.title), ['Submitted', 'Project director approval', 'Finance disbursal', 'Settlement']);
      expect(steps[1].current, isTrue);
    });

    test('closes every step of a settled advance', () {
      final r = withHistory('PAID', [act('REQUESTER', 'SUBMITTED', actor: 'u-1'), act('PM', 'APPROVED'), act('DIRECTOR', 'APPROVED'), act('FINANCE', 'PAID')],
          extra: {'balance': balance('0.00', status: 'CLOSED')});
      final steps = progressSteps(r, Stage.settled, names);
      expect(steps.every((s) => s.done), isTrue);
      expect(steps.last.sub, 'Closed');
    });
  });

  group('notifications', () {
    test('link to the request they are about', () {
      final n = FinanceNotification.fromJson({
        'id': 'n1', 'type': 'FINANCE_REQUEST_RETURNED', 'title': 'Changes requested', 'body': 'x',
        'actionUrl': '/finance/requests/0192f7a0-0000-7000-8000-000000000003', 'isRead': false, 'createdAt': '2026-10-09T05:00:00Z',
      });
      expect(n.requestId, '0192f7a0-0000-7000-8000-000000000003');
      expect(n.isFinance, isTrue);
      expect(n.tone, 'warn');
    });

    test('colour their dot by what happened, and tell finance ones from the rest', () {
      String tone(String type) => FinanceNotification.fromJson({'type': type, 'createdAt': '2026-10-09T05:00:00Z'}).tone;
      expect(tone('FINANCE_REQUEST_REJECTED'), 'err');
      expect(tone('FINANCE_REQUEST_PAID'), 'ok');
      expect(FinanceNotification.fromJson({'type': 'QC_SUBMISSION_APPROVED', 'createdAt': '2026-10-09T05:00:00Z'}).isFinance, isFalse);
    });

    test('say when in plain words', () {
      final at = DateTime(2026, 10, 10, 9, 0);
      expect(whenText(DateTime(2026, 10, 10, 8, 59, 40), at), 'Just now');
      expect(whenText(DateTime(2026, 10, 10, 8, 30), at), '30 min ago');
      expect(whenText(DateTime(2026, 10, 10, 7, 0), at), '2h ago');
      expect(whenText(DateTime(2026, 10, 9, 20, 0), at), 'Yesterday');
      expect(whenText(DateTime(2026, 10, 7, 12, 0), at), '3 days ago');
      expect(whenText(DateTime(2026, 9, 20, 12, 0), at), '20 Sep');
    });
  });
}
