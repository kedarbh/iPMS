import 'package:dio/dio.dart';
import '../../../core/config/api_endpoints.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../domain/app_notification.dart';

/// The signed-in user's notifications, of every type: work orders, finance and access.
class NotificationRepository {
  NotificationRepository({required this.apiClient});

  final ApiClient apiClient;

  /// The newest notifications, newest first.
  Future<List<AppNotification>> feed({int limit = 50}) async {
    try {
      final response = await apiClient.dio.get<Map<String, dynamic>>(
        ApiEndpoints.notifications,
        queryParameters: {'limit': limit},
      );
      return (response.data?['items'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(AppNotification.fromJson)
          .toList();
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load notifications.');
    }
  }

  /// How many are unread in all, beyond the ones a feed page lists.
  Future<int> unreadCount() async {
    try {
      final response = await apiClient.dio.get<Map<String, dynamic>>(ApiEndpoints.notificationsUnreadCount);
      return (response.data?['count'] as num?)?.toInt() ?? 0;
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to count notifications.');
    }
  }

  Future<void> markRead(String id) => _post(ApiEndpoints.notificationRead(id), 'Could not mark it read.');

  Future<void> markAllRead() => _post(ApiEndpoints.notificationsReadAll, 'Could not mark them read.');

  Future<void> _post(String path, String fallback) async {
    try {
      await apiClient.dio.post<void>(path, data: const <String, dynamic>{});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: fallback);
    }
  }
}
