import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import 'package:uuid/uuid.dart';
import '../../../core/network/api_exceptions.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../media/providers/evidence_upload_provider.dart';
import '../../projects/providers/project_providers.dart';
import '../domain/finance_models.dart';
import '../providers/finance_providers.dart';
import 'invoice_photo_viewer.dart';

/// One invoice being typed. Each row owns its fields so removing one in the
/// middle keeps what was typed in the others.
class _InvoiceRow {
  _InvoiceRow({String vendor = '', String number = '', String amount = '', this.date, this.mediaId, this.saved = false})
      : vendor = TextEditingController(text: vendor),
        number = TextEditingController(text: number),
        amount = TextEditingController(text: amount);

  final TextEditingController vendor;
  final TextEditingController number;
  final TextEditingController amount;
  DateTime? date;

  /// The invoice photo in the media bucket, once it is there.
  String? mediaId;

  /// [mediaId] came with the saved request, so it is already on the record
  /// and must not be discarded when removed here.
  final bool saved;

  /// The photo just chosen on this phone, shown while and after it uploads.
  File? photo;
  bool uploading = false;
  String? photoError;

  /// Not ready to be sent: still uploading, or its upload failed.
  bool get photoPending => uploading || photoError != null;

  void dispose() {
    vendor.dispose();
    number.dispose();
    amount.dispose();
  }

  bool get isComplete =>
      vendor.text.trim().isNotEmpty && number.text.trim().isNotEmpty && date != null && isValidMoney(amount.text);

  RequestInvoice toInvoice() => RequestInvoice(
        vendor: vendor.text,
        invoiceNumber: number.text,
        invoiceDate: date!,
        amount: amount.text,
        mediaId: photoPending ? null : mediaId,
      );
}

/// Raises an advance or a reimbursement, settles a paid advance ([advance]),
/// or edits a draft or returned request ([initial]). The kind and project
/// are fixed once a request exists.
class RequestFormScreen extends ConsumerStatefulWidget {
  const RequestFormScreen({super.key, required this.kind, this.advance, this.initial});

  final String kind;

  /// The paid advance being settled.
  final FinanceRequest? advance;

  /// The draft or returned request being edited.
  final FinanceRequest? initial;

  @override
  ConsumerState<RequestFormScreen> createState() => _RequestFormScreenState();
}

class _RequestFormScreenState extends ConsumerState<RequestFormScreen> {
  final _purpose = TextEditingController();
  final _amount = TextEditingController();
  final List<_InvoiceRow> _rows = [];
  String? _projectId;
  String? _categoryId;
  bool _busy = false;
  String? _error;

  bool get _editing => widget.initial != null;
  bool get _usesInvoices => widget.kind != RequestKind.advance;

  @override
  void initState() {
    super.initState();
    final initial = widget.initial;
    if (initial != null) {
      _purpose.text = initial.purpose;
      _categoryId = initial.categoryId;
      _projectId = initial.projectId;
      if (initial.isAdvance) _amount.text = initial.requestedAmount;
      for (final i in initial.invoices) {
        _rows.add(_InvoiceRow(
          vendor: i.vendor,
          number: i.invoiceNumber,
          amount: i.amount,
          date: i.invoiceDate,
          mediaId: i.mediaId,
          saved: i.mediaId != null,
        ));
      }
    }
    if (_usesInvoices && _rows.isEmpty) _rows.add(_InvoiceRow());
  }

  @override
  void dispose() {
    _purpose.dispose();
    _amount.dispose();
    for (final r in _rows) {
      r.dispose();
    }
    super.dispose();
  }

  String get _title => _editing
      ? 'Edit ${widget.initial!.number}'
      : switch (widget.kind) {
          RequestKind.advance => 'New advance',
          RequestKind.settlement => 'Settle advance',
          _ => 'New reimbursement',
        };

  String get _total => sumMoney(_rows.map((r) => isValidMoney(r.amount.text) ? r.amount.text : '0'));

  bool get _valid {
    if (_categoryId == null || _purpose.text.trim().isEmpty) return false;
    if (!_editing && widget.kind != RequestKind.settlement && _projectId == null) return false;
    if (widget.kind == RequestKind.advance) return isValidMoney(_amount.text);
    return _rows.isNotEmpty && _rows.every((r) => r.isComplete && !r.photoPending);
  }

