import 'package:intl/intl.dart';

/// What a notification is about, which decides its mark and its filter.
enum NotificationCategory {
  workOrder('Work orders'),
  finance('Finance'),
  other('Other');

  const NotificationCategory(this.label);

  final String label;
}

/// One entry of the signed-in user's notification feed, of any type.
class AppNotification {
  const AppNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.createdAt,
    required this.isRead,
    this.actionUrl,
    this.workOrderId,
  });

  factory AppNotification.fromJson(Map<String, dynamic> json) {
    final url = json['actionUrl'] as String?;
    return AppNotification(
      id: json['id'] as String? ?? '',
      type: json['type'] as String? ?? '',
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
      isRead: json['isRead'] as bool? ?? false,
      actionUrl: url,
      workOrderId: (json['workOrderId'] as String?) ?? workOrderIdIn(url),
    );
  }

  final String id;
  final String type;
  final String title;
  final String body;
  final DateTime createdAt;
  final bool isRead;

  /// The web link it points to, such as `/finance/requests/<id>`.
  final String? actionUrl;
  final String? workOrderId;

  NotificationCategory get category => categoryOf(type);

  /// The finance request it is about, when it links to one.
  String? get financeRequestId => financeRequestIdIn(actionUrl);

  /// Whether tapping it opens something in the app.
  bool get opensSomething => financeRequestId != null || workOrderId != null;

  AppNotification read() => AppNotification(
        id: id, type: type, title: title, body: body, createdAt: createdAt,
        isRead: true, actionUrl: actionUrl, workOrderId: workOrderId,
      );
}

NotificationCategory categoryOf(String type) {
  if (type.startsWith('QC_') || type.startsWith('WORK_ORDER_')) return NotificationCategory.workOrder;
  if (type.startsWith('FINANCE_')) return NotificationCategory.finance;
  return NotificationCategory.other;
}

String? financeRequestIdIn(String? url) => RegExp(r'^/finance/requests/([^/?#]+)').firstMatch(url ?? '')?.group(1);

String? workOrderIdIn(String? url) => RegExp(r'^/quality/work-orders/([^/?#]+)').firstMatch(url ?? '')?.group(1);

/// "2h ago", "Yesterday", "3 days ago", then the date.
String whenText(DateTime at, DateTime now) {
  final d = now.difference(at);
  if (d.inMinutes < 1) return 'Just now';
  if (d.inHours < 1) return '${d.inMinutes} min ago';
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(at.year, at.month, at.day);
  final days = today.difference(day).inDays;
  if (days == 0) return '${d.inHours}h ago';
  if (days == 1) return 'Yesterday';
  if (days < 7) return '$days days ago';
  return DateFormat('d MMM').format(at);
}

/// The heading a notification is listed under: Today, Yesterday, This week or Earlier.
String dayGroupOf(DateTime at, DateTime now) {
  final today = DateTime(now.year, now.month, now.day);
  final days = today.difference(DateTime(at.year, at.month, at.day)).inDays;
  if (days <= 0) return 'Today';
  if (days == 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}
