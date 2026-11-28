import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/widgets/brand_mark.dart';
import '../domain/models/project_item.dart';
import '../providers/project_providers.dart';
import 'project_sites_screen.dart';
import '../../notifications/presentation/notification_bell.dart';

class ProjectListScreen extends ConsumerWidget {
  const ProjectListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final projectsAsync = ref.watch(projectListProvider);

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      appBar: AppBar(
        leading: const Padding(
          padding: EdgeInsets.only(left: 16),
          child: BrandMark(),
        ),
        leadingWidth: 52,
        title: const Text('Assigned Projects', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded, size: 20),
            onPressed: () => ref.invalidate(projectListProvider),
          ),
          const Padding(padding: EdgeInsets.only(right: 12), child: NotificationBell()),
        ],
      ),
      body: SafeArea(
        child: projectsAsync.when(
          data: (projects) {
            if (projects.isEmpty) {
              return Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.folder_off_outlined, size: 48, color: AppColors.textSecondary),
                    const SizedBox(height: 12),
                    Text('No projects assigned yet', style: AppTypography.titleMedium),
                    const SizedBox(height: 4),
                    Text('Contact your project manager for task assignments.', style: AppTypography.bodySmall),
                  ],
                ),
              );
            }

            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(20, 14, 20, 100),
              itemCount: projects.length,
              separatorBuilder: (context, index) => const SizedBox(height: 16),
              itemBuilder: (context, index) {
                final project = projects[index];
                return _ProjectCard(project: project);
              },
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.error_outline, size: 40, color: AppColors.statusBlockedText),
                const SizedBox(height: 12),
                Text('Failed to load projects', style: AppTypography.titleMedium),
                const SizedBox(height: 8),
                TextButton.icon(
                  icon: const Icon(Icons.refresh, size: 16),
                  label: const Text('Try Again'),
                  onPressed: () => ref.invalidate(projectListProvider),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ProjectCard extends StatelessWidget {
  const _ProjectCard({required this.project});

  final ProjectItem project;

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(20),
        side: const BorderSide(color: AppColors.subtleDivider),
      ),
      child: InkWell(
        onTap: () {
          Navigator.push(
            context,
            MaterialPageRoute<void>(
              builder: (_) => ProjectSitesScreen(project: project),
            ),
          );
        },
        borderRadius: BorderRadius.circular(20),
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Top Row: Code Badge + Status + Forward Chevron
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.primaryLavenderLight,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      project.code,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: AppColors.darkSlate,
                      ),
                    ),
                  ),
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: AppColors.statusOngoingBg,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          project.status,
                          style: const TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.bold,
                            color: AppColors.statusOngoingText,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Icon(
                        Icons.arrow_forward_ios_rounded,
                        size: 14,
                        color: AppColors.textTertiary,
                      ),
                    ],
                  ),
                ],
              ),
              const SizedBox(height: 12),

              // Project Title
              Text(
                project.name,
                style: AppTypography.headingMedium,
              ),
              if (project.phase != null) ...[
                const SizedBox(height: 4),
                Text(
                  project.phase!,
                  style: AppTypography.bodySmall.copyWith(color: AppColors.textSecondary),
                ),
              ],
              const SizedBox(height: 16),

              // Stats Row: Sites & Tasks
              Row(
                children: [
                  _IconBadge(
                    icon: Icons.location_on_outlined,
                    label: '${project.siteCount} Sites',
                  ),
                  const SizedBox(width: 12),
                  _IconBadge(
                    icon: Icons.assignment_outlined,
                    label: '${project.taskCount} Tasks',
                  ),
                  const Spacer(),
                  Text(
                    'View Sites',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.darkSlate,
                    ),
                  ),
                  const SizedBox(width: 4),
                  const Icon(
                    Icons.chevron_right_rounded,
                    size: 18,
                    color: AppColors.darkSlate,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _IconBadge extends StatelessWidget {
  const _IconBadge({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.searchFieldBackground,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppColors.textSecondary),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.darkSlate,
            ),
          ),
        ],
      ),
    );
  }
}