  /// The project the request is for, which the photo is filed under.
  String? get _photoProjectId => widget.advance?.projectId ?? widget.initial?.projectId ?? _projectId;

  Future<void> _pickDate(_InvoiceRow row) async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: row.date ?? now,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
    );
    if (picked != null) setState(() => row.date = picked);
  }

  Future<void> _addPhoto(_InvoiceRow row) async {
    if (_photoProjectId == null) {
      setState(() => _error = 'Choose the project first; the photo is filed under it.');
      return;
    }
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              onTap: () => Navigator.pop(ctx, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Choose from gallery'),
              onTap: () => Navigator.pop(ctx, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null) return;
    final picked = await ImagePicker().pickImage(source: source, imageQuality: 85, maxWidth: 2048, maxHeight: 2048);
    if (picked == null || !mounted) return;
    setState(() {
      // A new object each time, so a replaced photo never reuses an id.
      row
        ..mediaId = const Uuid().v7()
        ..photo = File(picked.path);
    });
    await _uploadPhoto(row);
  }

  Future<void> _uploadPhoto(_InvoiceRow row) async {
    final file = row.photo;
    final mediaId = row.mediaId;
    final projectId = _photoProjectId;
    if (file == null || mediaId == null || projectId == null) return;
    setState(() {
      row.uploading = true;
      row.photoError = null;
    });
    try {
      await ref.read(invoicePhotoUploaderProvider).upload(
            projectId: projectId,
            mediaId: mediaId,
            bytes: await file.readAsBytes(),
          );
      if (mounted) setState(() => row.uploading = false);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          row.uploading = false;
          row.photoError = e.message;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          row.uploading = false;
          row.photoError = 'Upload failed: $e';
        });
      }
    }
  }

  void _removePhoto(_InvoiceRow row) {
    final id = row.mediaId;
    // A photo that never reached a submission is thrown away on the server
    // too; one already on the saved request stays until it is resubmitted.
    if (id != null && !row.saved && !row.uploading) {
      unawaited(ref.read(mediaRepositoryProvider).discardFinanceDocument(id).catchError((_) {}));
    }
    setState(() {
      row
        ..mediaId = null
        ..photo = null
        ..photoError = null
        ..uploading = false;
    });
  }

  /// Saves, then submits when [submit]. A failed submit leaves the request
  /// saved as a draft, and says so.
  Future<void> _save({required bool submit}) async {
    if (!_valid || _busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final repo = ref.read(financeRepositoryProvider);
    String? savedId = widget.initial?.id;
    try {
      if (_editing) {
        final body = <String, dynamic>{
          'categoryId': _categoryId,
          'purpose': _purpose.text.trim(),
          if (widget.kind == RequestKind.advance) 'amount': _amount.text.trim() else
            'invoices': _rows.map((r) => r.toInvoice().toJson()).toList(),
        };
        await repo.update(savedId!, body);
      } else {
        final common = {'categoryId': _categoryId, 'purpose': _purpose.text.trim()};
        final body = switch (widget.kind) {
          RequestKind.advance => {'kind': widget.kind, 'projectId': _projectId, 'amount': _amount.text.trim(), ...common},
          RequestKind.reimbursement => {
              'kind': widget.kind,
              'projectId': _projectId,
              'invoices': _rows.map((r) => r.toInvoice().toJson()).toList(),
              ...common,
            },
          _ => {
              'kind': widget.kind,
              'advanceId': widget.advance!.id,
              'invoices': _rows.map((r) => r.toInvoice().toJson()).toList(),
              ...common,
            },
        };
        savedId = (await repo.create(body)).id;
      }
      if (submit) {
        try {
          await repo.submit(savedId);
        } on ApiException catch (e) {
          _refresh(savedId);
          if (mounted) {
            setState(() => _error = 'Saved as a draft, but it could not be submitted: ${e.message}');
          }
          return;
        }
      }
      _refresh(savedId);
      if (!mounted) return;
      Navigator.pop(context, true);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(submit ? 'Request submitted.' : 'Saved as a draft.'), behavior: SnackBarBehavior.floating),
      );
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
    if (widget.advance != null) ref.invalidate(financeRequestProvider(widget.advance!.id));
  }

  @override
  Widget build(BuildContext context) {
    final projects = ref.watch(projectListProvider);
    final categories = ref.watch(financeCategoriesProvider);
    final advance = widget.advance;
    final needsProject = !_editing && widget.kind != RequestKind.settlement;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      appBar: AppBar(title: Text(_title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.bold))),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          children: [
            if (widget.initial?.lastReviewComment != null)
              Container(
                margin: const EdgeInsets.only(bottom: 14),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: AppColors.statusBlockedBg, borderRadius: BorderRadius.circular(12)),
                child: Text(
                  widget.initial!.lastReviewComment!,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.statusBlockedText),
                ),
              ),
            if (advance != null)
              Container(
                margin: const EdgeInsets.only(bottom: 14),
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: AppColors.primaryLavenderLight, borderRadius: BorderRadius.circular(12)),
                child: Text(
                  'Settling ${advance.number}. ${formatMoney(advance.balance?.outstanding)} is still outstanding. '
                  'Anything above that is paid back to you.'
                  '${advance.settlementWindow(DateTime.now()) == null ? '' : ' ${advance.settlementWindow(DateTime.now())!.label}.'}',
                  style: AppTypography.bodySmall.copyWith(color: AppColors.darkSlate),
                ),
              ),
            if (needsProject) ...[
              projects.when(
                loading: () => const LinearProgressIndicator(),
                error: (e, _) => Text('Could not load projects: $e', style: AppTypography.bodySmall),
                data: (list) => DropdownButtonFormField<String>(
                  initialValue: _projectId,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Project', prefixIcon: Icon(Icons.business_outlined)),
                  items: [
                    for (final p in list)
                      DropdownMenuItem(value: p.id, child: Text('${p.code} — ${p.name}', overflow: TextOverflow.ellipsis)),
                  ],
                  onChanged: (v) => setState(() => _projectId = v),
                ),
              ),
              const SizedBox(height: 14),
            ],
            categories.when(
              loading: () => const LinearProgressIndicator(),
              error: (e, _) => Text('Could not load categories: $e', style: AppTypography.bodySmall),
              data: (list) => DropdownButtonFormField<String>(
                initialValue: list.any((c) => c.id == _categoryId) ? _categoryId : null,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Category', prefixIcon: Icon(Icons.category_outlined)),
                items: [for (final c in list) DropdownMenuItem(value: c.id, child: Text(c.name))],
                onChanged: (v) => setState(() => _categoryId = v),
              ),
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _purpose,
              maxLength: 500,
              minLines: 1,
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(labelText: 'What is it for?', prefixIcon: Icon(Icons.notes_rounded)),
              onChanged: (_) => setState(() {}),
            ),
            if (widget.kind == RequestKind.advance) ...[
              const SizedBox(height: 6),
              TextField(
                controller: _amount,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                decoration: InputDecoration(
                  labelText: 'Amount (NPR)',
                  hintText: '50000.00',
                  prefixIcon: const Icon(Icons.payments_outlined),
                  errorText: _amount.text.isNotEmpty && !isValidMoney(_amount.text)
                      ? 'Enter an amount with at most two decimals'
                      : null,
                ),
                onChanged: (_) => setState(() {}),
              ),
            ],
            if (_usesInvoices) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(child: Text('Invoices', style: AppTypography.titleMedium)),
                  Text('Total ${formatMoney(_total)}', style: AppTypography.titleMedium),
                ],
              ),
              const SizedBox(height: 8),
              for (var i = 0; i < _rows.length; i++) _invoiceCard(i),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: _rows.length >= 100 ? null : () => setState(() => _rows.add(_InvoiceRow())),
                  icon: const Icon(Icons.add_rounded, size: 18),
                  label: const Text('Add invoice'),
                ),
              ),
            ],
            if (_error != null) ...[
              const SizedBox(height: 10),
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(color: AppColors.statusBlockedBg, borderRadius: BorderRadius.circular(10)),
                child: Text(
                  _error!,
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.statusBlockedText),
                ),
              ),
            ],
            const SizedBox(height: 16),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    style: OutlinedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    onPressed: _valid && !_busy ? () => _save(submit: false) : null,
                    child: const Text('Save draft'),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.darkSlate,
                      foregroundColor: Colors.white,
                      minimumSize: const Size.fromHeight(48),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    ),
                    onPressed: _valid && !_busy ? () => _save(submit: true) : null,
                    child: _busy
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('Submit', style: TextStyle(fontWeight: FontWeight.w700)),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _invoiceCard(int index) {
    final row = _rows[index];
    return Card(
      key: ObjectKey(row),
      margin: const EdgeInsets.only(bottom: 10),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 12),
        child: Column(
          children: [
            Row(
              children: [
                Text('Invoice ${index + 1}', style: AppTypography.caption.copyWith(fontWeight: FontWeight.w700)),
                const Spacer(),
                if (_rows.length > 1)
                  IconButton(
                    visualDensity: VisualDensity.compact,
                    icon: const Icon(Icons.delete_outline_rounded, size: 20),
                    tooltip: 'Remove',
                    onPressed: () => setState(() => _rows.removeAt(index).dispose()),
                  ),
              ],
            ),
            TextField(
              controller: row.vendor,
              decoration: const InputDecoration(labelText: 'Vendor', isDense: true),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: row.number,
              decoration: const InputDecoration(labelText: 'Invoice number', isDense: true),
              onChanged: (_) => setState(() {}),
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: InkWell(
                    onTap: () => _pickDate(row),
                    child: InputDecorator(
                      decoration: const InputDecoration(labelText: 'Date', isDense: true),
                      child: Text(row.date == null ? 'Pick a date' : DateFormat('d MMM yyyy').format(row.date!)),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: row.amount,
                    keyboardType: const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                    decoration: InputDecoration(
                      labelText: 'Amount (NPR)',
                      isDense: true,
                      errorText: row.amount.text.isNotEmpty && !isValidMoney(row.amount.text) ? 'Invalid' : null,
                    ),
                    onChanged: (_) => setState(() {}),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            _photoBlock(row),
          ],
        ),
      ),
    );
  }

  Widget _photoBlock(_InvoiceRow row) {
    if (row.mediaId == null) {
      return Align(
        alignment: Alignment.centerLeft,
        child: OutlinedButton.icon(
          onPressed: _busy ? null : () => _addPhoto(row),
          icon: const Icon(Icons.add_a_photo_outlined, size: 18),
          label: const Text('Add invoice photo'),
        ),
      );
    }
    final ready = !row.uploading && row.photoError == null;
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: row.photoError != null ? AppColors.statusBlockedBg : AppColors.searchFieldBackground,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox(
              width: 54,
              height: 54,
              child: row.photo != null
                  ? Image.file(row.photo!, fit: BoxFit.cover)
                  : InkWell(
                      onTap: () => Navigator.push<void>(
                        context,
                        MaterialPageRoute(builder: (_) => InvoicePhotoViewer(mediaId: row.mediaId!)),
                      ),
                      child: const ColoredBox(color: Colors.black12, child: Icon(Icons.image_outlined)),
                    ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: row.uploading
                ? const Row(
                    children: [
                      SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                      SizedBox(width: 8),
                      Text('Uploading…', style: TextStyle(fontSize: 12)),
                    ],
                  )
                : row.photoError != null
                    ? Text(
                        row.photoError!,
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.statusBlockedText),
                      )
                    : const Row(
                        children: [
                          Icon(Icons.cloud_done_outlined, size: 16, color: Color(0xFF2E7D32)),
                          SizedBox(width: 6),
                          Text('Photo attached', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                        ],
                      ),
          ),
          if (row.photoError != null && row.photo != null)
            TextButton(onPressed: () => _uploadPhoto(row), child: const Text('Retry')),
          if (ready && row.photo == null)
            TextButton(
              onPressed: () => Navigator.push<void>(
                context,
                MaterialPageRoute(builder: (_) => InvoicePhotoViewer(mediaId: row.mediaId!)),
              ),
              child: const Text('View'),
            ),
          IconButton(
            visualDensity: VisualDensity.compact,
            icon: const Icon(Icons.close_rounded, size: 18),
            tooltip: 'Remove photo',
            onPressed: row.uploading ? null : () => _removePhoto(row),
          ),
        ],
      ),
    );
  }
}
