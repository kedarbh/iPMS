import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/notifications/domain/app_notification.dart';
import 'package:mobile/features/notifications/presentation/notification_center_screen.dart';

import '../finance/finance_harness.dart';

const _requestId = '0192f7a0-0000-7000-8000-000000000003';

Map<String, dynamic> _n(String id, String type, String title, {bool read = false, String? url, String? workOrderId, String? at}) => {
      'id': id,
      'type': type,
      'title': title,
      'body': 'About $title',
      'actionUrl': url,
      'workOrderId': workOrderId,
      'isRead': read,
      'createdAt': at ?? DateTime.now().toUtc().toIso8601String(),
    };

void main() {
  group('a notification', () {
    test('knows what it is about and where it leads', () {
      final finance = AppNotification.fromJson(_n('n1', 'FINANCE_REQUEST_RETURNED', 'Changes requested', url: '/finance/requests/$_requestId'));
      expect(finance.category, NotificationCategory.finance);
      expect(finance.financeRequestId, _requestId);
      expect(finance.opensSomething, isTrue);

      final qc = AppNotification.fromJson(_n('n2', 'QC_SUBMISSION_REJECTED', 'Rework required', url: '/quality/work-orders/w-9'));
      expect(qc.category, NotificationCategory.workOrder);
      expect(qc.workOrderId, 'w-9'); // read from the link when the field is missing

      final access = AppNotification.fromJson(_n('n3', 'PROJECT_ACCESS_EXPIRING', 'Your project access is ending'));
      expect(access.category, NotificationCategory.other);
      expect(access.opensSomething, isFalse);
    });

    test('says when in plain words, and is grouped by day', () {
      final at = DateTime(2026, 10, 10, 9, 0);
      expect(whenText(DateTime(2026, 10, 10, 8, 59, 40), at), 'Just now');
      expect(whenText(DateTime(2026, 10, 10, 8, 30), at), '30 min ago');
      expect(whenText(DateTime(2026, 10, 10, 7, 0), at), '2h ago');
      expect(whenText(DateTime(2026, 10, 9, 20, 0), at), 'Yesterday');
      expect(whenText(DateTime(2026, 10, 7, 12, 0), at), '3 days ago');
      expect(whenText(DateTime(2026, 9, 20, 12, 0), at), '20 Sep');
      expect(dayGroupOf(DateTime(2026, 10, 10, 1), at), 'Today');
      expect(dayGroupOf(DateTime(2026, 10, 9, 23), at), 'Yesterday');
      expect(dayGroupOf(DateTime(2026, 10, 6), at), 'This week');
      expect(dayGroupOf(DateTime(2026, 9, 1), at), 'Earlier');
    });
  });

  group('the inbox', () {
    late FinanceServer server;
    setUp(() => server = FinanceServer());

    testWidgets('lists every kind of notification, not only finance', (tester) async {
      phoneScreen(tester);
      server.notifications = [
        _n('n1', 'QC_SUBMISSION_REJECTED', 'Rework required', workOrderId: 'w-1'),
        _n('n2', 'FINANCE_REQUEST_PAID', 'Advance paid', read: true),
        _n('n3', 'PROJECT_ACCESS_EXPIRING', 'Your project access is ending', at: '2026-01-01T05:00:00Z'),
      ];
      await tester.pumpWidget(financeApp(server, const NotificationCenterScreen()));
      await settleNetwork(tester);

      expect(find.text('Rework required'), findsOneWidget);
      expect(find.text('Advance paid'), findsOneWidget);
      expect(find.text('Your project access is ending'), findsOneWidget);
      expect(find.text('2 unread'), findsOneWidget);
      expect(find.text('TODAY'), findsOneWidget);
      expect(find.text('EARLIER'), findsOneWidget);
      expect(find.byKey(const ValueKey('unread-dot')), findsNWidgets(2));
    });

    testWidgets('filters to unread, or to one kind', (tester) async {
      phoneScreen(tester);
      server.notifications = [
        _n('n1', 'QC_SUBMISSION_APPROVED', 'Submission approved'),
        _n('n2', 'FINANCE_REQUEST_PAID', 'Advance paid', read: true),
      ];
      await tester.pumpWidget(financeApp(server, const NotificationCenterScreen()));
      await settleNetwork(tester);

      await tester.tap(find.text('Unread'));
      await tester.pump();
      expect(find.text('Submission approved'), findsOneWidget);
      expect(find.text('Advance paid'), findsNothing);

      await tester.ensureVisible(find.text('Finance'));
      await tester.pump();
      await tester.tap(find.text('Finance'));
      await tester.pump();
      expect(find.text('Submission approved'), findsNothing);
      expect(find.text('Advance paid'), findsOneWidget);
    });

    testWidgets('opens a finance request, fetched fresh, and marks it read', (tester) async {
      phoneScreen(tester);
      server.notifications = [_n('n1', 'FINANCE_REQUEST_RETURNED', 'Changes requested', url: '/finance/requests/$_requestId')];
      server.byId = {_requestId: record(_requestId, 'RETURNED')};
      await tester.pumpWidget(financeApp(server, const NotificationCenterScreen()));
      await settleNetwork(tester);

      await tester.tap(find.text('Changes requested'));
      await afterAction(tester);
      await tester.pumpAndSettle();
      expect(server.posts('/n1/read'), hasLength(1));
      expect(find.text('Edit and resubmit'), findsOneWidget); // the request opened
    });

    testWidgets('opens the work order a review is about', (tester) async {
      phoneScreen(tester);
      server.notifications = [_n('n1', 'QC_SUBMISSION_REJECTED', 'Rework required', workOrderId: 'w-1')];
      await tester.pumpWidget(financeApp(server, const NotificationCenterScreen()));
      await settleNetwork(tester);

      await tester.tap(find.text('Rework required'));
      await afterAction(tester);
      await tester.pump(const Duration(milliseconds: 400));
      await afterAction(tester);
      expect(server.posts('/n1/read'), hasLength(1));
      expect(server.calls.where((c) => c.method == 'GET' && c.path == '/api/v1/work-orders/w-1'), isNotEmpty);
    });

    testWidgets('marks all read', (tester) async {
      phoneScreen(tester);
      server.notifications = [_n('n1', 'FINANCE_REQUEST_PAID', 'Advance paid')];
      await tester.pumpWidget(financeApp(server, const NotificationCenterScreen()));
      await settleNetwork(tester);

      await tester.tap(find.text('Mark all read'));
      await tester.pump();
      expect(find.byKey(const ValueKey('unread-dot')), findsNothing); // at once, before the server answers
      await afterAction(tester);
      expect(server.posts('/read-all'), hasLength(1));
    });

    testWidgets('says so when there is nothing', (tester) async {
      phoneScreen(tester);
      await tester.pumpWidget(financeApp(server, const NotificationCenterScreen()));
      await settleNetwork(tester);
      expect(find.text('Nothing yet'), findsOneWidget);
      expect(find.text('You are all caught up'), findsOneWidget);
    });
  });
}
