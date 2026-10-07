import 'package:intl/intl.dart';

/// Advance, settlement or reimbursement.
class RequestKind {
  RequestKind._();

  static const String advance = 'ADVANCE';
  static const String settlement = 'SETTLEMENT';
  static const String reimbursement = 'REIMBURSEMENT';

  static const Map<String, String> labels = {
    advance: 'Advance',
    settlement: 'Settlement',
    reimbursement: 'Reimbursement',
  };
}

/// Where a request is in the approval chain.
class RequestStatus {
  RequestStatus._();

  static const Map<String, String> labels = {
    'DRAFT': 'Draft',
    'PENDING_PM': 'With project manager',
    'PENDING_DIRECTOR': 'With project director',
    'PENDING_FINANCE': 'Ready to pay',
    'PAID': 'Paid',
    'SETTLED': 'Settled',
    'RETURNED': 'Returned',
    'REJECTED': 'Rejected',
    'CANCELLED': 'Cancelled',
  };

  static const Set<String> pending = {'PENDING_PM', 'PENDING_DIRECTOR', 'PENDING_FINANCE'};

  static String label(String status) => labels[status] ?? status;

  /// Who the request is waiting on, or null when it is not waiting.
  static String? waitingOn(String status) => switch (status) {
        'PENDING_PM' => 'Waiting for the project manager',
        'PENDING_DIRECTOR' => 'Waiting for the project director',
        'PENDING_FINANCE' => 'Waiting for finance to pay',
        _ => null,
      };
}

/// "NPR 1,50,000.00": two decimals, Indian grouping. A missing amount is a dash.
String formatMoney(String? amount) {
  if (amount == null) return '—';
  final value = double.tryParse(amount);
  if (value == null) return amount;
  return 'NPR ${NumberFormat('#,##,##0.00', 'en_IN').format(value)}';
}

/// Amounts are sent and read as two-decimal strings and never added as
/// floating point: this sums them in whole paisa, as the server does.
String sumMoney(Iterable<String> amounts) {
  var paisa = 0;
  for (final a in amounts) {
    final parts = a.trim().split('.');
    final whole = int.tryParse(parts[0].isEmpty ? '0' : parts[0]) ?? 0;
    final frac = parts.length > 1 ? int.tryParse(parts[1].padRight(2, '0').substring(0, 2)) ?? 0 : 0;
    paisa += whole * 100 + frac;
  }
  return '${paisa ~/ 100}.${(paisa % 100).toString().padLeft(2, '0')}';
}

/// What the server accepts as an amount: positive, at most two decimals.
final RegExp _moneyPattern = RegExp(r'^(0|[1-9]\d{0,11})(\.\d{1,2})?$');

bool isValidMoney(String amount) {
  final a = amount.trim();
  return _moneyPattern.hasMatch(a) && (double.tryParse(a) ?? 0) > 0;
}

class ExpenseCategory {
  const ExpenseCategory({required this.id, required this.code, required this.name});

  factory ExpenseCategory.fromJson(Map<String, dynamic> json) => ExpenseCategory(
        id: json['id'] as String? ?? '',
        code: json['code'] as String? ?? '',
        name: json['name'] as String? ?? '',
      );

  final String id;
  final String code;
  final String name;
}

/// VAT is [vatRatePercent] of a bill's total, included in it, not added on top.
const int vatRatePercent = 13;

/// The VAT inside [amount] (which includes it): amount × 13 / 113 to the
/// paisa, halves rounding up, as the server works it out.
String vatIncluded(String amount) {
  final parts = amount.trim().split('.');
  final whole = int.tryParse(parts[0].isEmpty ? '0' : parts[0]) ?? 0;
  final frac = parts.length > 1 ? int.tryParse(parts[1].padRight(2, '0').substring(0, 2)) ?? 0 : 0;
  final minor = whole * 100 + frac;
  const rate = vatRatePercent;
  final vat = (minor * rate * 2 + (100 + rate)) ~/ ((100 + rate) * 2);
  return '${vat ~/ 100}.${(vat % 100).toString().padLeft(2, '0')}';
}

