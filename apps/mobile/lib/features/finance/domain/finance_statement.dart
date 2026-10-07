import 'finance_models.dart';
import 'finance_overview.dart';
import 'finance_view.dart';

/// The engineer's statement for a period: what came in, what was accounted for,
/// and what is still outstanding. Amounts are whole paisa.
class FinanceStatement {
  const FinanceStatement({
    required this.periodKey,
    required this.received,
    required this.spent,
    required this.returned,
    required this.claimed,
    required this.outstanding,
    required this.rows,
  });

  /// `yyyy-MM`, or `all`.
  final String periodKey;
  final int received;
  final int spent;
  final int returned;
  final int claimed;
  final int outstanding;
  final List<RecordView> rows;
}

FinanceStatement buildStatement(List<FinanceRequest> all, String periodKey, DateTime now) {
  bool inPeriod(FinanceRequest r) => periodKey == 'all' || monthKeyOf(r.createdAt) == periodKey;
  final views = [for (final r in all) viewOf(r, all, now)];
  final mine = views.where((v) => inPeriod(v.request)).toList();
  int sum(Iterable<RecordView> vs) => vs.fold(0, (t, v) => t + paisa(v.amount));

  final advances = mine.where((v) => v.isAdvance).toList();
  final settlements = mine.where((v) => v.request.kind == RequestKind.settlement && v.stage == Stage.settled).toList();
  final byId = {for (final r in all) r.id: r};
  var returned = 0;
  var claimed = 0;
  for (final v in settlements) {
    final advance = byId[v.request.advanceId];
    if (advance == null) continue;
    final advanced = paisa(advance.approvedAmount ?? advance.requestedAmount);
    final spent = paisa(v.amount);
    if (advanced > spent) returned += advanced - spent;
    if (spent > advanced) claimed += spent - advanced;
  }

  const paidStages = {Stage.paid, Stage.review, Stage.settled};
  return FinanceStatement(
    periodKey: periodKey,
    received: sum(advances.where((v) => paidStages.contains(v.stage))),
    spent: sum(settlements),
    returned: returned,
    claimed: claimed,
    outstanding: sum(advances.where((v) => v.stage == Stage.paid || v.stage == Stage.review)),
    rows: mine.where((v) => v.stage != Stage.draft).toList(),
  );
}
