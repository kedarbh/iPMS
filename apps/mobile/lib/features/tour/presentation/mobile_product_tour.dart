import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../../../core/security/token_storage.dart';

/// Central registry of target keys used to anchor interactive tour spotlight cutouts.
class TourTargetRegistry {
  static final GlobalKey profileHeaderKey = GlobalKey(
    debugLabel: 'tour_profile_header',
  );
  static final GlobalKey searchButtonKey = GlobalKey(
    debugLabel: 'tour_search_button',
  );
  static final GlobalKey statusFilterKey = GlobalKey(
    debugLabel: 'tour_status_filter',
  );
  static final GlobalKey firstTaskCardKey = GlobalKey(
    debugLabel: 'tour_first_task_card',
  );
  static final GlobalKey navigationDockKey = GlobalKey(
    debugLabel: 'tour_navigation_dock',
  );
}

/// A single step in the mobile interactive walkthrough.
class TourStep {
  final GlobalKey targetKey;
  final String title;
  final String description;

  const TourStep({
    required this.targetKey,
    required this.title,
    required this.description,
  });
}

/// Interactive guided tour tailored to user role and permissions.
class MobileProductTour {
  static List<TourStep> getStepsForRole(String? roleCode) {
    final role = (roleCode ?? '').toUpperCase();

    if (role == 'QC_MANAGER') {
      return [
        TourStep(
          targetKey: TourTargetRegistry.profileHeaderKey,
          title: 'QC Auditor Identity',
          description:
              'View your authenticated QC inspector status, digital signing authority, and regional telecom province.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.searchButtonKey,
          title: 'Inspection Work Order Search',
          description:
              'Instantly look up cell site inspections by tower ID (e.g. KTM-T01), checklist title, or assigned engineer.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.statusFilterKey,
          title: 'Review Status Pipeline',
          description:
              'Filter dispatches awaiting your approval, active audits, returned reworks, and finalized inspections.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.firstTaskCardKey,
          title: 'Quality Verification Cards',
          description:
              'Open submitted work orders to review high-res watermarked photos, check GPS tolerances, and approve or return.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.navigationDockKey,
          title: 'Audit Navigation Dock',
          description:
              'Quickly navigate between your active Inspection queue, Cell Sites, Travel Claims, and Profile.',
        ),
      ];
    }

    if (role == 'PROJECT_MANAGER' || role == 'PROJECT_DIRECTOR') {
      return [
        TourStep(
          targetKey: TourTargetRegistry.profileHeaderKey,
          title: 'Management Identity',
          description:
              'View your project portfolio authority, active deployment region, and operational settings.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.searchButtonKey,
          title: 'Search',
          description:
              'Search cell sites, tower upgrades, and contractor work packages across all 7 provinces of Nepal.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.statusFilterKey,
          title: 'Dispatch Status Pipeline',
          description:
              'Track work orders across Pending dispatches, ongoing field audits, and completed site handovers.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.firstTaskCardKey,
          title: 'Active Site Work Packages',
          description:
              'Monitor assigned contractor activities, inspect execution progress, and review milestone completions.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.navigationDockKey,
          title: 'Operations Dock',
          description:
              'Switch between assigned Project Sites, Work Orders, Budget advances, and Executive Settings.',
        ),
      ];
    }

    if (role == 'FINANCE') {
      return [
        TourStep(
          targetKey: TourTargetRegistry.profileHeaderKey,
          title: 'Finance Approver Identity',
          description:
              'Check your finance signing permissions, voucher disbursement thresholds, and account profile.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.searchButtonKey,
          title: 'Voucher & Expense Search',
          description:
              'Quickly find travel advances, fuel expense vouchers, and contractor claims by reference code.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.statusFilterKey,
          title: 'Disbursement Status Pipeline',
          description:
              'Filter requests across Pending Manager Approvals, Ready for Payment, Settled, and Returned items.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.firstTaskCardKey,
          title: 'Travel Advances & Claims',
          description:
              'Inspect submitted receipts, verify operational site budgets, and authorize instant payouts.',
        ),
        TourStep(
          targetKey: TourTargetRegistry.navigationDockKey,
          title: 'Finance Navigation Dock',
          description:
              'Switch seamlessly between Payment Requests, Expense Reports, Cell Site Budgets, and Profile.',
        ),
      ];
    }

    // Default: Field Engineer
    return [
      TourStep(
        targetKey: TourTargetRegistry.profileHeaderKey,
        title: 'Engineer Identity & Profile',
        description:
            'View your authenticated field engineer status, telecom province deployment, and access account settings.',
      ),
      TourStep(
        targetKey: TourTargetRegistry.searchButtonKey,
        title: 'Site & Tower Omni-Search',
        description:
            'Instantly search cell towers by site code (e.g. KTM-T01), tower height, or work order title across Nepal.',
      ),
      TourStep(
        targetKey: TourTargetRegistry.statusFilterKey,
        title: 'Workflow Status Pipeline',
        description:
            'Filter work orders across Pending dispatches, In-Progress audits, Submissions awaiting QC, and Completed logs.',
      ),
      TourStep(
        targetKey: TourTargetRegistry.firstTaskCardKey,
        title: 'Work Orders',
        description:
            'Open active tasks to complete digital checklists, verify GPS coordinates, and capture watermarked camera evidence.',
      ),
      TourStep(
        targetKey: TourTargetRegistry.navigationDockKey,
        title: 'Floating Navigation Dock',
        description:
            'Quickly navigate between your assigned Tasks, Project cell sites, Finance travel claims, and Profile.',
      ),
    ];
  }