class RequestInvoice {
  const RequestInvoice({
    required this.vendor,
    required this.invoiceDate,
    required this.amount,
    this.invoiceNumber,
    this.mediaId,
    this.vat = false,
    this.supplierTaxNo,
  });

  factory RequestInvoice.fromJson(Map<String, dynamic> json) => RequestInvoice(
        mediaId: json['mediaId'] as String?,
        vat: json['vat'] as bool? ?? false,
        supplierTaxNo: json['supplierTaxNo'] as String?,
        vendor: json['vendor'] as String? ?? '',
        invoiceNumber: json['invoiceNumber'] as String?,
        invoiceDate: DateTime.tryParse(json['invoiceDate']?.toString() ?? '') ?? DateTime.now(),
        amount: json['amount']?.toString() ?? '0.00',
      );

  /// Who was paid, or what for.
  final String vendor;

  /// Absent on a bill that has none, as a bill without VAT often does.
  final String? invoiceNumber;
  final DateTime invoiceDate;
  final String amount;

  /// A VAT bill: [vatRatePercent] is included in [amount].
  final bool vat;
  final String? supplierTaxNo;

  /// The VAT inside [amount], or zero for a bill without VAT.
  String get vatAmount => vat ? vatIncluded(amount) : '0.00';

  /// The invoice photo in the media service, if one was attached.
  final String? mediaId;

  Map<String, dynamic> toJson() => {
        'mediaId': ?mediaId,
        'vendor': vendor.trim(),
        if ((invoiceNumber ?? '').trim().isNotEmpty) 'invoiceNumber': invoiceNumber!.trim(),
        'invoiceDate': DateFormat('yyyy-MM-dd').format(invoiceDate),
        'amount': amount.trim(),
        if (vat) 'vat': true,
        if (vat && (supplierTaxNo ?? '').trim().isNotEmpty) 'supplierTaxNo': supplierTaxNo!.trim(),
      };
}

/// One step of a request's history.
class ApprovalEntry {
  const ApprovalEntry({
    required this.step,
    required this.action,
    required this.at,
    required this.revision,
    this.actorId = '',
    this.comment,
    this.amount,
  });

  factory ApprovalEntry.fromJson(Map<String, dynamic> json) => ApprovalEntry(
        actorId: json['actorId'] as String? ?? '',
        step: json['step'] as String? ?? 'REQUESTER',
        action: json['action'] as String? ?? '',
        at: DateTime.tryParse(json['at']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
        revision: (json['revision'] as num?)?.toInt() ?? 1,
        comment: json['comment'] as String?,
        amount: json['amount']?.toString(),
      );

  final String step;
  final String action;
  final DateTime at;
  final int revision;
  final String actorId;
  final String? comment;
  final String? amount;

  static const Map<String, String> _stepName = {
    'PM': 'the project manager',
    'DIRECTOR': 'the project director',
    'FINANCE': 'finance',
  };
  static const Map<String, String> _verb = {
    'APPROVED': 'Approved',
    'RETURNED': 'Returned',
    'REJECTED': 'Rejected',
    'PAID': 'Paid',
  };

  /// "Approved by the project manager".
  String get description {
    if (action == 'SUBMITTED') return 'Submitted';
    if (action == 'CANCELLED') return 'Cancelled';
    if (action == 'CASH_RETURNED') return 'Cash return recorded by finance';
    return '${_verb[action] ?? action} by ${_stepName[step] ?? step.toLowerCase()}';
  }
}

class RequestPayment {
  const RequestPayment({
    required this.kind,
    required this.mode,
    required this.reference,
    required this.paidOn,
    required this.amount,
    this.recordedBy = '',
  });

