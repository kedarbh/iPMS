import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../finance/presentation/finance_widgets.dart' show FC;
import '../domain/app_notification.dart';
import '../providers/notification_providers.dart';
import 'notification_targets.dart';

/// Which slice of the feed is showing.
sealed class _Filter {
  const _Filter();
}

class _All extends _Filter {
  const _All();
}

class _Unread extends _Filter {
  const _Unread();
}

class _Kind extends _Filter {
  const _Kind(this.category);
  final NotificationCategory category;

  @override
  bool operator ==(Object other) => other is _Kind && other.category == category;

  @override
  int get hashCode => category.hashCode;
}

/// Every notification the user has, of every type, in one place.
/// Unread ones carry a blue dot; a tap marks it read and opens what it is about.
class NotificationCenterScreen extends ConsumerStatefulWidget {
  const NotificationCenterScreen({super.key});

  @override
  ConsumerState<NotificationCenterScreen> createState() => _NotificationCenterScreenState();
}

class _NotificationCenterScreenState extends ConsumerState<NotificationCenterScreen> {
  _Filter _filter = const _All();

  /// Read here but not yet re-fetched, so the dot goes at once.
  final Set<String> _readHere = {};

  void _refetch() {
    ref.invalidate(notificationFeedProvider);
    ref.invalidate(unreadNotificationCountProvider);
  }

  Future<void> _open(AppNotification n) async {
    if (!n.isRead && !_readHere.contains(n.id)) {
      setState(() => _readHere.add(n.id));
      try {
        await ref.read(notificationRepositoryProvider).markRead(n.id);
      } catch (_) {
        // Opening it still works; it shows unread again after the next fetch.
        if (mounted) setState(() => _readHere.remove(n.id));
      }
      _refetch();
    }
    final target = notificationTarget(ref.invalidate, financeRequestId: n.financeRequestId, workOrderId: n.workOrderId);
    if (target != null && mounted) {
      await Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => target));
    }
  }

  Future<void> _markAllRead(List<AppNotification> items) async {
    setState(() => _readHere.addAll(items.map((n) => n.id)));
    try {
      await ref.read(notificationRepositoryProvider).markAllRead();
    } catch (_) {
      if (mounted) {
        setState(_readHere.clear);
        ScaffoldMessenger.maybeOf(context)?.showSnackBar(const SnackBar(content: Text('Could not mark them read. Try again.')));
      }
    }
    _refetch();
  }

  @override
  Widget build(BuildContext context) {
    final feed = ref.watch(notificationFeedProvider);
    final serverUnread = ref.watch(unreadNotificationCountProvider).value;
    final items = [for (final n in feed.value ?? const <AppNotification>[]) _readHere.contains(n.id) ? n.read() : n];
    final listedUnread = items.where((n) => !n.isRead).length;
    // The server counts beyond the listed page; what was just read here counts at once.
    final unread = feed.hasValue ? (serverUnread == null ? listedUnread : (serverUnread < listedUnread ? listedUnread : serverUnread)) : (serverUnread ?? 0);
    final kinds = NotificationCategory.values.where((c) => items.any((n) => n.category == c)).toList();
    final filter = _filter is _Kind && !kinds.contains((_filter as _Kind).category) ? const _All() : _filter;
    final shown = items.where((n) => switch (filter) {
          _All() => true,
          _Unread() => !n.isRead,
          _Kind(:final category) => n.category == category,
        }).toList();

    final canPop = Navigator.of(context).canPop();

    return Scaffold(
      backgroundColor: FC.bg,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () async {
            setState(_readHere.clear);
            ref.invalidate(unreadNotificationCountProvider);
            await ref.refresh(notificationFeedProvider.future).then((_) {}, onError: (_) {});
          },
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(canPop ? 8 : 20, 10, 12, 0),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (canPop)
                        IconButton(
                          tooltip: 'Back',
                          constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                          onPressed: () => Navigator.maybePop(context),
                          icon: const Icon(Icons.chevron_left_rounded, size: 30, color: FC.ink),
                        ),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text('Notifications', style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, letterSpacing: -0.5, color: FC.ink)),
                            const SizedBox(height: 3),
                            Text(
                              unread == 0 ? 'You are all caught up' : '$unread unread',
                              style: const TextStyle(fontSize: 13, color: FC.muted, height: 1.35, fontFeatures: [FontFeature.tabularFigures()]),
                            ),
                          ],
                        ),
                      ),
                      TextButton(
                        onPressed: listedUnread > 0 || unread > 0 ? () => _markAllRead(items) : null,
                        style: TextButton.styleFrom(foregroundColor: FC.link),
                        child: const Text('Mark all read', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
                      ),
                    ],
                  ),
                ),
              ),
              if (items.isNotEmpty)
                SliverToBoxAdapter(
                  child: SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    padding: const EdgeInsets.fromLTRB(20, 12, 20, 4),
                    child: SizedBox(
                      height: 38,
                      child: Row(
                      children: [
                        _Chip(label: 'All', selected: filter is _All, onTap: () => setState(() => _filter = const _All())),
                        _Chip(label: 'Unread', count: listedUnread, selected: filter is _Unread, onTap: () => setState(() => _filter = const _Unread())),
                        if (kinds.length > 1)
                          for (final c in kinds)
                            _Chip(label: c.label, selected: filter == _Kind(c), onTap: () => setState(() => _filter = _Kind(c))),
                      ],
                    ),
                    ),
                  ),
                ),
              ...feed.when(
                skipLoadingOnRefresh: true,
                skipLoadingOnReload: true,
                loading: () => [const SliverFillRemaining(hasScrollBody: false, child: Center(child: CircularProgressIndicator()))],
                error: (e, _) => [
                  SliverToBoxAdapter(
                    child: _Empty(
                      icon: Icons.cloud_off_outlined,
                      title: 'Could not load notifications',
                      body: e.toString(),
                      action: TextButton(onPressed: _refetch, child: const Text('Try again')),
                    ),
                  ),
                ],
                data: (_) => shown.isEmpty
                    ? [
                        SliverToBoxAdapter(
                          child: _Empty(
                            icon: Icons.notifications_none_rounded,
                            title: items.isEmpty ? 'Nothing yet' : 'Nothing here',
                            body: items.isEmpty
                                ? 'Reviews of your work orders, updates on your requests and anything waiting on you will show here.'
                                : filter is _Unread
                                    ? 'You have read everything.'
                                    : 'No notifications of this kind.',
                          ),
                        ),
                      ]
                    : _grouped(shown),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 40)),
            ],
          ),
        ),
      ),
    );
  }

  /// One bordered card per day group, each row divided by a hairline.
  List<Widget> _grouped(List<AppNotification> shown) {
    final now = DateTime.now();
    final groups = <String, List<AppNotification>>{};
    for (final n in shown) {
      groups.putIfAbsent(dayGroupOf(n.createdAt, now), () => []).add(n);
    }
    return [
      for (final entry in groups.entries) ...[
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 18, 20, 8),
            child: Text(
              entry.key.toUpperCase(),
              style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 0.66, color: FC.muted),
            ),
          ),
        ),
        SliverToBoxAdapter(
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 16),
            decoration: BoxDecoration(color: FC.card, borderRadius: BorderRadius.circular(14), border: Border.all(color: FC.border)),
            clipBehavior: Clip.antiAlias,
            child: Column(
              children: [
                for (var i = 0; i < entry.value.length; i++)
                  NotificationRow(
                    notification: entry.value[i],
                    now: now,
                    divider: i > 0,
                    onTap: () => _open(entry.value[i]),
                  ),
              ],
            ),
          ),
        ),
      ],
    ];
  }
}

