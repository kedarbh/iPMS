import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../domain/approver_overview.dart';
import '../domain/finance_models.dart';
import '../domain/finance_overview.dart';
import '../domain/finance_rules.dart';
import '../domain/finance_view.dart';
import '../providers/finance_providers.dart';
import 'approver_widgets.dart';
import 'finance_widgets.dart';

enum ApproverTab { overview, queue, history }

/// The Finance tab as a project manager, project director or Finance sees it:
/// what waits on them, the cash engineers hold, and every record in their projects.
/// Their own advances and settlements, which they rarely raise, sit in one card
/// at the foot of the Overview and behind the History filter "Mine".
class ApproverFinance extends ConsumerStatefulWidget {
  const ApproverFinance({
    super.key,
    required this.viewer,
    required this.onOpen,
    required this.onSettle,
    required this.onNew,
  });

  final FinanceViewer viewer;
  final ValueChanged<FinanceRequest> onOpen;
  final ValueChanged<FinanceRequest> onSettle;

  /// Opens the "Create new" sheet; null when the viewer raises nothing.
  final VoidCallback? onNew;

  @override
  ConsumerState<ApproverFinance> createState() => _ApproverFinanceState();
}

class _ApproverFinanceState extends ConsumerState<ApproverFinance> {
  ApproverTab _tab = ApproverTab.overview;
  String _kind = 'all';
  int _history = 0;
  String _query = '';
  late final TextEditingController _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  void _show(ApproverTab tab, {String query = '', int history = 0}) {
    setState(() {
      _tab = tab;
      _query = query;
      _history = history;
    });
    if (_search.text != query) _search.text = query;
  }

