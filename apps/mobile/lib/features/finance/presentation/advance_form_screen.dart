import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/network/api_exceptions.dart';
import '../../projects/providers/project_providers.dart';
import '../domain/finance_models.dart';
import '../providers/finance_providers.dart';
import 'finance_widgets.dart';
import 'form_parts.dart';
import 'request_detail_screen.dart';

/// Request an advance, or edit a draft or returned one: project, category,
/// title and amount, then save a draft or send it for approval.
class AdvanceFormScreen extends ConsumerStatefulWidget {
  const AdvanceFormScreen({super.key, this.initial});

  final FinanceRequest? initial;

  @override
  ConsumerState<AdvanceFormScreen> createState() => _AdvanceFormScreenState();
}

class _AdvanceFormScreenState extends ConsumerState<AdvanceFormScreen> {
  late final TextEditingController _title = TextEditingController(text: widget.initial?.purpose ?? '');
  late final TextEditingController _remarks = TextEditingController(text: widget.initial?.remarks ?? '');
  late final TextEditingController _amount = TextEditingController(text: widget.initial?.requestedAmount ?? '');
  late String? _project = widget.initial?.projectId;
  late String? _category = widget.initial?.categoryId;
  bool _tried = false;
  bool _busy = false;
  String? _error;

  bool get _editing => widget.initial != null;

  String? get _remarksOrNull => _remarks.text.trim().isEmpty ? null : _remarks.text.trim();

  @override
  void dispose() {
    _title.dispose();
    _amount.dispose();
    _remarks.dispose();
    super.dispose();
  }

  bool get _valid => _project != null && _category != null && _title.text.trim().isNotEmpty && isValidMoney(_amount.text);

