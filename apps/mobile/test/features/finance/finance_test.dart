import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/network/api_client.dart';
import 'package:mobile/core/security/token_storage.dart';
import 'package:mobile/features/auth/domain/models/auth_user.dart';
import 'package:mobile/features/auth/providers/auth_provider.dart';
import 'package:mobile/features/finance/domain/finance_models.dart';
import 'package:mobile/features/finance/domain/finance_rules.dart';
import 'package:mobile/features/finance/presentation/finance_screen.dart';
import 'package:mobile/features/finance/presentation/request_detail_screen.dart';
import 'package:mobile/features/finance/presentation/request_form_screen.dart';

class _Finance implements HttpClientAdapter {
  final List<RequestOptions> calls = [];
  List<Map<String, dynamic>> list = [];
  List<Map<String, dynamic>> awaiting = [];
  Map<String, Map<String, dynamic>> byId = {};

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    calls.add(options);
    ResponseBody json(int status, Object body) => ResponseBody.fromString(jsonEncode(body), status,
        headers: {Headers.contentTypeHeader: [Headers.jsonContentType]});
    final path = options.path;
    if (path == '/api/v1/finance/requests' && options.method == 'GET') {
      final rows = options.queryParameters['view'] == 'awaiting' ? awaiting : list;
      return json(200, {'items': rows, 'total': rows.length, 'page': 1, 'limit': 100});
    }
    if (path == '/api/v1/finance/requests' && options.method == 'POST') {
      return json(201, {'id': 'new-1', 'number': 'ADV-2026-0009', 'kind': 'ADVANCE', 'status': 'DRAFT'});
    }
    if (path == '/api/v1/finance/categories') {
      return json(200, [
        {'id': 'c-1', 'code': 'TRAVEL', 'name': 'Travel', 'disabledAt': null},
        {'id': 'c-2', 'code': 'OLD', 'name': 'Retired', 'disabledAt': '2026-01-01T00:00:00Z'},
      ]);
    }
    if (path == '/api/v1/projects') {
      return json(200, [
        {'id': 'p-1', 'code': 'KOS', 'name': 'Koshi rollout', 'status': 'ACTIVE'},
      ]);
    }
    if (path == '/api/v1/users/directory') {
      return json(200, [
        {'id': 'u-1', 'fullName': 'Field Engineer'},
        {'id': 'u-2', 'fullName': 'Sita Sharma'},
      ]);
    }
    if (options.method == 'POST' && ['/submit', '/cancel', '/approve', '/return', '/reject', '/pay', '/cash-return'].any(path.endsWith)) {
      return json(200, {});
    }
    final id = path.split('/').last;
    if (byId.containsKey(id)) return json(200, byId[id]!);
    return json(404, {});
  }

  @override
  void close({bool force = false}) {}
}

Map<String, dynamic> request(String id, String status, {String kind = 'ADVANCE', Map<String, dynamic>? extra}) => {
      'id': id,
      'number': 'ADV-2026-000${id.length}',
      'kind': kind,
      'status': status,
      'revision': 1,
      'projectId': 'p-1',
      'projectCode': 'KOS',
      'projectName': 'Koshi rollout',
      'categoryId': 'c-1',
      'category': {'code': 'TRAVEL', 'name': 'Travel'},
      'requesterId': 'u-1',
      'purpose': 'Site visit to Ilam',
      'requestedAmount': '50000.00',
      'approvedAmount': null,
      'appliedAmount': null,
      'createdAt': '2026-10-01T04:00:00.000Z',
      'invoices': [],
      'actions': [],
      'payments': [],
      ...?extra,
    };

const _engineer = AuthUser(
  id: 'u-1',
  email: 'eng@ipms.local',
  displayName: 'Field Engineer',
  permissions: ['finance_request.view', 'finance_request.create', 'finance_settlement.submit'],
);

class _Auth extends AuthNotifier {
  _Auth(this.user);
  final AuthUser? user;

  @override
  Future<AuthUser?> build() async => user;
}

