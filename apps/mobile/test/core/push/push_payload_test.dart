import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/core/push/push_payload.dart';

void main() {
  test('reads a push and finds the finance request it is about', () {
    final p = PushPayload.fromMessage(
      title: 'Approval needed',
      body: 'ADV-2026-0014 is waiting',
      data: {'type': 'FINANCE_APPROVAL_NEEDED', 'actionUrl': '/finance/requests/abc-123', 'notificationId': 'n1'},
    );
    expect(p.title, 'Approval needed');
    expect(p.isFinance, isTrue);
    expect(p.financeRequestId, 'abc-123');
    expect(p.notificationId, 'n1');
  });

  test('has no request for other links, or for a push with no data', () {
    expect(PushPayload.fromMessage(data: {'type': 'QC_SUBMISSION_SUBMITTED', 'actionUrl': '/quality/work-orders/w-1', 'workOrderId': 'w-1'}).financeRequestId, isNull);
    expect(PushPayload.fromMessage().financeRequestId, isNull);
    expect(PushPayload.fromMessage().title, '');
  });

  test('ignores a query string or fragment on the link', () {
    expect(PushPayload.fromMessage(data: {'actionUrl': '/finance/requests/r-7?tab=history'}).financeRequestId, 'r-7');
  });
}