  Future<void> _save({required bool submit}) async {
    if (_busy) return;
    if (!_valid) {
      setState(() => _tried = true);
      showFinanceToast(context, 'Complete the highlighted fields');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final repo = ref.read(financeRepositoryProvider);
    var id = widget.initial?.id;
    try {
      if (_editing) {
        await repo.update(id!, {'categoryId': _category, 'purpose': _title.text.trim(), 'remarks': _remarksOrNull, 'amount': _amount.text.trim()});
      } else {
        id = (await repo.create({
          'kind': RequestKind.advance,
          'projectId': _project,
          'categoryId': _category,
          'purpose': _title.text.trim(),
          if (_remarksOrNull != null) 'remarks': _remarksOrNull,
          'amount': _amount.text.trim(),
        }))
            .id;
      }
      if (submit) {
        try {
          await repo.submit(id);
        } on ApiException catch (e) {
          _refresh(id);
          if (mounted) setState(() => _error = 'Saved as a draft, but it could not be submitted: ${e.message}');
          return;
        }
      }
      _refresh(id);
      if (!mounted) return;
      final navigator = Navigator.of(context);
      final messenger = ScaffoldMessenger.of(context);
      navigator.pushReplacement(MaterialPageRoute<void>(builder: (_) => RequestDetailScreen(requestId: id!)));
      messenger.showSnackBar(SnackBar(
        content: Text(submit ? 'Sent for approval' : 'Saved as draft'),
        behavior: SnackBarBehavior.floating,
        backgroundColor: FC.ink,
      ));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } catch (e) {
      if (mounted) setState(() => _error = 'Could not save: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _refresh(String id) {
    ref.invalidate(myFinanceRequestsProvider);
    ref.invalidate(financeRequestProvider(id));
  }

  @override
  Widget build(BuildContext context) {
    final projects = ref.watch(projectListProvider);
    final categories = ref.watch(financeCategoriesProvider);
    final returnNote = widget.initial?.status == 'RETURNED' ? widget.initial?.lastReviewComment : null;

    return Scaffold(
      backgroundColor: FC.bg,
      body: SafeArea(
        child: Column(
          children: [
            FinanceHeader(title: _editing ? 'Edit ${widget.initial!.number}' : 'Request advance', close: true),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                children: [
                  if (returnNote != null)
                    Container(
                      margin: const EdgeInsets.only(bottom: 20),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      decoration: BoxDecoration(color: const Color(0xFFFEF4E2), borderRadius: BorderRadius.circular(14)),
                      child: Text(returnNote, style: const TextStyle(fontSize: 13, height: 1.45, color: Color(0xFF7A4A00))),
                    ),
                  FormSection(
                    label: 'Project / site',
                    error: _tried && _project == null ? 'Choose a project' : null,
                    child: _editing
                        ? FCard(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            child: Text([widget.initial!.projectCode, widget.initial!.projectName].whereType<String>().join(' · '), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                          )
                        : projects.when(
                            loading: () => const LinearProgressIndicator(),
                            error: (e, _) => Text('Could not load projects: $e', style: const TextStyle(color: FC.red)),
                            data: (list) => ProjectCards(projects: list, selected: _project, onPick: (id) => setState(() => _project = id)),
                          ),
                  ),
                  const SizedBox(height: 20),
                  FormSection(
                    label: 'Purpose / category',
                    error: _tried && _category == null ? 'Choose a category' : null,
                    child: categories.when(
                      loading: () => const LinearProgressIndicator(),
                      error: (e, _) => Text('Could not load categories: $e', style: const TextStyle(color: FC.red)),
                      data: (list) => CategoryChips(categories: list, selected: _category, onPick: (id) => setState(() => _category = id)),
                    ),
                  ),
                  const SizedBox(height: 20),
                  FormSection(
                    label: 'Title',
                    error: _tried && _title.text.trim().isEmpty ? 'Add a short title' : null,
                    child: TextField(
                      controller: _title,
                      maxLength: 500,
                      textCapitalization: TextCapitalization.sentences,
                      onChanged: (_) => setState(() {}),
                      style: const TextStyle(fontSize: 15),
                      decoration: fieldDecoration('e.g. Cable trays for control room', error: _tried && _title.text.trim().isEmpty).copyWith(counterText: ''),
                    ),
                  ),
                  const SizedBox(height: 20),
                  FormSection(
                    label: 'Amount',
                    error: _tried && !isValidMoney(_amount.text) ? 'Enter an amount with at most two decimals' : null,
                    child: AmountField(controller: _amount, onChanged: (_) => setState(() {}), error: _tried && !isValidMoney(_amount.text)),
                  ),
                  const SizedBox(height: 20),
                  FormSection(
                    label: 'Remarks (optional)',
                    child: TextField(
                      controller: _remarks,
                      maxLength: 1000,
                      minLines: 3,
                      maxLines: 6,
                      textCapitalization: TextCapitalization.sentences,
                      style: const TextStyle(fontSize: 15),
                      decoration: fieldDecoration('Details on what the advance will cover').copyWith(counterText: ''),
                    ),
                  ),
                  const SizedBox(height: 20),
                  FCard(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Approval route', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                        const SizedBox(height: 6),
                        Wrap(
                          crossAxisAlignment: WrapCrossAlignment.center,
                          spacing: 8,
                          runSpacing: 4,
                          children: [
                            for (final (i, step) in ['You', 'Project manager', 'Project director', 'Finance pays'].indexed) ...[
                              if (i > 0) const Icon(Icons.chevron_right_rounded, size: 16, color: FC.faint),
                              Text(step, style: const TextStyle(fontSize: 13, color: Color(0xFF3F4550))),
                            ],
                          ],
                        ),
                        const SizedBox(height: 6),
                        const Text('Settle within 7 days of payment.', style: TextStyle(fontSize: 13, color: FC.muted)),
                      ],
                    ),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 14),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: FC.redBg, borderRadius: BorderRadius.circular(12)),
                      child: Text(_error!, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: FC.red)),
                    ),
                  ],
                ],
              ),
            ),
            ActionBar(
              primary: returnNote != null ? 'Resubmit' : 'Submit for approval',
              onPrimary: () => _save(submit: true),
              secondary: 'Save draft',
              onSecondary: () => _save(submit: false),
              busy: _busy,
            ),
          ],
        ),
      ),
    );
  }
}
