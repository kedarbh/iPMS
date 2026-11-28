import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../providers/notification_providers.dart';
import 'notification_center_screen.dart';

/// The bell at the top of every tab: the unread count on it, and a tap opens
/// every notification. [onDark] is for headers drawn on the dark slate.
class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key, this.onDark = false});

  final bool onDark;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unread = ref.watch(unreadNotificationCountProvider).value ?? 0;
    final ink = onDark ? Colors.white : const Color(0xFF111318);
    return Tooltip(
      message: unread > 0 ? 'Notifications, $unread unread' : 'Notifications',
      child: Material(
        color: onDark ? Colors.white.withValues(alpha: 0.12) : Colors.white,
        shape: CircleBorder(side: BorderSide(color: onDark ? Colors.transparent : const Color(0xFFE1E3E8))),
        child: InkWell(
          key: const ValueKey('notification-bell'),
          customBorder: const CircleBorder(),
          onTap: () {
            // Opening the list always shows what is new, not what was there last time.
            ref.invalidate(notificationFeedProvider);
            ref.invalidate(unreadNotificationCountProvider);
            Navigator.of(context).push<void>(MaterialPageRoute(builder: (_) => const NotificationCenterScreen()));
          },
          child: SizedBox(
            width: 44,
            height: 44,
            child: Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.center,
              children: [
                Icon(Icons.notifications_none_rounded, size: 22, color: ink),
                if (unread > 0)
                  Positioned(
                    top: 4,
                    right: 2,
                    child: UnreadBadge(count: unread, ring: onDark ? const Color(0xFF1B1B2A) : Colors.white),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The unread count: a small red pill, "9+" past nine, ringed in the colour behind it.
class UnreadBadge extends StatelessWidget {
  const UnreadBadge({super.key, required this.count, this.ring = Colors.white});

  final int count;
  final Color ring;

  @override
  Widget build(BuildContext context) {
    return Container(
      key: const ValueKey('unread-badge'),
      constraints: const BoxConstraints(minWidth: 18, minHeight: 18),
      padding: const EdgeInsets.symmetric(horizontal: 4),
      decoration: BoxDecoration(
        color: const Color(0xFFD23B2F),
        borderRadius: BorderRadius.circular(9),
        border: Border.all(color: ring, width: 2),
      ),
      alignment: Alignment.center,
      child: Text(
        count > 9 ? '9+' : '$count',
        style: const TextStyle(
          color: Colors.white,
          fontSize: 10,
          height: 1.1,
          fontWeight: FontWeight.w700,
          fontFeatures: [FontFeature.tabularFigures()],
        ),
      ),
    );
  }
}
