import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show ProviderOrFamily;
import '../../finance/presentation/request_detail_screen.dart';
import '../../finance/providers/finance_providers.dart';
import '../../tasks/presentation/task_detail_screen.dart';
import '../../tasks/providers/task_providers.dart';

/// The screen a notification or push leads to, or null when it leads nowhere in the app.
///
/// Whatever it is about is dropped from the cache first, so the screen fetches
/// its latest state instead of the copy the app held when the notification was
/// sent (a request just returned must not still offer Cancel request).
Widget? notificationTarget(
  void Function(ProviderOrFamily provider) invalidate, {
  String? financeRequestId,
  String? workOrderId,
}) {
  if (financeRequestId != null) {
    invalidate(financeRequestProvider(financeRequestId));
    return RequestDetailScreen(requestId: financeRequestId);
  }
  if (workOrderId != null) {
    invalidate(taskDetailProvider(workOrderId));
    return WorkOrderFromNotification(workOrderId: workOrderId);
  }
  return null;
}

/// Loads a work order by id, then shows its detail. A notification carries only the id.
class WorkOrderFromNotification extends ConsumerWidget {
  const WorkOrderFromNotification({super.key, required this.workOrderId});

  final String workOrderId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final task = ref.watch(taskDetailProvider(workOrderId));
    return task.when(
      data: (t) => TaskDetailScreen(task: t),
      loading: () => const Scaffold(body: Center(child: CircularProgressIndicator())),
      error: (e, _) => Scaffold(
        appBar: AppBar(title: const Text('Work order')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(e.toString(), textAlign: TextAlign.center),
                const SizedBox(height: 12),
                TextButton(onPressed: () => ref.invalidate(taskDetailProvider(workOrderId)), child: const Text('Try again')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
