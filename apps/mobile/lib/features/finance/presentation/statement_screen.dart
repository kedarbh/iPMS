import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import '../../auth/providers/auth_provider.dart';
import '../data/statement_pdf.dart';
import '../domain/finance_models.dart';
import '../domain/finance_overview.dart';
import '../domain/finance_statement.dart';
import '../domain/finance_view.dart';
import '../providers/finance_providers.dart';
import 'finance_widgets.dart';
import 'request_detail_screen.dart';

/// The statement: totals for a month or for all time, every transaction, and
/// an Export PDF that opens the share sheet.
class StatementScreen extends ConsumerStatefulWidget {
  const StatementScreen({super.key, this.initialPeriod});

  final String? initialPeriod;

  @override
  ConsumerState<StatementScreen> createState() => _StatementScreenState();
}

class _StatementScreenState extends ConsumerState<StatementScreen> {
  String? _period;
  bool _exporting = false;

  Future<void> _export(FinanceStatement statement, StatementOwner owner) async {
    if (_exporting) return;
    setState(() => _exporting = true);
    try {
      final bytes = await buildStatementPdf(statement, owner, DateTime.now());
      final dir = await getTemporaryDirectory();
      final file = File('${dir.path}/finance-statement-${statement.periodKey}.pdf');
      await file.writeAsBytes(bytes, flush: true);
      await SharePlus.instance.share(ShareParams(files: [XFile(file.path, mimeType: 'application/pdf')], subject: 'Finance statement'));
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Could not create the statement: $e'), behavior: SnackBarBehavior.floating));
      }
    } finally {
      if (mounted) setState(() => _exporting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final all = ref.watch(myFinanceRequestsProvider).value ?? const <FinanceRequest>[];
    final user = ref.watch(authStateProvider).value;
    final now = DateTime.now();
    final months = monthsOf(all, now).reversed.toList();
    final period = _period ?? (months.contains(widget.initialPeriod) ? widget.initialPeriod! : monthKeyOf(now));
    final statement = buildStatement(all, period, now);
    final owner = StatementOwner(
      name: user?.displayName ?? user?.email ?? 'Field engineer',
      role: user?.roleLabel ?? 'Field engineer',
      employeeCode: user?.employeeCode,
    );
    final periods = [for (final m in months) (m, monthLabel(m)), ('all', 'All time')];

    Widget row(String label, int minor, {bool bold = false, bool last = false}) =>
        FactRow(label, formatRupees(minor), bold: bold, last: last);

    return Scaffold(
      backgroundColor: FC.bg,
      body: SafeArea(
        child: Column(
          children: [
            const FinanceHeader(title: 'Statement'),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                children: [
                  SizedBox(
                    height: 36,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      itemCount: periods.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 8),
                      itemBuilder: (_, i) {
                        final (key, label) = periods[i];
                        final on = key == period;
                        return InkWell(
                          borderRadius: BorderRadius.circular(10),
                          onTap: () => setState(() => _period = key),
                          child: Container(
                            alignment: Alignment.center,
                            padding: const EdgeInsets.symmetric(horizontal: 14),
                            decoration: BoxDecoration(
                              color: on ? FC.navy : Colors.white,
                              borderRadius: BorderRadius.circular(10),
                              border: Border.all(color: on ? FC.navy : const Color(0xFFC9CCD3)),
                            ),
                            child: Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: on ? Colors.white : FC.ink)),
                          ),
                        );
                      },
                    ),
                  ),
                  const SizedBox(height: 16),
                  FCard(
                    padding: EdgeInsets.zero,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(16),
                          decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: FC.divider))),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Statement · ${periodLabel(period)}', style: const TextStyle(fontSize: 12, color: FC.muted)),
                              const SizedBox(height: 3),
                              Text('${owner.name} · ${owner.role}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                              if ((owner.employeeCode ?? '').isNotEmpty) ...[
                                const SizedBox(height: 2),
                                Text('Employee ID ${owner.employeeCode}', style: const TextStyle(fontSize: 12, color: FC.muted)),
                              ],
                            ],
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 16),
                          child: Column(
                            children: [
                              row('Advances received', statement.received),
                              row('Settled with receipts', statement.spent),
                              row('Balance returned', statement.returned),
                              row('Excess claimed', statement.claimed),
                              row('Outstanding to settle', statement.outstanding, bold: true, last: true),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text('${statement.rows.length} transaction${statement.rows.length == 1 ? '' : 's'}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  FCard(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Column(
                      children: [
                        if (statement.rows.isEmpty)
                          const Padding(padding: EdgeInsets.symmetric(vertical: 20), child: Text('Nothing in this period.', style: TextStyle(color: FC.muted))),
                        for (var i = 0; i < statement.rows.length; i++)
                          InkWell(
                            onTap: () => Navigator.push<void>(
                              context,
                              MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: statement.rows[i].request.id)),
                            ),
                            child: Container(
                              padding: const EdgeInsets.symmetric(vertical: 12),
                              decoration: BoxDecoration(border: i == statement.rows.length - 1 ? null : const Border(bottom: BorderSide(color: FC.divider))),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(statement.rows[i].request.number, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                                        const SizedBox(height: 2),
                                        Text(
                                          '${statement.rows[i].request.purpose} · ${shortDate(statement.rows[i].request.createdAt)}',
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(fontSize: 12, color: FC.muted),
                                        ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Column(
                                    crossAxisAlignment: CrossAxisAlignment.end,
                                    children: [
                                      Text(formatRupees(statement.rows[i].amountPaisa), style: money(13)),
                                      const SizedBox(height: 2),
                                      Text(statement.rows[i].style.label, style: TextStyle(fontSize: 11, color: statement.rows[i].style.fg)),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            ActionBar(
              primary: _exporting ? 'Preparing PDF' : 'Export PDF',
              busy: _exporting,
              onPrimary: () => _export(statement, owner),
            ),
          ],
        ),
      ),
    );
  }
}
