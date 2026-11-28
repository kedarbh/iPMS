import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';

/// The Inbox tab's slot in [MainScaffold.pages]. It sits after the original
/// four so their indexes keep their meaning, and is shown second in the dock.
const int notificationsTabIndex = 4;

/// Floating capsule bottom navigation bar inspired by modern mobile dashboard designs.
class FloatingNavBar extends StatelessWidget {
  const FloatingNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
    this.onQuickAction,
    this.hiddenTabs = const {},
    this.unreadNotifications = 0,
  });

  final int currentIndex;
  final ValueChanged<int> onTap;
  final VoidCallback? onQuickAction;

  /// Indexes whose button is not offered. The page stays in place so every
  /// other index keeps its meaning.
  final Set<int> hiddenTabs;

  /// The count on the Inbox button, shown on every tab.
  final int unreadNotifications;

  static const _items = [
    (index: 0, icon: Icons.assignment_outlined, selectedIcon: Icons.assignment_rounded, label: 'Tasks'),
    (index: notificationsTabIndex, icon: Icons.notifications_none_rounded, selectedIcon: Icons.notifications_rounded, label: 'Inbox'),
    (index: 1, icon: Icons.business_outlined, selectedIcon: Icons.business_rounded, label: 'Projects'),
    (index: 2, icon: Icons.account_balance_wallet_outlined, selectedIcon: Icons.account_balance_wallet_rounded, label: 'Finance'),
    (index: 3, icon: Icons.person_outline_rounded, selectedIcon: Icons.person_rounded, label: 'Profile'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.darkSlate,
        borderRadius: BorderRadius.circular(36),
        boxShadow: [
          BoxShadow(
            color: AppColors.darkSlate.withValues(alpha: 0.35),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          for (final item in _items)
            if (!hiddenTabs.contains(item.index))
              _buildNavItem(
                index: item.index,
                icon: item.icon,
                selectedIcon: item.selectedIcon,
                label: item.label,
                badge: item.index == notificationsTabIndex ? unreadNotifications : 0,
              ),
        ],
      ),
    );
  }

  Widget _buildNavItem({
    required int index,
    required IconData icon,
    required IconData selectedIcon,
    required String label,
    int badge = 0,
  }) {
    final isSelected = currentIndex == index;
    final iconWidget = Icon(
      isSelected ? selectedIcon : icon,
      size: 20,
      color: isSelected ? Colors.white : AppColors.textTertiary,
    );

    return Tooltip(
      message: badge > 0 ? '$label, $badge unread' : label,
      child: InkWell(
        onTap: () => onTap(index),
        borderRadius: BorderRadius.circular(20),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: isSelected
                ? AppColors.darkSlateSecondary
                : Colors.transparent,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (badge > 0)
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    iconWidget,
                    Positioned(
                      top: -6,
                      right: -9,
                      child: UnreadBadge(count: badge, ring: isSelected ? AppColors.darkSlateSecondary : AppColors.darkSlate),
                    ),
                  ],
                )
              else
                iconWidget,
              if (isSelected) ...[
                const SizedBox(width: 6),
                Text(
                  label,
                  maxLines: 1,
                  softWrap: false,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ],
            ],
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
      constraints: const BoxConstraints(minWidth: 17, minHeight: 17),
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
