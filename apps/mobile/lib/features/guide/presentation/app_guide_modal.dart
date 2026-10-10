import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/layout/main_scaffold.dart';
import '../../auth/providers/auth_provider.dart';

/// Data structure for a step in the field engineer rollout lifecycle.
class FieldWorkflowStep {
  const FieldWorkflowStep({
    required this.stepNumber,
    required this.title,
    required this.category,
    required this.badge,
    required this.summary,
    required this.whatHappens,
    required this.stepActions,
    required this.proTip,
    this.targetTabIndex,
    this.actionLabel,
  });

  final int stepNumber;
  final String title;
  final String category;
  final String badge;
  final String summary;
  final List<String> whatHappens;
  final List<String> stepActions;
  final String proTip;
  final int? targetTabIndex;
  final String? actionLabel;
}

/// Data structure for an interactive mobile component or module.
class MobileComponentInfo {
  const MobileComponentInfo({
    required this.id,
    required this.name,
    required this.screenRoute,
    required this.category,
    required this.summary,
    required this.description,
    required this.keyFeatures,
    this.targetTabIndex,
    this.actionLabel,
  });

  final String id;
  final String name;
  final String screenRoute;
  final String category;
  final String summary;
  final String description;
  final List<String> keyFeatures;
  final int? targetTabIndex;
  final String? actionLabel;
}

