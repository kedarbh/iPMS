/// Gateway routes the field app calls. Every path is relative to
/// [AppConfig.apiBaseUrl]; the gateway forwards each prefix to its service.
class ApiEndpoints {
  ApiEndpoints._();

  // iam
  static const String login = '/api/v1/auth/login';
  static const String refresh = '/api/v1/auth/refresh';
  static const String logout = '/api/v1/auth/logout';
  static const String changePassword = '/api/v1/auth/change-password';
  static const String authMe = '/api/v1/auth/me';
  static const String usersMe = '/api/v1/users/me';
  static const String userDirectory = '/api/v1/users/directory';

  // project
  static const String projects = '/api/v1/projects';
  static String project(String id) => '/api/v1/projects/$id';

  // qc: work orders are the field app's tasks
  static const String workOrders = '/api/v1/work-orders';
  static String workOrder(String id) => '/api/v1/work-orders/$id';
  static String checklist(String workOrderId) =>
      '/api/v1/qc/tasks/$workOrderId/checklist';
  static const String submissions = '/api/v1/qc/submissions';
  static String submission(String id) => '/api/v1/qc/submissions/$id';

  // media
  static const String mediaUploads = '/api/v1/media/uploads';
  static const String mediaUploadStatus = '/api/v1/media/uploads/status';
  static String mediaComplete(String id) => '/api/v1/media/uploads/$id/complete';
  static String media(String id) => '/api/v1/media/$id';
  static String mediaUrl(String id) => '/api/v1/media/$id/url';
  // media: invoice photos for finance requests
  static const String financeUploads = '/api/v1/media/finance/uploads';
  static const String financeUploadStatus = '/api/v1/media/finance/uploads/status';
  static String financeUploadComplete(String id) => '/api/v1/media/finance/uploads/$id/complete';
  static String financeUpload(String id) => '/api/v1/media/finance/uploads/$id';
  static String financeFileUrl(String id) => '/api/v1/media/finance/$id/url';
  static const String mediaList = '/api/v1/media';

  // notifications
  static const String notifications = '/api/v1/notifications';
  static const String notificationsReadAll = '/api/v1/notifications/read-all';
  static String notificationRead(String id) => '/api/v1/notifications/$id/read';

  // finance
  static const String financeRequests = '/api/v1/finance/requests';
  static String financeRequest(String id) => '/api/v1/finance/requests/$id';
  static String financeSubmit(String id) => '/api/v1/finance/requests/$id/submit';
  static String financeCancel(String id) => '/api/v1/finance/requests/$id/cancel';
  static String financeAction(String id, String verb) => '/api/v1/finance/requests/$id/$verb';
  static String financeCashReturn(String advanceId) => '/api/v1/finance/advances/$advanceId/cash-return';
  static const String financeCategories = '/api/v1/finance/categories';

  /// Requests that must never carry (or refresh) an access token.
  static bool isAuthEndpoint(String path) =>
      path.contains(login) || path.contains(refresh);
}
