import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/domain/models/auth_user.dart';
import 'package:mobile/features/finance/domain/finance_models.dart';
import 'package:mobile/features/finance/presentation/advance_form_screen.dart';
import 'package:mobile/features/finance/presentation/expenses_form_screen.dart';
import 'package:mobile/features/finance/presentation/finance_screen.dart';
import 'package:mobile/features/finance/presentation/notifications_screen.dart';
import 'package:mobile/features/finance/presentation/request_detail_screen.dart';
import 'package:mobile/features/finance/presentation/statement_screen.dart';

import 'finance_harness.dart';

const _pm = AuthUser(id: 'u-pm', email: 'pm@ipms.local', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_approval.pm']);
const _director = AuthUser(id: 'u-dir', email: 'd@ipms.local', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_approval.director']);
const _finance = AuthUser(id: 'u-fin', email: 'f@ipms.local', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_payment.record']);

String _today(int plusDays) {
  final d = DateTime.now().add(Duration(days: plusDays));
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

Map<String, dynamic> _open(String id, {int due = 4, String purpose = 'Cable trays', String approved = '25000.00'}) => record(
      id, 'PAID',
      purpose: purpose, approved: approved, created: DateTime.now().toUtc().toIso8601String(),
      extra: {'settlementDueOn': _today(due), 'balance': balance(approved, paid: approved)},
    );

/// The page's own list, not the scrollables inside its text fields.
Finder _page() => find.descendant(of: find.byType(ListView), matching: find.byType(Scrollable)).first;
Finder _tab() => find.descendant(of: find.byType(SingleChildScrollView), matching: find.byType(Scrollable)).first;

/// Lets a button's request go out and come back, then redraws.
Future<void> afterAction(WidgetTester tester) async {
  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
  await tester.pump(const Duration(milliseconds: 500));
  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
  await tester.pump();
}

Future<void> scrollTo(WidgetTester tester, Finder f, {Finder? within}) async {
  await tester.scrollUntilVisible(f, 200, scrollable: within ?? _page());
  await tester.ensureVisible(f);
  await tester.pump();
}

void main() {
  late FinanceServer server;
  setUp(() => server = FinanceServer());

  group('the Finance tab', () {
    testWidgets('opens on the overview: this month\'s advances, split by where they stand', (tester) async {
      phoneScreen(tester);
      server.list = [
        _open('a1', purpose: 'Cable trays'),
        record('a2', 'PENDING_PM', amount: '6000.00', created: DateTime.now().toUtc().toIso8601String()),
      ];
      await tester.pumpWidget(financeApp(server, const FinanceScreen()));
      await settleNetwork(tester);

      expect(find.text('Finance'), findsOneWidget);
      expect(find.text('Total advance this month'), findsOneWidget);
      expect(find.text('NPR 31,000'), findsWidgets);
      expect(find.text('2 advances · ${monthName()}'), findsOneWidget);
      expect(find.text('NPR 25,000'), findsWidgets); // to settle
      expect(find.text('NPR 6,000'), findsWidgets); // in approval
      expect(find.text('Request advance'), findsOneWidget);
      expect(find.text('Submit settlement'), findsOneWidget);
      expect(find.text('Export statement'), findsOneWidget);
    });

    testWidgets('lists what is still to settle, with the days left, and settles from there', (tester) async {
      phoneScreen(tester);
      server.list = [_open('a1', due: 4, purpose: 'Cable trays')];
      await tester.pumpWidget(financeApp(server, const FinanceScreen()));
      await settleNetwork(tester);

      await scrollTo(tester, find.text('To settle').last, within: _tab());
      expect(find.text('4 days left'), findsOneWidget);
      await tester.tap(find.widgetWithText(OutlinedButton, 'Settle'));
      await tester.pumpAndSettle();

      expect(find.text('Submit settlement'), findsWidgets);
      expect(find.text('Linked advance'), findsOneWidget);
      expect(find.textContaining('NPR 25,000.00 received'), findsOneWidget);
    });

    testWidgets('warns about an overdue settlement and offers to settle it now', (tester) async {
      phoneScreen(tester);
      server.list = [_open('a1', due: -3, purpose: 'Earthing materials')];
      await tester.pumpWidget(financeApp(server, const FinanceScreen()));
      await settleNetwork(tester);

      expect(find.text('Settlement overdue'), findsOneWidget);
      expect(find.textContaining('NPR 25,000 was due on'), findsOneWidget);
      await tester.tap(find.text('Settle now'));
      await tester.pumpAndSettle();
      expect(find.text('Earthing materials'), findsOneWidget); // the linked advance
    });

    testWidgets('shows no warning when nothing is overdue', (tester) async {
      phoneScreen(tester);
      server.list = [_open('a1', due: 3)];
      await tester.pumpWidget(financeApp(server, const FinanceScreen()));
      await settleNetwork(tester);
      expect(find.text('Settlement overdue'), findsNothing);
    });

    testWidgets('moves between months with the arrows', (tester) async {
      phoneScreen(tester);
      server.list = [
        record('a1', 'PENDING_PM', amount: '6000.00', created: DateTime.now().toUtc().toIso8601String()),
        record('a9', 'PENDING_PM', amount: '900.00', created: DateTime(DateTime.now().year, DateTime.now().month - 1, 10, 10).toUtc().toIso8601String()),
      ];
      await tester.pumpWidget(financeApp(server, const FinanceScreen()));
      await settleNetwork(tester);
      expect(find.text('NPR 6,000'), findsWidgets);

      await tester.tap(find.byIcon(Icons.chevron_left_rounded).first);
      await tester.pump();
      expect(find.text('NPR 900'), findsWidgets);
    });

    testWidgets('the Records tab searches and filters', (tester) async {
      phoneScreen(tester);
      server.list = [
        record('a1', 'PENDING_PM', purpose: 'Traffic fine', created: DateTime.now().toUtc().toIso8601String()),
        record('a2', 'RETURNED', purpose: 'Harness replacement', created: DateTime.now().toUtc().toIso8601String()),
        record('a3', 'DRAFT', purpose: 'Ladder', created: DateTime.now().toUtc().toIso8601String()),
      ];
      await tester.pumpWidget(financeApp(server, const FinanceScreen()));
      await settleNetwork(tester);
      await tester.tap(find.text('Records'));
      await tester.pump();

      expect(find.text('3 records'), findsOneWidget);
      await tester.ensureVisible(find.byKey(const Key('filter-Returned')));
      await tester.tap(find.byKey(const Key('filter-Returned')));
      await tester.pump();
      expect(find.text('1 record'), findsOneWidget);
      expect(find.text('Harness replacement'), findsOneWidget);

      await tester.ensureVisible(find.byKey(const Key('filter-All')));
      await tester.tap(find.byKey(const Key('filter-All')));
      await tester.pump();
      await tester.enterText(find.byKey(const Key('finance-search')), 'ladder');
      await tester.pump();
      expect(find.text('1 record'), findsOneWidget);
      expect(find.text('Ladder'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('finance-search')), 'zzz');
      await tester.pump();
      expect(find.text('No records match.'), findsOneWidget);
    });

    testWidgets('a project on the overview opens its records', (tester) async {
      phoneScreen(tester);
      server.list = [_open('a1', purpose: 'Cable trays')];
      await tester.pumpWidget(financeApp(server, const FinanceScreen()));
      await settleNetwork(tester);
      await scrollTo(tester, find.text('By project'), within: _tab());
      await tester.tap(find.textContaining('Koshi rollout'));
      await tester.pump();
      expect(find.text('1 record'), findsOneWidget);
    });

    testWidgets('the New sheet offers an advance, a settlement and a reimbursement', (tester) async {
      phoneScreen(tester);
      server.list = [_open('a1')];
      await tester.pumpWidget(financeApp(server, const FinanceScreen()));
      await settleNetwork(tester);
      await tester.tap(find.text('New'));
      await tester.pumpAndSettle();

      expect(find.text('Create new'), findsOneWidget);
      expect(find.text('Advance request'), findsOneWidget);
      expect(find.text('Settlement'), findsOneWidget);
      expect(find.text('1 paid advance waiting'), findsOneWidget);
      expect(find.text('Reimbursement'), findsOneWidget);

      await tester.tap(find.text('Advance request'));
      await tester.pumpAndSettle();
      expect(find.text('Request advance'), findsWidgets);
      expect(find.text('Approval route'), findsOneWidget);
    });

    testWidgets('has no New button without permission to raise requests', (tester) async {
      phoneScreen(tester);
      const viewer = AuthUser(id: 'u-1', email: 'v@ipms.local', permissions: ['finance_request.view']);
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: viewer));
      await settleNetwork(tester);
      expect(find.text('New'), findsNothing);
    });

    testWidgets('shows how many notifications are unread, and no queue for an engineer', (tester) async {
      phoneScreen(tester);
      server.notifications = [
        {'id': 'n1', 'type': 'FINANCE_REQUEST_PAID', 'title': 'Advance paid', 'body': 'x', 'isRead': false, 'createdAt': '2026-10-09T05:00:00Z'},
        {'id': 'n2', 'type': 'FINANCE_REQUEST_RETURNED', 'title': 'Changes requested', 'body': 'y', 'isRead': false, 'createdAt': '2026-10-08T05:00:00Z'},
        {'id': 'n3', 'type': 'FINANCE_REQUEST_REJECTED', 'title': 'Rejected', 'body': 'z', 'isRead': true, 'createdAt': '2026-10-07T05:00:00Z'},
        {'id': 'n4', 'type': 'QC_SUBMISSION_APPROVED', 'title': 'QC approved', 'body': 'q', 'isRead': false, 'createdAt': '2026-10-07T05:00:00Z'},
      ];
      await tester.pumpWidget(financeApp(server, const FinanceScreen()));
      await settleNetwork(tester);
      expect(find.text('2'), findsOneWidget); // two unread finance ones; the QC one is not counted
      expect(find.textContaining('Approvals'), findsNothing);
    });

    testWidgets('an approver gets a queue of what waits on them', (tester) async {
      phoneScreen(tester);
      server.awaiting = [record('q1', 'PENDING_PM', purpose: 'Fuel for survey', extra: {'requesterId': 'u-2'}, created: DateTime.now().toUtc().toIso8601String())];
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: _pm));
      await settleNetwork(tester);

      await tester.tap(find.textContaining('Approvals'));
      await tester.pump();
      expect(find.text('Fuel for survey'), findsOneWidget);
      expect(find.textContaining('Sita Sharma'), findsOneWidget);
      expect(find.text('New'), findsNothing);
    });
  });

  group('a request\'s detail', () {
    testWidgets('a pending request can be cancelled', (tester) async {
      phoneScreen(tester);
      server.byId = {'p1': record('p1', 'PENDING_PM', extra: {
        'actions': [{'step': 'REQUESTER', 'action': 'SUBMITTED', 'actorId': 'u-1', 'revision': 1, 'at': '2026-10-05T05:00:00Z'}],
      })};
      await tester.pumpWidget(financeApp(server, const RequestDetailScreen(requestId: 'p1')));
      await settleNetwork(tester);

      expect(find.text('With project manager'), findsWidgets);
      expect(find.text('Waiting for project manager'), findsOneWidget);
      expect(find.text('Progress'), findsOneWidget);
      await tester.tap(find.text('Cancel request'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Cancel request'));
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
      await tester.pump();
      expect(server.posts('/p1/cancel'), hasLength(1));
    });

    testWidgets('a returned request shows why and offers to edit and resubmit', (tester) async {
      phoneScreen(tester);
      server.byId = {'r1': record('r1', 'RETURNED', extra: {
        'actions': [
          {'step': 'REQUESTER', 'action': 'SUBMITTED', 'actorId': 'u-1', 'revision': 1, 'at': '2026-10-05T05:00:00Z'},
          {'step': 'PM', 'action': 'RETURNED', 'actorId': 'u-pm', 'comment': 'Attach the quotation', 'revision': 1, 'at': '2026-10-06T05:00:00Z'},
        ],
      })};
      await tester.pumpWidget(financeApp(server, const RequestDetailScreen(requestId: 'r1')));
      await settleNetwork(tester);

      expect(find.text('Edit and resubmit'), findsOneWidget);
      expect(find.text('Returned for changes'), findsOneWidget);
      await scrollTo(tester, find.text('Comments'));
      expect(find.text('Attach the quotation'), findsOneWidget);
      expect(find.textContaining('Rajesh Shrestha'), findsWidgets);
    });

    testWidgets('a draft can be edited or submitted', (tester) async {
      phoneScreen(tester);
      server.byId = {'d1': record('d1', 'DRAFT')};
      await tester.pumpWidget(financeApp(server, const RequestDetailScreen(requestId: 'd1')));
      await settleNetwork(tester);
      expect(find.text('Edit draft'), findsOneWidget);
      await tester.tap(find.text('Submit'));
      await tester.pump();
      await afterAction(tester);
      expect(server.posts('/d1/submit'), hasLength(1));
    });

    testWidgets('a paid advance shows its balance and settle-by day, and offers settlement', (tester) async {
      phoneScreen(tester);
      server.byId = {'a1': record('a1', 'PAID', approved: '50000.00', extra: {'settlementDueOn': _today(-2), 'balance': balance('50000.00', paid: '50000.00')})};
      await tester.pumpWidget(financeApp(server, const RequestDetailScreen(requestId: 'a1')));
      await settleNetwork(tester);

      expect(find.text('Settle this advance'), findsOneWidget);
      expect(find.text('Settlement overdue by 2 days'), findsOneWidget);
      await scrollTo(tester, find.text('Outstanding'));
      expect(find.text('Outstanding'), findsOneWidget);
      await scrollTo(tester, find.text('Settle by'));
      expect(find.textContaining('2 days late'), findsOneWidget);
    });

    testWidgets('a settlement shows the advance, what was spent, the VAT and the balance returned', (tester) async {
      phoneScreen(tester);
      server.byId = {
        's1': record('s1', 'SETTLED', kind: 'SETTLEMENT', amount: '17250.00', approved: '17250.00', purpose: 'Survey vehicle hire', extra: {
          'advanceId': 'a3', 'appliedAmount': '17250.00',
          'invoices': [
            {'vendor': 'Jeep hire, 3 days', 'invoiceDate': '2026-10-02', 'amount': '15000.00', 'vat': true, 'supplierTaxNo': '301', 'invoiceNumber': 'B-77', 'mediaId': 'm-1'},
            {'vendor': 'Fuel top-up', 'invoiceDate': '2026-10-03', 'amount': '2250.00', 'vat': false},
          ],
        }),
        'a3': record('a3', 'PAID', approved: '18000.00', extra: {'balance': balance('0.00', status: 'CLOSED')}),
      };
      await tester.pumpWidget(financeApp(server, const RequestDetailScreen(requestId: 's1')));
      await settleNetwork(tester);
      await settleNetwork(tester); // the advance is read once the settlement names it

      expect(find.text('Advance received'), findsOneWidget);
      expect(find.text('NPR 18,000.00'), findsOneWidget);
      expect(find.text('Balance returned'), findsOneWidget);
      expect(find.text('NPR 750.00'), findsOneWidget);
      expect(find.text('NPR 1,725.66'), findsOneWidget); // VAT on the one VAT bill
      await scrollTo(tester, find.textContaining('VAT bill · 301'));
      expect(find.textContaining('VAT bill · 301'), findsOneWidget);
      expect(find.text('RECEIPT'), findsOneWidget);
      await scrollTo(tester, find.textContaining('Non-VAT'));
      expect(find.textContaining('Non-VAT'), findsOneWidget);
      expect(find.text('NO PHOTO'), findsOneWidget);
    });
  });

  group('approvals and payments', () {
    FinanceServer withRequest(Map<String, dynamic> r) => server..byId = {'abc': r};

    Future<void> tapButton(WidgetTester tester, Finder f) async {
      await scrollTo(tester, f);
      await tester.tap(f);
    }

    testWidgets('the director approves with a lower amount, never more than asked', (tester) async {
      phoneScreen(tester);
      withRequest(record('abc', 'PENDING_DIRECTOR', extra: {'requesterId': 'u-2'}));
      await tester.pumpWidget(financeApp(server, const RequestDetailScreen(requestId: 'abc'), user: _director));
      await settleNetwork(tester);
      await tapButton(tester, find.widgetWithText(ElevatedButton, 'Approve'));
      await tester.pumpAndSettle();

      await tester.enterText(find.widgetWithText(TextField, 'Approved amount (NPR)'), '60000');
      await tester.pump();
      expect(find.text('Cannot be more than NPR 50,000.00'), findsOneWidget);
      expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Approve').last).onPressed, isNull);

      await tester.enterText(find.widgetWithText(TextField, 'Approved amount (NPR)'), '45000');
      await tester.enterText(find.widgetWithText(TextField, 'Note (optional)'), 'Within budget');
      await tester.pump();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Approve').last);
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
      await tester.pump();
      expect(server.posts('/abc/approve').single.data, {'amount': '45000', 'comment': 'Within budget'});
    });

    testWidgets('the project manager approves without an amount field', (tester) async {
      phoneScreen(tester);
      withRequest(record('abc', 'PENDING_PM', extra: {'requesterId': 'u-2'}));
      await tester.pumpWidget(financeApp(server, const RequestDetailScreen(requestId: 'abc'), user: _pm));
      await settleNetwork(tester);
      await tapButton(tester, find.widgetWithText(ElevatedButton, 'Approve'));
      await tester.pumpAndSettle();
      expect(find.text('Approved amount (NPR)'), findsNothing);
    });

    testWidgets('returning needs a reason', (tester) async {
      phoneScreen(tester);
      withRequest(record('abc', 'PENDING_PM', extra: {'requesterId': 'u-2'}));
      await tester.pumpWidget(financeApp(server, const RequestDetailScreen(requestId: 'abc'), user: _pm));
      await settleNetwork(tester);
      await tapButton(tester, find.text('Return to requester'));
      await tester.pumpAndSettle();
      expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Return to requester')).onPressed, isNull);
      await tester.enterText(find.byType(TextField), 'Attach the quotation');
      await tester.pump();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Return to requester'));
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
      await tester.pump();
      expect(server.posts('/abc/return').single.data, {'comment': 'Attach the quotation'});
    });

    testWidgets('finance records a payment with its details', (tester) async {
      phoneScreen(tester);
      withRequest(record('abc', 'PENDING_FINANCE', approved: '45000.00', extra: {'requesterId': 'u-2'}));
      await tester.pumpWidget(financeApp(server, const RequestDetailScreen(requestId: 'abc'), user: _finance));
      await settleNetwork(tester);
      await tapButton(tester, find.widgetWithText(ElevatedButton, 'Record payment'));
      await tester.pumpAndSettle();
      expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Record payment').last).onPressed, isNull);

      await tester.tap(find.text('How was it paid?'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Bank transfer').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Reference'), 'TXN-1001');
      await tester.pump();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Record payment').last);
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
      await tester.pump();
      final data = server.posts('/abc/pay').single.data as Map<String, dynamic>;
      expect(data['mode'], 'BANK_TRANSFER');
      expect(data['reference'], 'TXN-1001');
    });

    testWidgets('finance records returned cash against an advance', (tester) async {
      phoneScreen(tester);
      withRequest(record('abc', 'PAID', extra: {'requesterId': 'u-2', 'balance': balance('50000.00', paid: '50000.00')}));
      await tester.pumpWidget(financeApp(server, const RequestDetailScreen(requestId: 'abc'), user: _finance));
      await settleNetwork(tester);
      await tapButton(tester, find.text('Record returned cash'));
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Amount returned (NPR)'), '1500.50');
      await tester.tap(find.text('How was it paid?'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cash').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Reference'), 'RCPT-7');
      await tester.pump();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Record cash return'));
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
      await tester.pump();
      final data = server.posts('/advances/abc/cash-return').single.data as Map<String, dynamic>;
      expect(data['amount'], '1500.50');
      expect(data['mode'], 'CASH');
    });
  });

  group('the advance form', () {
    testWidgets('asks for what is missing, in red, and sends nothing', (tester) async {
      phoneScreen(tester);
      await tester.pumpWidget(financeApp(server, const AdvanceFormScreen()));
      await settleNetwork(tester);
      await tester.tap(find.text('Submit for approval'));
      await tester.pump();

      expect(find.text('Complete the highlighted fields'), findsOneWidget);
      expect(find.text('Choose a project'), findsOneWidget);
      expect(find.text('Choose a category'), findsOneWidget);
      expect(find.text('Add a short title'), findsOneWidget);
      expect(server.posts('/requests'), isEmpty);
    });

    testWidgets('saves an advance and sends it for approval', (tester) async {
      phoneScreen(tester);
      server.byId = {'new-1': record('new-1', 'PENDING_PM')};
      await tester.pumpWidget(financeApp(server, const AdvanceFormScreen()));
      await settleNetwork(tester);

      await tester.tap(find.text('KOS'));
      await tester.pump();
      expect(find.text('Retired'), findsNothing); // a disabled category is not offered
      await tester.tap(find.text('Travel'));
      await tester.pump();
      await tester.enterText(find.byType(TextField).first, 'Fuel for the survey');
      await tester.enterText(find.byType(TextField).last, '25000.50');
      await tester.pump();
      await tester.tap(find.text('Submit for approval'));
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
      await tester.pump();

      final create = server.calls.firstWhere((c) => c.method == 'POST' && c.path == '/api/v1/finance/requests');
      expect(create.data, {'kind': 'ADVANCE', 'projectId': 'p-1', 'categoryId': 'c-1', 'purpose': 'Fuel for the survey', 'amount': '25000.50'});
      expect(server.posts('/new-1/submit'), hasLength(1));
    });

    testWidgets('a draft is saved without being submitted', (tester) async {
      phoneScreen(tester);
      server.byId = {'new-1': record('new-1', 'DRAFT')};
      await tester.pumpWidget(financeApp(server, const AdvanceFormScreen()));
      await settleNetwork(tester);
      await tester.tap(find.text('KOS'));
      await tester.pump();
      await tester.tap(find.text('Travel'));
      await tester.pump();
      await tester.enterText(find.byType(TextField).first, 'Ladder');
      await tester.enterText(find.byType(TextField).last, '7500');
      await tester.pump();
      await tester.tap(find.text('Save draft'));
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
      await tester.pump();
      expect(server.calls.where((c) => c.method == 'POST' && c.path == '/api/v1/finance/requests'), hasLength(1));
      expect(server.posts('/submit'), isEmpty);
    });

    testWidgets('a returned advance shows the reviewer\'s note and is resubmitted with edits', (tester) async {
      phoneScreen(tester);
      final returned = FinanceRequest.fromJson(record('r1', 'RETURNED', purpose: 'Safety harness', amount: '9000.00', extra: {
        'actions': [{'step': 'PM', 'action': 'RETURNED', 'actorId': 'u-pm', 'comment': 'Attach the supplier quote', 'revision': 1, 'at': '2026-10-06T05:00:00Z'}],
      }));
      server.byId = {'r1': record('r1', 'PENDING_PM')};
      await tester.pumpWidget(financeApp(server, AdvanceFormScreen(initial: returned)));
      await settleNetwork(tester);

      expect(find.textContaining('Attach the supplier quote'), findsOneWidget);
      expect(find.text('Resubmit'), findsOneWidget);
      await tester.enterText(find.byType(TextField).last, '8500');
      await tester.pump();
      await tester.tap(find.text('Resubmit'));
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
      await tester.pump();

      final patch = server.calls.firstWhere((c) => c.method == 'PATCH');
      expect(patch.data, {'categoryId': 'c-1', 'purpose': 'Safety harness', 'amount': '8500'});
      expect(server.posts('/r1/submit'), hasLength(1));
    });
  });

  group('the settlement form', () {
    FinanceRequest paidAdvance() => FinanceRequest.fromJson(_open('a1', purpose: 'Cable trays'));

    testWidgets('shows the advance and the balance to return as expenses are entered', (tester) async {
      phoneScreen(tester);
      await tester.pumpWidget(financeApp(server, ExpensesFormScreen(kind: RequestKind.settlement, advance: paidAdvance())));
      await settleNetwork(tester);

      expect(find.text('Cable trays'), findsOneWidget);
      expect(find.text('EXPENSE 1'), findsOneWidget);
      await tester.enterText(find.widgetWithText(TextField, '0').first, '3000');
      await tester.pump();
      await scrollTo(tester, find.text('Balance to return'));
      expect(find.text('Balance to return'), findsOneWidget);
      expect(find.text('NPR 22,000'), findsWidgets);
    });

    testWidgets('says excess to claim when more was spent than was advanced', (tester) async {
      phoneScreen(tester);
      await tester.pumpWidget(financeApp(server, ExpensesFormScreen(kind: RequestKind.settlement, advance: paidAdvance())));
      await settleNetwork(tester);
      await tester.enterText(find.widgetWithText(TextField, '0').first, '26000');
      await tester.pump();
      await scrollTo(tester, find.text('Excess to claim'));
      expect(find.text('Excess to claim'), findsOneWidget);
      expect(find.textContaining('paid back to you'), findsOneWidget);
    });

    testWidgets('a VAT bill asks for the supplier number and works out the VAT inside the amount', (tester) async {
      phoneScreen(tester);
      await tester.pumpWidget(financeApp(server, ExpensesFormScreen(kind: RequestKind.settlement, advance: paidAdvance())));
      await settleNetwork(tester);
      await tester.enterText(find.widgetWithText(TextField, '0').first, '3000');
      await tester.pump();

      expect(find.text('Supplier PAN/VAT no.'), findsNothing);
      await scrollTo(tester, find.text('VAT bill'));
      await tester.tap(find.text('VAT bill'));
      await tester.pump();
      expect(find.text('Supplier PAN/VAT no.'), findsOneWidget);
      expect(find.text('Invoice no.'), findsOneWidget);
      expect(find.textContaining('NPR 345.13', findRichText: true), findsOneWidget); // 3000 x 13 / 113
    });

    testWidgets('will not go until every expense has a receipt, and says which', (tester) async {
      phoneScreen(tester);
      await tester.pumpWidget(financeApp(server, ExpensesFormScreen(kind: RequestKind.settlement, advance: paidAdvance())));
      await settleNetwork(tester);
      await tester.enterText(find.widgetWithText(TextField, 'What did you pay for?'), 'Jeep hire');
      await tester.enterText(find.widgetWithText(TextField, '0').first, '3000');
      await tester.pump();
      await tester.tap(find.text('Submit settlement').last);
      await tester.pump();
      expect(find.text('Complete the highlighted fields'), findsOneWidget);
      expect(server.posts('/requests'), isEmpty);
    });

    testWidgets('lets you choose the advance when none was passed, soonest due first', (tester) async {
      phoneScreen(tester);
      server.list = [_open('a1', purpose: 'Cable trays', due: 5), _open('a2', purpose: 'Generator diesel', due: -2, approved: '8500.00')];
      await tester.pumpWidget(financeApp(server, const ExpensesFormScreen(kind: RequestKind.settlement)));
      await settleNetwork(tester);

      expect(find.text('Overdue 2 days'), findsOneWidget);
      expect(find.text('5 days left'), findsOneWidget);
      expect(tester.getTopLeft(find.text('Generator diesel')).dy, lessThan(tester.getTopLeft(find.text('Cable trays')).dy));
      await tester.tap(find.text('Cable trays'));
      await tester.pump();
      expect(find.textContaining('NPR 25,000.00 received'), findsOneWidget);
      expect(find.text('Change'), findsOneWidget);
      await tester.tap(find.text('Change'));
      await tester.pump();
      expect(find.text('Generator diesel'), findsOneWidget);
    });

    testWidgets('a returned settlement is resubmitted with its VAT bills and receipts intact', (tester) async {
      phoneScreen(tester);
      final returned = FinanceRequest.fromJson(record('s1', 'RETURNED', kind: 'SETTLEMENT', amount: '17250.00', purpose: 'Cable trays', extra: {
        'advanceId': 'a1',
        'invoices': [
          {'vendor': 'Jeep hire', 'invoiceDate': '2026-10-02', 'amount': '15000.00', 'vat': true, 'supplierTaxNo': '301', 'invoiceNumber': 'B-77', 'mediaId': 'm-1'},
          {'vendor': 'Fuel', 'invoiceDate': '2026-10-03', 'amount': '2250.00', 'mediaId': 'm-2'},
        ],
      }));
      server.byId = {'s1': record('s1', 'PENDING_PM', kind: 'SETTLEMENT'), 'a1': _open('a1')};
      await tester.pumpWidget(financeApp(server, ExpensesFormScreen(kind: RequestKind.settlement, initial: returned)));
      await settleNetwork(tester);

      expect(find.text('EXPENSE 2'), findsOneWidget);
      await tester.tap(find.text('Submit settlement').last);
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
      await tester.pump();

      final patch = server.calls.firstWhere((c) => c.method == 'PATCH');
      final invoices = (patch.data as Map<String, dynamic>)['invoices'] as List;
      expect(invoices[0], {
        'mediaId': 'm-1', 'vendor': 'Jeep hire', 'invoiceNumber': 'B-77', 'invoiceDate': '2026-10-02', 'amount': '15000.00',
        'vat': true, 'supplierTaxNo': '301',
      });
      expect(invoices[1], {'mediaId': 'm-2', 'vendor': 'Fuel', 'invoiceDate': '2026-10-03', 'amount': '2250.00'});
      expect(server.posts('/s1/submit'), hasLength(1));
    });

    testWidgets('a reimbursement asks for the project, category and title first', (tester) async {
      phoneScreen(tester);
      await tester.pumpWidget(financeApp(server, const ExpensesFormScreen(kind: RequestKind.reimbursement)));
      await settleNetwork(tester);
      expect(find.text('New reimbursement'), findsOneWidget);
      expect(find.text('Project / site'), findsOneWidget);
      await tester.tap(find.text('Submit reimbursement'));
      await tester.pump();
      expect(find.text('Choose a project'), findsOneWidget);
      expect(find.text('Choose a category'), findsOneWidget);
    });
  });

  group('notifications', () {
    testWidgets('list the feed, open a request and mark it read', (tester) async {
      phoneScreen(tester);
      server.notifications = [
        {'id': 'n1', 'type': 'FINANCE_REQUEST_RETURNED', 'title': 'Changes requested', 'body': 'Rajesh Shrestha on ADV-1: attach the quote.',
         'actionUrl': '/finance/requests/0192f7a0-0000-7000-8000-000000000003', 'isRead': false, 'createdAt': DateTime.now().toUtc().toIso8601String()},
        {'id': 'n2', 'type': 'FINANCE_REQUEST_PAID', 'title': 'Advance paid', 'body': 'Finance disbursed NPR 25,000.', 'isRead': true, 'createdAt': '2026-10-01T05:00:00Z'},
        {'id': 'n3', 'type': 'QC_SUBMISSION_APPROVED', 'title': 'QC approved', 'body': 'not finance', 'isRead': false, 'createdAt': '2026-10-01T05:00:00Z'},
      ];
      server.byId = {'0192f7a0-0000-7000-8000-000000000003': record('0192f7a0-0000-7000-8000-000000000003', 'RETURNED')};
      await tester.pumpWidget(financeApp(server, const NotificationsScreen()));
      await settleNetwork(tester);

      expect(find.text('Changes requested'), findsOneWidget);
      expect(find.text('Advance paid'), findsOneWidget);
      expect(find.text('QC approved'), findsNothing);
      expect(find.text('Just now'), findsOneWidget);

      await tester.tap(find.text('Changes requested'));
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 700)));
      await tester.pump();
      expect(server.posts('/n1/read'), hasLength(1));
      expect(find.text('Edit and resubmit'), findsOneWidget); // the request opened
    });

    testWidgets('mark all read', (tester) async {
      phoneScreen(tester);
      server.notifications = [
        {'id': 'n1', 'type': 'FINANCE_REQUEST_PAID', 'title': 'Advance paid', 'body': 'x', 'isRead': false, 'createdAt': '2026-10-01T05:00:00Z'},
      ];
      await tester.pumpWidget(financeApp(server, const NotificationsScreen()));
      await settleNetwork(tester);
      await tester.pump(const Duration(milliseconds: 100));
      await tester.tap(find.text('Mark all read'));
      await tester.pump();
      await afterAction(tester);
      expect(server.posts('/read-all'), hasLength(1));
    });

    testWidgets('say so when there is nothing', (tester) async {
      phoneScreen(tester);
      await tester.pumpWidget(financeApp(server, const NotificationsScreen()));
      await settleNetwork(tester);
      expect(find.textContaining('Nothing yet'), findsOneWidget);
    });
  });

  group('the statement', () {
    testWidgets('totals a month, lists its transactions and can be exported', (tester) async {
      phoneScreen(tester);
      final now = DateTime.now().toUtc().toIso8601String();
      server.list = [
        record('a3', 'PAID', approved: '18000.00', created: now, extra: {'balance': balance('0.00', status: 'CLOSED', paid: '18000.00')}),
        record('a1', 'PAID', approved: '25000.00', created: now, extra: {'balance': balance('25000.00', paid: '25000.00')}),
        record('s1', 'SETTLED', kind: 'SETTLEMENT', amount: '17250.00', approved: '17250.00', created: now, extra: {'advanceId': 'a3', 'appliedAmount': '17250.00'}),
      ];
      await tester.pumpWidget(financeApp(server, const StatementScreen()));
      await settleNetwork(tester);

      expect(find.text('Field Engineer · Field Engineer'), findsOneWidget);
      expect(find.text('Employee ID FE-0418'), findsOneWidget);
      expect(find.text('Advances received'), findsOneWidget);
      expect(find.text('NPR 43,000'), findsOneWidget);
      expect(find.text('NPR 17,250'), findsWidgets);
      expect(find.text('NPR 750'), findsOneWidget); // balance returned
      expect(find.text('Outstanding to settle'), findsOneWidget);
      await scrollTo(tester, find.text('3 transactions'));
      expect(find.text('3 transactions'), findsOneWidget);
      expect(find.text('Export PDF'), findsOneWidget);
    });
  });
}

String monthName() {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return names[DateTime.now().month - 1];
}
