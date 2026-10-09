import '../config/api_endpoints.dart';
import '../network/api_client.dart';

/// Tells the server which devices to push to.
class PushRepository {
  PushRepository({required this.apiClient});

  final ApiClient apiClient;

  Future<void> register(String token, String platform) =>
      apiClient.dio.post<void>(ApiEndpoints.pushTokens, data: {'token': token, 'platform': platform});

  Future<void> unregister(String token) => apiClient.dio.post<void>(ApiEndpoints.pushTokensRemove, data: {'token': token});
}
