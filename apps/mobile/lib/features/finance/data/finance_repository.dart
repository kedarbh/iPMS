import 'package:dio/dio.dart';
import '../../../core/config/api_endpoints.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exceptions.dart';
import '../domain/finance_models.dart';

/// The field app's side of the finance service: a user's own advance,
/// reimbursement and settlement requests. Approvals and payments are done on
/// the web by managers and finance.
class FinanceRepository {
  FinanceRepository({required this.apiClient});

  final ApiClient apiClient;

  Future<List<FinanceRequest>> myRequests({String? status}) => _list('mine', status: status);

  /// Other people's requests waiting for the signed-in user's approval or
  /// payment. Empty for someone who approves nothing.
  Future<List<FinanceRequest>> awaitingMe() => _list('awaiting');

  /// Everyone's requests in the signed-in approver's project scope, their own included.
  Future<List<FinanceRequest>> inMyScope() => _list('all');

  /// Requests of others the signed-in user has already acted on, most recent first.
  Future<List<FinanceRequest>> handledByMe() => _list('handled');

  Future<List<FinanceRequest>> _list(String view, {String? status, int limit = 100}) async {
    try {
      final response = await apiClient.dio.get<Map<String, dynamic>>(
        ApiEndpoints.financeRequests,
        queryParameters: {'view': view, 'limit': limit, 'status': ?status},
      );
      return (response.data?['items'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(FinanceRequest.fromJson)
          .toList();
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load your requests.');
    }
  }

  Future<FinanceRequest> getRequest(String id) async {
    try {
      final response = await apiClient.dio.get<Map<String, dynamic>>(ApiEndpoints.financeRequest(id));
      return FinanceRequest.fromJson(response.data ?? const {});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load the request.');
    }
  }

  Future<List<ExpenseCategory>> categories() async {
    try {
      final response = await apiClient.dio.get<List<dynamic>>(ApiEndpoints.financeCategories);
      return (response.data ?? const [])
          .whereType<Map<String, dynamic>>()
          .where((c) => c['disabledAt'] == null)
          .map(ExpenseCategory.fromJson)
          .toList();
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load the categories.');
    }
  }

  /// Creates a draft. [body] follows the server's `CreateRequestSchema`.
  Future<FinanceRequest> create(Map<String, dynamic> body) async {
    try {
      final response = await apiClient.dio.post<Map<String, dynamic>>(ApiEndpoints.financeRequests, data: body);
      return FinanceRequest.fromJson(response.data ?? const {});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not save the request.');
    }
  }

  /// Edits a draft or returned request. [body] follows `UpdateRequestSchema`.
  Future<FinanceRequest> update(String id, Map<String, dynamic> body) async {
    try {
      final response = await apiClient.dio.patch<Map<String, dynamic>>(ApiEndpoints.financeRequest(id), data: body);
      return FinanceRequest.fromJson(response.data ?? const {});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not save the request.');
    }
  }

  Future<void> submit(String id) async {
    try {
      await apiClient.dio.post<void>(ApiEndpoints.financeSubmit(id), data: const <String, dynamic>{});
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not submit the request.');
    }
  }

  /// Approves the request at the caller's step. Only the Director may set an
  /// [amount] (at most the requested one).
  Future<void> approve(String id, {String? amount, String? comment}) => _act(
        ApiEndpoints.financeAction(id, 'approve'),
        {
          if (amount != null && amount.trim().isNotEmpty) 'amount': amount.trim(),
          if (comment != null && comment.trim().isNotEmpty) 'comment': comment.trim(),
        },
        'Could not approve the request.',
      );

  Future<void> returnToRequester(String id, String comment) => _act(
        ApiEndpoints.financeAction(id, 'return'),
        {'comment': comment.trim()},
        'Could not return the request.',
      );

  Future<void> reject(String id, String comment) => _act(
        ApiEndpoints.financeAction(id, 'reject'),
        {'comment': comment.trim()},
        'Could not reject the request.',
      );

  /// Records the payment of an approved request. A settlement with nothing to
  /// pay out needs no details.
  Future<void> pay(String id, Map<String, dynamic> details) =>
      _act(ApiEndpoints.financeAction(id, 'pay'), details, 'Could not record the payment.');

  /// Nudges the engineer to settle an overdue advance. False when someone already did so today.
  Future<bool> remind(String advanceId) async {
    try {
      final response = await apiClient.dio.post<Map<String, dynamic>>(ApiEndpoints.financeRemind(advanceId), data: const <String, dynamic>{});
      return response.data?['reminded'] as bool? ?? true;
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not send the reminder.');
    }
  }

  /// Records cash an engineer handed back against a paid advance.
  Future<void> returnCash(String advanceId, Map<String, dynamic> details) =>
      _act(ApiEndpoints.financeCashReturn(advanceId), details, 'Could not record the cash return.');

  /// The newest notifications, finance ones only.
  Future<List<FinanceNotification>> notifications() async {
    try {
      final response = await apiClient.dio.get<Map<String, dynamic>>(
        ApiEndpoints.notifications,
        queryParameters: {'limit': 50},
      );
      return (response.data?['items'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(FinanceNotification.fromJson)
          .where((n) => n.isFinance)
          .toList();
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Failed to load notifications.');
    }
  }

  Future<void> markNotificationRead(String id) =>
      _act(ApiEndpoints.notificationRead(id), const {}, 'Could not mark it read.');

  Future<void> markAllNotificationsRead() =>
      _act(ApiEndpoints.notificationsReadAll, const {}, 'Could not mark them read.');

  /// Display names by user id, so history can say who did what.
  Future<Map<String, String>> userNames() async {
    try {
      final response = await apiClient.dio.get<List<dynamic>>(ApiEndpoints.userDirectory);
      return {
        for (final row in response.data ?? const <dynamic>[])
          if (row is Map && row['id'] != null) row['id'] as String: (row['fullName'] as String?) ?? '',
      };
    } catch (_) {
      return const {};
    }
  }

  Future<void> _act(String path, Map<String, dynamic> body, String fallback) async {
    try {
      await apiClient.dio.post<void>(path, data: body);
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: fallback);
    }
  }

  Future<void> cancel(String id, {String? comment}) async {
    try {
      await apiClient.dio.post<void>(
        ApiEndpoints.financeCancel(id),
        data: {if (comment != null && comment.trim().isNotEmpty) 'comment': comment.trim()},
      );
    } on DioException catch (e) {
      throw ApiException.fromDio(e, fallbackMessage: 'Could not cancel the request.');
    }
  }
}
