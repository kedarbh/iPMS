import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../../../core/network/api_exceptions.dart';
import '../../auth/providers/auth_provider.dart';
import '../domain/finance_models.dart';
import '../domain/finance_rules.dart';
import '../domain/finance_view.dart';
import '../providers/finance_providers.dart';
import 'advance_form_screen.dart';
import 'approver_widgets.dart';
import 'expenses_form_screen.dart';
import 'finance_action_sheets.dart';
import 'finance_widgets.dart';
import 'invoice_photo_viewer.dart';

/// One step of the Progress card.
class ProgressStep {
  const ProgressStep({required this.title, required this.sub, this.done = false, this.error = false, this.current = false});

  final String title;
  final String sub;
  final bool done;
  final bool error;
  final bool current;
}

String _who(Map<String, String> names, String id) {
  final name = names[id];
  if (name != null && name.isNotEmpty) return name;
  return id.length > 8 ? '${id.substring(0, 8)}…' : id;
}

/// The Progress card's steps for [r], from its status and history.
///
/// An advance goes: submitted, project manager, project director, finance
/// pays, settled. A request raised by a project manager skips the first
/// approval, so that step is left out when nobody ever held it there.
List<ProgressStep> progressSteps(FinanceRequest r, Stage stage, Map<String, String> names) {
  final h = r.history.where((e) => e.revision == r.revision).toList();
  ApprovalEntry? at(String step, {Set<String> actions = const {'APPROVED', 'PAID'}}) {
    for (final e in h.reversed) {
      if (e.step == step && actions.contains(e.action)) return e;
    }
    return null;
  }

  String stamp(ApprovalEntry? e) =>
      e == null ? '' : '${_who(names, e.actorId)} · ${DateFormat('d MMM').format(e.at)}';
  final submitted = r.history.where((e) => e.action == 'SUBMITTED').toList();
  final submittedOn = submitted.isEmpty ? r.createdAt : submitted.first.at;

  final includesPm = r.status == 'PENDING_PM' ||
      r.history.any((e) => e.step == 'PM') ||
      const {'DRAFT', 'RETURNED', 'REJECTED', 'CANCELLED'}.contains(r.status);

  // Which step the request is at: 0 submitted, then each approval, then the last.
  final labels = <String>[
    'Submitted',
    if (includesPm) 'Project manager approval',
    'Project director approval',
    r.kind == RequestKind.settlement ? 'Finance closure' : 'Finance payment',
    if (r.isAdvance) 'Settlement',
  ];
  final stepKeys = <String>[
    'SUBMIT',
    if (includesPm) 'PM',
    'DIRECTOR',
    'FINANCE',
    if (r.isAdvance) 'SETTLE',
  ];

  final current = switch (r.status) {
    'DRAFT' => 0,
    'PENDING_PM' => stepKeys.indexOf('PM'),
    'PENDING_DIRECTOR' => stepKeys.indexOf('DIRECTOR'),
    'PENDING_FINANCE' => stepKeys.indexOf('FINANCE'),
    'PAID' => r.isAdvance ? stepKeys.indexOf('SETTLE') : stepKeys.length,
    'SETTLED' => stepKeys.length,
    _ => stepKeys.indexOf(r.history.isNotEmpty ? (r.history.last.step == 'REQUESTER' ? 'SUBMIT' : r.history.last.step) : 'SUBMIT'),
  };
  final failed = const {'RETURNED', 'REJECTED', 'CANCELLED'}.contains(r.status);
  final settledAdvance = stage == Stage.settled && r.isAdvance;

  return [
    for (var i = 0; i < stepKeys.length; i++)
      () {
        final key = stepKeys[i];
        final isCurrent = i == current && !settledAdvance;
        final done = i < current || settledAdvance || (r.status == 'SETTLED' && !r.isAdvance);
        final err = isCurrent && failed;
        var title = labels[i];
        var sub = switch (key) {
          'SUBMIT' => DateFormat('d MMM yyyy').format(submittedOn),
          'PM' => stamp(at('PM')),
          'DIRECTOR' => stamp(at('DIRECTOR')),
          'FINANCE' => stamp(at('FINANCE')),
          _ => '',
        };
        if (key == 'SETTLE') {
          sub = settledAdvance
              ? 'Closed'
              : stage == Stage.review
                  ? 'In review'
                  : r.settlementDueOn != null
                      ? 'Due ${DateFormat('d MMM yyyy').format(r.settlementDueOn!)}'
                      : 'Within 7 days of payment';
        }
        if (err) {
          title = switch (r.status) {
            'RETURNED' => 'Returned for changes',
            'REJECTED' => 'Rejected',
            _ => 'Cancelled',
          };
        }
        if (isCurrent && r.status == 'DRAFT') {
          title = 'Draft';
          sub = 'Not yet submitted';
        }
        return ProgressStep(title: title, sub: sub, done: done, error: err, current: isCurrent);
      }(),
  ];
}

