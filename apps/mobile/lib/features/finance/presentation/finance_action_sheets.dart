import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import '../domain/finance_models.dart';
import 'finance_widgets.dart';

/// Opens a bottom sheet in the design's frame: grabber, title, subtitle, then [children].
Future<T?> _sheet<T>(BuildContext context, {required String title, String? subtitle, required List<Widget> children}) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (ctx) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(ctx).viewInsets.bottom),
      child: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(child: Container(width: 36, height: 5, decoration: BoxDecoration(color: const Color(0xFFD9DBE0), borderRadius: BorderRadius.circular(3)))),
              const SizedBox(height: 16),
              Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
              if (subtitle != null) ...[
                const SizedBox(height: 3),
                Text(subtitle, style: const TextStyle(fontSize: 13, color: FC.muted, height: 1.4)),
              ],
              const SizedBox(height: 14),
              ...children,
            ],
          ),
        ),
      ),
    ),
  );
}

InputDecoration _field({String? hint, String? error, String? prefix}) => InputDecoration(
      hintText: hint,
      errorText: error,
      prefixText: prefix,
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: FC.field)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: FC.field)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: FC.navy)),
    );

Widget _label(String text) => Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(text, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
    );

/// Cancel and the confirming pill, side by side.
Widget _buttons(BuildContext context, {required String label, required VoidCallback? onPressed, Color color = FC.navy}) => Row(
      children: [
        Expanded(
          flex: 10,
          child: SizedBox(
            height: 52,
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(
                side: const BorderSide(color: Color(0xFFC9CCD3)),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
              ),
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: FC.ink)),
            ),
          ),
        ),
        const SizedBox(width: 10),
        Expanded(
          flex: 14,
          child: SizedBox(
            height: 52,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: color,
                foregroundColor: Colors.white,
                disabledBackgroundColor: color.withValues(alpha: 0.4),
                disabledForegroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
              ),
              onPressed: onPressed,
              child: Text(label, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
            ),
          ),
        ),
      ],
    );

/// What a manager or director decided on a request.
class ApprovalChoice {
  const ApprovalChoice({this.amount, this.comment});

  final String? amount;
  final String? comment;
}

/// Approve [request]. Only the director may set an amount, and never above what was asked ([setsAmount]).
Future<ApprovalChoice?> askApproval(BuildContext context, FinanceRequest request, {required bool setsAmount}) {
  return _sheet<ApprovalChoice>(
    context,
    title: 'Approve ${request.number}',
    subtitle: request.status == 'PENDING_PM' ? 'The project director reviews next.' : 'Finance pays it next.',
    children: [_ApprovalForm(request: request, setsAmount: setsAmount)],
  );
}

class _ApprovalForm extends StatefulWidget {
  const _ApprovalForm({required this.request, required this.setsAmount});

  final FinanceRequest request;
  final bool setsAmount;

  @override
  State<_ApprovalForm> createState() => _ApprovalFormState();
}

class _ApprovalFormState extends State<_ApprovalForm> {
  final _amount = TextEditingController();
  final _comment = TextEditingController();

  @override
  void dispose() {
    _amount.dispose();
    _comment.dispose();
    super.dispose();
  }

  /// Empty means approve as asked; otherwise a valid amount not above it.
  String? get _error {
    final a = _amount.text.trim();
    if (a.isEmpty) return null;
    if (!isValidMoney(a)) return 'Enter an amount with at most two decimals';
    if ((double.tryParse(a) ?? 0) > (double.tryParse(widget.request.requestedAmount) ?? 0)) {
      return 'Enter an amount up to ${formatMoney(widget.request.requestedAmount)}';
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final requested = formatMoney(widget.request.requestedAmount);
    final typed = _amount.text.trim();
    final reduced = typed.isNotEmpty && _error == null && (double.tryParse(typed) ?? 0) < (double.tryParse(widget.request.requestedAmount) ?? 0);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.setsAmount) ...[
          _label('Approved amount'),
          TextField(
            key: const Key('approve-amount'),
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
            decoration: _field(hint: widget.request.requestedAmount, error: _error, prefix: 'NPR '),
            onChanged: (_) => setState(() {}),
          ),
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              reduced ? 'Reduced from $requested' : 'Requested $requested. Leave empty to approve it in full.',
              style: TextStyle(fontSize: 12, color: reduced ? FC.amber : FC.muted),
            ),
          ),
          const SizedBox(height: 14),
        ] else ...[
          Text('Requested $requested', style: const TextStyle(fontSize: 13, color: FC.muted)),
          const SizedBox(height: 14),
        ],
        _label('Comment'),
        TextField(
          key: const Key('sheet-comment'),
          controller: _comment,
          minLines: 3,
          maxLines: 5,
          maxLength: 1000,
          textCapitalization: TextCapitalization.sentences,
          decoration: _field(hint: 'Optional note for the engineer'),
        ),
        const SizedBox(height: 6),
        _buttons(
          context,
          label: 'Approve',
          onPressed: _error != null ? null : () => Navigator.pop(context, ApprovalChoice(amount: _amount.text.trim(), comment: _comment.text.trim())),
        ),
      ],
    );
  }
}

