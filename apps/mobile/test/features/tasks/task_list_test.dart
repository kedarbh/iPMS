import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/features/notifications/providers/notification_providers.dart';
import 'package:mobile/features/tasks/domain/models/task_item.dart';
import 'package:mobile/features/tasks/presentation/task_list_screen.dart';
import 'package:mobile/features/tasks/presentation/widgets/task_card.dart';
import 'package:mobile/features/tasks/providers/task_providers.dart';

void main() {
  testWidgets('TaskCard displays title, priority, status, and progress',
      (WidgetTester tester) async {
    final task = TaskItem(
      id: 'task-1',
      siteId: 'site-1',
      taskTypeId: 'tt-1',
      title: 'Civil Works & Tower Foundation',
      status: 'ONGOING',
      priority: 'High',
      siteCode: 'KOS121',
      completedChecklistCount: 3,
      totalChecklistCount: 5,
      assigneeName: 'Alex Morgan',
    );

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TaskCard(
            task: task,
            onTap: () {},
          ),
        ),
      ),
    );

    expect(find.text('Civil Works & Tower Foundation'), findsOneWidget);
    expect(find.text('Ongoing'), findsOneWidget);
    expect(find.text('High'), findsOneWidget);
    expect(find.text('3/5'), findsOneWidget);
    expect(find.text('Alex Morgan'), findsOneWidget);
  });

  testWidgets('TaskListScreen renders search bar, status chips and tasks',
      (WidgetTester tester) async {
    final demoTask = TaskItem(
      id: 'task-1',
      siteId: 'site-1',
      taskTypeId: 'tt-1',
      title: 'Civil Works & Tower Foundation',
      status: 'ONGOING',
      priority: 'High',
      siteCode: 'KOS121',
      completedChecklistCount: 3,
      totalChecklistCount: 5,
      assigneeName: 'Alex Morgan',
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          assignedTasksProvider.overrideWith((ref) async => [demoTask]),
          unreadNotificationCountProvider.overrideWith((ref) async => 0),
        ],
        child: const MaterialApp(
          home: TaskListScreen(),
        ),
      ),
    );

    await tester.pump();
    await tester.pump();

    // Verify header & search bar
    expect(find.text('Your task'), findsOneWidget);
    expect(find.byType(TextField), findsOneWidget);

    // Verify status filter chips
    expect(find.text('All'), findsOneWidget);
    expect(find.text('Ongoing'), findsNWidgets(2)); // in filter chip and on card
    expect(find.text('Completed'), findsOneWidget);

    // Verify task card rendering
    expect(find.text('Civil Works & Tower Foundation'), findsOneWidget);
  });
}