void main() {
  late _Finance server;

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    server = _Finance();
  });

  Widget app(Widget home, {AuthUser? user = _engineer}) {
    final api = ApiClient(
      tokenStorage: TokenStorage(),
      dio: Dio(BaseOptions(baseUrl: 'http://x'))..httpClientAdapter = server,
    );
    return ProviderScope(
      overrides: [
        apiClientProvider.overrideWithValue(api),
        authStateProvider.overrideWith(() => _Auth(user)),
      ],
      child: MaterialApp(home: home),
    );
  }

  Future<void> settle(WidgetTester tester) async {
    // Dio's replies need real async under the widget tester.
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
  }

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
  });

  group('a request', () {
    test('reads the reviewer comment of the last return', () {
      final r = FinanceRequest.fromJson(request('abc', 'RETURNED', extra: {
        'actions': [
          {'step': 'REQUESTER', 'action': 'SUBMITTED', 'at': '2026-10-01T05:00:00Z', 'revision': 1},
          {'step': 'PM', 'action': 'RETURNED', 'comment': 'Attach the quotation', 'at': '2026-10-02T05:00:00Z', 'revision': 1},
        ],
      }));
      expect(r.lastReviewComment, 'Returned by the project manager: Attach the quotation');
      expect(r.history.first.description, 'Submitted');
    });

    test('says what the requester may do', () {
      FinanceRequest r(String status, {Map<String, dynamic>? extra}) => FinanceRequest.fromJson(request('abc', status, extra: extra));
      expect(r('DRAFT').isEditable('u-1'), isTrue);
      expect(r('RETURNED').isEditable('u-1'), isTrue);
      expect(r('PENDING_PM').isEditable('u-1'), isFalse);
      expect(r('PENDING_PM').canCancel('u-1'), isTrue);
      expect(r('PENDING_PM').canCancel('u-2'), isFalse);
      expect(r('PAID').canSettle, isTrue);
      expect(r('PAID', extra: {'balance': {'status': 'CLOSED', 'outstanding': '0.00'}}).canSettle, isFalse);
      expect(r('DRAFT').canSettle, isFalse);
    });
  });

  group('settlement window', () {
    FinanceRequest advance({String? due, String balance = 'PAID'}) => FinanceRequest.fromJson(request('abc', 'PAID', extra: {
          'settlementDueOn': due,
          'balance': {'paid': '1000.00', 'applied': '0.00', 'cashReturned': '0.00', 'outstanding': '1000.00', 'status': balance},
        }));

    test('is a due day, in time up to and including it', () {
      final r = advance(due: '2026-10-14');
      expect(r.settlementDueOn, DateTime(2026, 10, 14));
      expect(r.settlementWindow(DateTime(2026, 10, 10, 9))!.label, 'Settle by 14 Oct 2026');
      final lastDay = r.settlementWindow(DateTime(2026, 10, 14, 23, 59))!;
      expect(lastDay.overdue, isFalse);
    });

    test('is overdue from the day after, and counts the days late', () {
      final w = advance(due: '2026-10-14').settlementWindow(DateTime(2026, 10, 17, 8))!;
      expect(w.overdue, isTrue);
      expect(w.label, 'Overdue since 14 Oct 2026');
      expect(w.daysLate, 3);
    });

    test('is off the clock for a closed advance, or one with no due day', () {
      expect(advance(due: '2026-10-14', balance: 'CLOSED').settlementWindow(DateTime(2026, 11, 1)), isNull);
      expect(advance().settlementWindow(DateTime(2026, 11, 1)), isNull);
    });

    testWidgets('the advance shows when to settle by, in red when late', (tester) async {
      final due = DateTime.now().add(const Duration(days: 3));
      final overdue = DateTime.now().subtract(const Duration(days: 2));
      String day(DateTime d) => '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
      server.byId = {
        'soon': request('soon', 'PAID', extra: {'settlementDueOn': day(due), 'balance': {'paid': '1.00', 'applied': '0.00', 'cashReturned': '0.00', 'outstanding': '1.00', 'status': 'PAID'}}),
      };
      await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'soon')));
      await settle(tester);
      expect(find.textContaining('Settle by'), findsOneWidget);

      server.byId = {
        'late': request('late', 'PAID', extra: {'settlementDueOn': day(overdue), 'balance': {'paid': '1.00', 'applied': '0.00', 'cashReturned': '0.00', 'outstanding': '1.00', 'status': 'PAID'}}),
      };
      await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'late')));
      await settle(tester);
      expect(find.textContaining('Overdue since'), findsOneWidget);
      expect(find.textContaining('2 days late'), findsOneWidget);
    });
  });

  testWidgets('the list shows my requests, filters them, and opens one', (tester) async {
    server.list = [request('aa', 'PENDING_PM'), request('bbb', 'PAID'), request('cccc', 'DRAFT')];
    server.byId = {'aa': request('aa', 'PENDING_PM')};
    await tester.pumpWidget(app(const FinanceScreen()));
    await settle(tester);

    expect(find.text('Site visit to Ilam'), findsNWidgets(3));
    expect(find.text('Waiting for the project manager'), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, 'Paid'));
    await tester.pump();
    expect(find.text('Site visit to Ilam'), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, 'Returned'));
    await tester.pump();
    expect(find.text('Nothing here'), findsOneWidget);
  });

  testWidgets('without the create permission there is no New button', (tester) async {
    const viewer = AuthUser(id: 'u-1', email: 'v@ipms.local', permissions: ['finance_request.view']);
    await tester.pumpWidget(app(const FinanceScreen(), user: viewer));
    await settle(tester);
    expect(find.text('New'), findsNothing);
  });

  testWidgets('a pending request can be cancelled, a returned one edited and resubmitted', (tester) async {
    server.byId = {'pend': request('pend', 'PENDING_PM'), 'ret': request('ret', 'RETURNED', extra: {
      'actions': [
        {'step': 'PM', 'action': 'RETURNED', 'comment': 'Attach the quotation', 'at': '2026-10-02T05:00:00Z', 'revision': 1},
      ],
    })};

    await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'pend')));
    await settle(tester);
    expect(find.text('Cancel request'), findsOneWidget);
    expect(find.text('Submit'), findsNothing);

    await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'ret')));
    await settle(tester);
    expect(find.text('Resubmit'), findsOneWidget);
    expect(find.text('Edit'), findsOneWidget);
    expect(find.textContaining('Attach the quotation'), findsWidgets);
  });

  testWidgets('a paid advance offers settlement, with its balance', (tester) async {
    server.byId = {
      'paid': request('paid', 'PAID', extra: {
        'approvedAmount': '50000.00',
        'balance': {'paid': '50000.00', 'applied': '0.00', 'cashReturned': '0.00', 'outstanding': '50000.00', 'status': 'PAID'},
      }),
    };
    await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'paid')));
    await settle(tester);
    expect(find.text('Settle with invoices'), findsOneWidget);
    expect(find.text('Outstanding'), findsOneWidget);
    expect(find.text('NPR 50,000.00'), findsWidgets);
  });

  testWidgets('an advance is saved and submitted with the server\'s fields', (tester) async {
    await tester.pumpWidget(app(const RequestFormScreen(kind: RequestKind.advance)));
    await settle(tester);

    await tester.tap(find.text('Project'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('KOS — Koshi rollout').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Category'));
    await tester.pumpAndSettle();
    expect(find.text('Retired'), findsNothing); // disabled categories are not offered
    await tester.tap(find.text('Travel').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'What is it for?'), 'Fuel for the survey');
    await tester.enterText(find.widgetWithText(TextField, 'Amount (NPR)'), '25000.50');
    await tester.pump();

    await tester.tap(find.text('Submit'));
    await tester.pumpAndSettle();
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
    await tester.pump();

    final create = server.calls.firstWhere((c) => c.method == 'POST' && c.path == '/api/v1/finance/requests');
    expect(create.data, {
      'kind': 'ADVANCE',
      'projectId': 'p-1',
      'amount': '25000.50',
      'categoryId': 'c-1',
      'purpose': 'Fuel for the survey',
    });
    expect(server.calls.any((c) => c.path == '/api/v1/finance/requests/new-1/submit'), isTrue);
  });

  testWidgets('an invoice photo needs the project first', (tester) async {
    await tester.pumpWidget(app(const RequestFormScreen(kind: RequestKind.reimbursement)));
    await settle(tester);
    await tester.ensureVisible(find.text('Add invoice photo'));
    await tester.tap(find.text('Add invoice photo'));
    await tester.pump();
    expect(find.text('Choose the project first; the photo is filed under it.'), findsOneWidget);
  });

  testWidgets('the form stays disabled until it is complete', (tester) async {
    await tester.pumpWidget(app(const RequestFormScreen(kind: RequestKind.reimbursement)));
    await settle(tester);
    expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Submit', skipOffstage: false)).onPressed, isNull);
    expect(find.text('Invoice 1'), findsOneWidget);
    expect(find.text('Total NPR 0.00'), findsOneWidget);
  });

  group('approvals and payments', () {
    const pm = AuthUser(id: 'u-pm', email: 'pm@ipms.local', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_approval.pm']);
    const director = AuthUser(id: 'u-dir', email: 'd@ipms.local', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_approval.director']);
    const finance = AuthUser(id: 'u-fin', email: 'f@ipms.local', permissions: ['finance_request.view', 'finance_request.view_all', 'finance_payment.record']);

    FinanceRequest req(String status, {String requester = 'u-1', String kind = 'ADVANCE', Map<String, dynamic>? extra}) =>
        FinanceRequest.fromJson(request('abc', status, kind: kind, extra: {'requesterId': requester, ...?extra}));

    test('the right person is offered the right step', () {
      List<FinanceAction> offered(FinanceRequest r, AuthUser u) =>
          availableActions(r, FinanceViewer(id: u.id, permissions: u.permissions));
      const decide = [FinanceAction.approve, FinanceAction.returnToRequester, FinanceAction.reject];

      expect(offered(req('PENDING_PM'), pm), decide);
      expect(offered(req('PENDING_PM'), director), isEmpty);
      expect(offered(req('PENDING_DIRECTOR'), director), decide);
      expect(offered(req('PENDING_FINANCE'), finance), [FinanceAction.pay, FinanceAction.returnToRequester, FinanceAction.reject]);
      expect(offered(req('PENDING_PM', requester: 'u-2'), _engineer), isEmpty);
    });

    test('nobody acts on two steps of one revision, and nobody on their own request', () {
      final approvedByDirector = req('PENDING_FINANCE', extra: {
        'actions': [
          {'step': 'DIRECTOR', 'action': 'APPROVED', 'actorId': 'u-fin', 'revision': 1, 'at': '2026-10-02T05:00:00Z'},
        ],
      });
      // Finance who also approved earlier is refused the payment step.
      expect(availableActions(approvedByDirector, FinanceViewer(id: 'u-fin', permissions: finance.permissions)), isEmpty);
      // An approver whose own request it is gets the requester's buttons only.
      expect(
        availableActions(req('PENDING_PM', requester: 'u-pm'), FinanceViewer(id: 'u-pm', permissions: pm.permissions)),
        [FinanceAction.cancel],
      );
    });

    test('finance can take returned cash on an open paid advance only', () {
      final open = req('PAID', extra: {'balance': {'status': 'PAID', 'outstanding': '100.00'}});
      final closed = req('PAID', extra: {'balance': {'status': 'CLOSED', 'outstanding': '0.00'}});
      final viewer = FinanceViewer(id: 'u-fin', permissions: finance.permissions);
      expect(availableActions(open, viewer), [FinanceAction.cashReturn]);
      expect(availableActions(closed, viewer), isEmpty);
    });

    testWidgets('an approver sees a queue and can switch to it', (tester) async {
      server.awaiting = [request('aa', 'PENDING_PM', extra: {'requesterId': 'u-2'})];
      await tester.pumpWidget(app(const FinanceScreen(), user: pm));
      await settle(tester);

      expect(find.widgetWithText(ButtonSegment<bool>, 'Approvals'), findsNothing);
      await tester.tap(find.textContaining('Approvals'));
      await tester.pump();
      await settle(tester);

      expect(find.text('Requests waiting for your decision'), findsOneWidget);
      expect(find.textContaining('Sita Sharma'), findsOneWidget);
      expect(find.text('New'), findsNothing);
    });

    testWidgets('an engineer has no approvals queue', (tester) async {
      await tester.pumpWidget(app(const FinanceScreen()));
      await settle(tester);
      expect(find.textContaining('Approvals'), findsNothing);
    });

    testWidgets('the director approves with a lower amount', (tester) async {
      server.byId = {'abc': request('abc', 'PENDING_DIRECTOR', extra: {'requesterId': 'u-2'})};
      await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'abc'), user: director));
      await settle(tester);
      await tester.tap(find.widgetWithText(ElevatedButton, 'Approve'));
      await tester.pumpAndSettle();

      // More than asked is refused before it is sent.
      await tester.enterText(find.widgetWithText(TextField, 'Approved amount (NPR)'), '60000');
      await tester.pump();
      expect(find.text('Cannot be more than NPR 50,000.00'), findsOneWidget);
      expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Approve').last).onPressed, isNull);

      await tester.enterText(find.widgetWithText(TextField, 'Approved amount (NPR)'), '45000');
      await tester.enterText(find.widgetWithText(TextField, 'Note (optional)'), 'Within budget');
      await tester.pump();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Approve').last);
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pump();

      final call = server.calls.firstWhere((c) => c.path == '/api/v1/finance/requests/abc/approve');
      expect(call.data, {'amount': '45000', 'comment': 'Within budget'});
    });

    testWidgets('the project manager approves without an amount field', (tester) async {
      server.byId = {'abc': request('abc', 'PENDING_PM', extra: {'requesterId': 'u-2'})};
      await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'abc'), user: pm));
      await settle(tester);
      await tester.tap(find.widgetWithText(ElevatedButton, 'Approve'));
      await tester.pumpAndSettle();
      expect(find.text('Approved amount (NPR)'), findsNothing);
    });

    testWidgets('returning and rejecting both need a reason', (tester) async {
      server.byId = {'abc': request('abc', 'PENDING_PM', extra: {'requesterId': 'u-2'})};
      await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'abc'), user: pm));
      await settle(tester);

      await tester.tap(find.text('Return to requester'));
      await tester.pumpAndSettle();
      expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Return to requester')).onPressed, isNull);
      await tester.enterText(find.byType(TextField), 'Attach the quotation');
      await tester.pump();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Return to requester'));
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pump();

      final call = server.calls.firstWhere((c) => c.path == '/api/v1/finance/requests/abc/return');
      expect(call.data, {'comment': 'Attach the quotation'});
    });

    testWidgets('finance records a payment with its details', (tester) async {
      server.byId = {'abc': request('abc', 'PENDING_FINANCE', extra: {'requesterId': 'u-2', 'approvedAmount': '45000.00'})};
      await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'abc'), user: finance));
      await settle(tester);
      await tester.tap(find.widgetWithText(ElevatedButton, 'Record payment'));
      await tester.pumpAndSettle();

      // Details are required for a plain payment.
      expect(tester.widget<ElevatedButton>(find.widgetWithText(ElevatedButton, 'Record payment').last).onPressed, isNull);
      await tester.tap(find.text('How was it paid?'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Bank transfer').last);
      await tester.pumpAndSettle();
      await tester.enterText(find.widgetWithText(TextField, 'Reference'), 'TXN-1001');
      await tester.pump();
      await tester.tap(find.widgetWithText(ElevatedButton, 'Record payment').last);
      await tester.pumpAndSettle();
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pump();

      final call = server.calls.firstWhere((c) => c.path == '/api/v1/finance/requests/abc/pay');
      final data = call.data as Map<String, dynamic>;
      expect(data['mode'], 'BANK_TRANSFER');
      expect(data['reference'], 'TXN-1001');
      expect(data['paidOn'], matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    });

    testWidgets('finance records returned cash against an advance', (tester) async {
      server.byId = {
        'abc': request('abc', 'PAID', extra: {
          'requesterId': 'u-2',
          'balance': {'paid': '50000.00', 'applied': '0.00', 'cashReturned': '0.00', 'outstanding': '50000.00', 'status': 'PAID'},
        }),
      };
      await tester.pumpWidget(app(const RequestDetailScreen(requestId: 'abc'), user: finance));
      await settle(tester);
      await tester.tap(find.text('Record returned cash'));
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
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pump();

      final call = server.calls.firstWhere((c) => c.path == '/api/v1/finance/advances/abc/cash-return');
      final data = call.data as Map<String, dynamic>;
      expect(data['amount'], '1500.50');
      expect(data['mode'], 'CASH');
      expect(data['reference'], 'RCPT-7');
    });
  });
}