  factory RequestPayment.fromJson(Map<String, dynamic> json) => RequestPayment(
        recordedBy: json['recordedBy'] as String? ?? '',
        kind: json['kind'] as String? ?? 'PAYOUT',
        mode: json['mode'] as String? ?? '',
        reference: json['reference'] as String? ?? '',
        paidOn: DateTime.tryParse(json['paidOn']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
        amount: json['amount']?.toString() ?? '0.00',
      );

  final String kind;
  final String mode;
  final String reference;
  final DateTime paidOn;
  final String amount;
  final String recordedBy;

  bool get isCashReturn => kind == 'CASH_RETURN';

  static const Map<String, String> modeLabels = {
    'BANK_TRANSFER': 'Bank transfer',
    'CASH': 'Cash',
    'CHEQUE': 'Cheque',
    'MOBILE_WALLET': 'Mobile wallet',
  };

  String get modeLabel => modeLabels[mode] ?? mode;
}

/// What is left of a paid advance.
class AdvanceBalance {
  const AdvanceBalance({
    required this.paid,
    required this.applied,
    required this.cashReturned,
    required this.outstanding,
    required this.status,
  });

  factory AdvanceBalance.fromJson(Map<String, dynamic> json) => AdvanceBalance(
        paid: json['paid']?.toString() ?? '0.00',
        applied: json['applied']?.toString() ?? '0.00',
        cashReturned: json['cashReturned']?.toString() ?? '0.00',
        outstanding: json['outstanding']?.toString() ?? '0.00',
        status: json['status'] as String? ?? 'PAID',
      );

  final String paid;
  final String applied;
  final String cashReturned;
  final String outstanding;

  /// PAID, PARTIALLY_SETTLED or CLOSED.
  final String status;

  bool get isClosed => status == 'CLOSED';
}

/// Reads a `YYYY-MM-DD` day as a local calendar date, so it never slides to
/// the day before in a timezone behind UTC.
DateTime? _calendarDay(Object? value) {
  final parts = value?.toString().split('-');
  if (parts == null || parts.length != 3) return null;
  final y = int.tryParse(parts[0]);
  final m = int.tryParse(parts[1]);
  final d = int.tryParse(parts[2].substring(0, parts[2].length < 2 ? parts[2].length : 2));
  return (y == null || m == null || d == null) ? null : DateTime(y, m, d);
}

class SettlementWindow {
  const SettlementWindow({required this.label, required this.overdue, required this.daysLate});

  final String label;
  final bool overdue;
  final int daysLate;
}

class FinanceRequest {
  const FinanceRequest({
    required this.id,
    required this.number,
    required this.kind,
    required this.status,
    required this.projectId,
    required this.categoryId,
    required this.requesterId,
    required this.purpose,
    required this.requestedAmount,
    required this.createdAt,
    this.projectCode,
    this.projectName,
    this.categoryName,
    this.advanceId,
    this.approvedAmount,
    this.appliedAmount,
    this.revision = 1,
    this.invoices = const [],
    this.history = const [],
    this.payments = const [],
    this.balance,
    this.settlementDueOn,
    this.vatAmount,
  });

  factory FinanceRequest.fromJson(Map<String, dynamic> json) {
    List<T> list<T>(String key, T Function(Map<String, dynamic>) read) =>
        (json[key] as List<dynamic>? ?? const []).whereType<Map<String, dynamic>>().map(read).toList();
    final balance = json['balance'];
    return FinanceRequest(
      id: json['id'] as String? ?? '',
      number: json['number'] as String? ?? '',
      kind: json['kind'] as String? ?? RequestKind.advance,
      status: json['status'] as String? ?? 'DRAFT',
      projectId: json['projectId'] as String? ?? '',
      projectCode: json['projectCode'] as String?,
      projectName: json['projectName'] as String?,
      categoryId: json['categoryId'] as String? ?? '',
      categoryName: (json['category'] as Map<String, dynamic>?)?['name'] as String?,
      requesterId: json['requesterId'] as String? ?? '',
      advanceId: json['advanceId'] as String?,
      purpose: json['purpose'] as String? ?? '',
      requestedAmount: json['requestedAmount']?.toString() ?? '0.00',
      approvedAmount: json['approvedAmount']?.toString(),
      appliedAmount: json['appliedAmount']?.toString(),
      revision: (json['revision'] as num?)?.toInt() ?? 1,
      createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
      invoices: list('invoices', RequestInvoice.fromJson),
      history: list('actions', ApprovalEntry.fromJson),
      payments: list('payments', RequestPayment.fromJson),
      balance: balance is Map<String, dynamic> ? AdvanceBalance.fromJson(balance) : null,
      settlementDueOn: _calendarDay(json['settlementDueOn']),
      vatAmount: json['vatAmount']?.toString(),
    );
  }

