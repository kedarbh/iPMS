import 'package:flutter/material.dart';
import '../../core/theme/app_colors.dart';

/// Floating capsule bottom navigation bar inspired by modern mobile dashboard designs.
class FloatingNavBar extends StatelessWidget {
  const FloatingNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
    this.onQuickAction,
    this.hiddenTabs = const {},
  });

  final int currentIndex;
  final ValueChanged<int> onTap;
  final VoidCallback? onQuickAction;

  /// Indexes whose button is not offered. The page stays in place so every
  /// other index keeps its meaning.
  final Set<int> hiddenTabs;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 24, vertical: 18),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
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
          if (!hiddenTabs.contains(0))
            _buildNavItem(
              index: 0,
              icon: Icons.assignment_outlined,
              selectedIcon: Icons.assignment_rounded,
              label: 'Tasks',
            ),
          if (!hiddenTabs.contains(1))
            _buildNavItem(
              index: 1,
              icon: Icons.business_outlined,
              selectedIcon: Icons.business_rounded,
              label: 'Projects',
            ),
          if (!hiddenTabs.contains(2))
            _buildNavItem(
              index: 2,
              icon: Icons.account_balance_wallet_outlined,
              selectedIcon: Icons.account_balance_wallet_rounded,
              label: 'Finance',
            ),
          if (!hiddenTabs.contains(3))
            _buildNavItem(
              index: 3,
              icon: Icons.person_outline_rounded,
              selectedIcon: Icons.person_rounded,
              label: 'Profile',
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
  }) {
    final isSelected = currentIndex == index;

    return Tooltip(
      message: label,
      child: InkWell(
        onTap: () => onTap(index),
        borderRadius: BorderRadius.circular(20),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(
            color: isSelected
                ? AppColors.darkSlateSecondary
                : Colors.transparent,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                isSelected ? selectedIcon : icon,
                size: 20,
                color: isSelected ? Colors.white : AppColors.textTertiary,
              ),
              if (isSelected) ...[
                const SizedBox(width: 6),
                Text(
                  label,
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
