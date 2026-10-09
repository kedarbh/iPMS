import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../projects/domain/models/project_item.dart';
import '../domain/finance_models.dart';
import 'finance_widgets.dart';

InputDecoration fieldDecoration(String hint, {bool error = false, double radius = 12}) => InputDecoration(
      hintText: hint,
      hintStyle: const TextStyle(color: FC.faint),
      filled: true,
      fillColor: Colors.white,
      isDense: false,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(radius), borderSide: BorderSide(color: error ? FC.red : FC.field)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(radius), borderSide: BorderSide(color: error ? FC.red : FC.field)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(radius), borderSide: BorderSide(color: error ? FC.red : FC.navy, width: 1.4)),
    );

/// A bold label over a field, with the design's red hint under it when [error] is set.
class FormSection extends StatelessWidget {
  const FormSection({super.key, required this.label, required this.child, this.error, this.hint});

  final String label;
  final Widget child;
  final String? error;

  /// Light text after the label, such as "· quote or estimate".
  final String? hint;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text.rich(
          TextSpan(children: [
            TextSpan(text: label, style: const TextStyle(fontWeight: FontWeight.w600)),
            if (hint != null) TextSpan(text: ' · $hint', style: const TextStyle(fontWeight: FontWeight.w400, color: FC.faint)),
          ]),
          style: const TextStyle(fontSize: 13),
        ),
        const SizedBox(height: 8),
        child,
        if (error != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(error!, style: const TextStyle(fontSize: 12, color: FC.red))),
      ],
    );
  }
}

/// The projects as radio cards: code in bold, name below.
class ProjectCards extends StatelessWidget {
  const ProjectCards({super.key, required this.projects, required this.selected, required this.onPick});

  final List<ProjectItem> projects;
  final String? selected;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        for (final p in projects)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: InkWell(
              borderRadius: BorderRadius.circular(14),
              onTap: () => onPick(p.id),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: selected == p.id ? FC.navy : FC.field, width: 1.5),
                ),
                child: Row(
                  children: [
                    Container(
                      width: 20,
                      height: 20,
                      decoration: BoxDecoration(shape: BoxShape.circle, border: Border.all(color: selected == p.id ? FC.navy : const Color(0xFFC9CCD3), width: 2)),
                      alignment: Alignment.center,
                      child: Container(width: 10, height: 10, decoration: BoxDecoration(shape: BoxShape.circle, color: selected == p.id ? FC.navy : Colors.transparent)),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(p.code, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
                          const SizedBox(height: 1),
                          Text(p.name, style: const TextStyle(fontSize: 12, color: FC.muted)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// The expense categories as chips.
class CategoryChips extends StatelessWidget {
  const CategoryChips({super.key, required this.categories, required this.selected, required this.onPick});

  final List<ExpenseCategory> categories;
  final String? selected;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: [
        for (final c in categories)
          InkWell(
            borderRadius: BorderRadius.circular(10),
            onTap: () => onPick(c.id),
            child: Container(
              height: 38,
              alignment: Alignment.center,
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: selected == c.id ? FC.navy : Colors.white,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: selected == c.id ? FC.navy : const Color(0xFFC9CCD3)),
              ),
              child: Text(c.name, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: selected == c.id ? Colors.white : FC.ink)),
            ),
          ),
      ],
    );
  }
}

/// An NPR amount field in the design's large style.
class AmountField extends StatelessWidget {
  const AmountField({super.key, required this.controller, required this.onChanged, this.error = false, this.compact = false});

  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final bool error;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: compact ? 44 : 56,
      padding: EdgeInsets.symmetric(horizontal: compact ? 12 : 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(compact ? 10 : 12),
        border: Border.all(color: error ? FC.red : FC.field),
      ),
      child: Row(
        children: [
          Text('NPR', style: TextStyle(fontSize: compact ? 13 : 15, fontWeight: FontWeight.w600, color: FC.muted)),
          SizedBox(width: compact ? 6 : 8),
          Expanded(
            child: TextField(
              controller: controller,
              onChanged: onChanged,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
              style: money(compact ? 15 : 22),
              decoration: const InputDecoration(
                hintText: '0',
                border: InputBorder.none,
                enabledBorder: InputBorder.none,
                focusedBorder: InputBorder.none,
                filled: false,
                isDense: true,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// A one-line toast at the top of a form, like the design's black bar.
void showFinanceToast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Row(children: [
        const Icon(Icons.check_rounded, size: 18, color: Color(0xFF5FD08F)),
        const SizedBox(width: 10),
        Expanded(child: Text(message, style: const TextStyle(fontSize: 14))),
      ]),
      behavior: SnackBarBehavior.floating,
      backgroundColor: FC.ink,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ));
}