  void _toast(String message) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(message), behavior: SnackBarBehavior.floating));
  }

  /// Sends a reminder for each overdue advance and says who was nudged.
  Future<void> _remind(List<FinanceRequest> advances, Map<String, String> names) async {
    final repo = ref.read(financeRepositoryProvider);
    final nudged = <String>{};
    try {
      for (final a in advances) {
        if (await repo.remind(a.id)) nudged.add((names[a.requesterId] ?? 'the engineer').split(' ').first);
      }
    } catch (e) {
      if (mounted) _toast(e.toString());
      return;
    }
    if (!mounted) return;
    _toast(nudged.isEmpty ? 'They were reminded earlier today' : 'Reminder sent to ${nudged.join(' and ')}');
  }

  @override
  Widget build(BuildContext context) {
    final queue = ref.watch(awaitingFinanceRequestsProvider);
    final scope = ref.watch(scopeFinanceRequestsProvider);
    final names = ref.watch(financeUserNamesProvider).value ?? const <String, String>{};
    final queueCount = queue.value?.length ?? 0;
    final failed = scope.hasError && !scope.hasValue ? scope.error : (queue.hasError && !queue.hasValue ? queue.error : null);

    final Widget body;
    if (failed != null) {
      body = _error(failed);
    } else if (!scope.hasValue || !queue.hasValue) {
      body = const Padding(padding: EdgeInsets.all(60), child: Center(child: CircularProgressIndicator()));
    } else {
      final now = DateTime.now();
      body = switch (_tab) {
        ApproverTab.overview => _overview(queue.value!, scope.value!, names, now),
        ApproverTab.queue => _queueList(queue.value!, scope.value!, names, now),
        ApproverTab.history => _historyList(scope.value!, names, now),
      };
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SegmentBar(
          labels: ['Overview', queueCount > 0 ? 'Queue · $queueCount' : 'Queue', 'History'],
          selected: _tab.index,
          onSelect: (i) => _show(ApproverTab.values[i]),
        ),
        body,
      ],
    );
  }

  Widget _error(Object error) => Padding(
        padding: const EdgeInsets.all(40),
        child: Center(
          child: Column(
            children: [
              const Icon(Icons.cloud_off_outlined, size: 40, color: FC.faint),
              const SizedBox(height: 10),
              Text(error.toString(), textAlign: TextAlign.center, style: const TextStyle(color: FC.muted)),
              TextButton(
                onPressed: () {
                  ref.invalidate(scopeFinanceRequestsProvider);
                  ref.invalidate(awaitingFinanceRequestsProvider);
                },
                child: const Text('Retry'),
              ),
            ],
          ),
        ),
      );

  // ---------------------------------------------------------------- Overview

  Widget _overview(List<FinanceRequest> queue, List<FinanceRequest> scope, Map<String, String> names, DateTime now) {
    final viewerId = widget.viewer.id;
    final role = approverRoleOf(widget.viewer);
    final o = buildApproverOverview(queue: queue, scope: scope, viewerId: viewerId, role: role, monthKey: monthKeyOf(now), now: now);
    final advances = {for (final r in scope) if (r.isAdvance) r.id: r};
    final handled = ref.watch(handledFinanceRequestsProvider).value ?? const <FinanceRequest>[];
    final mine = ref.watch(myFinanceRequestsProvider).value ?? const <FinanceRequest>[];
    final overdueAdvances = [for (final v in o.overdue) v.request];

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 130),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _hero(o.hero),
          if (o.overdue.isNotEmpty) ...[
            const SizedBox(height: 14),
            _overdueBanner(o, names, () => _remind(overdueAdvances, names)),
          ],
          const SizedBox(height: 18),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              const Text('Waiting for you', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
              InkWell(
                onTap: () => _show(ApproverTab.queue),
                child: const Text('See all', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: FC.link)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (o.preview.isEmpty)
            const FCard(
              padding: EdgeInsets.all(20),
              child: Center(child: Text('Nothing is waiting for you.', style: TextStyle(fontSize: 14, color: FC.muted))),
            ),
          for (final v in o.preview) ...[
            ApproverCard(
              view: v,
              requester: names[v.request.requesterId] ?? '',
              age: ageDays(v.request, now),
              hint: _hintFor(v, advances),
              onTap: () => widget.onOpen(v.request),
            ),
            const SizedBox(height: 12),
          ],
          if (o.cash.isNotEmpty) ...[const SizedBox(height: 2), _cashCard(o, names, scope, now)],
          if (o.projects.isNotEmpty) ...[const SizedBox(height: 14), _projectsCard(o.projects, now)],
          if (handled.isNotEmpty) ...[const SizedBox(height: 14), _recentCard(handled, scope, role)],
          if (o.ahead.isNotEmpty) ...[const SizedBox(height: 14), _aheadCard(o, role, names, now)],
          if (widget.onNew != null || mine.isNotEmpty) ...[const SizedBox(height: 14), _ownCard(mine, now)],
        ],
      ),
    );
  }

  /// A settlement's balance or excess; other kinds keep their own hint.
  (String, Color)? _hintFor(RecordView v, Map<String, FinanceRequest> advances) {
    if (v.request.kind != RequestKind.settlement) return null;
    final diff = settlementDifference(v.request, advances);
    if (diff == null) return null;
    return (settlementHint(v.request, advances), diff < 0 ? FC.amber : FC.green);
  }

  Widget _hero(ApproverHero h) {
    return InkWell(
      borderRadius: BorderRadius.circular(20),
      onTap: () => _show(ApproverTab.queue),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: FC.navy, borderRadius: BorderRadius.circular(20)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(h.label, style: const TextStyle(fontSize: 13, color: Color(0xFFB9BED0))),
            const SizedBox(height: 4),
            Text(h.total, key: const Key('approver-hero-total'), style: money(34, weight: FontWeight.w700, color: Colors.white).copyWith(letterSpacing: -0.7)),
            const SizedBox(height: 2),
            Text(h.count, style: const TextStyle(fontSize: 13, color: Color(0xFFB9BED0))),
            const SizedBox(height: 16),
            Container(height: 1, color: const Color(0xFF2A3152)),
            const SizedBox(height: 14),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final s in h.stats)
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(s.label, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Color(0xFFB9BED0))),
                        const SizedBox(height: 4),
                        Text(s.value, maxLines: 1, overflow: TextOverflow.ellipsis, style: money(14, color: Colors.white)),
                        const SizedBox(height: 1),
                        Text(s.sub, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: Color(0xFF8E95B0))),
                      ],
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _overdueBanner(ApproverOverview o, Map<String, String> names, VoidCallback onRemind) {
    final people = {for (final v in o.overdue) names[v.request.requesterId] ?? 'an engineer'}.toList();
    final title = o.overdue.length == 1 ? '1 settlement overdue' : '${o.overdue.length} settlements overdue';
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: FC.redBg, border: Border.all(color: const Color(0xFFF5C9C2)), borderRadius: BorderRadius.circular(16)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            child: const Icon(Icons.warning_amber_rounded, size: 18, color: FC.red),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Color(0xFF8E2A20))),
                const SizedBox(height: 2),
                Text(
                  '${formatRupees(o.overdueTotal)} with ${people.join(' and ')}, past the settlement window.',
                  style: const TextStyle(fontSize: 13, color: Color(0xFF8E2A20), height: 1.4),
                ),
                const SizedBox(height: 10),
                SizedBox(
                  height: 36,
                  child: ElevatedButton(
                    key: const Key('remind-engineers'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: FC.red,
                      foregroundColor: Colors.white,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
                    ),
                    onPressed: onRemind,
                    child: const Text('Remind engineers', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// What is still with an earlier approver and will come to the viewer, so none of it is a surprise.
  Widget _aheadCard(ApproverOverview o, ApproverRole role, Map<String, String> names, DateTime now) {
    return FCard(
      key: const Key('on-its-way'),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: Text('On its way to you', overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
              const SizedBox(width: 8),
              Text('${o.aheadCount} · ${formatRupees(o.aheadTotal)}', style: const TextStyle(fontSize: 12, color: FC.muted)),
            ],
          ),
          const SizedBox(height: 4),
          const Text('Not with you yet. Still with an earlier approver.', style: TextStyle(fontSize: 12, color: FC.muted)),
          const SizedBox(height: 4),
          Wrap(
            spacing: 14,
            children: [
              for (final a in o.ahead) Text('${a.count} with the ${a.step}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: FC.indigo)),
            ],
          ),
          for (final r in o.aheadRequests.take(5))
            InkWell(
              onTap: () => widget.onOpen(r),
              child: Container(
                margin: const EdgeInsets.only(top: 10),
                padding: const EdgeInsets.symmetric(vertical: 12),
                decoration: const BoxDecoration(border: Border(top: BorderSide(color: FC.divider))),
                child: Row(
                  children: [
                    PersonAvatar(names[r.requesterId] ?? '', size: 32),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${r.number} · ${formatRupees(paisa(r.approvedAmount ?? r.requestedAmount))}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 2),
                          Text(
                            [if ((names[r.requesterId] ?? '').isNotEmpty) names[r.requesterId]!, r.purpose].join(' · '),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 12, color: FC.muted),
                          ),
                          const SizedBox(height: 2),
                          Text(onItsWayHint(role, r, now) ?? '', style: const TextStyle(fontSize: 12, color: FC.indigo)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          if (o.aheadRequests.length > 5)
            Padding(
              padding: const EdgeInsets.only(top: 2, bottom: 8),
              child: Text('and ${o.aheadRequests.length - 5} more', style: const TextStyle(fontSize: 12, color: FC.muted)),
            ),
        ],
      ),
    );
  }

  Widget _cashCard(ApproverOverview o, Map<String, String> names, List<FinanceRequest> scope, DateTime now) {
    return FCard(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: Text('Cash with engineers', overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
              const SizedBox(width: 8),
              Text('${formatRupees(o.cashTotal)} open', style: const TextStyle(fontSize: 12, color: FC.muted)),
            ],
          ),
          for (final c in o.cash)
            Container(
              margin: const EdgeInsets.only(top: 10),
              padding: const EdgeInsets.symmetric(vertical: 12),
              decoration: const BoxDecoration(border: Border(top: BorderSide(color: FC.divider))),
              child: Row(
                children: [
                  Expanded(
                    child: InkWell(
                      onTap: () => _show(ApproverTab.history, query: names[c.requesterId] ?? ''),
                      child: Row(
                        children: [
                          PersonAvatar(names[c.requesterId] ?? '', size: 36),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(names[c.requesterId] ?? 'Unknown', maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                                const SizedBox(height: 2),
                                Text(
                                  '${c.open} open${c.overdue > 0 ? ' · ${c.overdue} overdue' : c.inReview ? ' · settlement in review' : ''}',
                                  style: TextStyle(fontSize: 12, color: c.overdue > 0 ? FC.red : FC.muted),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(formatRupees(c.total), style: money(14)),
                      if (c.overdue > 0)
                        InkWell(
                          key: Key('remind-${c.requesterId}'),
                          onTap: () => _remind(
                            [for (final r in scope) if (r.isAdvance && r.requesterId == c.requesterId && viewOf(r, scope, now).stage == Stage.paid && viewOf(r, scope, now).isOverdue) r],
                            names,
                          ),
                          child: const Padding(
                            padding: EdgeInsets.only(top: 4),
                            child: Text('Remind', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: FC.red)),
                          ),
                        ),
                    ],
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _projectsCard(List<ProjectSpend> projects, DateTime now) {
    final widest = projects.fold(1, (m, p) => p.total > m ? p.total : m);
    Widget legend(Color c, String label) => Row(mainAxisSize: MainAxisSize.min, children: [
          Container(width: 7, height: 7, decoration: BoxDecoration(color: c, borderRadius: BorderRadius.circular(2))),
          const SizedBox(width: 4),
          Text(label, style: const TextStyle(fontSize: 11, color: FC.muted)),
        ]);
    return FCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('By project · ${monthLabel(monthKeyOf(now)).split(' ').first}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
              legend(FC.green, 'Paid'),
              const SizedBox(width: 10),
              legend(const Color(0xFFE2A93B), 'In approval'),
            ],
          ),
          for (final p in projects) ...[
            const SizedBox(height: 14),
            InkWell(
              onTap: () => _show(ApproverTab.history, query: p.code),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
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
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: Container(
                      height: 8,
                      color: const Color(0xFFF1F2F4),
                      alignment: Alignment.centerLeft,
                      child: FractionallySizedBox(
                        widthFactor: p.total / widest,
                        child: Row(
                          children: [
                            if (p.paid > 0) Expanded(flex: p.paid, child: const ColoredBox(color: FC.green, child: SizedBox.expand())),
                            if (p.paid > 0 && p.inApproval > 0) const SizedBox(width: 2),
                            if (p.inApproval > 0) Expanded(flex: p.inApproval, child: const ColoredBox(color: Color(0xFFE2A93B), child: SizedBox.expand())),
                          ],
                        ),
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

  Widget _recentCard(List<FinanceRequest> handled, List<FinanceRequest> scope, ApproverRole role) {
    final names = ref.watch(financeUserNamesProvider).value ?? const <String, String>{};
    final now = DateTime.now();
    return FCard(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(role == ApproverRole.finance ? 'Recently handled by you' : 'After your approval', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
          for (final r in handled.take(4))
            () {
              final v = viewOf(r, [...scope, r], now);
              return InkWell(
                onTap: () => widget.onOpen(r),
                child: Container(
                  margin: const EdgeInsets.only(top: 10),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  decoration: const BoxDecoration(border: Border(top: BorderSide(color: FC.divider))),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('${r.number} · ${formatRupees(paisa(v.amount))}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                            const SizedBox(height: 2),
                            Text([if ((names[r.requesterId] ?? '').isNotEmpty) names[r.requesterId]!, r.purpose].join(' · '),
                                maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: FC.muted)),
                          ],
                        ),
                      ),
                      const SizedBox(width: 10),
                      StagePill(v.stage),
                    ],
                  ),
                ),
              );
            }(),
        ],
      ),
    );
  }

  /// The viewer's own advances and settlements: a manager seldom raises one, so
  /// it is one quiet card with the way to raise another, not a tab of its own.
  Widget _ownCard(List<FinanceRequest> mine, DateTime now) {
    final open = [for (final r in mine) if (r.isAdvance) viewOf(r, mine, now)].where((v) => v.stage == Stage.paid || v.stage == Stage.review).toList();
    final inFlight = mine.where((r) => RequestStatus.pending.contains(r.status)).length;
    return FCard(
      key: const Key('own-requests'),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(child: Text('Your own requests', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
              if (widget.onNew != null)
                InkWell(
                  key: const Key('raise-request'),
                  onTap: widget.onNew,
                  child: const Text('Raise a request', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: FC.link)),
                ),
            ],
          ),
          if (open.isEmpty && inFlight == 0)
            const Padding(
              padding: EdgeInsets.only(top: 8),
              child: Text('You have no advances or settlements open.', style: TextStyle(fontSize: 13, color: FC.muted)),
            ),
          for (final v in open)
            InkWell(
              onTap: () => widget.onOpen(v.request),
              child: Container(
                margin: const EdgeInsets.only(top: 10),
                padding: const EdgeInsets.only(top: 12),
                decoration: const BoxDecoration(border: Border(top: BorderSide(color: FC.divider))),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('${v.request.number} · ${formatRupees(paisa(v.request.balance?.outstanding ?? v.amount))}', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 2),
                          Text(v.hint, style: TextStyle(fontSize: 12, color: v.hintColor)),
                        ],
                      ),
                    ),
                    if (v.stage == Stage.paid)
                      SizedBox(
                        height: 34,
                        child: OutlinedButton(
                          key: Key('settle-${v.request.id}'),
                          style: OutlinedButton.styleFrom(
                            side: const BorderSide(color: Color(0xFFC9CCD3)),
                            padding: const EdgeInsets.symmetric(horizontal: 14),
                            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(17)),
                          ),
                          onPressed: () => widget.onSettle(v.request),
                          child: const Text('Settle', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: FC.ink)),
                        ),
                      ),
                  ],
                ),
              ),
            ),
          if (inFlight > 0)
            InkWell(
              onTap: () => _show(ApproverTab.history, history: historyFilters.indexOf('Mine')),
              child: Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text('$inFlight of your requests ${inFlight == 1 ? 'is' : 'are'} in approval · See all', style: const TextStyle(fontSize: 12, color: FC.link)),
              ),
            ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------- Queue

  Widget _queueList(List<FinanceRequest> queue, List<FinanceRequest> scope, Map<String, String> names, DateTime now) {
    const kinds = [('all', 'All'), (RequestKind.advance, 'Advances'), (RequestKind.settlement, 'Settlements'), (RequestKind.reimbursement, 'Reimbursements')];
    final sorted = [...queue]..sort((a, b) => ageDays(b, now).compareTo(ageDays(a, now)));
    int countOf(String k) => k == 'all' ? sorted.length : sorted.where((r) => r.kind == k).length;
    final shown = sorted.where((r) => _kind == 'all' || r.kind == _kind).toList();
    final total = shown.fold(0, (t, r) => t + paisa(r.approvedAmount ?? r.requestedAmount));
    final advances = {for (final r in scope) if (r.isAdvance) r.id: r};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        FilterChips(
          labels: [for (final (k, l) in kinds) '$l ${countOf(k)}'],
          selected: kinds.indexWhere0(_kind),
          onSelect: (i) => setState(() => _kind = kinds[i].$1),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 130),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${shown.length} waiting · ${formatRupees(total)}', style: const TextStyle(fontSize: 12, color: FC.muted)),
              const SizedBox(height: 12),
              if (shown.isEmpty)
                const Padding(padding: EdgeInsets.symmetric(vertical: 40), child: Center(child: Text('Nothing waiting here.', style: TextStyle(fontSize: 14, color: FC.muted)))),
              for (final r in shown) ...[
                () {
                  final v = viewOf(r, scope, now);
                  return ApproverCard(
                    view: v,
                    requester: names[r.requesterId] ?? '',
                    age: ageDays(r, now),
                    hint: _hintFor(v, advances),
                    onTap: () => widget.onOpen(r),
                  );
                }(),
                const SizedBox(height: 12),
              ],
            ],
          ),
        ),
      ],
    );
  }

  // ----------------------------------------------------------------- History

  Widget _historyList(List<FinanceRequest> scope, Map<String, String> names, DateTime now) {
    final viewerId = widget.viewer.id;
    // History is what the viewer has acted on and what is theirs. Requests still on their way to
    // them are not history yet (they show on the Overview), and open advances stay so that the
    // cash-with-engineers rows have somewhere to lead.
    final pool = <String, FinanceRequest>{};
    for (final r in ref.watch(handledFinanceRequestsProvider).value ?? const <FinanceRequest>[]) {
      pool[r.id] = r;
    }
    for (final r in ref.watch(myFinanceRequestsProvider).value ?? const <FinanceRequest>[]) {
      pool[r.id] = r;
    }
    for (final r in scope) {
      if (r.isAdvance && r.status == 'PAID' && !(r.balance?.isClosed ?? false)) pool[r.id] = r;
    }
    final all = pool.values.toList()..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    final context = [...scope, ...all.where((r) => !scope.any((x) => x.id == r.id))];
    final q = _query.trim().toLowerCase();
    final filter = historyFilters[_history.clamp(0, historyFilters.length - 1)];
    final advances = {for (final r in all) if (r.isAdvance) r.id: r};
    final shown = [
      for (final r in all)
        if (_matches(r, q, names)) viewOf(r, context, now),
    ].where((v) => matchesHistoryFilter(filter, v, viewerId)).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 14, 20, 0),
          child: Container(
            height: 44,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: FC.field)),
            child: Row(
              children: [
                const Icon(Icons.search_rounded, size: 20, color: FC.faint),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    key: const Key('finance-search'),
                    controller: _search,
                    onChanged: (v) => setState(() => _query = v),
                    style: const TextStyle(fontSize: 15),
                    decoration: const InputDecoration(
                      hintText: 'Search number, engineer, project',
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      filled: false,
                      isDense: true,
                    ),
                  ),
                ),
                if (_query.isNotEmpty)
                  InkWell(
                    onTap: () {
                      _search.clear();
                      setState(() => _query = '');
                    },
                    child: Container(
                      width: 22,
                      height: 22,
                      decoration: const BoxDecoration(color: Color(0xFFE9EAEE), shape: BoxShape.circle),
                      child: const Icon(Icons.close_rounded, size: 13, color: Color(0xFF5D636D)),
                    ),
                  ),
              ],
            ),
          ),
        ),
        FilterChips(labels: historyFilters, selected: _history, onSelect: (i) => setState(() => _history = i)),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 130),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(shown.length == 1 ? '1 record' : '${shown.length} records', style: const TextStyle(fontSize: 12, color: FC.muted)),
              const SizedBox(height: 12),
              if (shown.isEmpty)
                const Padding(padding: EdgeInsets.symmetric(vertical: 40), child: Center(child: Text('No records match.', style: TextStyle(fontSize: 14, color: FC.muted)))),
              for (final v in shown) ...[
                ApproverCard(
                  view: v,
                  requester: names[v.request.requesterId] ?? '',
                  hint: _hintFor(v, advances),
                  onTap: () => widget.onOpen(v.request),
                ),
                const SizedBox(height: 12),
              ],
            ],
          ),
        ),
      ],
    );
  }

  bool _matches(FinanceRequest r, String q, Map<String, String> names) {
    if (q.isEmpty) return true;
    return [r.number, r.purpose, r.projectCode ?? '', r.projectName ?? '', names[r.requesterId] ?? '', r.categoryName ?? '']
        .join(' ')
        .toLowerCase()
        .contains(q);
  }
}

extension on List<(String, String)> {
  int indexWhere0(String key) {
    final i = indexWhere((e) => e.$1 == key);
    return i < 0 ? 0 : i;
  }
}
