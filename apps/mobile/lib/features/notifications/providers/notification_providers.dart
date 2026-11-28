import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/providers/auth_provider.dart';
import '../data/notification_repository.dart';
import '../domain/app_notification.dart';

final notificationRepositoryProvider = Provider<NotificationRepository>((ref) {
  ref.watch(sessionOwnerProvider);
  return NotificationRepository(apiClient: ref.watch(apiClientProvider));
});

/// Every notification of the signed-in user, newest first.
final notificationFeedProvider = FutureProvider<List<AppNotification>>((ref) {
  return ref.watch(notificationRepositoryProvider).feed();
});

/// The unread count on the Inbox button. A failed check counts as none, so the
/// button never shows an error; the next check tries again.
final unreadNotificationCountProvider = FutureProvider<int>((ref) async {
  try {
    return await ref.watch(notificationRepositoryProvider).unreadCount();
  } catch (_) {
    return 0;
  }
});
