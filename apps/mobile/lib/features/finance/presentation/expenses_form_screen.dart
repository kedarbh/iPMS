import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:uuid/uuid.dart';
import '../../../core/network/api_exceptions.dart';
import '../../media/providers/evidence_upload_provider.dart';
import '../../projects/providers/project_providers.dart';
import '../domain/finance_models.dart';
import '../domain/finance_view.dart';
import '../providers/finance_providers.dart';
import 'finance_widgets.dart';
import 'form_parts.dart';
import 'request_detail_screen.dart';

/// One expense being typed: what was paid for, the amount, its receipt photo
/// and whether it is a VAT bill. Each owns its fields so removing one in the
/// middle keeps what was typed in the others.
class _Line {
  _Line({String desc = '', String amount = '', String taxNo = '', String number = '', this.vat = false, this.mediaId, this.saved = false, DateTime? date})
      : desc = TextEditingController(text: desc),
        amount = TextEditingController(text: amount),
        taxNo = TextEditingController(text: taxNo),
        number = TextEditingController(text: number),
        date = date ?? DateTime.now();

  final TextEditingController desc;
  final TextEditingController amount;
  final TextEditingController taxNo;
  final TextEditingController number;
  bool vat;
  final DateTime date;

  /// The receipt photo in the media bucket, once it is there.
  String? mediaId;

  /// [mediaId] came with the saved request: already on the record, not to be discarded.
  final bool saved;
  File? photo;
  bool uploading = false;
  String? photoError;

  bool get photoPending => uploading || photoError != null;
  bool get hasReceipt => mediaId != null && !photoPending;
  bool get complete => desc.text.trim().isNotEmpty && isValidMoney(amount.text) && hasReceipt;

  void dispose() {
    desc.dispose();
    amount.dispose();
    taxNo.dispose();
    number.dispose();
  }

  RequestInvoice toInvoice() => RequestInvoice(
        vendor: desc.text,
        invoiceDate: date,
        amount: amount.text,
        invoiceNumber: number.text,
        vat: vat,
        supplierTaxNo: taxNo.text,
        mediaId: hasReceipt ? mediaId : null,
      );
}

/// A settlement against a paid advance, or a reimbursement: expense lines each
/// with a receipt photo and an optional VAT bill, and (for a settlement) the
/// balance to return or excess to claim.
class ExpensesFormScreen extends ConsumerStatefulWidget {
  const ExpensesFormScreen({super.key, required this.kind, this.advance, this.initial});

  /// [RequestKind.settlement] or [RequestKind.reimbursement].
  final String kind;

  /// The paid advance being settled; chosen on the screen when null.
  final FinanceRequest? advance;

  /// The draft or returned request being edited.
  final FinanceRequest? initial;

  @override
  ConsumerState<ExpensesFormScreen> createState() => _ExpensesFormScreenState();
}

class _ExpensesFormScreenState extends ConsumerState<ExpensesFormScreen> {
  final List<_Line> _lines = [];
  late final TextEditingController _title = TextEditingController(text: widget.initial?.purpose ?? '');
  late FinanceRequest? _advance = widget.advance;
  late String? _project = widget.initial?.projectId;
  late String? _category = widget.initial?.categoryId;
  bool _tried = false;
  bool _busy = false;
  String? _error;

