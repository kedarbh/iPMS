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

/// The services a finance screen talks to, in one stand-in. Every call is
/// recorded in [calls]; lists and records are whatever a test puts in.
class FinanceServer implements HttpClientAdapter {
  final List<RequestOptions> calls = [];
  List<Map<String, dynamic>> list = [];
  List<Map<String, dynamic>> awaiting = [];
  Map<String, Map<String, dynamic>> byId = {};
  List<Map<String, dynamic>> notifications = [];

  List<RequestOptions> posts(String suffix) =>
      calls.where((c) => c.method == 'POST' && c.path.endsWith(suffix)).toList();

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
        {'id': 'p-2', 'code': 'NP003', 'name': 'Hetauda line', 'status': 'ACTIVE'},
      ]);
    }
    if (path == '/api/v1/users/directory') {
      return json(200, [
        {'id': 'u-1', 'fullName': 'Field Engineer'},
        {'id': 'u-2', 'fullName': 'Sita Sharma'},
        {'id': 'u-pm', 'fullName': 'Rajesh Shrestha'},
      ]);
    }
    if (path == '/api/v1/notifications' && options.method == 'GET') {
      return json(200, {'items': notifications, 'nextCursor': null});
    }
    if (options.method == 'POST' && path.startsWith('/api/v1/notifications')) return json(200, {'updated': 1});
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

String isoOn(int month, int day) => DateTime(2026, month, day, 10).toUtc().toIso8601String();

/// A request as the finance service sends it.
Map<String, dynamic> record(
  String id,
  String status, {
  String kind = 'ADVANCE',
  String? number,
  String purpose = 'Site visit to Ilam',
  String amount = '50000.00',
  String? approved,
  String created = '2026-10-04T04:00:00.000Z',
  Map<String, dynamic>? extra,
}) =>
    {
      'id': id,
      'number': number ?? 'ADV-2026-${id.padLeft(4, '0')}',
      'kind': kind,
      'status': status,
      'revision': 1,
      'projectId': 'p-1',
      'projectCode': 'KOS',
      'projectName': 'Koshi rollout',
      'categoryId': 'c-1',
      'category': {'code': 'TRAVEL', 'name': 'Travel'},
      'requesterId': 'u-1',
      'purpose': purpose,
      'requestedAmount': amount,
      'approvedAmount': approved,
      'appliedAmount': null,
      'createdAt': created,
      'invoices': [],
      'actions': [],
      'payments': [],
      ...?extra,
    };

Map<String, dynamic> balance(String outstanding, {String status = 'PAID', String paid = '1000.00', String applied = '0.00', String returned = '0.00'}) =>
    {'paid': paid, 'applied': applied, 'cashReturned': returned, 'outstanding': outstanding, 'status': status};

const engineer = AuthUser(
  id: 'u-1',
  email: 'eng@ipms.local',
  displayName: 'Field Engineer',
  role: 'Field Engineer',
  employeeCode: 'FE-0418',
  permissions: ['finance_request.view', 'finance_request.create', 'finance_settlement.submit'],
);

class FakeAuth extends AuthNotifier {
  FakeAuth(this.user);
  final AuthUser? user;

  @override
  Future<AuthUser?> build() async => user;
}

Widget financeApp(FinanceServer server, Widget home, {AuthUser? user = engineer}) {
  FlutterSecureStorage.setMockInitialValues({});
  final api = ApiClient(
    tokenStorage: TokenStorage(),
    dio: Dio(BaseOptions(baseUrl: 'http://x'))..httpClientAdapter = server,
  );
  return ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(api),
      authStateProvider.overrideWith(() => FakeAuth(user)),
    ],
    child: MaterialApp(home: home),
  );
}

/// A phone-sized screen, so a long page is laid out the way it is used.
void phoneScreen(WidgetTester tester) {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

/// Dio's replies need real async under the widget tester.
Future<void> settleNetwork(WidgetTester tester) async {
  await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 200)));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 300));
}
