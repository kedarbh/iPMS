import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../auth/providers/auth_provider.dart';
import '../domain/finance_models.dart';
import '../domain/finance_overview.dart';
import '../domain/finance_rules.dart';
import '../domain/finance_view.dart';
import '../providers/finance_providers.dart';
import 'advance_form_screen.dart';
import 'expenses_form_screen.dart';
import 'finance_widgets.dart';
import 'notifications_screen.dart';
import 'overview_tab.dart';
import 'records_tab.dart';
import 'request_detail_screen.dart';
import 'statement_screen.dart';

enum _Segment { overview, records, approvals }

/// The Finance tab: header, then Overview, Records and, for approvers, the
/// requests waiting on them.
class FinanceScreen extends ConsumerStatefulWidget {
  const FinanceScreen({super.key});

  @override
  ConsumerState<FinanceScreen> createState() => _FinanceScreenState();
}

class _FinanceScreenState extends ConsumerState<FinanceScreen> {
  _Segment _segment = _Segment.overview;
  String? _month;
  String _query = '';
  int _filter = 0;
  final ScrollController _scroll = ScrollController();

  @override
  void dispose() {
    _scroll.dispose();
    super.dispose();
  }

  void _open(FinanceRequest r) => Navigator.push<void>(
        context,
        MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: r.id)),
      );

  void _show(_Segment s, {String query = '', int filter = 0}) {
    setState(() {
      _segment = s;
      _query = query;
      _filter = filter;
    });
    if (_scroll.hasClients) _scroll.jumpTo(0);
  }

  Future<void> _go(Widget screen) => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => screen));

  Future<void> _newRequest(List<FinanceRequest> all) async {
    final openCount = all.where((r) => r.isAdvance && stageOf(r, all) == Stage.paid).length;
    final choice = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(child: Container(width: 36, height: 5, decoration: BoxDecoration(color: const Color(0xFFD9DBE0), borderRadius: BorderRadius.circular(3)))),
              const SizedBox(height: 16),
              const Text('Create new', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              _SheetOption(
                icon: Icons.north_east_rounded,
                bg: const Color(0xFFEEF0FF),
                fg: FC.indigo,
                title: 'Advance request',
                subtitle: 'Ask for funds before you spend',
                onTap: () => Navigator.pop(ctx, RequestKind.advance),
              ),
              const SizedBox(height: 10),
              _SheetOption(
                icon: Icons.receipt_long_outlined,
                bg: const Color(0xFFE6F5EC),
                fg: FC.green,
                title: 'Settlement',
                subtitle: openCount > 0 ? '$openCount paid advance${openCount == 1 ? '' : 's'} waiting' : 'Account for an advance with receipts',
                onTap: () => Navigator.pop(ctx, RequestKind.settlement),
              ),
              const SizedBox(height: 10),
              _SheetOption(
                icon: Icons.account_balance_wallet_outlined,
                bg: const Color(0xFFF1F2F4),
                fg: const Color(0xFF3F4550),
                title: 'Reimbursement',
                subtitle: 'Claim back what you already spent',
                onTap: () => Navigator.pop(ctx, RequestKind.reimbursement),
              ),
            ],
          ),
        ),
      ),
    );
    if (choice == null || !mounted) return;
    switch (choice) {
      case RequestKind.advance:
        await _go(const AdvanceFormScreen());
      case RequestKind.settlement:
        await _go(const ExpensesFormScreen(kind: RequestKind.settlement));
      default:
        await _go(const ExpensesFormScreen(kind: RequestKind.reimbursement));
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authStateProvider).value;
    final viewer = FinanceViewer(id: user?.id ?? '', permissions: user?.permissions ?? const []);
    final canView = viewer.can('finance_request.view');
    final canCreate = viewer.raisesRequests;
    final mine = ref.watch(myFinanceRequestsProvider);
    final awaiting = ref.watch(awaitingFinanceRequestsProvider);
    final names = ref.watch(financeUserNamesProvider).value ?? const <String, String>{};
    final unread = (ref.watch(financeNotificationsProvider).value ?? const []).where((n) => !n.isRead).length;
    final awaitingCount = awaiting.value?.length ?? 0;
    final segment = (_segment == _Segment.approvals && !viewer.hasApprovals) ? _Segment.overview : _segment;
    final now = DateTime.now();

    Future<void> refresh() async {
      ref.invalidate(awaitingFinanceRequestsProvider);
      ref.invalidate(financeNotificationsProvider);
      await ref.refresh(myFinanceRequestsProvider.future).then((_) {}, onError: (_) {});
    }

    return Scaffold(
      backgroundColor: FC.bg,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: refresh,
          child: SingleChildScrollView(
            controller: _scroll,
            physics: const AlwaysScrollableScrollPhysics(),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 10, 20, 0),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Finance', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: -0.5)),
                            SizedBox(height: 3),
                            Text('Your advances, settlements and reimbursements', style: TextStyle(fontSize: 13, color: Color(0xFF737983), height: 1.35)),
                          ],
                        ),
                      ),
                      const SizedBox(width: 12),
                      _Bell(unread: unread, onTap: () => _go(const NotificationsScreen())),
                      if (canCreate) ...[
                        const SizedBox(width: 8),
                        SizedBox(
                          height: 44,
                          child: ElevatedButton.icon(
                            style: ElevatedButton.styleFrom(
                              backgroundColor: FC.navy,
                              foregroundColor: Colors.white,
                              padding: const EdgeInsets.symmetric(horizontal: 18),
                              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
                            ),
                            onPressed: () => _newRequest(mine.value ?? const []),
                            icon: const Icon(Icons.add_rounded, size: 18),
                            label: const Text('New', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                if (!canView)
                  const Padding(
                    padding: EdgeInsets.all(40),
                    child: Center(
                      child: Text(
                        'Finance is not available for your account. Ask an administrator if you need to raise advances or reimbursements.',
                        textAlign: TextAlign.center,
                        style: TextStyle(color: FC.muted),
                      ),
                    ),
                  )
                else ...[
                  Container(
                    margin: const EdgeInsets.fromLTRB(20, 16, 20, 0),
                    padding: const EdgeInsets.all(3),
                    decoration: BoxDecoration(color: const Color(0xFFE9EAEE), borderRadius: BorderRadius.circular(12)),
                    child: Row(
                      children: [
                        _SegmentButton('Overview', segment == _Segment.overview, () => _show(_Segment.overview)),
                        _SegmentButton('Records', segment == _Segment.records, () => _show(_Segment.records)),
                        if (viewer.hasApprovals)
                          _SegmentButton(
                            awaitingCount > 0 ? 'Approvals ($awaitingCount)' : 'Approvals',
                            segment == _Segment.approvals,
                            () => _show(_Segment.approvals),
                          ),
                      ],
                    ),
                  ),
                  if (segment == _Segment.approvals)
                    _list(awaiting, ref, (rows) {
                      final views = [for (final r in rows) viewOf(r, rows, now)];
                      return RecordsTab(
                        views: views,
                        query: _query,
                        filter: _filter,
                        onQuery: (q) => setState(() => _query = q),
                        onFilter: (f) => setState(() => _filter = f),
                        onOpen: _open,
                        requesterNames: names,
                        emptyMessage: 'Nothing is waiting for you.',
                      );
                    })
                  else
                    _list(mine, ref, (all) {
                      if (segment == _Segment.records) {
                        final views = [for (final r in all) viewOf(r, all, now)];
                        return RecordsTab(
                          views: views,
                          query: _query,
                          filter: _filter,
                          onQuery: (q) => setState(() => _query = q),
                          onFilter: (f) => setState(() => _filter = f),
                          onOpen: _open,
                        );
                      }
                      final months = monthsOf(all, now);
                      final month = months.contains(_month) ? _month! : monthKeyOf(now);
                      return OverviewTab(
                        overview: buildOverview(all, month, now),
                        months: months,
                        onMonth: (m) => setState(() => _month = m),
                        onOpen: _open,
                        onSettle: (advance) => _go(ExpensesFormScreen(kind: RequestKind.settlement, advance: advance)),
                        onNewAdvance: () => _go(const AdvanceFormScreen()),
                        onNewSettlement: () => _go(const ExpensesFormScreen(kind: RequestKind.settlement)),
                        onStatement: () => _go(StatementScreen(initialPeriod: month)),
                        onProject: (code) => _show(_Segment.records, query: code),
                        onSeeAll: () => _show(_Segment.records),
                      );
                    }),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _list(AsyncValue<List<FinanceRequest>> async, WidgetRef ref, Widget Function(List<FinanceRequest>) data) {
    return async.when(
      loading: () => const Padding(padding: EdgeInsets.all(60), child: Center(child: CircularProgressIndicator())),
      error: (e, _) => Padding(
        padding: const EdgeInsets.all(40),
        child: Center(
          child: Column(
            children: [
              const Icon(Icons.cloud_off_outlined, size: 40, color: FC.faint),
              const SizedBox(height: 10),
              Text(e.toString(), textAlign: TextAlign.center, style: const TextStyle(color: FC.muted)),
              TextButton(
                onPressed: () {
                  ref.invalidate(myFinanceRequestsProvider);
                  ref.invalidate(awaitingFinanceRequestsProvider);
                },
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      ),
      data: data,
    );
  }
}

class _Bell extends StatelessWidget {
  const _Bell({required this.unread, required this.onTap});

  final int unread;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      customBorder: const CircleBorder(),
      onTap: onTap,
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(color: Colors.white, shape: BoxShape.circle, border: Border.all(color: FC.field)),
            child: const Icon(Icons.notifications_none_rounded, size: 22, color: FC.ink),
          ),
          if (unread > 0)
            Positioned(
              top: 4,
              right: 4,
              child: Container(
                constraints: const BoxConstraints(minWidth: 16, minHeight: 16),
                padding: const EdgeInsets.symmetric(horizontal: 4),
                decoration: BoxDecoration(color: const Color(0xFFC8372D), borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.white, width: 2)),
                alignment: Alignment.center,
                child: Text(unread > 9 ? '9+' : '$unread', style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w700)),
              ),
            ),
        ],
      ),
    );
  }
}

class _SegmentButton extends StatelessWidget {
  const _SegmentButton(this.label, this.selected, this.onTap);

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: InkWell(
        borderRadius: BorderRadius.circular(9),
        onTap: onTap,
        child: Container(
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: selected ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(9),
            boxShadow: selected ? [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 2, offset: const Offset(0, 1))] : null,
          ),
          child: Text(
            label,
            style: TextStyle(fontSize: 14, fontWeight: selected ? FontWeight.w600 : FontWeight.w500, color: selected ? FC.ink : const Color(0xFF5D636D)),
          ),
        ),
      ),
    );
  }
}

class _SheetOption extends StatelessWidget {
  const _SheetOption({required this.icon, required this.bg, required this.fg, required this.title, required this.subtitle, required this.onTap});

  final IconData icon;
  final Color bg;
  final Color fg;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(16),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(16), border: Border.all(color: FC.border)),
        child: Row(
          children: [
            Container(
              width: 42,
              height: 42,
              decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(12)),
              child: Icon(icon, size: 20, color: fg),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 2),
                  Text(subtitle, style: const TextStyle(fontSize: 13, color: FC.muted)),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
