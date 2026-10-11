import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../core/security/token_storage.dart';
import '../../core/theme/app_colors.dart';
import '../../features/auth/presentation/widgets/biometric_enrollment_sheet.dart';
import '../../features/auth/providers/auth_provider.dart';
import '../../features/auth/providers/biometric_provider.dart';
import '../../features/guide/presentation/app_guide_modal.dart';
import 'floating_nav_bar.dart';

/// Navigation index notifier for active tab switching across screens.
class NavigationIndexNotifier extends Notifier<int> {
  @override
  int build() => 0;

  void setIndex(int index) => state = index;
}

final navigationIndexProvider =
    NotifierProvider<NavigationIndexNotifier, int>(NavigationIndexNotifier.new);

/// The Finance tab's slot in [MainScaffold.pages]. A user whose finance is
/// handled elsewhere keeps the slot, which keeps every other tab's index valid
/// (the task list jumps to Profile by index), but not the button.
const int financeTabIndex = 2;

class MainScaffold extends ConsumerStatefulWidget {
  const MainScaffold({
    super.key,
    required this.pages,
    this.hiddenTabs = const {},
  });

  final List<Widget> pages;

  /// Tabs whose page stays in place but whose button is not offered.
  final Set<int> hiddenTabs;

  @override
  ConsumerState<MainScaffold> createState() => _MainScaffoldState();
}

class _MainScaffoldState extends ConsumerState<MainScaffold> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await _offerBiometricSignIn();
      if (mounted) {
        await _checkFirstTimeGuide();
      }
    });
  }

  /// Displays the interactive onboarding guide once on initial installation / first login.
  Future<void> _checkFirstTimeGuide() async {
    final storage = TokenStorage();
    final hasSeen = await storage.hasSeenProjectGuide();
    if (!hasSeen && mounted) {
      await storage.markProjectGuideAsSeen();
      if (mounted) {
        await AppGuideModal.show(context);
      }
    }
  }

  /// After a password sign-in, offers to turn on Face ID / fingerprint once,
  /// if the device has it and it is not already on.
  Future<void> _offerBiometricSignIn() async {
    if (!mounted || !ref.read(biometricOfferPendingProvider)) return;
    ref.read(biometricOfferPendingProvider.notifier).set(false);

    await ref.read(biometricAuthStateProvider.notifier).checkBiometricStatus();
    if (!mounted) return;
    final biometric = ref.read(biometricAuthStateProvider);
    final user = ref.read(authStateProvider).value;
    if (user == null || !biometric.isHardwareSupported || biometric.isConfigured) return;
    await BiometricEnrollmentSheet.show(context, user.username);
  }

  @override
  Widget build(BuildContext context) {
    final pages = widget.pages;
    final requested = ref.watch(navigationIndexProvider);
    // A shortcut to a tab this user does not have (a guide button) lands on the
    // first tab instead of a blank page.
    final currentIndex = widget.hiddenTabs.contains(requested) ? 0 : requested;

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      body: Stack(
        children: [
          // Current Tab Body
          IndexedStack(
            index: currentIndex < pages.length ? currentIndex : 0,
            children: pages,
          ),

          // Floating Navigation Bar
          Positioned(
            left: 0,
            right: 0,
            bottom: 0,
            child: SafeArea(
              child: FloatingNavBar(
                currentIndex: currentIndex,
                hiddenTabs: widget.hiddenTabs,
                onTap: (index) {
                  ref.read(navigationIndexProvider.notifier).setIndex(index);
                },
                onQuickAction: () {
                  // Switch to Task List
                  ref.read(navigationIndexProvider.notifier).setIndex(0);
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}