  /// Checks if the user has already seen the tour; if not, marks as seen and launches it.
  static Future<void> checkAndStart(
    BuildContext context, {
    String? role,
  }) async {
    final storage = TokenStorage();
    final hasSeen = await storage.hasSeenProductTour();
    if (hasSeen || !context.mounted) return;

    await storage.markProductTourAsSeen();
    if (context.mounted) {
      await show(context, role: role);
    }
  }

  /// Explicitly opens the interactive guided tour overlay matching Image 3 design.
  static Future<void> show(BuildContext context, {String? role}) {
    return showGeneralDialog<void>(
      context: context,
      barrierDismissible: false,
      barrierColor: Colors.transparent,
      pageBuilder: (dialogContext, animation, secondaryAnimation) {
        return _TourOverlay(role: role);
      },
    );
  }
}

class _TourOverlay extends StatefulWidget {
  final String? role;

  const _TourOverlay({this.role});

  @override
  State<_TourOverlay> createState() => _TourOverlayState();
}

class _TourOverlayState extends State<_TourOverlay>
    with SingleTickerProviderStateMixin {
  int _currentStep = 0;
  late final AnimationController _pulseController;
  late final List<TourStep> _steps;

  @override
  void initState() {
    super.initState();
    _steps = MobileProductTour.getStepsForRole(widget.role);
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _pulseController.dispose();
    super.dispose();
  }

  Rect? _getTargetRect(GlobalKey key) {
    final renderBox = key.currentContext?.findRenderObject() as RenderBox?;
    if (renderBox == null || !renderBox.attached) return null;
    final offset = renderBox.localToGlobal(Offset.zero);
    final size = renderBox.size;
    if (size.width <= 0 || size.height <= 0) return null;
    return offset & size;
  }

  void _next() {
    if (_currentStep < _steps.length - 1) {
      setState(() => _currentStep++);
    } else {
      _dismiss();
    }
  }

  void _previous() {
    if (_currentStep > 0) {
      setState(() => _currentStep--);
    }
  }

  void _dismiss() {
    if (Navigator.of(context).canPop()) {
      Navigator.of(context).pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_steps.isEmpty) return const SizedBox.shrink();

    final step = _steps[_currentStep];
    final screenSize = MediaQuery.of(context).size;
    final padding = MediaQuery.of(context).padding;
    final rawTargetRect = _getTargetRect(step.targetKey);

    // Padding inflation around target
    final targetRect = rawTargetRect?.inflate(6.0);

    // Determine tooltip positioning: above or below target
    final bool placeBelow;
    if (targetRect != null) {
      final spaceBelow = screenSize.height - targetRect.bottom;
      final spaceAbove = targetRect.top;
      placeBelow = spaceBelow >= 220 || spaceBelow >= spaceAbove;
    } else {
      placeBelow = true;
    }

    return Material(
      color: Colors.transparent,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // 1. Darkened Spotlight Cutout Canvas
          AnimatedBuilder(
            animation: _pulseController,
            builder: (context, _) {
              return CustomPaint(
                size: screenSize,
                painter: _SpotlightPainter(
                  targetRect: targetRect,
                  pulseValue: _pulseController.value,
                ),
              );
            },
          ),

          // 2. Barrier tap to prevent clicks underneath
          Positioned.fill(
            child: GestureDetector(
              behavior: HitTestBehavior.translucent,
              onTap: () {},
            ),
          ),

          // 3. Floating Tooltip Popover Card (Matches Image 3)
          _buildPopoverCard(
            context: context,
            step: step,
            screenSize: screenSize,
            safePadding: padding,
            targetRect: targetRect,
            placeBelow: placeBelow,
          ),
        ],
      ),
    );
  }

  Widget _buildPopoverCard({
    required BuildContext context,
    required TourStep step,
    required Size screenSize,
    required EdgeInsets safePadding,
    required Rect? targetRect,
    required bool placeBelow,
  }) {
    const cardHorizontalMargin = 20.0;
    final cardWidth = screenSize.width - (cardHorizontalMargin * 2);

    double? top;
    double? bottom;

    if (targetRect != null) {
      if (placeBelow) {
        top = math.min(
          targetRect.bottom + 12.0,
          screenSize.height - safePadding.bottom - 220.0,
        );
      } else {
        bottom = math.min(
          (screenSize.height - targetRect.top) + 12.0,
          screenSize.height - safePadding.top - 220.0,
        );
      }
    } else {
      // Centered fallback if target is not currently laid out
      top = (screenSize.height - 200.0) / 2.0;
    }

    final isFirst = _currentStep == 0;
    final isLast = _currentStep == _steps.length - 1;

    // Calculate pointer arrow horizontal offset
    double arrowLeft = 32.0;
    if (targetRect != null) {
      arrowLeft = (targetRect.center.dx - cardHorizontalMargin - 8.0).clamp(
        20.0,
        cardWidth - 36.0,
      );
    }

    return Positioned(
      left: cardHorizontalMargin,
      right: cardHorizontalMargin,
      top: top,
      bottom: bottom,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Arrow pointing UP towards target when placeBelow is true
          if (targetRect != null && placeBelow)
            Padding(
              padding: EdgeInsets.only(left: arrowLeft),
              child: CustomPaint(
                size: const Size(16, 9),
                painter: _TrianglePainter(isPointingUp: true),
              ),
            ),

          // Compact Pure White Card (Exact Image 3 Spec)
          AnimatedSwitcher(
            duration: const Duration(milliseconds: 220),
            child: Container(
              key: ValueKey<int>(_currentStep),
              width: cardWidth,
              padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: const Color(0xFFE2E8F0), width: 1),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.18),
                    blurRadius: 28,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header Row: Royal Blue Title + Circular Close (X)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Expanded(
                        child: Text(
                          step.title,
                          style: const TextStyle(
                            color: Color(
                              0xFF2563EB,
                            ), // Royal blue matching Image 3
                            fontSize: 15.5,
                            fontWeight: FontWeight.w700,
                            letterSpacing: -0.2,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      // Circular (X) Button
                      InkWell(
                        onTap: _dismiss,
                        borderRadius: BorderRadius.circular(12),
                        child: Container(
                          width: 22,
                          height: 22,
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            border: Border.all(
                              color: const Color(0xFFCBD5E1),
                              width: 1.2,
                            ),
                          ),
                          child: const Center(
                            child: Icon(
                              Icons.close_rounded,
                              size: 13,
                              color: Color(0xFF64748B),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 9),

                  // Description Text
                  Text(
                    step.description,
                    style: const TextStyle(
                      color: Color(0xFF475569),
                      fontSize: 13,
                      height: 1.45,
                    ),
                  ),
                  const SizedBox(height: 16),

                  // Footer: Outlined Button (End Tour / Previous) + Step Indicator (1/5) + Solid Blue Button (Next / Finish)
                  Row(
                    children: [
                      // Left Button
                      OutlinedButton(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: const Color(0xFF334155),
                          side: const BorderSide(color: Color(0xFFCBD5E1)),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 16,
                            vertical: 7,
                          ),
                          shape: const StadiumBorder(),
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        onPressed: isFirst ? _dismiss : _previous,
                        child: Text(
                          isFirst ? 'End Tour' : 'Previous',
                          style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),

                      // Center Step Count (e.g. 1/5)
                      Expanded(
                        child: Center(
                          child: Text(
                            '${_currentStep + 1}/${_steps.length}',
                            style: const TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                              color: Color(0xFF64748B),
                            ),
                          ),
                        ),
                      ),

                      // Right Solid Blue Button
                      ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF2563EB),
                          foregroundColor: Colors.white,
                          elevation: 0,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 20,
                            vertical: 7,
                          ),
                          shape: const StadiumBorder(),
                          minimumSize: Size.zero,
                          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                        ),
                        onPressed: _next,
                        child: Text(
                          isLast ? 'Finish' : 'Next',
                          style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),

          // Arrow pointing DOWN towards target when placeBelow is false
          if (targetRect != null && !placeBelow)
            Padding(
              padding: EdgeInsets.only(left: arrowLeft),
              child: CustomPaint(
                size: const Size(16, 9),
                painter: _TrianglePainter(isPointingUp: false),
              ),
            ),
        ],
      ),
    );
  }
}