/// One notification: its kind mark, title, what happened, and when.
class NotificationRow extends StatelessWidget {
  const NotificationRow({super.key, required this.notification, required this.now, required this.onTap, this.divider = false});

  final AppNotification notification;
  final DateTime now;
  final VoidCallback onTap;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    final n = notification;
    final icon = switch (n.category) {
      NotificationCategory.workOrder => Icons.assignment_outlined,
      NotificationCategory.finance => Icons.account_balance_wallet_outlined,
      NotificationCategory.other => Icons.key_outlined,
    };
    return Semantics(
      button: true,
      label: '${n.isRead ? '' : 'Unread. '}${n.title}',
      child: InkWell(
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.fromLTRB(14, 14, 14, 14),
          decoration: BoxDecoration(border: divider ? const Border(top: BorderSide(color: FC.divider)) : null),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 10,
                child: Padding(
                  padding: const EdgeInsets.only(top: 14),
                  child: n.isRead
                      ? null
                      : Container(
                          key: const ValueKey('unread-dot'),
                          width: 7,
                          height: 7,
                          decoration: const BoxDecoration(color: FC.link, shape: BoxShape.circle),
                        ),
                ),
              ),
              const SizedBox(width: 4),
              Container(
                width: 34,
                height: 34,
                decoration: const BoxDecoration(color: Color(0xFFF1F2F5), shape: BoxShape.circle),
                child: Icon(icon, size: 17, color: const Color(0xFF4B515B)),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Text(
                            n.title,
                            style: TextStyle(fontSize: 14, height: 1.3, color: FC.ink, fontWeight: n.isRead ? FontWeight.w500 : FontWeight.w600),
                          ),
                        ),
                        const SizedBox(width: 10),
                        Text(
                          whenText(n.createdAt, now),
                          style: const TextStyle(fontSize: 12, color: FC.faint, height: 1.5, fontFeatures: [FontFeature.tabularFigures()]),
                        ),
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      n.body,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 13, height: 1.45, color: n.isRead ? FC.muted : const Color(0xFF4B515B)),
                    ),
                  ],
                ),
              ),
              if (n.opensSomething)
                const Padding(
                  padding: EdgeInsets.only(left: 4, top: 8),
                  child: Icon(Icons.chevron_right_rounded, size: 20, color: Color(0xFFB4B8C0)),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.selected, required this.onTap, this.count = 0});

  final String label;
  final bool selected;
  final VoidCallback onTap;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Material(
        color: selected ? FC.navy : FC.card,
        shape: StadiumBorder(side: BorderSide(color: selected ? FC.navy : FC.field)),
        child: InkWell(
          customBorder: const StadiumBorder(),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(label, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: selected ? Colors.white : FC.ink)),
                if (count > 0) ...[
                  const SizedBox(width: 6),
                  Text(
                    '$count',
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: selected ? Colors.white70 : FC.muted, fontFeatures: const [FontFeature.tabularFigures()]),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty({required this.icon, required this.title, required this.body, this.action});

  final IconData icon;
  final String title;
  final String body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(40, 56, 40, 0),
      child: Column(
        children: [
          Icon(icon, size: 36, color: const Color(0xFFB4B8C0)),
          const SizedBox(height: 12),
          Text(title, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: FC.ink)),
          const SizedBox(height: 4),
          Text(body, textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, height: 1.45, color: FC.muted)),
          ?action,
        ],
      ),
    );
  }
}
