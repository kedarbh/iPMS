import 'finance_models.dart';
import 'finance_overview.dart';
import 'finance_rules.dart';
import 'finance_view.dart';

/// Which side of approval the signed-in user sits on; it sets the wording of
/// the dashboard, while what is in their queue is the server's call.
enum ApproverRole {
  projectManager('Project manager'),
  projectDirector('Project director'),
  finance('Finance');

  const ApproverRole(this.label);

  final String label;
}

/// The highest step the viewer acts at: paying beats directing beats managing.
ApproverRole approverRoleOf(FinanceViewer viewer) {
  if (viewer.can('finance_payment.record')) return ApproverRole.finance;
  if (viewer.can('finance_approval.director')) return ApproverRole.projectDirector;
  return ApproverRole.projectManager;
}

class HeroStat {
  const HeroStat(this.label, this.value, this.sub);

  final String label;
  final String value;
  final String sub;
}

/// The navy card at the top: what is waiting, worth how much, and the split.
class ApproverHero {
  const ApproverHero({required this.label, required this.total, required this.count, required this.stats});

  final String label;
  final String total;
  final String count;
  final List<HeroStat> stats;
}

/// One engineer's open advances: the cash they still hold.
class CashHolder {
  const CashHolder({required this.requesterId, required this.total, required this.open, required this.overdue, required this.inReview});

  final String requesterId;

  /// Whole paisa still outstanding across the engineer's open advances.
  final int total;
  final int open;
  final int overdue;
  final bool inReview;
}

/// A project's share of the month: how much is paid and how much is still moving.
class ProjectSpend {
  const ProjectSpend({required this.code, required this.name, required this.total, required this.paid});

  final String code;
  final String name;
  final int total;
  final int paid;

  int get inApproval => total - paid;
}

/// What the approver's Overview tab shows. Amounts are whole paisa.
class ApproverOverview {
  const ApproverOverview({
    required this.hero,
    required this.preview,
    required this.overdue,
    required this.cash,
    required this.cashTotal,
    required this.projects,
  });

  final ApproverHero hero;

  /// The oldest few things waiting, for the "Waiting for you" list.
  final List<RecordView> preview;

  /// Open advances past their settle-by day with nothing under review, oldest first.
  final List<RecordView> overdue;
  final List<CashHolder> cash;
  final int cashTotal;
  final List<ProjectSpend> projects;

  int get overdueTotal => overdue.fold(0, (t, v) => t + _outstandingOf(v.request));
}

/// How many whole days [r] has been where it is. Today is 0.
int ageDays(FinanceRequest r, DateTime now) {
  final since = r.updatedAt ?? r.createdAt;
  final a = DateTime(since.year, since.month, since.day);
  final b = DateTime(now.year, now.month, now.day);
  return b.difference(a).inDays.clamp(0, 1 << 20);
}

String ageLabel(int days) => days == 0 ? 'Today' : days == 1 ? '1 day' : '$days days';

int _amountOf(FinanceRequest r) => paisa(r.approvedAmount ?? r.requestedAmount);

/// What is left to settle on a paid advance, falling back to what was paid.
int _outstandingOf(FinanceRequest advance) => paisa(advance.balance?.outstanding ?? advance.approvedAmount ?? advance.requestedAmount);

/// What a settlement leaves between the engineer and the company: positive is
/// balance the engineer must return, negative is excess the company owes.
/// Null when the advance is not among [advances].
int? settlementDifference(FinanceRequest settlement, Map<String, FinanceRequest> advances) {
  final advance = advances[settlement.advanceId];
  if (advance == null) return null;
  return _outstandingOf(advance) - _amountOf(settlement);
}

/// "Return NPR 750", "Excess NPR 1,800" or "Fully utilised" for a settlement; empty if unknown.
String settlementHint(FinanceRequest settlement, Map<String, FinanceRequest> advances) {
  final diff = settlementDifference(settlement, advances);
  if (diff == null) return '';
  if (diff > 0) return 'Return ${formatRupees(diff)}';
  if (diff < 0) return 'Excess ${formatRupees(-diff)}';
  return 'Fully utilised';
}

