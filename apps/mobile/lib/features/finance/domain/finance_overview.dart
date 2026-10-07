import 'package:intl/intl.dart';
import 'finance_models.dart';
import 'finance_view.dart';

/// One project's share of the month, as bars: settled, still open, in approval.
class ProjectShare {
  const ProjectShare({
    required this.code,
    required this.name,
    required this.total,
    required this.settled,
    required this.open,
    required this.approval,
  });

  final String code;
  final String name;
  final int total;
  final int settled;
  final int open;
  final int approval;
}

/// The settlements card: what was spent against receipts and where the rest went.
class SettlementStats {
  const SettlementStats({
    required this.count,
    required this.spent,
    required this.vat,
    required this.returned,
    required this.claimed,
  });

  final int count;
  final int spent;
  final int vat;
  final int returned;
  final int claimed;
}

/// Everything the Overview tab shows, for one month. Amounts are whole paisa.
class FinanceOverview {
  const FinanceOverview({
    required this.monthKey,
    required this.total,
    required this.counted,
    required this.settled,
    required this.toSettle,
    required this.approval,
    required this.outstanding,
    required this.overdue,
    required this.settlements,
    required this.byProject,
    required this.recent,
  });

  /// `yyyy-MM`.
  final String monthKey;

  /// Advances this month that are live: not draft, returned, rejected or cancelled.
  final int total;
  final int counted;
  final int settled;
  final int toSettle;
  final int approval;

  /// Every paid advance with something left to settle, soonest due first.
  final List<RecordView> outstanding;
  final List<RecordView> overdue;
  final SettlementStats settlements;
  final List<ProjectShare> byProject;
  final List<RecordView> recent;

  int get outstandingTotal => outstanding.fold(0, (t, v) => t + paisa(v.amount));
}

String monthKeyOf(DateTime d) => DateFormat('yyyy-MM').format(d);

String monthLabel(String key) {
  final parts = key.split('-');
  return DateFormat('MMMM yyyy').format(DateTime(int.parse(parts[0]), int.parse(parts[1])));
}

/// The months that have any request, oldest first. Always includes the month of [now].
List<String> monthsOf(List<FinanceRequest> all, DateTime now) {
  final keys = {monthKeyOf(now), ...all.map((r) => monthKeyOf(r.createdAt))}.toList()..sort();
  return keys;
}

const Set<Stage> _notLive = {Stage.draft, Stage.returned, Stage.rejected, Stage.cancelled};

FinanceOverview buildOverview(List<FinanceRequest> all, String monthKey, DateTime now) {
  final views = [for (final r in all) viewOf(r, all, now)];
  final month = views.where((v) => monthKeyOf(v.request.createdAt) == monthKey).toList();

  final advances = month.where((v) => v.isAdvance).toList();
  final counted = advances.where((v) => !_notLive.contains(v.stage)).toList();
  int sum(Iterable<RecordView> vs) => vs.fold(0, (t, v) => t + paisa(v.amount));

  final settled = counted.where((v) => v.stage == Stage.settled);
  final toSettle = counted.where((v) => v.stage == Stage.paid || v.stage == Stage.review);
  final approval = counted.where((v) => const {Stage.pm, Stage.director, Stage.admin}.contains(v.stage));

  // Every open advance, whatever month it was raised in: the clock runs from payment.
  final outstanding = views.where((v) => v.isAdvance && v.stage == Stage.paid).toList()
    ..sort((a, b) => (a.daysLeft ?? 1 << 30).compareTo(b.daysLeft ?? 1 << 30));

  final byId = {for (final r in all) r.id: r};
  final settlements = month.where((v) => !v.isAdvance && v.request.kind == RequestKind.settlement && !_notLive.contains(v.stage)).toList();
  var returned = 0;
  var claimed = 0;
  for (final v in settlements) {
    final advance = byId[v.request.advanceId];
    final spent = paisa(v.amount);
    final advanced = advance == null ? null : paisa(advance.approvedAmount ?? advance.requestedAmount);
    if (advanced == null) continue;
    if (advanced > spent) returned += advanced - spent;
    if (spent > advanced) claimed += spent - advanced;
  }

  final codes = <String, String>{};
  for (final v in counted) {
    codes[v.request.projectCode ?? v.request.projectId] = v.request.projectName ?? '';
  }
  final byProject = [
    for (final e in codes.entries)
      () {
        final mine = counted.where((v) => (v.request.projectCode ?? v.request.projectId) == e.key).toList();
        return ProjectShare(
          code: e.key,
          name: e.value,
          total: sum(mine),
          settled: sum(mine.where((v) => v.stage == Stage.settled)),
          open: sum(mine.where((v) => v.stage == Stage.paid || v.stage == Stage.review)),
          approval: sum(mine.where((v) => const {Stage.pm, Stage.director, Stage.admin}.contains(v.stage))),
        );
      }(),
  ]..sort((a, b) => b.total.compareTo(a.total));

  return FinanceOverview(
    monthKey: monthKey,
    total: sum(counted),
    counted: counted.length,
    settled: sum(settled),
    toSettle: sum(toSettle),
    approval: sum(approval),
    outstanding: outstanding,
    overdue: outstanding.where((v) => v.isOverdue).toList(),
    settlements: SettlementStats(
      count: settlements.length,
      spent: sum(settlements),
      vat: settlements.fold(0, (t, v) => t + paisa(v.request.vatAmount ?? '0')),
      returned: returned,
      claimed: claimed,
    ),
    byProject: byProject,
    recent: month.take(3).toList(),
  );
}
