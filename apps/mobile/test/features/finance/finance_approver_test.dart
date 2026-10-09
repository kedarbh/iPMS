import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/auth/domain/models/auth_user.dart';
import 'package:mobile/features/finance/presentation/finance_screen.dart';
import 'finance_harness.dart';

const _pm = AuthUser(
  id: 'u-pm',
  email: 'pm@ipms.local',
  displayName: 'Rajesh Shrestha',
  permissions: ['finance_request.view', 'finance_request.view_all', 'finance_request.create', 'finance_settlement.submit', 'finance_approval.pm'],
);
const _finance = AuthUser(
  id: 'u-fin',
  email: 'f@ipms.local',
  displayName: 'Sunita Karki',
  permissions: ['finance_request.view', 'finance_request.view_all', 'finance_payment.record'],
);

String _day(int plusDays) {
  final d = DateTime.now().add(Duration(days: plusDays));
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

String _now() => DateTime.now().toUtc().toIso8601String();

Map<String, dynamic> _queued(String id, String status, {String kind = 'ADVANCE', String by = 'u-2', String purpose = 'Cable trays', String amount = '25000.00', Map<String, dynamic>? extra}) =>
    record(id, status, kind: kind, purpose: purpose, amount: amount, approved: status == 'PENDING_FINANCE' ? amount : null, created: _now(), extra: {'requesterId': by, 'updatedAt': _now(), ...?extra});

Map<String, dynamic> _paidAdvance(String id, {String by = 'u-2', int due = 4, String outstanding = '10000.00', Map<String, dynamic>? extra}) =>
    record(id, 'PAID', purpose: 'Generator diesel', amount: '10000.00', approved: '10000.00', created: _now(), extra: {
      'requesterId': by,
      'settlementDueOn': _day(due),
      'balance': balance(outstanding, paid: '10000.00'),
      ...?extra,
    });

Finder _tab(String label) => find.byKey(Key('segment-$label'));

/// The dashboard loads in two waves: the lists, then what they lead to.
Future<void> _load(WidgetTester tester) async {
  await settleNetwork(tester);
  await settleNetwork(tester);
}

/// Chips scroll sideways, so bring one into view before tapping it.
Future<void> _tap(WidgetTester tester, Finder f) async {
  await tester.ensureVisible(f);
  await tester.pump();
  await tester.tap(f);
  await tester.pump();
}

void main() {
  late FinanceServer server;
  setUp(() => server = FinanceServer());

  group('Finance', () {
    testWidgets('opens on an overview of what waits for payment, under the name and role', (tester) async {
      phoneScreen(tester);
      server.awaiting = [_queued('q1', 'PENDING_FINANCE'), _queued('q2', 'PENDING_FINANCE', kind: 'REIMBURSEMENT', amount: '3800.00', purpose: 'First aid kit')];
      server.scope = [...server.awaiting];
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: _finance));
      await _load(tester);

      expect(find.text('Sunita Karki · Finance'), findsOneWidget);
      expect(find.text('To pay out'), findsOneWidget);
      expect(tester.widget<Text>(find.byKey(const Key('approver-hero-total'))).data, 'NPR 28,800');
      expect(find.text('Queue · 2'), findsOneWidget);
      expect(find.text('New'), findsNothing);
      expect(find.text('Waiting for you'), findsOneWidget);
      expect(find.text('Cable trays'), findsOneWidget);
    });

    testWidgets('the queue filters by kind and opens a request', (tester) async {
      phoneScreen(tester);
      server.awaiting = [_queued('q1', 'PENDING_FINANCE'), _queued('q2', 'PENDING_FINANCE', kind: 'REIMBURSEMENT', amount: '3800.00', purpose: 'First aid kit')];
      server.scope = [...server.awaiting];
      server.byId = {'q2': server.awaiting[1]};
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: _finance));
      await _load(tester);

      await tester.tap(_tab('Queue · 2'));
      await tester.pump();
      expect(find.text('Cable trays'), findsOneWidget);
      expect(find.text('First aid kit'), findsOneWidget);
      expect(find.text('2 waiting · NPR 28,800'), findsOneWidget);

      await _tap(tester, find.text('Reimbursements 1'));
      expect(find.text('Cable trays'), findsNothing);
      expect(find.text('First aid kit'), findsOneWidget);
      expect(find.text('1 waiting · NPR 3,800'), findsOneWidget);
    });

    testWidgets('an overdue advance shows the banner, and Remind engineers sends a reminder', (tester) async {
      phoneScreen(tester);
      server.scope = [_paidAdvance('a1', due: -3, outstanding: '30000.00')];
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: _finance));
      await _load(tester);

      expect(find.text('1 settlement overdue'), findsOneWidget);
      expect(find.textContaining('NPR 30,000 with Sita Sharma'), findsOneWidget);
      expect(find.text('Cash with engineers'), findsOneWidget);
      await tester.tap(find.byKey(const Key('remind-engineers')));
      await tester.pump();
      await afterAction(tester);

      expect(server.posts('/advances/a1/remind'), hasLength(1));
      expect(find.text('Reminder sent to Sita'), findsOneWidget);
    });

    testWidgets('history holds what the viewer handled, and open advances, but not what is still upstream', (tester) async {
      phoneScreen(tester);
      final taxi = _queued('h1', 'PENDING_DIRECTOR', by: 'u-1', purpose: 'Taxi fare', kind: 'REIMBURSEMENT', amount: '2400.00');
      server.handled = [taxi];
      server.scope = [
        _paidAdvance('a1', by: 'u-2'),
        taxi,
        _queued('up1', 'PENDING_PM', by: 'u-1', purpose: 'Hotel stay', amount: '14000.00'),
        _queued('other1', 'REJECTED', by: 'u-1', purpose: 'Team lunch', amount: '4500.00'),
      ];
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: _finance));
      await _load(tester);

      await tester.tap(_tab('History'));
      await tester.pump();
      expect(find.text('2 records'), findsOneWidget);
      expect(find.text('Taxi fare'), findsOneWidget);
      expect(find.text('Generator diesel'), findsOneWidget);
      expect(find.text('Hotel stay'), findsNothing); // still with the project manager
      expect(find.text('Team lunch'), findsNothing); // never reached them

      await tester.enterText(find.byKey(const Key('finance-search')), 'sita');
      await tester.pump();
      expect(find.text('1 record'), findsOneWidget);
      expect(find.text('Generator diesel'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('finance-search')), '');
      await _tap(tester, find.byKey(const Key('filter-In-1')));
      expect(find.text('Taxi fare'), findsOneWidget);
      expect(find.text('Generator diesel'), findsNothing);
    });
  });

  group('requests still on their way', () {
    final upstream = [
      _queued('p1', 'PENDING_PM', purpose: 'Hotel stay', amount: '14000.00', extra: {'updatedAt': DateTime.now().subtract(const Duration(days: 2)).toUtc().toIso8601String()}),
      _queued('d1', 'PENDING_DIRECTOR', purpose: 'Scaffolding hire', amount: '42000.00'),
      _queued('f1', 'PENDING_FINANCE', purpose: 'Cable trays'),
    ];

    testWidgets('Finance sees what is still with the manager and the director, and where it stands', (tester) async {
      phoneScreen(tester);
      server.awaiting = [upstream[2]];
      server.scope = upstream;
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: _finance));
      await _load(tester);

      expect(find.byKey(const Key('on-its-way')), findsOneWidget);
      expect(find.text('On its way to you'), findsOneWidget);
      expect(find.text('2 · NPR 56,000'), findsOneWidget);
      expect(find.text('1 with the project director'), findsOneWidget);

      expect(find.text('1 with the project manager'), findsOneWidget);
      expect(find.text('Hotel stay'), findsNothing); // the purpose shares a line with the requester
      expect(find.textContaining('Hotel stay', findRichText: true), findsOneWidget);
      expect(find.text('Then project director, then you · waiting 2 days'), findsOneWidget);
      expect(find.text('Reaches you after the project director · since today'), findsOneWidget);
      expect(find.text('Cable trays'), findsOneWidget); // the one actually waiting, in the queue preview

      await tester.tap(_tab('History'));
      await tester.pump();
      expect(find.text('On its way'), findsNothing);
      expect(find.text('0 records'), findsOneWidget); // none of it is history until they act on it
      expect(find.text('Hotel stay'), findsNothing);
    });

    testWidgets('the director only waits on the manager', (tester) async {
      phoneScreen(tester);
      const director = AuthUser(id: 'u-dir', email: 'd@ipms.local', displayName: 'Hari Adhikari', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_approval.director']);
      server.scope = upstream;
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: director));
      await _load(tester);
      expect(find.text('1 · NPR 14,000'), findsOneWidget);
      expect(find.text('1 with the project manager'), findsOneWidget);
      expect(find.textContaining('project director', findRichText: true), findsNothing);
    });

    testWidgets('a project manager has no On its way card or filter', (tester) async {
      phoneScreen(tester);
      server.scope = upstream;
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: _pm));
      await _load(tester);
      expect(find.byKey(const Key('on-its-way')), findsNothing);
    });
  });

  group('a project manager\'s own requests', () {
    testWidgets('sit in one card, with a way to raise one and to settle an open advance', (tester) async {
      phoneScreen(tester);
      server.awaiting = [_queued('q1', 'PENDING_PM', purpose: 'Taxi fare')];
      server.scope = [...server.awaiting];
      server.list = [_paidAdvance('mine1', by: 'u-pm', due: 3, outstanding: '10000.00')];
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: _pm));
      await _load(tester);

      expect(find.text('Rajesh Shrestha · Project manager'), findsOneWidget);
      expect(find.text('Waiting for your approval'), findsOneWidget);
      expect(find.text('New'), findsNothing); // the header has no New button; raising is in the card
      final card = find.byKey(const Key('own-requests'));
      await tester.scrollUntilVisible(card, 300, scrollable: find.byType(Scrollable).first);
      await tester.pump();
      expect(find.text('Your own requests'), findsOneWidget);
      expect(find.text('Raise a request'), findsOneWidget);
      expect(find.byKey(const Key('settle-mine1')), findsOneWidget);
    });

    testWidgets('a manager with nothing open is told so', (tester) async {
      phoneScreen(tester);
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: _pm));
      await _load(tester);
      final card = find.byKey(const Key('own-requests'));
      await tester.scrollUntilVisible(card, 300, scrollable: find.byType(Scrollable).first);
      expect(find.text('You have no advances or settlements open.'), findsOneWidget);
    });

    testWidgets('a person who raises nothing and has nothing sees no card', (tester) async {
      phoneScreen(tester);
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: _finance));
      await _load(tester);
      expect(find.byKey(const Key('own-requests')), findsNothing);
    });

    testWidgets('are listed in History under Mine', (tester) async {
      phoneScreen(tester);
      server.handled = [_queued('q1', 'PENDING_DIRECTOR', purpose: 'Taxi fare', kind: 'REIMBURSEMENT', amount: '2400.00')];
      server.list = [_paidAdvance('mine1', by: 'u-pm')];
      await tester.pumpWidget(financeApp(server, const FinanceScreen(), user: _pm));
      await _load(tester);

      await tester.tap(_tab('History'));
      await tester.pump();
      expect(find.text('2 records'), findsOneWidget);
      await _tap(tester, find.byKey(const Key('filter-Mine-6')));
      expect(find.text('1 record'), findsOneWidget);
      expect(find.text('Generator diesel'), findsOneWidget);
    });
  });
}