/// Draws the crisp triangular arrow caret pointing at the target element.
class _TrianglePainter extends CustomPainter {
  final bool isPointingUp;

  _TrianglePainter({required this.isPointingUp});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white
      ..style = PaintingStyle.fill;

    final borderPaint = Paint()
      ..color = const Color(0xFFE2E8F0)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.0;

    final path = Path();
    if (isPointingUp) {
      path.moveTo(0, size.height);
      path.lineTo(size.width / 2, 0);
      path.lineTo(size.width, size.height);
      path.close();
    } else {
      path.moveTo(0, 0);
      path.lineTo(size.width / 2, size.height);
      path.lineTo(size.width, 0);
      path.close();
    }

    canvas.drawPath(path, paint);
    canvas.drawPath(path, borderPaint);
  }

  @override
  bool shouldRepaint(covariant _TrianglePainter oldDelegate) =>
      oldDelegate.isPointingUp != isPointingUp;
}

/// Custom painter rendering the darkened backdrop with rounded cutout and pulsing halo.
class _SpotlightPainter extends CustomPainter {
  final Rect? targetRect;
  final double pulseValue;

  _SpotlightPainter({required this.targetRect, required this.pulseValue});

  @override
  void paint(Canvas canvas, Size size) {
    // 1. Darkened Barrier Background
    final fullScreenPath = Path()
      ..addRect(Rect.fromLTWH(0, 0, size.width, size.height));

    if (targetRect == null) {
      // Dark barrier without cutout when target is not available
      canvas.drawPath(
        fullScreenPath,
        Paint()..color = const Color(0x990F172A), // ~60% opacity deep slate
      );
      return;
    }

    final cutoutRRect = RRect.fromRectAndRadius(
      targetRect!,
      const Radius.circular(14.0),
    );
    final cutoutPath = Path()..addRRect(cutoutRRect);

    // Compute inverted mask difference so target element shines through
    final barrierPath = Path.combine(
      PathOperation.difference,
      fullScreenPath,
      cutoutPath,
    );

    canvas.drawPath(barrierPath, Paint()..color = const Color(0x990F172A));

    // 2. Animated Pulsing Halo Ring
    final haloInflation = 3.0 + (pulseValue * 6.0);
    final haloOpacity = (1.0 - pulseValue).clamp(0.0, 1.0) * 0.7;
    final haloRRect = RRect.fromRectAndRadius(
      targetRect!.inflate(haloInflation),
      Radius.circular(14.0 + haloInflation),
    );

    final haloPaint = Paint()
      ..color = const Color(0xFF3B82F6).withValues(alpha: haloOpacity)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5;

    canvas.drawRRect(haloRRect, haloPaint);

    // 3. Crisp Inner Focus Border
    final borderPaint = Paint()
      ..color = const Color(0xFF2563EB)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.0;

    canvas.drawRRect(cutoutRRect, borderPaint);
  }

  @override
  bool shouldRepaint(covariant _SpotlightPainter oldDelegate) {
    return oldDelegate.targetRect != targetRect ||
        oldDelegate.pulseValue != pulseValue;
  }
}
