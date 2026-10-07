import 'package:flutter/material.dart';
import '../domain/finance_models.dart';
import '../domain/finance_overview.dart';
import '../domain/finance_view.dart';
import 'finance_widgets.dart';

/// The Overview tab: the month's advances at a glance, what is overdue and
/// still to settle, where the money went by project, and the latest records.
class OverviewTab extends StatelessWidget {
  const OverviewTab({
    super.key,
    required this.overview,
    required this.months,
    required this.onMonth,
    required this.onOpen,
    required this.onSettle,
    required this.onNewAdvance,
    required this.onNewSettlement,
    required this.onStatement,
    required this.onProject,
    required this.onSeeAll,
  });

  final FinanceOverview overview;
  final List<String> months;
  final ValueChanged<String> onMonth;
  final ValueChanged<FinanceRequest> onOpen;

  /// Opens the settlement form for this advance.
  final ValueChanged<FinanceRequest> onSettle;
  final VoidCallback onNewAdvance;
  final VoidCallback onNewSettlement;
  final VoidCallback onStatement;
  final ValueChanged<String> onProject;
  final VoidCallback onSeeAll;

  @override
  Widget build(BuildContext context) {
    final o = overview;
    final i = months.indexOf(o.monthKey);
    final hasPrev = i > 0;
    final hasNext = i >= 0 && i < months.length - 1;
    String pct(int v) => (o.total == 0 ? 0 : v / o.total * 100).toStringAsFixed(1);
    final overdue = o.overdue;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 130),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _circle(Icons.chevron_left_rounded, hasPrev ? () => onMonth(months[i - 1]) : null),
              Text(monthLabel(o.monthKey), style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              _circle(Icons.chevron_right_rounded, hasNext ? () => onMonth(months[i + 1]) : null),
            ],
          ),
          const SizedBox(height: 14),
          _hero(o, pct),
          if (overdue.isNotEmpty) ...[const SizedBox(height: 14), _overdueBanner(overdue)],
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(child: _quick(Icons.north_east_rounded, const Color(0xFFEEF0FF), FC.indigo, 'Request advance', onNewAdvance)),
              const SizedBox(width: 10),
              Expanded(child: _quick(Icons.receipt_long_outlined, const Color(0xFFE6F5EC), FC.green, 'Submit settlement', onNewSettlement)),
              const SizedBox(width: 10),
              Expanded(child: _quick(Icons.file_download_outlined, const Color(0xFFF1F2F4), const Color(0xFF3F4550), 'Export statement', onStatement)),
            ],
          ),
          const SizedBox(height: 14),
          _settlementsCard(o.settlements),
          if (o.outstanding.isNotEmpty) ...[const SizedBox(height: 14), _toSettle(o)],
          if (o.byProject.isNotEmpty) ...[const SizedBox(height: 14), _byProject(o)],
          const SizedBox(height: 18),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Recent', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              TextButton(
                style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 24), tapTargetSize: MaterialTapTargetSize.shrinkWrap),
                onPressed: onSeeAll,
                child: const Text('See all', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: FC.link)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (o.recent.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: Text('Nothing this month yet.', style: TextStyle(color: FC.muted, fontSize: 14))),
            ),
          for (final v in o.recent) ...[
            RecordCard(view: v, onTap: () => onOpen(v.request)),
            const SizedBox(height: 14),
          ],
        ],
      ),
    );
  }

  Widget _circle(IconData icon, VoidCallback? onTap) => Opacity(
        opacity: onTap == null ? 0.35 : 1,
        child: InkWell(
          customBorder: const CircleBorder(),
          onTap: onTap,
          child: Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(color: Colors.white, shape: BoxShape.circle, border: Border.all(color: FC.field)),
            child: Icon(icon, size: 20, color: FC.ink),
          ),
        ),
      );

  Widget _hero(FinanceOverview o, String Function(int) pct) {
    Widget legend(Color c, String label, int value) => Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(children: [
                Container(width: 8, height: 8, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(2))),
                const SizedBox(width: 6),
                Flexible(child: Text(label, style: const TextStyle(fontSize: 12, color: Color(0xFFB9BED0)), overflow: TextOverflow.ellipsis)),
              ]),
              const SizedBox(height: 4),
              Text(formatRupees(value), style: money(14, color: Colors.white)),
            ],
          ),
        );
    int flex(int v) => o.total == 0 ? 0 : (v / o.total * 1000).round();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: FC.navy, borderRadius: BorderRadius.circular(20)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('Total advance this month', style: TextStyle(fontSize: 13, color: Color(0xFFB9BED0))),
          const SizedBox(height: 4),
          Text(formatRupees(o.total), style: money(34, weight: FontWeight.w700, color: Colors.white).copyWith(letterSpacing: -0.7)),
          const SizedBox(height: 2),
          Text('${o.counted} advance${o.counted == 1 ? '' : 's'} · ${monthLabel(o.monthKey).split(' ').first}',
              style: const TextStyle(fontSize: 13, color: Color(0xFFB9BED0))),
          const SizedBox(height: 16),
          ClipRRect(
            borderRadius: BorderRadius.circular(4),
            child: SizedBox(
              height: 8,
              child: o.total == 0
                  ? const ColoredBox(color: Color(0xFF2A3152))
                  : Row(children: [
                      if (flex(o.settled) > 0) Expanded(flex: flex(o.settled), child: const ColoredBox(color: Color(0xFF5FD08F))),
                      if (flex(o.settled) > 0) const SizedBox(width: 2),
                      if (flex(o.toSettle) > 0) Expanded(flex: flex(o.toSettle), child: const ColoredBox(color: Color(0xFF8E97FF))),
                      if (flex(o.toSettle) > 0) const SizedBox(width: 2),
                      if (flex(o.approval) > 0) Expanded(flex: flex(o.approval), child: const ColoredBox(color: Color(0xFFF2C14E))),
                    ]),
            ),
          ),
          const SizedBox(height: 16),
          Row(children: [
            legend(const Color(0xFF5FD08F), 'Settled', o.settled),
            legend(const Color(0xFF8E97FF), 'To settle', o.toSettle),
            legend(const Color(0xFFF2C14E), 'In approval', o.approval),
          ]),
        ],
      ),
    );
  }

  Widget _overdueBanner(List<RecordView> overdue) {
    final first = overdue.first;
    final due = first.request.settlementDueOn;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFDEDEA),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFF5C9C2)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            child: const Icon(Icons.warning_amber_rounded, size: 20, color: FC.red),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  overdue.length == 1 ? 'Settlement overdue' : '${overdue.length} settlements overdue',
                  style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFF8E2A20)),
                ),
                const SizedBox(height: 2),
                Text(
                  '${first.request.number} · ${formatRupees(paisa(first.amount))}${due == null ? '' : ' was due on ${shortDate(due)}'}.',
                  style: const TextStyle(fontSize: 13, height: 1.4, color: Color(0xFF8E2A20)),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  height: 36,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: FC.red,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                    ),
                    onPressed: () => onSettle(first.request),
                    child: const Text('Settle now', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _quick(IconData icon, Color bg, Color fg, String label, VoidCallback onTap) => InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
          decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: FC.border)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
                child: Icon(icon, size: 18, color: fg),
              ),
              const SizedBox(height: 10),
              Text(label, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, height: 1.25)),
            ],
          ),
        ),
      );

  Widget _settlementsCard(SettlementStats s) {
    Widget stat(String label, int value) => Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: const TextStyle(fontSize: 12, color: FC.muted)),
              const SizedBox(height: 3),
              Text(formatRupees(value), style: money(16)),
            ],
          ),
        );
    return FCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              const Text('Settlements', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              const SizedBox(width: 8),
              Flexible(child: Text('${s.count} this month', overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: FC.muted))),
            ],
          ),
          const SizedBox(height: 14),
          Row(children: [stat('Spent and receipted', s.spent), const SizedBox(width: 12), stat('VAT on bills', s.vat)]),
          const SizedBox(height: 14),
          Row(children: [stat('Balance returned', s.returned), const SizedBox(width: 12), stat('Excess claimed', s.claimed)]),
        ],
      ),
    );
  }

  Widget _toSettle(FinanceOverview o) {
    return FCard(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              const Text('To settle', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              const SizedBox(width: 8),
              Flexible(child: Text('${formatRupees(o.outstandingTotal)} open', overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: FC.muted))),
            ],
          ),
          for (final v in o.outstanding)
            Container(
              margin: const EdgeInsets.only(top: 10),
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: FC.divider))),
              child: Row(
                children: [
                  Expanded(
                    child: InkWell(
                      onTap: () => onOpen(v.request),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(v.request.purpose, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 2),
                          Text('${v.request.number} · ${formatRupees(paisa(v.amount))}', style: const TextStyle(fontSize: 12, color: FC.muted)),
                          const SizedBox(height: 6),
                          _dueChip(v),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  SizedBox(
                    height: 36,
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: FC.navy),
                        foregroundColor: FC.navy,
                        padding: const EdgeInsets.symmetric(horizontal: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                      ),
                      onPressed: () => onSettle(v.request),
                      child: const Text('Settle', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _dueChip(RecordView v) {
    final d = v.daysLeft;
    if (d == null) return const SizedBox.shrink();
    final (String text, Color bg, Color fg) = d < 0
        ? ('Overdue ${-d} day${d == -1 ? '' : 's'}', FC.redBg, FC.red)
        : d <= 2
            ? (d == 0 ? 'Due today' : '$d day${d == 1 ? '' : 's'} left', const Color(0xFFFEF4E2), FC.amber)
            : ('$d days left', const Color(0xFFEEF0FF), FC.indigo);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
      child: Text(text, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: fg)),
    );
  }

  Widget _byProject(FinanceOverview o) {
    Widget key(Color c, String label) => Row(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 7, height: 7, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(2))),
          const SizedBox(width: 4),
          Text(label, style: const TextStyle(fontSize: 11, color: FC.muted)),
        ]);
    final max = o.byProject.fold<int>(1, (m, p) => p.total > m ? p.total : m);
    return FCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('By project', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Wrap(spacing: 10, runSpacing: 4, children: [
            key(FC.green, 'Settled'),
            key(const Color(0xFF5B61D6), 'Open'),
            key(const Color(0xFFE2A93B), 'Approval'),
          ]),
          for (final p in o.byProject) ...[
            const SizedBox(height: 14),
            InkWell(
              onTap: () => onProject(p.code),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text.rich(
                          TextSpan(children: [
                            TextSpan(text: p.code, style: const TextStyle(fontWeight: FontWeight.w600)),
                            TextSpan(text: ' ${p.name}', style: const TextStyle(color: FC.muted)),
                          ]),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 13),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(formatRupees(p.total), style: money(13)),
                    ],
                  ),
                  const SizedBox(height: 7),
                  Container(
                    height: 8,
                    decoration: BoxDecoration(color: const Color(0xFFF1F2F4), borderRadius: BorderRadius.circular(4)),
                    alignment: Alignment.centerLeft,
                    child: FractionallySizedBox(
                      widthFactor: (p.total / max).clamp(0.02, 1),
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: Row(children: [
                          if (p.settled > 0) Expanded(flex: p.settled, child: const ColoredBox(color: FC.green)),
                          if (p.settled > 0 && p.open + p.approval > 0) const SizedBox(width: 2),
                          if (p.open > 0) Expanded(flex: p.open, child: const ColoredBox(color: Color(0xFF5B61D6))),
                          if (p.open > 0 && p.approval > 0) const SizedBox(width: 2),
                          if (p.approval > 0) Expanded(flex: p.approval, child: const ColoredBox(color: Color(0xFFE2A93B))),
                        ]),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