const List<FieldWorkflowStep> _kWorkflowSteps = [
  FieldWorkflowStep(
    stepNumber: 1,
    title: 'Review Assigned Work Orders',
    category: 'Work Order Dispatch',
    badge: 'Step 1 • Assignment',
    summary:
        'Access your daily queue of telecom installation and quality audit tasks directly from the iPMS dispatch console.',
    whatHappens: [
      'Backend managers dispatch site quality inspections directly to your field profile.',
      'Tasks display telecom site codes, rollout projects, deadlines, and urgency badges (Critical, High, Normal).',
      'Filters enable instant separation between In Progress, Submitted, and Approved tasks.',
    ],
    stepActions: [
      'Open the "Tasks" tab in the bottom navigation bar.',
      'Check the status filters (In Progress, Submitted, Approved, Rejected).',
      'Tap on an assigned work order card to view its physical cell site details and checklist requirements.',
    ],
    proTip:
        'Always perform a pull-to-refresh sync before traveling to remote cell towers to ensure your local cache has the newest work order revisions.',
    targetTabIndex: 0,
    actionLabel: 'Go to Tasks List',
  ),
  FieldWorkflowStep(
    stepNumber: 2,
    title: 'Travel & GPS Geofence Check-in',
    category: 'Site Engineering & Geo-verification',
    badge: 'Step 2 • Geofence',
    summary:
        'Navigate to the physical tower location across Nepal and validate engineer presence inside the mandatory 100m geofence radius.',
    whatHappens: [
      'Each work order opens a map of its cell tower site with live latitude and longitude coordinates.',
      'The automated geofencing engine measures your real-time distance from the tower base.',
      'Check-in is permitted only when inside the 100m compliance radius, preventing off-site fraud.',
    ],
    stepActions: [
      'Open a work order and tap the map button to preview the site and your distance from it.',
      'Tap "Navigate with Maps" for turn-by-turn driving directions to the tower base.',
      'Once on site, open the task detail and check the Geofence status card.',
      'When the status turns green ("Inside Geofence"), tap "Verify Check-in".',
    ],
    proTip:
        'Ensure device GPS location mode is set to "High Accuracy" and wait for the accuracy indicator to stabilize (<= 15m) before checking in.',
    targetTabIndex: 0,
    actionLabel: 'Go to Tasks List',
  ),
  FieldWorkflowStep(
    stepNumber: 3,
    title: 'Execute Quality Checklist',
    category: 'Field Inspection',
    badge: 'Step 3 • Inspection',
    summary:
        'Perform hands-on physical verification of Civil Works, Power, Antenna tilt, and Earthing checkpoints.',
    whatHappens: [
      'Standardized quality templates created on the web console are loaded onto your device.',
      'Every checkpoint supports Pass, Fail, or NA status with mandatory remarks for non-compliance.',
      'Critical checkpoints show a "Photo Required" badge, enforcing visual evidence before submission.',
    ],
    stepActions: [
      'Scroll through sections: Foundation, Tower Structure, Electrical & Earthing, RF Antennas.',
      'Tap "Pass", "Fail", or "N/A" for each item.',
      'If an item fails, add detailed observation remarks to guide tower technicians.',
      'Items marked with a camera badge will unlock the continuous camera.',
    ],
    proTip:
        'Review the mandatory photo items before starting climbing or structural work so you can organize your photo evidence capture systematically.',
    targetTabIndex: 0,
    actionLabel: 'Open Task Inspection',
  ),
  FieldWorkflowStep(
    stepNumber: 4,
    title: 'Watermarked Evidence Capture',
    category: 'Forensic Evidence Camera',
    badge: 'Step 4 • Watermarking',
    summary:
        'Capture tamper-proof evidence photos with real-time canvas watermarking embedded directly into the pixels.',
    whatHappens: [
      'Continuous rapid-fire shutter enables taking multiple checkpoint photos without returning to the menu.',
      'Pure canvas engine embeds live GPS coordinates, altitude, timestamp, site code, task ID, and engineer name.',
      'Photos are verified against site boundaries to guarantee authenticity for audits.',
    ],
    stepActions: [
      'Tap the Camera icon on any checklist item requiring visual proof.',
      'Frame the telecom component (e.g. Earthing busbar, RF cable bend, foundation anchor bolts).',
      'Tap the shutter button. Photos are watermarked instantly and added to the evidence tray.',
      'Review captured thumbnails in the bottom reel before accepting.',
    ],
    proTip:
        'Hold the phone steady until the shutter click completes; the embedded watermark uses raw sensor data captured at the exact moment of exposure.',
    targetTabIndex: 0,
    actionLabel: 'Try Inspection Camera',
  ),
  FieldWorkflowStep(
    stepNumber: 5,
    title: 'Submit & Track QC Review',
    category: 'Compliance & Sign-off',
    badge: 'Step 5 • Approval',
    summary:
        'Package all inspection items and forensic photo evidence for remote sign-off by the Quality Assurance Manager.',
    whatHappens: [
      'The app verifies that all mandatory questions and required photo proofs are fulfilled.',
      'Once submitted, the task transitions to "Submitted" status and locks editing.',
      'Remote QC managers review each evidence photo on the web console and either Approve or Request Rework.',
    ],
    stepActions: [
      'Perform a final review of all checklist answers and photo thumbnails.',
      'Tap the "Submit Work Order for QC Review" button at the bottom of the task screen.',
      'Monitor task status in your task list: green badge indicates Approval; red badge indicates Rework Needed.',
      'If rework is requested, open the task to see the reviewer notes on specific rejected items.',
    ],
    proTip:
        'Check push notifications or pull-to-refresh in the task list daily to immediately spot any rework requests before leaving the regional zone.',
    targetTabIndex: 0,
    actionLabel: 'View Task Statuses',
  ),
];

