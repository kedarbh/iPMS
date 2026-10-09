/// What a push carries: the notification, and where tapping it should lead.
class PushPayload {
  const PushPayload({required this.title, required this.body, this.type = '', this.actionUrl, this.workOrderId, this.notificationId});

  factory PushPayload.fromMessage({String? title, String? body, Map<String, dynamic> data = const {}}) => PushPayload(
        title: title ?? '',
        body: body ?? '',
        type: data['type']?.toString() ?? '',
        actionUrl: data['actionUrl']?.toString(),
        workOrderId: data['workOrderId']?.toString(),
        notificationId: data['notificationId']?.toString(),
      );

  final String title;
  final String body;
  final String type;
  final String? actionUrl;
  final String? workOrderId;
  final String? notificationId;

  /// The finance request it is about, read from the same link the web uses.
  String? get financeRequestId => RegExp(r'^/finance/requests/([^/?#]+)').firstMatch(actionUrl ?? '')?.group(1);

  bool get isFinance => type.startsWith('FINANCE_');
}