/// A return or a rejection, with the reason it needs.
class DeclineChoice {
  const DeclineChoice({required this.reject, required this.reason});

  final bool reject;
  final String reason;
}

/// Return [request] for changes or reject it; either takes a reason the requester will see.
Future<DeclineChoice?> askDecline(BuildContext context, FinanceRequest request, {String who = 'the engineer'}) {
  return _sheet<DeclineChoice>(
    context,
    title: 'Return or reject ${request.number}',
    subtitle: '${formatMoney(request.approvedAmount ?? request.requestedAmount)} · ${request.purpose}',
    children: [_DeclineForm(who: who)],
  );
}

class _DeclineForm extends StatefulWidget {
  const _DeclineForm({required this.who});

  final String who;

  @override
  State<_DeclineForm> createState() => _DeclineFormState();
}

class _DeclineFormState extends State<_DeclineForm> {
  final _reason = TextEditingController();
  bool _reject = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Widget _choice(String label, bool reject) {
    final on = _reject == reject;
    return Expanded(
      child: InkWell(
        key: Key('decline-${label.toLowerCase()}'),
        borderRadius: BorderRadius.circular(9),
        onTap: () => setState(() => _reject = reject),
        child: Container(
          height: 36,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: on ? Colors.white : Colors.transparent,
            borderRadius: BorderRadius.circular(9),
            boxShadow: on ? [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 2, offset: const Offset(0, 1))] : null,
          ),
          child: Text(label, style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: on ? FC.ink : const Color(0xFF5D636D))),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final text = _reason.text.trim();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(color: const Color(0xFFE9EAEE), borderRadius: BorderRadius.circular(12)),
          child: Row(children: [_choice('Return', false), _choice('Reject', true)]),
        ),
        const SizedBox(height: 10),
        Text(
          _reject
              ? 'The request is closed. ${widget.who[0].toUpperCase()}${widget.who.substring(1)} must raise a new one.'
              : '${widget.who[0].toUpperCase()}${widget.who.substring(1)} can edit and resubmit. It restarts at the project manager.',
          style: const TextStyle(fontSize: 13, color: Color(0xFF5D636D), height: 1.45),
        ),
        const SizedBox(height: 14),
        _label('Reason'),
        TextField(
          key: const Key('sheet-comment'),
          controller: _reason,
          minLines: 3,
          maxLines: 5,
          maxLength: 1000,
          textCapitalization: TextCapitalization.sentences,
          decoration: _field(hint: _reject ? 'Why is this being rejected?' : 'What should ${widget.who} change?'),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 6),
        _buttons(
          context,
          label: _reject ? 'Reject request' : 'Return to engineer',
          color: _reject ? FC.red : FC.navy,
          onPressed: text.isEmpty ? null : () => Navigator.pop(context, DeclineChoice(reject: _reject, reason: text)),
        ),
      ],
    );
  }
}

/// How much a payment sheet asks about how the money moved.
enum DetailsNeed {
  /// Nothing moves (a settlement that exactly uses the advance): no questions.
  none,

  /// May or may not move: answer all or leave empty.
  optional,

  /// Money moves: mode and reference are needed.
  required,
}

/// Asks how a payment, or cash handed back, was made. Resolves to the fields
/// the server takes (`mode`, `reference`, `paidOn`, `note`, and `amount` for
/// returned cash), or null if dismissed. [rows] is the summary shown first.
Future<Map<String, dynamic>?> askPaymentDetails(
  BuildContext context, {
  required String title,
  required String subtitle,
  required String button,
  List<(String, String, bool)> rows = const [],
  DetailsNeed need = DetailsNeed.required,
  String modeLabel = 'Paid by',
  bool withAmount = false,
  Color color = FC.green,
}) {
  return _sheet<Map<String, dynamic>>(
    context,
    title: title,
    subtitle: subtitle,
    children: [_PaymentForm(rows: rows, need: need, modeLabel: modeLabel, button: button, withAmount: withAmount, color: color)],
  );
}

class _PaymentForm extends StatefulWidget {
  const _PaymentForm({required this.rows, required this.need, required this.modeLabel, required this.button, required this.withAmount, required this.color});

