import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../domain/finance_models.dart';
import '../domain/finance_view.dart';

/// The colours of the finance design.
class FC {
  FC._();

  static const Color bg = Color(0xFFF5F6F8);
  static const Color card = Colors.white;
  static const Color border = Color(0xFFE7E8EC);
  static const Color divider = Color(0xFFF0F1F3);
  static const Color ink = Color(0xFF111318);
  static const Color navy = Color(0xFF151B36);
  static const Color muted = Color(0xFF737983);
  static const Color faint = Color(0xFF8A8F98);
  static const Color link = Color(0xFF1F5FB8);
  static const Color red = Color(0xFFB4372A);
  static const Color redBg = Color(0xFFFDEDEA);
  static const Color green = Color(0xFF1E7A46);
  static const Color amber = Color(0xFF9A5B00);
  static const Color indigo = Color(0xFF3A3FB0);
  static const Color field = Color(0xFFE1E3E8);
}

const TextStyle _tabular = TextStyle(fontFeatures: [FontFeature.tabularFigures()]);

TextStyle money(double size, {FontWeight weight = FontWeight.w600, Color color = FC.ink}) =>
    _tabular.copyWith(fontSize: size, fontWeight: weight, color: color);

/// A white rounded card with the design's hairline border.
class FCard extends StatelessWidget {
  const FCard({super.key, required this.child, this.padding = const EdgeInsets.all(16), this.onTap});

  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final box = Container(
      width: double.infinity,
      padding: padding,
      decoration: BoxDecoration(
        color: FC.card,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: FC.border),
      ),
      child: child,
    );
    return onTap == null
        ? box
        : InkWell(borderRadius: BorderRadius.circular(16), onTap: onTap, child: box);
  }
}

/// Status as the design's tinted pill.
class StagePill extends StatelessWidget {
  const StagePill(this.stage, {super.key, this.margin});

  final Stage stage;
  final EdgeInsets? margin;

  @override
  Widget build(BuildContext context) {
    final s = stageStyles[stage]!;
    return Container(
      margin: margin,
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: s.bg, borderRadius: BorderRadius.circular(12)),
      child: Text(s.label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: s.fg)),
    );
  }
}

/// One request in a list: number, type, status, title, meta, amount and hint.
class RecordCard extends StatelessWidget {
  const RecordCard({super.key, required this.view, required this.onTap, this.requester});

  final RecordView view;
  final VoidCallback onTap;

  /// Shown first in the meta line on the approvals list, where it is someone else's.
  final String? requester;

  @override
  Widget build(BuildContext context) {
    return FCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Expanded(
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Flexible(child: Text(view.request.number, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700))),
                    const SizedBox(width: 8),
                    Flexible(child: Text(view.typeLabel, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: FC.faint))),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              StagePill(view.stage),
            ],
          ),
          const SizedBox(height: 8),
          Text(view.request.purpose, style: const TextStyle(fontSize: 14, color: Color(0xFF3F4550))),
          const SizedBox(height: 3),
          Text(
            [if ((requester ?? '').isNotEmpty) requester!, view.meta].join(' • '),
            style: const TextStyle(fontSize: 12, color: FC.faint),
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(formatMoney(view.amount), style: money(16, weight: FontWeight.w700)),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  view.hint,
                  textAlign: TextAlign.end,
                  style: TextStyle(fontSize: 12, color: view.hintColor),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// A label and a value on a line inside a card, with a hairline below.
class FactRow extends StatelessWidget {
  const FactRow(this.label, this.value, {super.key, this.bold = false, this.last = false, this.valueColor, this.onTap});

  final String label;
  final String value;
  final bool bold;
  final bool last;
  final Color? valueColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final row = Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(border: last ? null : const Border(bottom: BorderSide(color: FC.divider))),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Flexible(flex: 0, child: Text(label, style: TextStyle(fontSize: 14, color: bold ? FC.ink : FC.muted, fontWeight: bold ? FontWeight.w600 : FontWeight.w400))),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value,
              textAlign: TextAlign.end,
              style: money(14, weight: bold ? FontWeight.w700 : FontWeight.w600, color: valueColor ?? (onTap != null ? FC.link : FC.ink)),
            ),
          ),
          if (onTap != null) const Icon(Icons.chevron_right_rounded, size: 18, color: FC.link),
        ],
      ),
    );
    return onTap == null ? row : InkWell(onTap: onTap, child: row);
  }
}

/// The sticky header of a pushed screen: back, title, optional trailing.
class FinanceHeader extends StatelessWidget {
  const FinanceHeader({super.key, required this.title, this.trailing, this.close = false, this.onBack});

  final String title;
  final Widget? trailing;

  /// A cross instead of a back arrow, for forms.
  final bool close;
  final VoidCallback? onBack;

  @override
  Widget build(BuildContext context) {
    return Container(
      color: FC.bg,
      padding: const EdgeInsets.fromLTRB(12, 6, 12, 10),
      child: Row(
        children: [
          IconButton(
            iconSize: 22,
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            onPressed: onBack ?? () => Navigator.maybePop(context),
            icon: Icon(close ? Icons.close_rounded : Icons.chevron_left_rounded, size: close ? 22 : 28, color: FC.ink),
          ),
          Expanded(child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600))),
          ?trailing,
        ],
      ),
    );
  }
}

/// The pinned action bar: up to two pill buttons, the primary on the right.
class ActionBar extends StatelessWidget {
  const ActionBar({super.key, this.primary, this.secondary, this.onPrimary, this.onSecondary, this.busy = false, this.destructive = false});

  final String? primary;
  final String? secondary;
  final VoidCallback? onPrimary;
  final VoidCallback? onSecondary;
  final bool busy;
  final bool destructive;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(20, 12, 20, 12 + MediaQuery.of(context).padding.bottom * 0.5),
      decoration: const BoxDecoration(
        color: Color(0xF0F5F6F8),
        border: Border(top: BorderSide(color: FC.border)),
      ),
      child: Row(
        children: [
          if (secondary != null)
            Expanded(
              flex: 10,
              child: SizedBox(
                height: 52,
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: Color(0xFFC9CCD3)),
                    backgroundColor: Colors.white,
                    foregroundColor: destructive ? FC.red : FC.ink,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
                  ),
                  onPressed: busy ? null : onSecondary,
                  child: Text(secondary!, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                ),
              ),
            ),
          if (secondary != null && primary != null) const SizedBox(width: 10),
          if (primary != null)
            Expanded(
              flex: secondary != null ? 14 : 10,
              child: SizedBox(
                height: 52,
                child: ElevatedButton(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: FC.navy,
                    foregroundColor: Colors.white,
                    disabledBackgroundColor: const Color(0xFF8B90A6),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(26)),
                  ),
                  onPressed: busy ? null : onPrimary,
                  child: busy
                      ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : Text(primary!, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600)),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

String shortDate(DateTime d) => DateFormat('d MMM yyyy').format(d);