/// Builds the approver's Overview.
///
/// [queue] is what waits on the viewer, [scope] every request in their projects
/// (their own included, which are left out of "cash with engineers"), and
/// [monthKey] the month the project bars cover.
ApproverOverview buildApproverOverview({
  required List<FinanceRequest> queue,
  required List<FinanceRequest> scope,
  required String viewerId,
  required ApproverRole role,
  required String monthKey,
  required DateTime now,
}) {
  final sorted = [...queue]..sort((a, b) => ageDays(b, now).compareTo(ageDays(a, now)));
  final advances = {for (final r in scope) if (r.isAdvance) r.id: r};
  int sum(Iterable<FinanceRequest> rs) => rs.fold(0, (t, r) => t + _amountOf(r));
  Iterable<FinanceRequest> kind(String k) => sorted.where((r) => r.kind == k);

  final oldest = sorted.isEmpty ? null : ageDays(sorted.first, now);
  final countText = '${sorted.length} request${sorted.length == 1 ? '' : 's'}'
      '${role == ApproverRole.finance ? ' ready' : ''}'
      '${oldest == null ? '' : ' · oldest ${oldest == 0 ? 'today' : ageLabel(oldest)}'}';

  final ApproverHero hero;
  if (role == ApproverRole.finance) {
    final settlements = kind(RequestKind.settlement).toList();
    var toReceive = 0;
    var toPay = 0;
    for (final s in settlements) {
      final diff = settlementDifference(s, advances) ?? 0;
      if (diff > 0) toReceive += diff;
      if (diff < 0) toPay += -diff;
    }
    final advanceSum = sum(kind(RequestKind.advance));
    final reimburseSum = sum(kind(RequestKind.reimbursement));
    hero = ApproverHero(
      label: 'To pay out',
      total: formatRupees(advanceSum + reimburseSum + toPay),
      count: countText,
      stats: [
        HeroStat('Advances', formatRupees(advanceSum), '${kind(RequestKind.advance).length} to pay'),
        HeroStat('Reimbursements', formatRupees(reimburseSum), '${kind(RequestKind.reimbursement).length} to pay'),
        HeroStat('Settlements', '${settlements.length} to close', toReceive > 0 ? '${formatRupees(toReceive)} to receive' : 'Nothing to receive'),
      ],
    );
  } else {
    hero = ApproverHero(
      label: role == ApproverRole.projectManager ? 'Waiting for your approval' : 'Waiting for director approval',
      total: formatRupees(sum(sorted)),
      count: countText,
      stats: [
        for (final (label, k) in [('Advances', RequestKind.advance), ('Settlements', RequestKind.settlement), ('Reimburse', RequestKind.reimbursement)])
          HeroStat(label, formatRupees(sum(kind(k))), '${kind(k).length} waiting'),
      ],
    );
  }

  final others = scope.where((r) => r.requesterId != viewerId).toList();
  final open = [for (final r in others) if (r.isAdvance) viewOf(r, scope, now)].where((v) => v.stage == Stage.paid || v.stage == Stage.review).toList();
  final overdue = open.where((v) => v.stage == Stage.paid && v.isOverdue).toList()
    ..sort((a, b) => (a.daysLeft ?? 0).compareTo(b.daysLeft ?? 0));

  final byEngineer = <String, List<RecordView>>{};
  for (final v in open) {
    byEngineer.putIfAbsent(v.request.requesterId, () => []).add(v);
  }
  final cash = [
    for (final e in byEngineer.entries)
      CashHolder(
        requesterId: e.key,
        total: e.value.fold(0, (t, v) => t + _outstandingOf(v.request)),
        open: e.value.length,
        overdue: e.value.where((v) => v.stage == Stage.paid && v.isOverdue).length,
        inReview: e.value.any((v) => v.stage == Stage.review),
      ),
  ]..sort((a, b) => b.total.compareTo(a.total));

  const notCounted = {Stage.draft, Stage.returned, Stage.rejected, Stage.cancelled};
  final counted = [
    for (final r in scope)
      if (r.kind != RequestKind.settlement && monthKeyOf(r.createdAt) == monthKey) viewOf(r, scope, now),
  ].where((v) => !notCounted.contains(v.stage)).toList();
  final names = <String, String>{};
  for (final v in counted) {
    names[v.request.projectCode ?? v.request.projectId] = v.request.projectName ?? '';
  }
  final projects = [
    for (final e in names.entries)
      () {
        final mine = counted.where((v) => (v.request.projectCode ?? v.request.projectId) == e.key).toList();
        final paid = mine.where((v) => v.request.status == 'PAID' || v.request.status == 'SETTLED' || v.stage == Stage.paid || v.stage == Stage.review || v.stage == Stage.settled);
        return ProjectSpend(
          code: e.key,
          name: e.value,
          total: mine.fold(0, (t, v) => t + paisa(v.amount)),
          paid: paid.fold(0, (t, v) => t + paisa(v.amount)),
        );
      }(),
  ]..sort((a, b) => b.total.compareTo(a.total));

  return ApproverOverview(
    hero: hero,
    preview: [for (final r in sorted.take(3)) viewOf(r, scope.isEmpty ? sorted : scope, now)],
    overdue: overdue,
    cash: cash,
    cashTotal: cash.fold(0, (t, c) => t + c.total),
    projects: projects,
  );
}

/// The History filters: the design's, plus the viewer's own requests.
const List<String> historyFilters = ['All', 'In approval', 'Open advances', 'Paid & settled', 'Returned', 'Rejected', 'Mine'];

bool matchesHistoryFilter(String filter, RecordView v, String viewerId) {
  final s = v.stage;
  return switch (filter) {
    'In approval' => const {Stage.pm, Stage.director, Stage.admin}.contains(s),
    'Open advances' => v.isAdvance && (s == Stage.paid || s == Stage.review),
    'Paid & settled' => (v.request.status == 'PAID' || v.request.status == 'SETTLED') && !(v.isAdvance && (s == Stage.paid || s == Stage.review)),
    'Returned' => s == Stage.returned,
    'Rejected' => s == Stage.rejected,
    'Mine' => v.request.requesterId == viewerId,
    _ => true,
  };
}