class RequestDetailScreen extends ConsumerStatefulWidget {
  const RequestDetailScreen({super.key, required this.requestId});

  final String requestId;

  @override
  ConsumerState<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends ConsumerState<RequestDetailScreen> {
  bool _busy = false;

  void _message(String text, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(text),
      behavior: SnackBarBehavior.floating,
      backgroundColor: error ? FC.red : null,
    ));
  }

  void _refresh() {
    ref.invalidate(financeRequestProvider(widget.requestId));
    ref.invalidate(myFinanceRequestsProvider);
    ref.invalidate(awaitingFinanceRequestsProvider);
  }

  Future<void> _run(Future<void> Function() action, String done) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
      _refresh();
      _message(done);
    } on ApiException catch (e) {
      _message(e.message, error: true);
    } catch (e) {
      _message('$e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel(FinanceRequest request) async {
    final reason = TextEditingController();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Text('Cancel ${request.number}?'),
        content: TextField(controller: reason, maxLength: 1000, decoration: const InputDecoration(labelText: 'Reason (optional)')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep it')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: FC.red, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Cancel request'),
          ),
        ],
      ),
    );
    final text = reason.text;
    reason.dispose();
    if (confirmed != true) return;
    await _run(() => ref.read(financeRepositoryProvider).cancel(request.id, comment: text), 'Request cancelled.');
  }

  Future<void> _open(Widget screen) async {
    await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => screen));
    _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authStateProvider).value;
    final viewer = FinanceViewer(id: user?.id ?? '', permissions: user?.permissions ?? const []);
    final names = ref.watch(financeUserNamesProvider).value ?? const <String, String>{};
    final all = ref.watch(myFinanceRequestsProvider).value ?? const <FinanceRequest>[];
    final async = ref.watch(financeRequestProvider(widget.requestId));
    final now = DateTime.now();

    return Scaffold(
      backgroundColor: FC.bg,
      body: SafeArea(
        child: async.when(
          loading: () => const Column(children: [FinanceHeader(title: ''), Expanded(child: Center(child: CircularProgressIndicator()))]),
          error: (e, _) => Column(children: [
            const FinanceHeader(title: 'Request'),
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text(e.toString(), textAlign: TextAlign.center, style: const TextStyle(color: FC.muted)),
                    TextButton(onPressed: _refresh, child: const Text('Retry')),
                  ]),
                ),
              ),
            ),
          ]),
          data: (r) => _body(r, viewer, names, all, now),
        ),
      ),
    );
  }

  Widget _body(FinanceRequest r, FinanceViewer viewer, Map<String, String> names, List<FinanceRequest> all, DateTime now) {
    final view = viewOf(r, [...all.where((x) => x.id != r.id), r], now);
    final isSettlement = r.kind == RequestKind.settlement;
    final advance = isSettlement && r.advanceId != null ? ref.watch(financeRequestProvider(r.advanceId!)).value : null;
    // An advance is settled once, until that settlement is decided: while one is
    // under review, or the balance is closed, there is nothing to settle.
    final actions = availableActions(r, viewer)
        .where((a) => a != FinanceAction.settle || view.stage == Stage.paid)
        .toList();
    const mine = {FinanceAction.edit, FinanceAction.submit, FinanceAction.cancel, FinanceAction.settle};
    final approverActions = actions.where((a) => !mine.contains(a)).toList();
    final steps = progressSteps(r, view.stage, names);
    final window = r.settlementWindow(now);
    final payout = r.payments.where((p) => !p.isCashReturn).firstOrNull;
    final settlementsOfAdvance = r.isAdvance ? all.where((s) => s.advanceId == r.id).toList() : const <FinanceRequest>[];
    final comments = r.history.where((e) => (e.comment ?? '').isNotEmpty).toList();

    // The summary for a settlement: the advance, what was spent, VAT, and the balance.
    int spent = paisa(r.requestedAmount);
    final advanced = advance == null ? null : paisa(advance.approvedAmount ?? advance.requestedAmount);
    final vat = r.invoices.fold<int>(0, (t, i) => t + paisa(i.vatAmount));

    final approverView = r.requesterId != viewer.id && viewer.hasApprovals;
    final scope = approverView ? ref.watch(scopeFinanceRequestsProvider).value ?? const <FinanceRequest>[] : const <FinanceRequest>[];
    final openAdvances = scope.where((x) => x.requesterId == r.requesterId && x.isAdvance && x.status == 'PAID' && !(x.balance?.isClosed ?? false)).length;
    // A settlement still under review is measured against what is outstanding, not what was first paid.
    final basis = (advance?.balance != null && r.status != 'SETTLED') ? paisa(advance!.balance!.outstanding) : advanced;
    final settleDiff = isSettlement && basis != null ? basis - spent : null;
    final canRemind = approverView && viewer.can('finance_request.view_all') && r.isAdvance && r.status == 'PAID' && view.stage == Stage.paid && (window?.overdue ?? false);

    var (primary, onPrimary, secondary, onSecondary, destructive) = _bar(r, actions);
    if (approverView) {
      (primary, onPrimary, secondary, onSecondary, destructive) = _approverBar(r, approverActions, canRemind: canRemind, advance: advance, diff: settleDiff, names: names);
    }

    return Column(
      children: [
        FinanceHeader(
          title: r.number,
          trailing: Padding(padding: const EdgeInsets.only(right: 8), child: StagePill(view.stage)),
        ),
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => ref.refresh(financeRequestProvider(widget.requestId).future).then((_) {}, onError: (_) {}),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
              children: [
                Text('${view.typeLabel} · ${r.categoryName ?? ''}', style: const TextStyle(fontSize: 13, color: FC.muted)),
                const SizedBox(height: 4),
                Text(r.purpose, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600, height: 1.3)),
                const SizedBox(height: 8),
                Text(formatMoney(view.amount), style: money(32, weight: FontWeight.w700).copyWith(letterSpacing: -0.6)),
                if (view.hint.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(view.hint, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: view.hintColor)),
                  ),
                const SizedBox(height: 14),
                if (r.duplicates.isNotEmpty) ...[
                  _duplicateWarning(r.duplicates),
                  const SizedBox(height: 14),
                ],
                if (approverView) ...[
                  _requesterCard(r, names, openAdvances),
                  const SizedBox(height: 14),
                ],
                if (isSettlement) ...[
                  FCard(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    child: Column(children: [
                      FactRow(approverView ? 'Advance paid${advance == null ? '' : ' · ${advance.number}'}' : 'Advance received', advanced == null ? '—' : formatMoney(_str(advanced))),
                      FactRow(approverView ? 'Spent on invoices' : 'Spent', formatMoney(r.requestedAmount)),
                      FactRow('VAT on bills', formatMoney(_str(vat))),
                      FactRow(
                        settleDiff == null
                            ? 'Difference'
                            : r.status == 'SETTLED'
                                ? (settleDiff > 0 ? 'Balance returned' : settleDiff < 0 ? 'Excess claimed' : 'Difference')
                                : (settleDiff > 0 ? 'Balance to return' : settleDiff < 0 ? 'Excess to pay' : 'Difference'),
                        settleDiff == null ? '—' : formatMoney(_str(settleDiff.abs())),
                        bold: true,
                        last: true,
                        valueColor: settleDiff == null ? null : settleDiff > 0 ? FC.green : settleDiff < 0 ? FC.amber : null,
                      ),
                    ]),
                  ),
                  const SizedBox(height: 14),
                  const Text('Expenses', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  for (final i in r.invoices) ...[_expense(i), const SizedBox(height: 10)],
                ] else if (r.invoices.isNotEmpty) ...[
                  const Text('Expenses', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 8),
                  for (final i in r.invoices) ...[_expense(i), const SizedBox(height: 10)],
                ],
                if (r.balance != null) ...[
                  FCard(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                    child: Column(children: [
                      FactRow('Paid', formatMoney(r.balance!.paid)),
                      FactRow('Settled with receipts', formatMoney(r.balance!.applied)),
                      FactRow('Cash returned', formatMoney(r.balance!.cashReturned)),
                      FactRow('Outstanding', formatMoney(r.balance!.outstanding), bold: true, last: true),
                    ]),
                  ),
                  const SizedBox(height: 14),
                ],
                FCard(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  child: Column(children: [
                    FactRow('Project', [r.projectCode, r.projectName].whereType<String>().join(' · ')),
                    FactRow('Requested by', _who(names, r.requesterId)),
                    FactRow(isSettlement ? 'Submitted on' : 'Requested on', shortDate(r.createdAt)),
                    if (window != null)
                      FactRow(
                        'Settle by',
                        window.overdue ? '${shortDate(r.settlementDueOn!)} (${window.daysLate} day${window.daysLate == 1 ? '' : 's'} late)' : shortDate(r.settlementDueOn!),
                        valueColor: window.overdue ? FC.red : null,
                      ),
                    if (payout != null) FactRow('Paid via', [payout.modeLabel, if (payout.reference.isNotEmpty) payout.reference].join(' · ')),
                    for (final p in r.payments.where((p) => p.isCashReturn)) FactRow('Balance returned', '${formatMoney(p.amount)} · ${p.modeLabel}'),
                    if (isSettlement && r.advanceId != null)
                      FactRow(
                        'Linked advance',
                        advance?.number ?? 'View advance',
                        onTap: () => _open(RequestDetailScreen(requestId: r.advanceId!)),
                      ),
                    for (final s in settlementsOfAdvance)
                      FactRow('Settlement', s.number, onTap: () => _open(RequestDetailScreen(requestId: s.id))),
                    FactRow('Category', r.categoryName ?? '—', last: true),
                  ]),
                ),
                const SizedBox(height: 14),
                FCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Progress', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 14),
                      for (var i = 0; i < steps.length; i++) _step(steps[i], last: i == steps.length - 1),
                    ],
                  ),
                ),
                const SizedBox(height: 14),
                FCard(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(approverView ? 'Activity' : 'Comments', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                      const SizedBox(height: 12),
                      if (!approverView && comments.isEmpty) const Text('No comments yet.', style: TextStyle(fontSize: 13, color: FC.faint)),
                      if (approverView)
                        for (final c in r.history.reversed) _comment(c, names, kind: r.kind)
                      else
                        for (final c in comments) _comment(c, names, kind: r.kind),
                    ],
                  ),
                ),
                if (approverActions.contains(FinanceAction.cashReturn)) ...[
                  const SizedBox(height: 14),
                  _cashReturnButton(r),
                ],
              ],
            ),
          ),
        ),
        if (primary != null || secondary != null)
          ActionBar(primary: primary, onPrimary: onPrimary, secondary: secondary, onSecondary: onSecondary, busy: _busy, destructive: destructive),
      ],
    );
  }

  static String _str(int paisaValue) => '${paisaValue ~/ 100}.${(paisaValue % 100).toString().padLeft(2, '0')}';

  Widget _duplicateWarning(List<DuplicateHit> hits) {
    return FCard(
      padding: const EdgeInsets.all(14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(children: [
            Icon(Icons.warning_amber_rounded, size: 18, color: FC.red),
            SizedBox(width: 8),
            Flexible(child: Text('Possible duplicate bill', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: FC.red))),
          ]),
          for (final h in hits)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: InkWell(
                onTap: () => _open(RequestDetailScreen(requestId: h.requestId)),
                child: Text.rich(TextSpan(children: [
                  TextSpan(text: h.number, style: const TextStyle(fontWeight: FontWeight.w600, decoration: TextDecoration.underline)),
                  TextSpan(text: ' — ${h.explanation}'),
                ]), style: const TextStyle(fontSize: 13, height: 1.4)),
              ),
            ),
        ],
      ),
    );
  }

  Widget _expense(RequestInvoice i) {
    return FCard(
      padding: const EdgeInsets.all(12),
      child: Row(
        children: [
          InkWell(
            onTap: i.mediaId == null
                ? null
                : () => Navigator.push<void>(context, MaterialPageRoute(builder: (_) => InvoicePhotoViewer(mediaId: i.mediaId!))),
            child: Container(
              width: 52,
              height: 52,
              decoration: BoxDecoration(color: const Color(0xFFECEDF0), borderRadius: BorderRadius.circular(10)),
              alignment: Alignment.center,
              child: Text(
                i.mediaId == null ? 'NO PHOTO' : 'RECEIPT',
                style: const TextStyle(fontSize: 9, fontWeight: FontWeight.w600, color: FC.faint, fontFamily: 'Menlo'),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(i.vendor, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(
                  [
                    shortDate(i.invoiceDate),
                    if (i.vat) 'VAT bill${(i.supplierTaxNo ?? '').isEmpty ? '' : ' · ${i.supplierTaxNo}'}' else 'Non-VAT',
                    if ((i.invoiceNumber ?? '').isNotEmpty) '#${i.invoiceNumber}',
                  ].join(' · '),
                  style: const TextStyle(fontSize: 12, color: FC.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Text(formatMoney(i.amount), style: money(14)),
        ],
      ),
    );
  }

  Widget _step(ProgressStep s, {required bool last}) {
    final bg = s.done ? FC.green : s.error ? FC.red : Colors.white;
    final bd = s.done ? FC.green : s.error ? FC.red : s.current ? FC.navy : const Color(0xFFD1D5DB);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 22,
            child: Column(
              children: [
                Container(
                  width: 22,
                  height: 22,
                  decoration: BoxDecoration(color: bg, shape: BoxShape.circle, border: Border.all(color: bd, width: 2)),
                  child: s.done
                      ? const Icon(Icons.check_rounded, size: 13, color: Colors.white)
                      : s.error
                          ? const Icon(Icons.close_rounded, size: 12, color: Colors.white)
                          : null,
                ),
                if (!last) Expanded(child: Container(width: 2, margin: const EdgeInsets.symmetric(vertical: 3), color: s.done ? FC.green : FC.field)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.only(bottom: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(s.title, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: s.done || s.current ? FC.ink : FC.faint)),
                  if (s.sub.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(s.sub, style: const TextStyle(fontSize: 12, color: FC.muted)),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  static const Map<String, String> _verbs = {
    'SUBMITTED': 'submitted',
    'APPROVED': 'approved',
    'RETURNED': 'returned for changes',
    'REJECTED': 'rejected',
    'CANCELLED': 'cancelled',
    'PAID': 'recorded payment',
    'CASH_RETURNED': 'confirmed balance received',
    'REMINDED': 'sent a reminder',
  };

  Widget _comment(ApprovalEntry c, Map<String, String> names, {required String kind}) {
    final name = _who(names, c.actorId);
    var verb = _verbs[c.action] ?? c.action.toLowerCase();
    if (c.action == 'PAID' && kind == RequestKind.settlement) verb = 'closed the settlement';
    if (c.amount != null && const {'APPROVED', 'PAID', 'CASH_RETURNED'}.contains(c.action) && paisa(c.amount!) > 0) verb += ' ${formatRupees(paisa(c.amount!))}';
    final hasComment = (c.comment ?? '').isNotEmpty;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          PersonAvatar(name),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text.rich(
                  TextSpan(children: [
                    TextSpan(text: name, style: const TextStyle(fontWeight: FontWeight.w600)),
                    TextSpan(text: ' $verb', style: const TextStyle(color: Color(0xFF5D636D))),
                    TextSpan(text: ' · ${DateFormat('d MMM').format(c.at)}', style: const TextStyle(color: FC.faint)),
                  ]),
                  style: const TextStyle(fontSize: 13, height: 1.4),
                ),
                if (hasComment) ...[
                  const SizedBox(height: 3),
                  Text(c.comment!, style: const TextStyle(fontSize: 14, height: 1.45, color: Color(0xFF2B3038))),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// The engineer's own action bar: (primary, onPrimary, secondary, onSecondary, secondaryIsDestructive).
  (String?, VoidCallback?, String?, VoidCallback?, bool) _bar(FinanceRequest r, List<FinanceAction> actions) {
    final repo = ref.read(financeRepositoryProvider);
    if (actions.contains(FinanceAction.settle)) {
      return ('Settle this advance', () => _open(ExpensesFormScreen(kind: RequestKind.settlement, advance: r)), null, null, false);
    }
    void edit() => _open(r.isAdvance ? AdvanceFormScreen(initial: r) : ExpensesFormScreen(kind: r.kind, initial: r));
    if (actions.contains(FinanceAction.edit) && actions.contains(FinanceAction.submit)) {
      if (r.status == 'RETURNED') {
        return ('Edit and resubmit', edit, null, null, false);
      }
      return ('Edit draft', edit, 'Submit', () => _run(() => repo.submit(r.id), 'Request submitted.'), false);
    }
    if (actions.contains(FinanceAction.cancel)) {
      return (null, null, 'Cancel request', () => _cancel(r), true);
    }
    return (null, null, null, null, false);
  }

  /// The approver's pinned bar: approve or pay on the right, return or reject on the left.
  (String?, VoidCallback?, String?, VoidCallback?, bool) _approverBar(
    FinanceRequest r,
    List<FinanceAction> actions, {
    required bool canRemind,
    required FinanceRequest? advance,
    required int? diff,
    required Map<String, String> names,
  }) {
    final declines = actions.contains(FinanceAction.returnToRequester) || actions.contains(FinanceAction.reject);
    final who = (names[r.requesterId] ?? '').isEmpty ? 'the engineer' : names[r.requesterId]!.split(' ').first;
    if (actions.contains(FinanceAction.approve)) {
      return ('Approve', () => _approve(r), declines ? 'Return or reject' : null, declines ? () => _decline(r, who) : null, false);
    }
    if (actions.contains(FinanceAction.pay)) {
      final isSettlement = r.kind == RequestKind.settlement;
      final label = !isSettlement
          ? 'Record payment'
          : diff == null
              ? 'Settle'
              : diff > 0
                  ? 'Confirm balance received'
                  : diff < 0
                      ? 'Pay excess'
                      : 'Close settlement';
      return (label, () => _pay(r, advance, diff, names), declines ? 'Return' : null, declines ? () => _decline(r, who) : null, false);
    }
    if (canRemind) return ('Send reminder', () => _remind(r), null, null, false);
    return (null, null, null, null, false);
  }

  Future<void> _approve(FinanceRequest r) async {
    final choice = await askApproval(context, r, setsAmount: r.status == 'PENDING_DIRECTOR');
    if (choice == null) return;
    final next = r.status == 'PENDING_PM' ? 'Approved. Sent to the project director.' : 'Approved. Sent to finance for payment.';
    await _run(() => ref.read(financeRepositoryProvider).approve(r.id, amount: choice.amount, comment: choice.comment), next);
  }

  Future<void> _decline(FinanceRequest r, String who) async {
    final choice = await askDecline(context, r, who: who);
    if (choice == null) return;
    final repo = ref.read(financeRepositoryProvider);
    await _run(
      () => choice.reject ? repo.reject(r.id, choice.reason) : repo.returnToRequester(r.id, choice.reason),
      choice.reject ? 'Rejected. $who has been told.' : 'Returned to $who.',
    );
  }

  Future<void> _remind(FinanceRequest r) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      final sent = await ref.read(financeRepositoryProvider).remind(r.id);
      _refresh();
      _message(sent ? 'Reminder sent' : 'They were reminded earlier today');
    } on ApiException catch (e) {
      _message(e.message, error: true);
    } catch (e) {
      _message('$e', error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _pay(FinanceRequest r, FinanceRequest? advance, int? diff, Map<String, String> names) async {
    final isSettlement = r.kind == RequestKind.settlement;
    final amount = r.approvedAmount ?? r.requestedAmount;
    final rows = <(String, String, bool)>[];
    var need = DetailsNeed.required;
    var modeLabel = 'Paid by';
    var title = 'Record payment';
    var button = 'Pay ${formatMoney(amount)}';
    var done = 'Payment recorded.';
    if (isSettlement) {
      final paid = advance == null ? null : formatMoney(advance.approvedAmount ?? advance.requestedAmount);
      if (paid != null) rows.add(('Advance paid', paid, false));
      rows.add(('Spent on invoices', formatMoney(amount), false));
      if (diff == null) {
        need = DetailsNeed.optional;
        title = 'Settle ${r.number}';
        button = 'Confirm settlement';
        done = 'Settled.';
      } else if (diff > 0) {
        rows.add(('Balance to receive', formatMoney(_str(diff)), true));
        modeLabel = 'Received as';
        title = 'Confirm balance received';
        button = 'Confirm and close';
        done = 'Settlement closed. The advance is settled.';
      } else if (diff < 0) {
        rows.add(('Excess to pay', formatMoney(_str(-diff)), true));
        title = 'Pay excess';
        button = 'Pay and close';
        done = 'Excess paid. The advance is settled.';
      } else {
        need = DetailsNeed.none;
        rows.add(('Difference', formatMoney('0.00'), true));
        title = 'Close settlement';
        button = 'Close settlement';
        done = 'Settlement closed. The advance is settled.';
      }
    } else {
      rows.add(('Pay to', (names[r.requesterId] ?? '').isEmpty ? '—' : names[r.requesterId]!, false));
      rows.add(('Amount', formatMoney(amount), true));
    }
    final details = await askPaymentDetails(
      context,
      title: title,
      subtitle: '${r.number} · approved ${formatMoney(amount)}',
      button: button,
      rows: rows,
      need: need,
      modeLabel: modeLabel,
    );
    if (details == null) return;
    final body = {...details, if (isSettlement && diff != null && diff > 0) 'balanceReceived': true};
    await _run(() => ref.read(financeRepositoryProvider).pay(r.id, body), done);
  }

  Widget _cashReturnButton(FinanceRequest r) {
    return OutlinedButton.icon(
      style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50), shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(25))),
      onPressed: _busy
          ? null
          : () async {
              final details = await askPaymentDetails(
                context,
                title: 'Record returned cash',
                subtitle: '${r.number} · outstanding ${formatMoney(r.balance?.outstanding)}',
                button: 'Record cash return',
                modeLabel: 'Received as',
                withAmount: true,
                rows: [('Outstanding', formatMoney(r.balance?.outstanding), true)],
              );
              if (details == null) return;
              await _run(() => ref.read(financeRepositoryProvider).returnCash(r.id, details), 'Cash return recorded.');
            },
      icon: const Icon(Icons.undo_rounded, size: 18),
      label: const Text('Record returned cash'),
    );
  }

  /// Who raised it: their name, what they are, and how much cash they hold.
  Widget _requesterCard(FinanceRequest r, Map<String, String> names, int openAdvances) {
    final name = _who(names, r.requesterId);
    return FCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      child: Row(
        children: [
          PersonAvatar(name, size: 40),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                const SizedBox(height: 2),
                Text(
                  '${r.raisedByManager ? 'Project manager' : 'Field engineer'} · ${openAdvances == 0 ? 'No open advances' : '$openAdvances open advance${openAdvances == 1 ? '' : 's'}'}',
                  style: const TextStyle(fontSize: 12, color: FC.muted),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
