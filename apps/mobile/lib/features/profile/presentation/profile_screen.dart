import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/push/push_controller.dart';
import '../../../core/push/push_providers.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/widgets/brand_mark.dart';
import '../../auth/providers/auth_provider.dart';
import '../../auth/providers/biometric_provider.dart';
import '../../projects/providers/project_providers.dart';
import '../../media/providers/evidence_upload_provider.dart';
import '../../tasks/domain/models/task_evidence.dart';
import '../../tasks/providers/evidence_provider.dart';
import '../../tasks/providers/task_providers.dart';
import 'widgets/change_password_sheet.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  void _showLogoutDialog(BuildContext context, WidgetRef ref) {
    final biometric = ref.read(biometricAuthStateProvider);
    final keepsBiometric = biometric.isConfigured;
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Confirm Logout'),
        content: Text(
          keepsBiometric
              ? 'You can sign back in with ${biometric.biometricLabel}. '
                  'To sign out everywhere and turn ${biometric.biometricLabel} off on this device, '
                  'choose "Sign out & forget device".'
              : 'Are you sure you want to log out? Your session will be ended on all devices.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          if (keepsBiometric)
            TextButton(
              onPressed: () {
                Navigator.pop(ctx);
                // Read before signing out: this screen is gone afterwards.
                final biometrics = ref.read(biometricAuthStateProvider.notifier);
                ref
                    .read(authStateProvider.notifier)
                    .logout(purgeBiometrics: true)
                    .then((_) => biometrics.checkBiometricStatus());
              },
              child: const Text(
                'Sign out & forget device',
                style: TextStyle(color: AppColors.statusBlockedText),
              ),
            ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.statusBlockedText,
            ),
            onPressed: () {
              Navigator.pop(ctx);
              ref.read(authStateProvider.notifier).logout();
            },
            child: const Text('Log Out'),
          ),
        ],
      ),
    );
  }

  Future<void> _showChangePassword(BuildContext context, WidgetRef ref) async {
    final changed = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (_) => const ChangePasswordSheet(),
    );
    if (changed == null || !context.mounted) return;
    // The server ended every session when the password changed.
    await showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Password changed'),
        content: const Text('Sign in again with your new password.'),
        actions: [
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: AppColors.darkSlate, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Sign in'),
          ),
        ],
      ),
    );
    // Read before signing out: this screen is gone afterwards. Every session,
    // including the biometric one, is already revoked.
    final biometrics = ref.read(biometricAuthStateProvider.notifier);
    await ref.read(authStateProvider.notifier).logout(purgeBiometrics: true);
    await biometrics.checkBiometricStatus();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authStateProvider).value;

    final biometricState = ref.watch(biometricAuthStateProvider);

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      body: SingleChildScrollView(
        padding: const EdgeInsets.only(bottom: 110),
        child: Column(
          children: [
            // Curved Hero Header
            Stack(
              clipBehavior: Clip.none,
              alignment: Alignment.center,
              children: [
                Container(
                  height: 160,
                  width: double.infinity,
                  decoration: const BoxDecoration(
                    color: AppColors.darkSlate,
                    borderRadius: BorderRadius.only(
                      bottomLeft: Radius.circular(36),
                      bottomRight: Radius.circular(36),
                    ),
                  ),
                  child: SafeArea(
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Profile',
                            style: AppTypography.headingSmall.copyWith(
                              color: Colors.white,
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.15),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: const Text(
                              'Online',
                              style: TextStyle(color: Colors.white, fontSize: 11, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),

                // Elevated Circular Avatar
                Positioned(
                  bottom: -45,
                  child: Container(
                    width: 90,
                    height: 90,
                    decoration: BoxDecoration(
                      color: AppColors.primaryLavender,
                      shape: BoxShape.circle,
                      border: Border.all(color: Colors.white, width: 4),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withValues(alpha: 0.12),
                          blurRadius: 16,
                          offset: const Offset(0, 6),
                        ),
                      ],
                    ),
                    child: Center(
                      child: Text(
                        user?.displayName?.isNotEmpty == true
                            ? user!.displayName![0].toUpperCase()
                            : 'U',
                        style: const TextStyle(
                          fontSize: 36,
                          fontWeight: FontWeight.w700,
                          color: AppColors.darkSlate,
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),

            const SizedBox(height: 55),

            // User Identity & Role
            Text(
              user?.displayName ?? user?.email ?? 'Field Staff',
              style: AppTypography.headingMedium,
            ),
            const SizedBox(height: 4),
            Text(
              user?.roleLabel != null
                  ? '${user!.roleLabel} • Field Operations'
                  : 'Field Engineer • Telecom & Civil',
              style: AppTypography.bodySmall,
            ),
            const SizedBox(height: 24),

            // Security
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  child: Column(
                    children: [
                      _buildSettingsTile(
                        icon: Icons.shield_outlined,
                        title: 'Security',
                        trailingText: 'Change password',
                        onTap: () => _showChangePassword(context, ref),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            const SizedBox(height: 14),

            // Sync
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: 20),
              child: _SyncCard(),
            ),

            const SizedBox(height: 14),

            // Preferences & Toggles
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Column(
                    children: [
                      const _PushTile(),
                      if (biometricState.isHardwareSupported) ...[
                        SwitchListTile.adaptive(
                          secondary: Icon(
                            biometricState.biometricIcon,
                            color: AppColors.darkSlate,
                          ),
                          title: Text(
                            '${biometricState.biometricLabel} login',
                            style: AppTypography.titleMedium,
                          ),
                          subtitle: Text(
                            biometricState.isConfigured
                                ? 'Active for @${biometricState.enrolledUsername ?? user?.username}'
                                : 'Fast ${biometricState.biometricName.toLowerCase()} access',
                            style: AppTypography.caption,
                          ),
                          value: biometricState.isConfigured,
                          activeThumbColor: AppColors.darkSlate,
                          onChanged: (val) async {
                            if (val) {
                              final problem = await ref
                                  .read(biometricAuthStateProvider.notifier)
                                  .enrollBiometric(user?.username ?? 'engineer');
                              if (context.mounted && problem != null && problem.isNotEmpty) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text(problem)),
                                );
                              }
                            } else {
                              await ref
                                  .read(biometricAuthStateProvider.notifier)
                                  .disableBiometric();
                            }
                          },
                        ),
                      ] else
                        ListTile(
                          leading: const Icon(Icons.fingerprint_rounded, color: AppColors.textSecondary),
                          title: Text('Biometric login', style: AppTypography.titleMedium),
                          subtitle: Text(
                            'Not available: set up Face ID or a fingerprint on this device first.',
                            style: AppTypography.caption,
                          ),
                        ),
                    ],
                  ),
                ),
              ),
            ),

            const SizedBox(height: 14),

            // Logout Action
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: _buildSettingsTile(
                    icon: Icons.logout_rounded,
                    iconColor: AppColors.statusBlockedText,
                    title: 'Log Out',
                    titleColor: AppColors.statusBlockedText,
                    onTap: () => _showLogoutDialog(context, ref),
                  ),
                ),
              ),
            ),

            const SizedBox(height: 20),
            const Center(child: BrandMark(size: 28)),
            const SizedBox(height: 8),
            Center(
              child: Text(
                'Axiom Mobile v1.0.0 • Pure Stateless Client',
                style: AppTypography.caption,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSettingsTile({
    required IconData icon,
    Color? iconColor,
    required String title,
    Color? titleColor,
    String? trailingText,
    bool enabled = true,
    VoidCallback? onTap,
  }) {
    return ListTile(
      enabled: enabled,
      leading: Icon(icon, color: enabled ? (iconColor ?? AppColors.darkSlate) : AppColors.textTertiary, size: 22),
      title: Text(
        title,
        style: AppTypography.titleMedium.copyWith(
          color: enabled ? (titleColor ?? AppColors.textPrimary) : AppColors.textTertiary,
        ),
      ),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (trailingText != null) ...[
            Text(
              trailingText,
              style: AppTypography.bodySmall.copyWith(
                color: enabled ? AppColors.textSecondary : AppColors.textTertiary,
              ),
            ),
            const SizedBox(width: 6),
          ],
          Icon(
            Icons.chevron_right_rounded,
            size: 20,
            color: enabled ? AppColors.textTertiary : AppColors.subtleDivider,
          ),
        ],
      ),
      onTap: enabled ? onTap : null,
    );
  }
}

/// When the app last brought itself up to date, for the Sync card.
class LastSyncedNotifier extends Notifier<DateTime?> {
  @override
  DateTime? build() => null;

  void set(DateTime when) => state = when;
}

final lastSyncedProvider = NotifierProvider<LastSyncedNotifier, DateTime?>(LastSyncedNotifier.new);

/// One button that brings the phone and the server level: it re-reads the work
/// orders, projects and sites, and sends any photos still waiting to upload.
class _SyncCard extends ConsumerStatefulWidget {
  const _SyncCard();

  @override
  ConsumerState<_SyncCard> createState() => _SyncCardState();
}

class _SyncCardState extends ConsumerState<_SyncCard> {
  bool _syncing = false;
  String? _result;
  bool _failed = false;

  /// Photos on checklist items that have not reached the media bucket.
  int _waiting() => ref
      .read(taskEvidenceProvider)
      .values
      .expand((list) => list)
      .where((e) =>
          !e.isSubmitted &&
          (e.checklistItemId ?? '').isNotEmpty &&
          !e.isUploaded)
      .length;

  Future<void> _sync() async {
    if (_syncing) return;
    setState(() {
      _syncing = true;
      _result = null;
      _failed = false;
    });
    try {
      final before = _waiting();
      // Photos first, so the work orders read afterwards reflect them.
      final uploader = ref.read(evidenceUploaderProvider);
      for (final taskId in ref.read(taskEvidenceProvider).keys.toList()) {
        await uploader.uploadPending(taskId);
      }
      final stuck = _waiting();

      ref.invalidate(taskDetailProvider);
      ref.invalidate(projectListProvider);
      final _ = await ref.refresh(assignedTasksProvider.future);

      ref.read(lastSyncedProvider.notifier).set(DateTime.now());
      final sent = before - stuck;
      setState(() {
        _failed = stuck > 0;
        _result = stuck > 0
            ? '$stuck photo${stuck == 1 ? '' : 's'} could not be uploaded. Try again with a better connection.'
            : sent > 0
                ? 'Up to date. $sent photo${sent == 1 ? '' : 's'} uploaded.'
                : 'Up to date.';
      });
    } catch (e) {
      setState(() {
        _failed = true;
        _result = e.toString();
      });
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  String _ago(DateTime when) {
    final d = DateTime.now().difference(when);
    if (d.inMinutes < 1) return 'just now';
    if (d.inHours < 1) return '${d.inMinutes} min ago';
    if (d.inDays < 1) return '${d.inHours} h ago';
    return '${d.inDays} d ago';
  }

  @override
  Widget build(BuildContext context) {
    final last = ref.watch(lastSyncedProvider);
    final waiting = ref.watch(taskEvidenceProvider.select(
      (all) => all.values
          .expand((list) => list)
          .where((TaskEvidence e) => !e.isSubmitted && (e.checklistItemId ?? '').isNotEmpty && !e.isUploaded)
          .length,
    ));
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(
                    color: AppColors.primaryLavenderLight,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: const Icon(Icons.sync_rounded, size: 22, color: AppColors.darkSlate),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Sync', style: AppTypography.titleMedium),
                      const SizedBox(height: 2),
                      Text(
                        waiting > 0
                            ? '$waiting photo${waiting == 1 ? '' : 's'} waiting to upload'
                            : last == null
                                ? 'Tasks, projects and photos'
                                : 'Last synced ${_ago(last)}',
                        style: AppTypography.caption,
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            SizedBox(
              width: double.infinity,
              height: 46,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.darkSlate,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                onPressed: _syncing ? null : _sync,
                icon: _syncing
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.sync_rounded, size: 18),
                label: Text(_syncing ? 'Syncing…' : 'Sync now', style: const TextStyle(fontWeight: FontWeight.w600)),
              ),
            ),
            if (_result != null) ...[
              const SizedBox(height: 10),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    _failed ? Icons.error_outline : Icons.check_circle_outline,
                    size: 16,
                    color: _failed ? AppColors.statusBlockedText : const Color(0xFF2E7D32),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      _result!,
                      style: AppTypography.caption.copyWith(
                        color: _failed ? AppColors.statusBlockedText : AppColors.textSecondary,
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}


/// Switches push notifications on or off for this device, and says honestly when they cannot work.
class _PushTile extends ConsumerWidget {
  const _PushTile();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final enabled = ref.watch(pushEnabledProvider).value ?? true;
    final status = ref.watch(pushStatusProvider);
    final subtitle = !enabled
        ? 'Off on this device'
        : switch (status) {
            PushStatus.unavailable => 'Not set up in this version of the app',
            PushStatus.denied => 'Blocked: allow notifications for this app in system settings',
            _ => 'Alerts when something needs you',
          };
    return SwitchListTile.adaptive(
      key: const Key('push-switch'),
      secondary: const Icon(Icons.notifications_active_outlined, color: AppColors.darkSlate),
      title: Text('Push notifications', style: AppTypography.titleMedium),
      subtitle: Text(subtitle, style: AppTypography.caption),
      value: enabled,
      activeThumbColor: AppColors.darkSlate,
      onChanged: (value) => ref.read(pushEnabledProvider.notifier).set(value),
    );
  }
}
