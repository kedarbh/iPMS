import 'package:flutter/material.dart';
import '../domain/finance_models.dart';
import '../domain/finance_view.dart';
import 'finance_widgets.dart';

/// The Records filters, by stage.
const List<(String, bool Function(Stage))> recordFilters = [
  ('All', _all),
  ('Drafts', _drafts),
  ('In approval', _approval),
  ('Paid', _paid),
  ('Returned', _returned),
  ('Rejected', _rejected),
  ('Settled', _settled),
];
bool _all(Stage s) => true;
bool _drafts(Stage s) => s == Stage.draft;
bool _approval(Stage s) => const {Stage.pm, Stage.director, Stage.admin, Stage.review}.contains(s);
bool _paid(Stage s) => s == Stage.paid;
bool _returned(Stage s) => s == Stage.returned;
bool _rejected(Stage s) => s == Stage.rejected;
bool _settled(Stage s) => s == Stage.settled;

/// Whether [v] matches a search typed in the box: id, title, project or category.
bool matchesSearch(RecordView v, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) return true;
  final r = v.request;
  return [r.number, r.purpose, r.projectCode ?? '', r.projectName ?? '', r.categoryName ?? '']
      .join(' ')
      .toLowerCase()
      .contains(q);
}

/// The Records tab: search, filter chips and every request as a card.
class RecordsTab extends StatefulWidget {
  const RecordsTab({
    super.key,
    required this.views,
    required this.query,
    required this.filter,
    required this.onQuery,
    required this.onFilter,
    required this.onOpen,
  });

  final List<RecordView> views;
  final String query;
  final int filter;
  final ValueChanged<String> onQuery;
  final ValueChanged<int> onFilter;
  final ValueChanged<FinanceRequest> onOpen;

  @override
  State<RecordsTab> createState() => _RecordsTabState();
}

class _RecordsTabState extends State<RecordsTab> {
  late final TextEditingController _search = TextEditingController(text: widget.query);

  @override
  void didUpdateWidget(RecordsTab old) {
    super.didUpdateWidget(old);
    // A search set from outside (tapping a project) shows in the box; typing keeps the cursor.
    if (widget.query != _search.text) {
      _search.value = TextEditingValue(text: widget.query, selection: TextSelection.collapsed(offset: widget.query.length));
    }
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final views = widget.views, query = widget.query, filter = widget.filter;
    final onQuery = widget.onQuery, onFilter = widget.onFilter, onOpen = widget.onOpen;
    final matches = recordFilters[filter].$2;
    final shown = views.where((v) => matches(v.stage) && matchesSearch(v, query)).toList();
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
                    onChanged: onQuery,
                    style: const TextStyle(fontSize: 15),
                    decoration: const InputDecoration(
                      hintText: 'Search ID, title, project',
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      filled: false,
                      isDense: true,
                    ),
                  ),
                ),
                if (query.isNotEmpty)
                  InkWell(
                    onTap: () => onQuery(''),
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
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
          child: Row(
            children: [
              for (var i = 0; i < recordFilters.length; i++) ...[
                if (i > 0) const SizedBox(width: 8),
                _chip(i, filter, onFilter),
              ],
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 130),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(shown.length == 1 ? '1 record' : '${shown.length} records', style: const TextStyle(fontSize: 12, color: FC.muted)),
              const SizedBox(height: 12),
              if (shown.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 40),
                  child: Center(child: Text('No records match.', style: const TextStyle(fontSize: 14, color: FC.muted))),
                ),
              for (final v in shown) ...[
                RecordCard(view: v, onTap: () => onOpen(v.request)),
                const SizedBox(height: 12),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _chip(int i, int filter, ValueChanged<int> onFilter) {
    final on = i == filter;
    return InkWell(
      key: Key('filter-${recordFilters[i].$1}'),
      borderRadius: BorderRadius.circular(10),
      onTap: () => onFilter(i),
      child: Container(
        height: 36,
        alignment: Alignment.center,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        decoration: BoxDecoration(
          color: on ? FC.navy : Colors.white,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: on ? FC.navy : const Color(0xFFC9CCD3)),
        ),
        child: Text(
          recordFilters[i].$1,
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: on ? Colors.white : FC.ink),
        ),
      ),
    );
  }
}
