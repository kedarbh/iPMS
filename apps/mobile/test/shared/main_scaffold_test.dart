import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/finance/presentation/finance_screen.dart';
import 'package:mobile/features/profile/presentation/profile_screen.dart';
import 'package:mobile/features/projects/presentation/project_list_screen.dart';
import 'package:mobile/features/tasks/presentation/task_list_screen.dart';
import 'package:mobile/shared/layout/main_scaffold.dart';

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

    // Profile keeps its own index.
    await tester.tap(find.byIcon(Icons.person_outline_rounded));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.text('Security'), findsOneWidget);
  });
}