  final String id;
  final String number;
  final String kind;
  final String status;
  final String projectId;
  final String? projectCode;
  final String? projectName;
  final String categoryId;
  final String? categoryName;
  final String requesterId;
  final String? advanceId;
  final String purpose;
  final String requestedAmount;
  final String? approvedAmount;
  final String? appliedAmount;
  final int revision;
  final DateTime createdAt;
  final List<RequestInvoice> invoices;
  final List<ApprovalEntry> history;
  final List<RequestPayment> payments;

  /// Only on a paid advance.
  final AdvanceBalance? balance;

  /// A paid advance's last day to settle: a week after it was paid.
  final DateTime? settlementDueOn;

  /// The VAT inside a settlement's or reimbursement's VAT bills; on the list only.
  final String? vatAmount;

  /// Where the advance stands against its settlement window as of [now]; null
  /// when it is not on the clock (not a paid advance, or nothing left to
  /// settle). The due day counts as in time; overdue starts the day after.
  SettlementWindow? settlementWindow(DateTime now) {
    final due = settlementDueOn;
    if (due == null || (balance?.isClosed ?? false)) return null;
    final today = DateTime(now.year, now.month, now.day);
    final overdue = today.isAfter(due);
    final date = DateFormat('d MMM yyyy').format(due);
    return SettlementWindow(
      label: overdue ? 'Overdue since $date' : 'Settle by $date',
      overdue: overdue,
      daysLate: overdue ? today.difference(due).inDays : 0,
    );
  }

  bool get isAdvance => kind == RequestKind.advance;

  /// The requester can still change it.
  bool isEditable(String userId) => requesterId == userId && (status == 'DRAFT' || status == 'RETURNED');

  bool canCancel(String userId) => requesterId == userId && RequestStatus.pending.contains(status);

  /// A paid advance with something outstanding can be settled.
  bool get canSettle => isAdvance && status == 'PAID' && !(balance?.isClosed ?? false);

  /// The reason given the last time it was returned or rejected.
  String? get lastReviewComment {
    for (final e in history.reversed) {
      if ((e.action == 'RETURNED' || e.action == 'REJECTED') && (e.comment ?? '').isNotEmpty) {
        return '${e.description}: ${e.comment}';
      }
    }
    return null;
  }
}

/// One entry of the notification feed, as the notification service sends it.
class FinanceNotification {
  const FinanceNotification({
    required this.id,
    required this.type,
    required this.title,
    required this.body,
    required this.createdAt,
    required this.isRead,
    this.requestId,
  });

  factory FinanceNotification.fromJson(Map<String, dynamic> json) {
    // Finance links look like `/finance/requests/<id>`.
    final url = json['actionUrl'] as String?;
    final match = url == null ? null : RegExp(r'/finance/requests/([0-9a-fA-F-]{36})').firstMatch(url);
    return FinanceNotification(
      id: json['id'] as String? ?? '',
      type: json['type'] as String? ?? '',
      title: json['title'] as String? ?? '',
      body: json['body'] as String? ?? '',
      createdAt: DateTime.tryParse(json['createdAt']?.toString() ?? '')?.toLocal() ?? DateTime.now(),
      isRead: json['isRead'] as bool? ?? false,
      requestId: match?.group(1),
    );
  }

  final String id;
  final String type;
  final String title;
  final String body;
  final DateTime createdAt;
  final bool isRead;

  /// The request it is about, when it links to one.
  final String? requestId;

  bool get isFinance => type.startsWith('FINANCE_');

  /// ok, warn or err: the dot's colour on the feed.
  String get tone => switch (type) {
        'FINANCE_REQUEST_REJECTED' || 'FINANCE_REQUEST_CANCELLED' => 'err',
        'FINANCE_REQUEST_RETURNED' || 'FINANCE_APPROVAL_NEEDED' || 'FINANCE_PAYMENT_DUE' => 'warn',
        _ => 'ok',
      };
}
