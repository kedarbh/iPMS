import 'package:flutter/material.dart';
import '../domain/approver_overview.dart';
import '../domain/finance_models.dart';
import '../domain/finance_view.dart';
import 'finance_widgets.dart';

/// Two-letter initials of a name.
String initialsOf(String name) {
  final parts = name.split(' ').where((w) => w.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  return parts.take(2).map((w) => w[0]).join().toUpperCase();
}

const List<(Color, Color)> _avatarPalette = [
  (Color(0xFFE8F1FD), Color(0xFF1F5FB8)),
  (Color(0xFFE6F5EC), Color(0xFF1E7A46)),
  (Color(0xFFFEF4E2), Color(0xFF9A5B00)),
  (Color(0xFFEEF0FF), Color(0xFF3A3FB0)),
  (Color(0xFFFDEDEA), Color(0xFFB4372A)),
];

/// A round initials badge; a person always gets the same colours.
class PersonAvatar extends StatelessWidget {
  const PersonAvatar(this.name, {super.key, this.size = 32});

  final String name;
  final double size;

  @override
  Widget build(BuildContext context) {
    final (bg, fg) = _avatarPalette[name.codeUnits.fold(0, (a, b) => a + b) % _avatarPalette.length];
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(color: bg, shape: BoxShape.circle),
      child: Text(initialsOf(name), style: TextStyle(fontSize: size <= 32 ? 12 : 13, fontWeight: FontWeight.w700, color: fg)),
    );
  }
}

/// A request on an approver's list: number and type, a tag (how long it has waited, or its status),
/// who raised it, and the amount with a hint.
class ApproverCard extends StatelessWidget {
  const ApproverCard({super.key, required this.view, required this.requester, required this.onTap, this.age, this.hint});

  final RecordView view;
  final String requester;
  final VoidCallback onTap;

  /// Whole days waiting; when set the tag shows it instead of the status.
  final int? age;

  /// Replaces the view's own hint (a settlement's balance or excess, say).
  final (String, Color)? hint;

  @override
  Widget build(BuildContext context) {
    final style = view.style;
    final waited = age;
    final tagBg = waited == null ? style.bg : waited >= 3 ? const Color(0xFFFEF4E2) : const Color(0xFFF1F2F4);
    final tagFg = waited == null ? style.fg : waited >= 3 ? FC.amber : const Color(0xFF4B5563);
    final (hintText, hintColor) = hint ?? (view.hint, view.hintColor);
    return FCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
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
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
                decoration: BoxDecoration(color: tagBg, borderRadius: BorderRadius.circular(12)),
                child: Text(waited == null ? style.label : ageLabel(waited), style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: tagFg)),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              PersonAvatar(requester),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(view.request.purpose, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 2),
                    Text([if (requester.isNotEmpty) requester, if (view.request.projectCode != null) view.request.projectCode!].join(' · '),
                        maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: FC.muted)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(formatMoney(view.amount), style: money(16, weight: FontWeight.w700)),
              const SizedBox(width: 8),
              Expanded(child: Text(hintText, textAlign: TextAlign.end, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: hintColor))),
            ],
          ),
        ],
      ),
    );
  }
}

/// The three-way switch under the header.
class SegmentBar extends StatelessWidget {
  const SegmentBar({super.key, required this.labels, required this.selected, required this.onSelect});

  final List<String> labels;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 16, 20, 0),
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(color: const Color(0xFFE9EAEE), borderRadius: BorderRadius.circular(12)),
      child: Row(
        children: [
          for (var i = 0; i < labels.length; i++)
            Expanded(
              child: InkWell(
                key: Key('segment-${labels[i]}'),
                borderRadius: BorderRadius.circular(9),
                onTap: () => onSelect(i),
                child: Container(
                  height: 36,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: i == selected ? Colors.white : Colors.transparent,
                    borderRadius: BorderRadius.circular(9),
                    boxShadow: i == selected ? [BoxShadow(color: Colors.black.withValues(alpha: 0.08), blurRadius: 2, offset: const Offset(0, 1))] : null,
                  ),
                  child: Text(
                    labels[i],
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 14, fontWeight: i == selected ? FontWeight.w600 : FontWeight.w500, color: i == selected ? FC.ink : const Color(0xFF5D636D)),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A row of pill filters that scrolls sideways.
class FilterChips extends StatelessWidget {
  const FilterChips({super.key, required this.labels, required this.selected, required this.onSelect});

  final List<String> labels;
  final int selected;
  final ValueChanged<int> onSelect;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
      child: Row(
        children: [
          for (var i = 0; i < labels.length; i++) ...[
            if (i > 0) const SizedBox(width: 8),
            InkWell(
              key: Key('filter-${labels[i].split(' ').first}-$i'),
              borderRadius: BorderRadius.circular(10),
              onTap: () => onSelect(i),
              child: Container(
                height: 36,
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 14),
                decoration: BoxDecoration(
                  color: i == selected ? FC.navy : Colors.white,
                  borderRadius: BorderRadius.circular(10),
                  border: Border.all(color: i == selected ? FC.navy : const Color(0xFFC9CCD3)),
                ),
                child: Text(labels[i], style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: i == selected ? Colors.white : FC.ink)),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
