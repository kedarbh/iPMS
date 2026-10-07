import 'dart:ui' show Color;
import 'package:intl/intl.dart';
import 'finance_models.dart';

/// Where a request is in its life, as the engineer thinks of it. The service
/// has a status per request; the engineer's picture also needs whether a paid
/// advance is still to settle, in review, or fully settled, which comes from
/// the advance's balance and the settlements raised against it.
enum Stage { draft, pm, director, admin, paid, review, returned, rejected, cancelled, settled }

class StageStyle {
  const StageStyle(this.label, this.bg, this.fg);

  final String label;
  final Color bg;
  final Color fg;
}

const Map<Stage, StageStyle> stageStyles = {
  Stage.draft: StageStyle('Draft', Color(0xFFF1F2F4), Color(0xFF4B5563)),
  Stage.pm: StageStyle('With project manager', Color(0xFFE8F1FD), Color(0xFF1F5FB8)),
  Stage.director: StageStyle('With project director', Color(0xFFE8F1FD), Color(0xFF1F5FB8)),
  Stage.admin: StageStyle('Awaiting disbursal', Color(0xFFFEF4E2), Color(0xFF9A5B00)),
  Stage.paid: StageStyle('Paid · to settle', Color(0xFFEEF0FF), Color(0xFF3A3FB0)),
  Stage.review: StageStyle('Settlement in review', Color(0xFFE8F1FD), Color(0xFF1F5FB8)),
  Stage.returned: StageStyle('Returned', Color(0xFFFDEDEA), Color(0xFFB4372A)),
  Stage.rejected: StageStyle('Rejected', Color(0xFFFDEDEA), Color(0xFFB4372A)),
  Stage.cancelled: StageStyle('Cancelled', Color(0xFFF1F2F4), Color(0xFF4B5563)),
  Stage.settled: StageStyle('Settled', Color(0xFFE6F5EC), Color(0xFF1E7A46)),
};

bool _pending(String status) => RequestStatus.pending.contains(status);

/// The stage of [r]. [all] is the engineer's other requests, used to see
/// whether a paid advance already has a settlement under review.
Stage stageOf(FinanceRequest r, Iterable<FinanceRequest> all) {
  switch (r.status) {
    case 'DRAFT':
      return Stage.draft;
    case 'PENDING_PM':
      return Stage.pm;
    case 'PENDING_DIRECTOR':
      return Stage.director;
    case 'PENDING_FINANCE':
      return Stage.admin;
    case 'RETURNED':
      return Stage.returned;
    case 'REJECTED':
      return Stage.rejected;
    case 'CANCELLED':
      return Stage.cancelled;
    case 'SETTLED':
      return Stage.settled;
    case 'PAID':
      if (!r.isAdvance) return Stage.settled;
      if (r.balance?.isClosed ?? false) return Stage.settled;
      final underReview = all.any((s) => s.advanceId == r.id && _pending(s.status));
      return underReview ? Stage.review : Stage.paid;
    default:
      return Stage.draft;
  }
}

/// A request as the lists draw it: stage, label, colours, amount and the
/// short line under the amount.
class RecordView {
  const RecordView({
    required this.request,
    required this.stage,
    required this.hint,
    required this.hintColor,
    this.daysLeft,
  });

  final FinanceRequest request;
  final Stage stage;
  final String hint;
  final Color hintColor;

  /// Days until a paid advance's settle-by day; negative once overdue.
  final int? daysLeft;

  StageStyle get style => stageStyles[stage]!;
  String get typeLabel => RequestKind.labels[request.kind] ?? request.kind;

  /// The amount the record stands for: what was asked, or what was approved once it was.
  String get amount => request.approvedAmount ?? request.requestedAmount;

  /// [amount] in whole paisa.
  int get amountPaisa => paisa(amount);

  bool get isOverdue => (daysLeft ?? 0) < 0;
  bool get isAdvance => request.isAdvance;

  /// "NP002 • Travel • 7 Oct 2026"
  String get meta => [
        if (request.projectCode != null) request.projectCode!,
        if (request.categoryName != null) request.categoryName!,
        DateFormat('d MMM yyyy').format(request.createdAt),
      ].join(' • ');
}

const Color _muted = Color(0xFF8A8F98);
const Color _red = Color(0xFFB4372A);
const Color _amber = Color(0xFF9A5B00);
const Color _indigo = Color(0xFF3A3FB0);

/// Builds the view of [r] as of [now]; [all] is every request in hand.
RecordView viewOf(FinanceRequest r, List<FinanceRequest> all, DateTime now) {
  final stage = stageOf(r, all);
  var hint = '';
  var color = _muted;
  int? daysLeft;

  if (r.isAdvance) {
    hint = switch (stage) {
      Stage.draft => 'Not submitted',
      Stage.pm => 'Waiting for project manager',
      Stage.director => 'Waiting for project director',
      Stage.admin => 'Waiting for finance to disburse',
      Stage.review => 'Settlement under review',
      Stage.returned => 'Changes requested',
      Stage.settled => 'Fully settled',
      _ => '',
    };
    if (stage == Stage.returned) color = _red;
    final due = r.settlementDueOn;
    if (stage == Stage.paid && due != null) {
      final today = DateTime(now.year, now.month, now.day);
      daysLeft = due.difference(today).inDays;
      hint = daysLeft < 0
          ? 'Settlement overdue by ${-daysLeft} day${daysLeft == -1 ? '' : 's'}'
          : 'Settle by ${DateFormat('d MMM yyyy').format(due)}';
      color = daysLeft < 0 ? _red : daysLeft <= 2 ? _amber : _indigo;
    } else if (stage == Stage.paid) {
      hint = 'Waiting to be settled';
      color = _indigo;
    }
  } else {
    if (_pending(r.status)) {
      hint = stage == Stage.admin
          ? 'Waiting for finance'
          : 'Waiting for ${stage == Stage.director ? 'project director' : 'project manager'}';
    } else if (stage == Stage.settled) {
      final claimed = _claimed(r);
      hint = claimed > 0 ? '${formatMoney(_fromPaisa(claimed))} claimed' : 'Closed';
    } else if (stage == Stage.returned) {
      hint = 'Changes requested';
      color = _red;
    } else if (stage == Stage.draft) {
      hint = 'Not submitted';
    }
  }
  return RecordView(request: r, stage: stage, hint: hint, hintColor: color, daysLeft: daysLeft);
}

/// What a settled settlement paid out beyond the advance: approved minus applied.
int _claimed(FinanceRequest r) {
  final approved = r.approvedAmount;
  final applied = r.appliedAmount;
  if (approved == null || applied == null) return 0;
  final diff = paisa(approved) - paisa(applied);
  return diff > 0 ? diff : 0;
}

/// An amount string in whole paisa.
int paisa(String amount) {
  final parts = amount.trim().split('.');
  final whole = int.tryParse(parts[0].isEmpty ? '0' : parts[0]) ?? 0;
  final frac = parts.length > 1 ? int.tryParse(parts[1].padRight(2, '0').substring(0, 2)) ?? 0 : 0;
  return whole * 100 + frac;
}

String _fromPaisa(int minor) => '${minor ~/ 100}.${(minor % 100).toString().padLeft(2, '0')}';

/// Whole rupees for the overview ("NPR 25,000"), without decimals.
String formatRupees(int minor) => 'NPR ${NumberFormat('#,##,##0', 'en_IN').format(minor / 100)}';