const List<MobileComponentInfo> _kComponentsCatalog = [
  MobileComponentInfo(
    id: 'tasks',
    name: 'Work Orders & Tasks',
    screenRoute: 'Tab 1: TaskListScreen',
    category: 'Field Operations',
    summary:
        'Central landing feed listing all site inspections assigned to the logged-in field engineer.',
    description:
        'Allows filtering by status (In Progress, Submitted, Approved, Rejected), searching by Site Code or Task Title, and launching detailed quality inspections.',
    keyFeatures: [
      'Real-time search across site codes and work order titles',
      'Status chips for quick filtering and queue triage',
      'Pull-to-refresh instant backend synchronization',
      'Visual priority indicators (Critical, High, Normal)',
    ],
    targetTabIndex: 0,
    actionLabel: 'Switch to Tasks Tab',
  ),
  MobileComponentInfo(
    id: 'finance',
    name: 'Finance',
    screenRoute: 'Tab 3: FinanceScreen',
    category: 'Expenses',
    summary:
        'Raise advances and reimbursements, settle advances with invoices, and follow each request through approval.',
    description:
        'Your own finance requests in one place. Requests go to your project manager, then the project director, then finance, who pays. Returned requests can be edited and resubmitted.',
    keyFeatures: [
      'New advance and reimbursement requests with category and purpose',
      'Settle a paid advance with invoices; the outstanding balance is shown',
      'Status filters: drafts, in approval, paid, returned, closed',
      'Full history with reviewer comments, invoices and payments',
    ],
    targetTabIndex: 2,
    actionLabel: 'Switch to Finance Tab',
  ),
  MobileComponentInfo(
    id: 'projects',
    name: 'Projects & Sites Directory',
    screenRoute: 'Tab 2: ProjectListScreen',
    category: 'Portfolio Management',
    summary:
        'Master list of telecommunications infrastructure rollout projects and physical site directories.',
    description:
        'Browse nationwide initiatives (e.g. 5G Modernization, Microwave Upgrade) and inspect all associated physical cell sites.',
    keyFeatures: [
      'Nationwide project overview cards with active status',
      'Sub-site directory grouped by telecom region and province',
      'Direct link to launch inspections for any cell tower',
    ],
    targetTabIndex: 1,
    actionLabel: 'Switch to Projects Tab',
  ),
  MobileComponentInfo(
    id: 'camera',
    name: 'Continuous Watermarked Camera',
    screenRoute: 'ContinuousCameraScreen',
    category: 'Forensic Photo Evidence',
    summary:
        'High-speed field camera with pixel-embedded tamper-proof metadata watermarks.',
    description:
        'Engineered for rapid field operations. Eliminates screen reloading between shots and permanently burns GPS latitude, longitude, altitude, accuracy, timestamp, and site identifiers onto each image.',
    keyFeatures: [
      'Continuous rapid capture (1-tap shutter without leaving viewfinder)',
      'Pure canvas in-memory watermark burn-in',
      'Sensor bar showing live GPS accuracy and compass heading',
      'Reel preview bar for reviewing evidence photos before saving',
    ],
    targetTabIndex: 0,
    actionLabel: 'View in Tasks',
  ),
  MobileComponentInfo(
    id: 'geofence',
    name: 'Geofence Verification Engine',
    screenRoute: 'GeofenceVerificationCard',
    category: 'Anti-Fraud & Compliance',
    summary:
        'Real-time GPS validation enforcing on-site physical presence before work order execution.',
    description:
        'Calculates great-circle distance between device GPS and cell tower coordinates. Prevents inspection submission if the engineer is outside the designated 100-meter radius.',
    keyFeatures: [
      '100-meter compliance boundary enforcement',
      'Live distance meter displaying meters remaining to site base',
      'Green/Red compliance badge with high-accuracy GPS check',
    ],
    targetTabIndex: 0,
    actionLabel: 'View in Tasks',
  ),
  MobileComponentInfo(
    id: 'biometrics',
    name: 'Biometric & Enclave Authentication',
    screenRoute: 'BiometricEnrollmentSheet',
    category: 'Security & Identity',
    summary:
        'Hardware keystore authentication supporting Fingerprint and Face ID.',
    description:
        'Enables instantaneous 1-tap sign-in on site without typing passwords. Uses Android Keystore and iOS Secure Enclave for secure offline token persistence.',
    keyFeatures: [
      'Fingerprint and Face Unlock support',
      'Hardware-backed token encryption',
      'Offline session continuity during field operations',
      'Sync QR and dual-SIM support for instant server setup',
    ],
    targetTabIndex: 3,
    actionLabel: 'View Profile Security',
  ),
  MobileComponentInfo(
    id: 'profile',
    name: 'Profile & Device Settings',
    screenRoute: 'Tab 4: ProfileScreen',
    category: 'System & Preferences',
    summary:
        'User profile credentials, role verification, and device security management.',
    description:
        'View engineer credentials, switch server URLs, configure biometric preferences, and manage offline data cache.',
    keyFeatures: [
      'Assigned role and security credential display',
      'Biometric authentication toggles',
      'Server endpoint address configuration',
      'Instant access to the interactive App Guide',
    ],
    targetTabIndex: 3,
    actionLabel: 'Switch to Profile Tab',
  ),
];

/// Interactive modal bottom sheet providing a complete walkthrough of the
/// mobile field application and its underlying components.
class AppGuideModal extends ConsumerStatefulWidget {
  const AppGuideModal({super.key});

