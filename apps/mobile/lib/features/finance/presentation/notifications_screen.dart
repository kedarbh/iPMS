import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import '../domain/finance_models.dart';
import '../providers/finance_providers.dart';
import 'finance_widgets.dart';
import 'request_detail_screen.dart';

/// "2h ago", "Yesterday", "3 days ago", then the date.
String whenText(DateTime at, DateTime now) {
  final d = now.difference(at);
  if (d.inMinutes < 1) return 'Just now';
  if (d.inHours < 1) return '${d.inMinutes} min ago';
  final today = DateTime(now.year, now.month, now.day);
  final day = DateTime(at.year, at.month, at.day);
  final days = today.difference(day).inDays;
  if (days == 0) return '${d.inHours}h ago';
  if (days == 1) return 'Yesterday';
  if (days < 7) return '$days days ago';
  return DateFormat('d MMM').format(at);
}

/// The finance notification feed: unread first with a coloured dot, tap to read and open.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  Future<void> _openOne(BuildContext context, WidgetRef ref, FinanceNotification n) async {
    final repo = ref.read(financeRepositoryProvider);
    if (!n.isRead) {
      try {
        await repo.markNotificationRead(n.id);
      } catch (_) {
        // Opening it still works; it shows unread until the next successful read.
      }
      ref.invalidate(financeNotificationsProvider);
    }
    if (n.requestId != null && context.mounted) {
      await Navigator.push<void>(
        context,
        MaterialPageRoute(builder: (_) => RequestDetailScreen(requestId: n.requestId!)),
      );
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feed = ref.watch(financeNotificationsProvider);
    final now = DateTime.now();
    final hasUnread = feed.value?.any((n) => !n.isRead) ?? false;

    return Scaffold(
      backgroundColor: FC.bg,
      body: SafeArea(
        child: Column(
          children: [
            FinanceHeader(
              title: 'Notifications',
              trailing: TextButton(
                onPressed: hasUnread
                    ? () async {
                        try {
                          await ref.read(financeRepositoryProvider).markAllNotificationsRead();
                        } catch (_) {}
                        ref.invalidate(financeNotificationsProvider);
                      }
                    : null,
                child: const Text('Mark all read', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
              ),
            ),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () => ref.refresh(financeNotificationsProvider.future).then((_) {}, onError: (_) {}),
                child: feed.when(
                  loading: () => const Center(child: CircularProgressIndicator()),
                  error: (e, _) => ListView(children: [Padding(padding: const EdgeInsets.all(32), child: Text(e.toString(), textAlign: TextAlign.center, style: const TextStyle(color: FC.muted)))]),
                  data: (items) => items.isEmpty
                      ? ListView(children: const [Padding(padding: EdgeInsets.all(48), child: Center(child: Text('Nothing yet. Updates on your requests will show here.', textAlign: TextAlign.center, style: TextStyle(color: FC.muted))))])
                      : ListView.builder(
                          padding: const EdgeInsets.fromLTRB(20, 0, 20, 40),
                          itemCount: items.length,
                          itemBuilder: (_, i) {
                            final n = items[i];
                            final dot = n.isRead
                                ? Colors.transparent
                                : switch (n.tone) {
                                    'err' => FC.red,
                                    'warn' => const Color(0xFFE2A93B),
                                    _ => FC.green,
                                  };
                            return InkWell(
                              onTap: () => _openOne(context, ref, n),
                              child: Container(
                                padding: const EdgeInsets.symmetric(vertical: 14),
                                decoration: const BoxDecoration(border: Border(bottom: BorderSide(color: FC.border))),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Padding(
                                      padding: const EdgeInsets.only(top: 6, right: 12),
                                      child: Container(width: 8, height: 8, decoration: BoxDecoration(color: dot, shape: BoxShape.circle)),
                                    ),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Row(
                                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                            children: [
                                              Expanded(child: Text(n.title, style: TextStyle(fontSize: 14, fontWeight: n.isRead ? FontWeight.w500 : FontWeight.w600))),
                                              const SizedBox(width: 8),
                                              Text(whenText(n.createdAt, now), style: const TextStyle(fontSize: 12, color: FC.faint)),
                                            ],
                                          ),
                                          const SizedBox(height: 3),
                                          Text(n.body, style: const TextStyle(fontSize: 13, color: Color(0xFF5D636D), height: 1.45)),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