  bool get _isSettlement => widget.kind == RequestKind.settlement;
  bool get _editing => widget.initial != null;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    if (initial != null) {
      for (final i in initial.invoices) {
        _lines.add(_Line(
          desc: i.vendor,
          amount: i.amount,
          taxNo: i.supplierTaxNo ?? '',
          number: i.invoiceNumber ?? '',
          vat: i.vat,
          mediaId: i.mediaId,
          saved: i.mediaId != null,
          date: i.invoiceDate,
        ));
      }
    }
    if (_lines.isEmpty) _lines.add(_Line());
  }

  @override
  void dispose() {
    _title.dispose();
    for (final l in _lines) {
      l.dispose();
    }
    super.dispose();
  }

  String? get _photoProject => _advance?.projectId ?? widget.initial?.projectId ?? _project;

  int get _spent => _lines.fold(0, (t, l) => t + (isValidMoney(l.amount.text) ? paisa(l.amount.text) : 0));
  int get _vat => _lines.fold(0, (t, l) => t + (l.vat && isValidMoney(l.amount.text) ? paisa(vatIncluded(l.amount.text)) : 0));

  bool get _valid {
    if (_isSettlement && _advance == null && !_editing) return false;
    if (!_isSettlement && !_editing && (_project == null || _category == null || _title.text.trim().isEmpty)) return false;
    if (_editing && !_isSettlement && (_category == null || _title.text.trim().isEmpty)) return false;
    return _lines.isNotEmpty && _lines.every((l) => l.complete);
  }

  // --- receipts -------------------------------------------------------------

  Future<void> _addReceipt(_Line line) async {
    if (_photoProject == null) {
      setState(() => _error = 'Choose the project first; the receipt is filed under it.');
      return;
    }
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.photo_camera_outlined), title: const Text('Take a photo'), onTap: () => Navigator.pop(ctx, ImageSource.camera)),
          ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('Choose from gallery'), onTap: () => Navigator.pop(ctx, ImageSource.gallery)),
        ]),
      ),
    );
    if (source == null) return;
    final picked = await ImagePicker().pickImage(source: source, imageQuality: 85, maxWidth: 2048, maxHeight: 2048);
    if (picked == null || !mounted) return;
    setState(() {
      // A new object each time, so a retaken receipt never reuses an id.
      line
        ..mediaId = const Uuid().v7()
        ..photo = File(picked.path);
    });
    await _uploadReceipt(line);
  }

  Future<void> _uploadReceipt(_Line line) async {
    final file = line.photo;
    final id = line.mediaId;
    final project = _photoProject;
    if (file == null || id == null || project == null) return;
    setState(() {
      line.uploading = true;
      line.photoError = null;
    });
    try {
      await ref.read(invoicePhotoUploaderProvider).upload(projectId: project, mediaId: id, bytes: await file.readAsBytes());
      if (mounted) setState(() => line.uploading = false);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          line.uploading = false;
          line.photoError = e.message;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          line.uploading = false;
          line.photoError = 'Upload failed: $e';
        });
      }
    }
  }

  void _dropReceipt(_Line line) {
    final id = line.mediaId;
    if (id != null && !line.saved && !line.uploading) {
      unawaited(ref.read(mediaRepositoryProvider).discardFinanceDocument(id).catchError((_) {}));
    }
    setState(() {
      line
        ..mediaId = null
        ..photo = null
        ..photoError = null
        ..uploading = false;
    });
  }

  // --- saving ---------------------------------------------------------------

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
    final invoices = _lines.map((l) => l.toInvoice().toJson()).toList();
    var id = widget.initial?.id;
    try {
      if (_editing) {
        await repo.update(id!, {
          if (!_isSettlement) 'categoryId': _category,
          if (!_isSettlement) 'purpose': _title.text.trim(),
          'invoices': invoices,
        });
      } else if (_isSettlement) {
        final a = _advance!;
        id = (await repo.create({
          'kind': RequestKind.settlement,
          'advanceId': a.id,
          'categoryId': a.categoryId,
          'purpose': a.purpose,
          'invoices': invoices,
        }))
            .id;
      } else {
        id = (await repo.create({
          'kind': RequestKind.reimbursement,
          'projectId': _project,
          'categoryId': _category,
          'purpose': _title.text.trim(),
          'invoices': invoices,
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
      final label = _isSettlement ? 'Settlement' : 'Reimbursement';
      navigator.pushReplacement(MaterialPageRoute<void>(builder: (_) => RequestDetailScreen(requestId: id!)));
      messenger.showSnackBar(SnackBar(
        content: Text(submit ? '$label sent for approval' : 'Saved as draft'),
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
    final a = _advance;
    if (a != null) ref.invalidate(financeRequestProvider(a.id));
  }

  // --- build ----------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final title = _editing
        ? 'Edit ${widget.initial!.number}'
        : _isSettlement
            ? 'Submit settlement'
            : 'New reimbursement';
    final projects = ref.watch(projectListProvider);
    final categories = ref.watch(financeCategoriesProvider);
    final all = ref.watch(myFinanceRequestsProvider).value ?? const <FinanceRequest>[];
    final now = DateTime.now();
    final open = [for (final r in all) if (r.isAdvance && stageOf(r, all) == Stage.paid) viewOf(r, all, now)]
      ..sort((a, b) => (a.daysLeft ?? 1 << 30).compareTo(b.daysLeft ?? 1 << 30));

    return Scaffold(
      backgroundColor: FC.bg,
      body: SafeArea(
        child: Column(
          children: [
            FinanceHeader(title: title, close: true),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
                children: [
                  if (widget.initial?.lastReviewComment != null && widget.initial?.status == 'RETURNED')
                    Container(
                      margin: const EdgeInsets.only(bottom: 18),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      decoration: BoxDecoration(color: const Color(0xFFFEF4E2), borderRadius: BorderRadius.circular(14)),
                      child: Text(widget.initial!.lastReviewComment!, style: const TextStyle(fontSize: 13, height: 1.45, color: Color(0xFF7A4A00))),
                    ),
                  if (_isSettlement) _advanceBlock(open) else ..._reimbursementHeader(projects, categories),
                  const SizedBox(height: 18),
                  const Text('Expenses', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 10),
                  for (var i = 0; i < _lines.length; i++) ...[_lineCard(i), const SizedBox(height: 12)],
                  SizedBox(
                    height: 46,
                    child: OutlinedButton.icon(
                      style: OutlinedButton.styleFrom(
                        side: const BorderSide(color: Color(0xFFC9CCD3)),
                        backgroundColor: Colors.white,
                        foregroundColor: FC.ink,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onPressed: _lines.length >= 100 ? null : () => setState(() => _lines.add(_Line())),
                      icon: const Icon(Icons.add_rounded, size: 18),
                      label: const Text('Add expense', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                    ),
                  ),
                  const SizedBox(height: 18),
                  _summary(),
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
              primary: _isSettlement ? 'Submit settlement' : 'Submit reimbursement',
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

  Widget _advanceBlock(List<RecordView> open) {
    final a = _advance;
    return FormSection(
      label: 'Linked advance',
      error: _tried && a == null && !_editing ? 'Choose the advance you are settling' : null,
      child: _editing
          ? _advanceSummary(null)
          : a != null
              ? _advanceSummary(a)
              : Column(
                  children: [
                    if (open.isEmpty)
                      const Padding(padding: EdgeInsets.symmetric(vertical: 12), child: Align(alignment: Alignment.centerLeft, child: Text('No paid advances waiting for settlement.', style: TextStyle(fontSize: 14, color: FC.muted)))),
                    for (final v in open)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(14),
                          onTap: () => setState(() => _advance = v.request),
                          child: Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: FC.field)),
                            child: Row(
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(v.request.purpose, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                                      const SizedBox(height: 2),
                                      Text('${v.request.number} · ${v.request.projectCode ?? ''}', style: const TextStyle(fontSize: 12, color: FC.muted)),
                                    ],
                                  ),
                                ),
                                Column(
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(formatRupees(v.amountPaisa), style: money(14)),
                                    const SizedBox(height: 2),
                                    Text(
                                      v.daysLeft == null ? '' : v.daysLeft! < 0 ? 'Overdue ${-v.daysLeft!} days' : '${v.daysLeft} days left',
                                      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: (v.daysLeft ?? 0) < 0 ? FC.red : (v.daysLeft ?? 9) <= 2 ? FC.amber : FC.indigo),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
    );
  }

  Widget _advanceSummary(FinanceRequest? a) {
    final r = a ?? widget.initial!;
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: FC.navy, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${a?.number ?? 'Settlement'} · ${r.projectCode ?? ''}', style: const TextStyle(fontSize: 12, color: Color(0xFFB9BED0))),
                const SizedBox(height: 2),
                Text(r.purpose, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Colors.white)),
                if (a != null) ...[
                  const SizedBox(height: 4),
                  Text('${formatMoney(a.approvedAmount ?? a.requestedAmount)} received', style: money(13, weight: FontWeight.w400, color: Colors.white)),
                ],
              ],
            ),
          ),
          if (a != null && widget.advance == null)
            OutlinedButton(
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: Color(0xFF3A4266)),
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(17)),
              ),
              onPressed: () => setState(() => _advance = null),
              child: const Text('Change', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            ),
        ],
      ),
    );
  }

  List<Widget> _reimbursementHeader(AsyncValue projects, AsyncValue<List<ExpenseCategory>> categories) {
    return [
      FormSection(
        label: 'Project / site',
        error: _tried && _project == null && !_editing ? 'Choose a project' : null,
        child: _editing
            ? FCard(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                child: Text([widget.initial!.projectCode, widget.initial!.projectName].whereType<String>().join(' · '), style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
              )
            : ref.watch(projectListProvider).when(
                  loading: () => const LinearProgressIndicator(),
                  error: (e, _) => Text('Could not load projects: $e', style: const TextStyle(color: FC.red)),
                  data: (list) => ProjectCards(projects: list, selected: _project, onPick: (id) => setState(() => _project = id)),
                ),
      ),
      const SizedBox(height: 18),
      FormSection(
        label: 'Purpose / category',
        error: _tried && _category == null ? 'Choose a category' : null,
        child: categories.when(
          loading: () => const LinearProgressIndicator(),
          error: (e, _) => Text('Could not load categories: $e', style: const TextStyle(color: FC.red)),
          data: (list) => CategoryChips(categories: list, selected: _category, onPick: (id) => setState(() => _category = id)),
        ),
      ),
      const SizedBox(height: 18),
      FormSection(
        label: 'Title',
        error: _tried && _title.text.trim().isEmpty ? 'Add a short title' : null,
        child: TextField(
          controller: _title,
          maxLength: 500,
          textCapitalization: TextCapitalization.sentences,
          onChanged: (_) => setState(() {}),
          style: const TextStyle(fontSize: 15),
          decoration: fieldDecoration('e.g. Fuel for the survey', error: _tried && _title.text.trim().isEmpty).copyWith(counterText: ''),
        ),
      ),
    ];
  }

  Widget _lineCard(int index) {
    final l = _lines[index];
    final descBad = _tried && l.desc.text.trim().isEmpty;
    final amtBad = _tried && !isValidMoney(l.amount.text);
    final receiptBad = _tried && !l.hasReceipt;
    return Container(
      key: ObjectKey(l),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: FC.border)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('EXPENSE ${index + 1}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: FC.muted, letterSpacing: 0.5)),
              if (_lines.length > 1)
                InkWell(
                  onTap: () => setState(() {
                    final removed = _lines.removeAt(index);
                    _dropReceipt(removed);
                    removed.dispose();
                  }),
                  child: const Text('Remove', style: TextStyle(fontSize: 13, color: FC.red, fontWeight: FontWeight.w500)),
                ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: l.desc,
            onChanged: (_) => setState(() {}),
            textCapitalization: TextCapitalization.sentences,
            style: const TextStyle(fontSize: 14),
            decoration: fieldDecoration('What did you pay for?', error: descBad, radius: 10).copyWith(contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12)),
          ),
          const SizedBox(height: 10),
          AmountField(controller: l.amount, onChanged: (_) => setState(() {}), error: amtBad, compact: true),
          const SizedBox(height: 10),
          _receipt(l, receiptBad),
          const SizedBox(height: 8),
          InkWell(
            onTap: () => setState(() => l.vat = !l.vat),
            child: Row(
              children: [
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('VAT bill', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                      Text('13% VAT included in amount', style: TextStyle(fontSize: 12, color: FC.muted)),
                    ],
                  ),
                ),
                Switch.adaptive(value: l.vat, activeTrackColor: FC.green, onChanged: (v) => setState(() => l.vat = v)),
              ],
            ),
          ),
          if (l.vat) ...[
            const SizedBox(height: 4),
            Row(
              children: [
                Expanded(child: TextField(controller: l.taxNo, maxLength: 50, style: const TextStyle(fontSize: 13), decoration: fieldDecoration('Supplier PAN/VAT no.', radius: 10).copyWith(counterText: '', contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11)))),
                const SizedBox(width: 8),
                Expanded(child: TextField(controller: l.number, maxLength: 100, style: const TextStyle(fontSize: 13), decoration: fieldDecoration('Invoice no.', radius: 10).copyWith(counterText: '', contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11)))),
              ],
            ),
            const SizedBox(height: 8),
            Text.rich(
              TextSpan(children: [
                const TextSpan(text: 'VAT portion: ', style: TextStyle(color: FC.muted)),
                TextSpan(text: formatMoney(isValidMoney(l.amount.text) ? vatIncluded(l.amount.text) : '0.00'), style: const TextStyle(fontWeight: FontWeight.w600, color: FC.ink)),
              ]),
              style: const TextStyle(fontSize: 12),
            ),
          ],
        ],
      ),
    );
  }

  Widget _receipt(_Line l, bool bad) {
    if (l.mediaId == null) {
      return InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: _busy ? null : () => _addReceipt(l),
        child: Container(
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(10), border: Border.all(color: bad ? FC.red : const Color(0xFFC9CCD3), width: 1.5)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.photo_camera_outlined, size: 18, color: bad ? FC.red : const Color(0xFF3F4550)),
              const SizedBox(width: 8),
              Text('Add receipt photo', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500, color: bad ? FC.red : const Color(0xFF3F4550))),
            ],
          ),
        ),
      );
    }
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(color: l.photoError != null ? FC.redBg : const Color(0xFFF6F7F9), borderRadius: BorderRadius.circular(10)),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox(
              width: 44,
              height: 44,
              child: l.photo != null ? Image.file(l.photo!, fit: BoxFit.cover) : const ColoredBox(color: Color(0xFFE3E5EA), child: Icon(Icons.image_outlined, size: 20)),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: l.uploading
                ? const Row(children: [SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)), SizedBox(width: 8), Text('Uploading…', style: TextStyle(fontSize: 12))])
                : l.photoError != null
                    ? Text(l.photoError!, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: FC.red))
                    : const Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Receipt', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                          Text('Receipt attached', style: TextStyle(fontSize: 12, color: FC.green)),
                        ],
                      ),
          ),
          if (l.photoError != null && l.photo != null) TextButton(onPressed: () => _uploadReceipt(l), child: const Text('Retry')),
          if (!l.uploading) TextButton(onPressed: () => _addReceipt(l), child: const Text('Retake', style: TextStyle(fontWeight: FontWeight.w600, color: FC.link))),
          if (!l.uploading) IconButton(visualDensity: VisualDensity.compact, icon: const Icon(Icons.close_rounded, size: 18), tooltip: 'Remove photo', onPressed: () => _dropReceipt(l)),
        ],
      ),
    );
  }

  Widget _summary() {
    if (!_isSettlement) {
      return FCard(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
        child: Column(children: [
          FactRow('Total', formatRupees(_spent), bold: true),
          FactRow('VAT included', formatRupees(_vat), last: true),
        ]),
      );
    }
    final a = _advance;
    final advanced = a == null ? null : paisa(a.approvedAmount ?? a.requestedAmount);
    final diff = advanced == null ? 0 : advanced - _spent;
    return FCard(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FactRow('Advance received', advanced == null ? '—' : formatRupees(advanced)),
          FactRow('Total spent', formatRupees(_spent)),
          FactRow('VAT included', formatRupees(_vat)),
          Padding(
            padding: const EdgeInsets.only(top: 14, bottom: 4),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Flexible(child: Text(diff > 0 ? 'Balance to return' : diff < 0 ? 'Excess to claim' : 'Fully utilised', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600))),
                const SizedBox(width: 8),
                Text(
                  formatRupees(diff.abs()),
                  style: money(18, weight: FontWeight.w700, color: diff > 0 ? FC.green : diff < 0 ? FC.amber : FC.ink),
                ),
              ],
            ),
          ),
          if (diff > 0 && advanced != null)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text('Hand the unused balance to finance; they record it against this advance.', style: TextStyle(fontSize: 13, color: FC.muted, height: 1.45)),
            ),
          if (diff < 0)
            const Padding(
              padding: EdgeInsets.only(top: 6),
              child: Text('The excess is paid back to you after your project manager and director approve this settlement.', style: TextStyle(fontSize: 13, color: FC.muted, height: 1.45)),
            ),
        ],
      ),
    );
  }
}