  /// Opens the interactive project guide bottom sheet.
  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.transparent,
      builder: (_) => const AppGuideModal(),
    );
  }

  @override
  ConsumerState<AppGuideModal> createState() => _AppGuideModalState();
}

class _AppGuideModalState extends ConsumerState<AppGuideModal> {
  int _activeTab = 0; // 0: Workflow, 1: Components
  int _currentStepIndex = 0;
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _navigateToTab(int tabIndex) {
    ref.read(navigationIndexProvider.notifier).setIndex(tabIndex);
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final size = MediaQuery.of(context).size;

    return Container(
      height: size.height * 0.90,
      decoration: const BoxDecoration(
        color: AppColors.scaffoldBackground,
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      child: Column(
        children: [
          // Drag Handle
          const SizedBox(height: 10),
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey.shade300,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Header
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Row(
              children: [
                Container(
                  width: 42,
                  height: 42,
                  decoration: BoxDecoration(
                    gradient: const LinearGradient(
                      colors: [Color(0xFF3B82F6), Color(0xFF1D4ED8)],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: [
                      BoxShadow(
                        color: const Color(0xFF2563EB).withValues(alpha: 0.25),
                        blurRadius: 8,
                        offset: const Offset(0, 3),
                      ),
                    ],
                  ),
                  child: const Icon(
                    Icons.explore_rounded,
                    color: Colors.white,
                    size: 22,
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            'IPMS GUIDE',
                            style: GoogleFonts.inter(
                              fontSize: 10,
                              fontWeight: FontWeight.w800,
                              letterSpacing: 0.8,
                              color: AppColors.textSecondary,
                            ),
                          ),
                          const SizedBox(width: 6),
                          Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 6, vertical: 1),
                            decoration: BoxDecoration(
                              color: const Color(0xFFDBEAFE),
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text(
                              'Walkthrough',
                              style: GoogleFonts.inter(
                                fontSize: 9.5,
                                fontWeight: FontWeight.w700,
                                color: const Color(0xFF1E40AF),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Field Guide & Workflow',
                        style: AppTypography.titleLarge.copyWith(
                          fontWeight: FontWeight.bold,
                          color: AppColors.darkSlate,
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close_rounded),
                  style: IconButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: AppColors.textSecondary,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(10),
                      side: BorderSide(color: Colors.grey.shade200),
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          // Tab Switcher Pill
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 20),
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                color: const Color(0xFFEDF2F7),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: _buildTabButton(
                      title: 'Field Workflow',
                      icon: Icons.timeline_rounded,
                      isActive: _activeTab == 0,
                      onTap: () => setState(() => _activeTab = 0),
                    ),
                  ),
                  const SizedBox(width: 4),
                  Expanded(
                    child: _buildTabButton(
                      title: 'Component Explorer',
                      icon: Icons.widgets_rounded,
                      isActive: _activeTab == 1,
                      onTap: () => setState(() => _activeTab = 1),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),

          // Body Content (Tabs)
          Expanded(
            child: _activeTab == 0
                ? _buildWorkflowView(theme)
                : _buildComponentsView(theme),
          ),
        ],
      ),
    );
  }

  Widget _buildTabButton({
    required String title,
    required IconData icon,
    required bool isActive,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: isActive ? Colors.white : Colors.transparent,
          borderRadius: BorderRadius.circular(10),
          boxShadow: isActive
              ? [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.05),
                    blurRadius: 4,
                    offset: const Offset(0, 1),
                  ),
                ]
              : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 16,
              color: isActive ? const Color(0xFF1E40AF) : AppColors.textSecondary,
            ),
            const SizedBox(width: 6),
            Text(
              title,
              style: GoogleFonts.inter(
                fontSize: 12.5,
                fontWeight: isActive ? FontWeight.w700 : FontWeight.w600,
                color: isActive ? const Color(0xFF1E40AF) : AppColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Tab 1: 5-Step Field Workflow
  // --------------------------------------------------------------------------
  Widget _buildWorkflowView(ThemeData theme) {
    final step = _kWorkflowSteps[_currentStepIndex];

    return Column(
      children: [
        // Stepper Progress Indicators
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: List.generate(_kWorkflowSteps.length, (index) {
                final isCurrent = index == _currentStepIndex;
                final isPassed = index < _currentStepIndex;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: InkWell(
                    onTap: () => setState(() => _currentStepIndex = index),
                    borderRadius: BorderRadius.circular(10),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 150),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: isCurrent
                            ? const Color(0xFFEFF6FF)
                            : (isPassed
                                ? const Color(0xFFF0FDF4)
                                : Colors.white),
                        border: Border.all(
                          color: isCurrent
                              ? const Color(0xFF93C5FD)
                              : (isPassed
                                  ? const Color(0xFFBBF7D0)
                                  : const Color(0xFFE2E8F0)),
                        ),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        children: [
                          Container(
                            width: 18,
                            height: 18,
                            decoration: BoxDecoration(
                              color: isCurrent
                                  ? const Color(0xFF2563EB)
                                  : (isPassed
                                      ? const Color(0xFF22C55E)
                                      : const Color(0xFFF1F5F9)),
                              shape: BoxShape.circle,
                            ),
                            child: Center(
                              child: isPassed
                                  ? const Icon(Icons.check,
                                      size: 12, color: Colors.white)
                                  : Text(
                                      '${index + 1}',
                                      style: GoogleFonts.inter(
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold,
                                        color: isCurrent
                                            ? Colors.white
                                            : AppColors.textPrimary,
                                      ),
                                    ),
                            ),
                          ),
                          const SizedBox(width: 6),
                          Text(
                            'Step ${index + 1}',
                            style: GoogleFonts.inter(
                              fontSize: 11.5,
                              fontWeight: isCurrent
                                  ? FontWeight.bold
                                  : FontWeight.w500,
                              color: isCurrent
                                  ? const Color(0xFF1E40AF)
                                  : (isPassed
                                      ? const Color(0xFF166534)
                                      : AppColors.textSecondary),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              }),
            ),
          ),
        ),

        // Scrollable Step Details
        Expanded(
          child: SingleChildScrollView(
            padding: const EdgeInsets.fromLTRB(20, 10, 20, 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Badges Row
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: const Color(0xFFE0E7FF),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        step.badge,
                        style: GoogleFonts.inter(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w700,
                          color: const Color(0xFF3730A3),
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF1F5F9),
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Text(
                        step.category,
                        style: GoogleFonts.inter(
                          fontSize: 10.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),

                // Title & Summary
                Text(
                  step.title,
                  style: AppTypography.headingSmall.copyWith(
                    fontWeight: FontWeight.bold,
                    color: AppColors.darkSlate,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  step.summary,
                  style: AppTypography.bodyMedium.copyWith(
                    height: 1.45,
                    color: const Color(0xFF475569),
                  ),
                ),
                const SizedBox(height: 16),

                // What Happens Card
                _buildInfoBlock(
                  title: 'What Happens Here',
                  icon: Icons.check_circle_outline_rounded,
                  iconColor: const Color(0xFF2563EB),
                  items: step.whatHappens,
                ),
                const SizedBox(height: 14),

                // Step-by-Step Actions Card
                _buildActionBlock(
                  title: 'Step-by-Step Instructions',
                  actions: step.stepActions,
                ),
                const SizedBox(height: 14),

                // Pro-Tip Card
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFFFBEB),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: const Color(0xFFFEF3C7)),
                  ),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.lightbulb_rounded,
                        color: Color(0xFFD97706),
                        size: 20,
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Field Pro-Tip',
                              style: GoogleFonts.inter(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: const Color(0xFF92400E),
                              ),
                            ),
                            const SizedBox(height: 3),
                            Text(
                              step.proTip,
                              style: GoogleFonts.inter(
                                fontSize: 12,
                                height: 1.45,
                                color: const Color(0xFF78350F),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),

                // Jump to Tab Action Button (if linked)
                if (step.targetTabIndex != null && step.actionLabel != null) ...[
                  const SizedBox(height: 14),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: () => _navigateToTab(step.targetTabIndex!),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF2563EB),
                        foregroundColor: Colors.white,
                        elevation: 0,
                        padding: const EdgeInsets.symmetric(vertical: 12),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      icon: const Icon(Icons.arrow_forward_rounded, size: 16),
                      label: Text(
                        step.actionLabel!,
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),

        // Stepper Bottom Navigation Bar
        Container(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 16),
          decoration: BoxDecoration(
            color: Colors.white,
            border: Border(top: BorderSide(color: Colors.grey.shade200)),
          ),
          child: Row(
            children: [
              // Previous Step Button
              OutlinedButton.icon(
                onPressed: _currentStepIndex > 0
                    ? () => setState(() => _currentStepIndex--)
                    : null,
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.textPrimary,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                ),
                icon: const Icon(Icons.arrow_back_rounded, size: 16),
                label: const Text('Back'),
              ),
              const Spacer(),

              // Progress Indicator (e.g. 2 of 5)
              Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'Step ${_currentStepIndex + 1} of ${_kWorkflowSteps.length}',
                    style: GoogleFonts.inter(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 4),
                  SizedBox(
                    width: 70,
                    height: 4,
                    child: ClipRRect(
                      borderRadius: BorderRadius.circular(2),
                      child: LinearProgressIndicator(
                        value: (_currentStepIndex + 1) / _kWorkflowSteps.length,
                        backgroundColor: const Color(0xFFE2E8F0),
                        valueColor:
                            const AlwaysStoppedAnimation(Color(0xFF2563EB)),
                      ),
                    ),
                  ),
                ],
              ),
              const Spacer(),

              // Next / Finish Button
              ElevatedButton.icon(
                onPressed: _currentStepIndex < _kWorkflowSteps.length - 1
                    ? () => setState(() => _currentStepIndex++)
                    : () => Navigator.pop(context),
                style: ElevatedButton.styleFrom(
                  backgroundColor:
                      _currentStepIndex < _kWorkflowSteps.length - 1
                          ? const Color(0xFF2563EB)
                          : const Color(0xFF10B981),
                  foregroundColor: Colors.white,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  padding:
                      const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                ),
                label: Text(
                  _currentStepIndex < _kWorkflowSteps.length - 1
                      ? 'Next'
                      : 'Done',
                  style: GoogleFonts.inter(fontWeight: FontWeight.w600),
                ),
                icon: Icon(
                  _currentStepIndex < _kWorkflowSteps.length - 1
                      ? Icons.arrow_forward_rounded
                      : Icons.check_circle_rounded,
                  size: 16,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildInfoBlock({
    required String title,
    required IconData icon,
    required Color iconColor,
    required List<String> items,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: iconColor),
              const SizedBox(width: 8),
              Text(
                title,
                style: GoogleFonts.inter(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.darkSlate,
                  letterSpacing: 0.3,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ...items.map((item) => Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 5,
                      height: 5,
                      margin: const EdgeInsets.only(top: 6, right: 8),
                      decoration: const BoxDecoration(
                        color: Color(0xFF2563EB),
                        shape: BoxShape.circle,
                      ),
                    ),
                    Expanded(
                      child: Text(
                        item,
                        style: GoogleFonts.inter(
                          fontSize: 12,
                          height: 1.45,
                          color: const Color(0xFF334155),
                        ),
                      ),
                    ),
                  ],
                ),
              )),
        ],
      ),
    );
  }

  Widget _buildActionBlock({
    required String title,
    required List<String> actions,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.format_list_numbered_rounded,
                  size: 16, color: Color(0xFF10B981)),
              const SizedBox(width: 8),
              Text(
                title,
                style: GoogleFonts.inter(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.darkSlate,
                  letterSpacing: 0.3,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          ...actions.asMap().entries.map((entry) {
            final idx = entry.key + 1;
            final action = entry.value;
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 18,
                    height: 18,
                    margin: const EdgeInsets.only(right: 8, top: 1),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF1F5F9),
                      shape: BoxShape.circle,
                      border: Border.all(color: const Color(0xFFE2E8F0)),
                    ),
                    child: Center(
                      child: Text(
                        '$idx',
                        style: GoogleFonts.inter(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      action,
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        height: 1.45,
                        color: const Color(0xFF334155),
                      ),
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Tab 2: Mobile Component Catalog
  // --------------------------------------------------------------------------
  Widget _buildComponentsView(ThemeData theme) {
    // The Finance entry describes a tab this user may not have.
    final mayUseFinance = ref.watch(authStateProvider).value?.can('finance_request.view') ?? false;
    final catalog = _kComponentsCatalog.where((c) => c.id != 'finance' || mayUseFinance).toList();
    final filtered = catalog.where((c) {
      if (_searchQuery.isEmpty) return true;
      final q = _searchQuery.toLowerCase();
      return c.name.toLowerCase().contains(q) ||
          c.summary.toLowerCase().contains(q) ||
          c.category.toLowerCase().contains(q);
    }).toList();

    return Column(
      children: [
        // Search Filter Bar
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
          child: Container(
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: const Color(0xFFCBD5E1)),
            ),
            child: TextField(
              controller: _searchController,
              onChanged: (val) => setState(() => _searchQuery = val.trim()),
              decoration: InputDecoration(
                hintText: 'Search mobile components (e.g. Camera, Map)...',
                hintStyle: GoogleFonts.inter(
                  fontSize: 12.5,
                  color: AppColors.textSecondary,
                ),
                prefixIcon: const Icon(
                  Icons.search_rounded,
                  size: 20,
                  color: AppColors.textSecondary,
                ),
                suffixIcon: _searchQuery.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear, size: 16),
                        onPressed: () {
                          _searchController.clear();
                          setState(() => _searchQuery = '');
                        },
                      )
                    : null,
                border: InputBorder.none,
                contentPadding: const EdgeInsets.symmetric(vertical: 11),
              ),
            ),
          ),
        ),

        // Result Count Label
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 2),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(
              'Showing ${filtered.length} of ${catalog.length} mobile components',
              style: GoogleFonts.inter(
                fontSize: 11,
                color: AppColors.textSecondary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
        ),

        // List of Component Cards
        Expanded(
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(20, 8, 20, 20),
            itemCount: filtered.length,
            itemBuilder: (context, i) {
              final comp = filtered[i];
              return Container(
                margin: const EdgeInsets.only(bottom: 12),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.02),
                      blurRadius: 6,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Header Tag & Name
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                comp.category.toUpperCase(),
                                style: GoogleFonts.inter(
                                  fontSize: 9.5,
                                  fontWeight: FontWeight.w800,
                                  letterSpacing: 0.5,
                                  color: const Color(0xFF2563EB),
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                comp.name,
                                style: GoogleFonts.inter(
                                  fontSize: 14.5,
                                  fontWeight: FontWeight.bold,
                                  color: AppColors.darkSlate,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 7, vertical: 2),
                          decoration: BoxDecoration(
                            color: const Color(0xFFF1F5F9),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            comp.screenRoute,
                            style: GoogleFonts.robotoMono(
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textSecondary,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),

                    // Summary & Description
                    Text(
                      comp.summary,
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: const Color(0xFF334155),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      comp.description,
                      style: GoogleFonts.inter(
                        fontSize: 11.5,
                        color: AppColors.textSecondary,
                        height: 1.4,
                      ),
                    ),
                    const SizedBox(height: 10),

                    // Key Features List
                    Container(
                      padding: const EdgeInsets.all(10),
                      decoration: BoxDecoration(
                        color: const Color(0xFFF8FAFC),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: comp.keyFeatures
                            .map((feat) => Padding(
                                  padding: const EdgeInsets.only(bottom: 4),
                                  child: Row(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      const Icon(
                                        Icons.check_circle_rounded,
                                        size: 13,
                                        color: Color(0xFF10B981),
                                      ),
                                      const SizedBox(width: 6),
                                      Expanded(
                                        child: Text(
                                          feat,
                                          style: GoogleFonts.inter(
                                            fontSize: 11.5,
                                            color: const Color(0xFF475569),
                                          ),
                                        ),
                                      ),
                                    ],
                                  ),
                                ))
                            .toList(),
                      ),
                    ),

                    // Jump to Screen Button
                    if (comp.targetTabIndex != null &&
                        comp.actionLabel != null) ...[
                      const SizedBox(height: 10),
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton.icon(
                          onPressed: () => _navigateToTab(comp.targetTabIndex!),
                          style: TextButton.styleFrom(
                            foregroundColor: const Color(0xFF2563EB),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 10, vertical: 6),
                          ),
                          icon: Text(
                            comp.actionLabel!,
                            style: GoogleFonts.inter(
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          label: const Icon(
                            Icons.arrow_forward_rounded,
                            size: 14,
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}