  final List<(String, String, bool)> rows;
  final DetailsNeed need;
  final String modeLabel;
  final String button;
  final bool withAmount;
  final Color color;

  @override
  State<_PaymentForm> createState() => _PaymentFormState();
}

class _PaymentFormState extends State<_PaymentForm> {
  final _amount = TextEditingController();
  final _reference = TextEditingController();
  final _note = TextEditingController();
  String? _mode;
  DateTime _paidOn = DateTime.now();

  @override
  void dispose() {
    _amount.dispose();
    _reference.dispose();
    _note.dispose();
    super.dispose();
  }

  bool get _anyDetail => _mode != null || _reference.text.trim().isNotEmpty;
  bool get _asks => widget.need != DetailsNeed.none;

  bool get _valid {
    if (widget.withAmount && !isValidMoney(_amount.text)) return false;
    if (!_asks) return true;
    if (widget.need == DetailsNeed.optional && !_anyDetail) return true;
    return _mode != null && _reference.text.trim().isNotEmpty;
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(context: context, initialDate: _paidOn, firstDate: DateTime(now.year - 1), lastDate: now);
    if (picked != null) setState(() => _paidOn = picked);
  }

  Map<String, dynamic> _result() {
    final skip = !_asks || (widget.need == DetailsNeed.optional && !_anyDetail);
    return {
      if (widget.withAmount) 'amount': _amount.text.trim(),
      if (!skip) ...{
        'mode': _mode,
        'reference': _reference.text.trim(),
        'paidOn': DateFormat('yyyy-MM-dd').format(_paidOn),
      },
      if (_note.text.trim().isNotEmpty && !skip) 'note': _note.text.trim(),
    };
  }

  String get _referenceHint => switch (_mode) {
        'CASH' => 'Cash voucher no.',
        'CHEQUE' => 'Cheque no.',
        'MOBILE_WALLET' => 'Wallet transaction ID',
        _ => 'Bank transaction ID',
      };

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (widget.rows.isNotEmpty) ...[
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 2),
            decoration: BoxDecoration(color: const Color(0xFFF6F7F9), borderRadius: BorderRadius.circular(14)),
            child: Column(
              children: [
                for (var i = 0; i < widget.rows.length; i++)
                  Container(
                    padding: const EdgeInsets.symmetric(vertical: 11),
                    decoration: BoxDecoration(border: i == widget.rows.length - 1 ? null : const Border(bottom: BorderSide(color: FC.border))),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Flexible(child: Text(widget.rows[i].$1, style: const TextStyle(fontSize: 14, color: Color(0xFF5D636D)))),
                        const SizedBox(width: 10),
                        Flexible(child: Text(widget.rows[i].$2, textAlign: TextAlign.end, style: money(14, weight: widget.rows[i].$3 ? FontWeight.w700 : FontWeight.w600))),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(height: 14),
        ],
        if (widget.withAmount) ...[
          _label('Amount returned'),
          TextField(
            key: const Key('payment-amount'),
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
            decoration: _field(prefix: 'NPR '),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 14),
        ],
        if (_asks) ...[
          _label(widget.need == DetailsNeed.optional ? '${widget.modeLabel} (if money moved)' : widget.modeLabel),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final e in RequestPayment.modeLabels.entries)
                InkWell(
                  key: Key('mode-${e.key}'),
                  borderRadius: BorderRadius.circular(10),
                  onTap: () => setState(() => _mode = e.key),
                  child: Container(
                    height: 40,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: _mode == e.key ? FC.navy : Colors.white,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(color: _mode == e.key ? FC.navy : const Color(0xFFC9CCD3)),
                    ),
                    child: Text(e.value, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: _mode == e.key ? Colors.white : FC.ink)),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 14),
          _label('Reference'),
          TextField(
            key: const Key('payment-reference'),
            controller: _reference,
            maxLength: 100,
            decoration: _field(hint: _referenceHint),
            onChanged: (_) => setState(() {}),
          ),
          const SizedBox(height: 2),
          _label('Date'),
          InkWell(
            onTap: _pickDate,
            child: InputDecorator(decoration: _field(), child: Text(DateFormat('d MMM yyyy').format(_paidOn), style: const TextStyle(fontSize: 15))),
          ),
          const SizedBox(height: 14),
          _label('Comment'),
          TextField(
            key: const Key('sheet-comment'),
            controller: _note,
            minLines: 2,
            maxLines: 4,
            maxLength: 500,
            decoration: _field(hint: 'Optional note'),
          ),
          const SizedBox(height: 6),
        ],
        _buttons(context, label: widget.button, color: widget.color, onPressed: _valid ? () => Navigator.pop(context, _result()) : null),
      ],
    );
  }
}
