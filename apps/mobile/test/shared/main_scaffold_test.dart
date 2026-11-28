import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/finance/presentation/finance_screen.dart';
import 'package:mobile/features/profile/presentation/profile_screen.dart';
import 'package:mobile/features/projects/presentation/project_list_screen.dart';
import 'package:mobile/features/tasks/presentation/task_list_screen.dart';
import 'package:mobile/features/notifications/presentation/notification_center_screen.dart';
import 'package:mobile/shared/layout/main_scaffold.dart';

import '../features/finance/finance_harness.dart';

void main() {
  testWidgets('MainScaffold switches tabs when FloatingNavBar items are tapped',
      (WidgetTester tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(
          home: MainScaffold(
            pages: [
              TaskListScreen(),
              ProjectListScreen(),
              FinanceScreen(),
              ProfileScreen(),
            ],
          ),
        ),
      ),
    );

    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    // Initial tab is TaskListScreen
    expect(find.text('Your task'), findsOneWidget);

    // Tap Projects tab (index 1)
    await tester.tap(find.byIcon(Icons.business_outlined));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Assigned Projects'), findsOneWidget);

    // Tap Finance tab (index 2); the Map tab is gone from the bar
    expect(find.byIcon(Icons.map_outlined), findsNothing);
    await tester.tap(find.byIcon(Icons.account_balance_wallet_outlined));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Your advances, settlements and reimbursements'), findsOneWidget);

    // Tap Profile tab (index 3)
    await tester.tap(find.byIcon(Icons.person_outline_rounded));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Security'), findsOneWidget);
  });

  testWidgets('MainScaffold leaves out the button of a hidden tab and falls back from it',
      (WidgetTester tester) async {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: const MaterialApp(
          home: MainScaffold(
            hiddenTabs: {financeTabIndex},
            pages: [
              TaskListScreen(),
              ProjectListScreen(),
              SizedBox.shrink(),
              ProfileScreen(),
            ],
          ),
        ),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.byIcon(Icons.account_balance_wallet_outlined), findsNothing);
    // Tasks is the selected tab, so the bar draws its filled icon.
    expect(find.byIcon(Icons.assignment_rounded), findsOneWidget);
    expect(find.byIcon(Icons.business_outlined), findsOneWidget);
    expect(find.byIcon(Icons.person_outline_rounded), findsOneWidget);

    // A shortcut to the hidden tab lands on the first tab, not on a blank page.
    container.read(navigationIndexProvider.notifier).setIndex(financeTabIndex);
    await tester.pump();
    expect(find.text('Your task'), findsOneWidget);
    // The bar shows Tasks as the selected tab after the fallback.
    expect(find.byIcon(Icons.assignment_rounded), findsOneWidget);

    // Profile keeps its own index.
    await tester.tap(find.byIcon(Icons.person_outline_rounded));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Security'), findsOneWidget);
  });

  testWidgets('the Inbox button counts unread notifications on every tab and opens them all',
      (WidgetTester tester) async {
    phoneScreen(tester);
    final server = FinanceServer()
      ..notifications = [
        {'id': 'n1', 'type': 'QC_SUBMISSION_REJECTED', 'title': 'Rework required', 'body': 'x', 'isRead': false, 'createdAt': DateTime.now().toUtc().toIso8601String()},
        {'id': 'n2', 'type': 'FINANCE_REQUEST_PAID', 'title': 'Advance paid', 'body': 'y', 'isRead': false, 'createdAt': DateTime.now().toUtc().toIso8601String()},
        {'id': 'n3', 'type': 'FINANCE_REQUEST_PAID', 'title': 'Old one', 'body': 'z', 'isRead': true, 'createdAt': DateTime.now().toUtc().toIso8601String()},
      ];
    final app = financeApp(
      server,
      const MainScaffold(pages: [
        Center(child: Text('tasks page')),
        Center(child: Text('projects page')),
        Center(child: Text('finance page')),
        Center(child: Text('profile page')),
        NotificationCenterScreen(),
      ]),
    );
    // Already toured, so the guide does not cover the dock.
    FlutterSecureStorage.setMockInitialValues({'ipms_has_seen_guide_v1': 'true'});
    await tester.pumpWidget(app);
    await settleNetwork(tester);

    Finder badge() => find.descendant(of: find.byKey(const ValueKey('unread-badge')), matching: find.text('2'));
    expect(badge(), findsOneWidget);
    for (final icon in [Icons.business_outlined, Icons.account_balance_wallet_outlined, Icons.person_outline_rounded]) {
      await tester.tap(find.byIcon(icon));
      await tester.pump();
      await tester.pump(const Duration(seconds: 2));
      expect(badge(), findsOneWidget);
    }

    await tester.tap(find.byIcon(Icons.notifications_none_rounded));
    await settleNetwork(tester);
    expect(find.text('Notifications'), findsOneWidget);
    expect(find.text('Rework required'), findsOneWidget);
    expect(find.text('Advance paid'), findsOneWidget);
  });
}
