import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_typography.dart';
import '../../auth/providers/auth_provider.dart';
import '../providers/task_providers.dart';
import 'task_detail_screen.dart';
import 'widgets/status_filter_bar.dart';
import 'widgets/task_card.dart';
import '../../../shared/layout/main_scaffold.dart';
import '../../tour/presentation/mobile_product_tour.dart';
import '../../notifications/presentation/notification_bell.dart';

class TaskListScreen extends ConsumerStatefulWidget {
  const TaskListScreen({super.key});

  @override
  ConsumerState<TaskListScreen> createState() => _TaskListScreenState();
}

class _TaskListScreenState extends ConsumerState<TaskListScreen> {
  final _searchController = TextEditingController();
  Timer? _debounceTimer;
  bool _isSearching = false;

  @override
  void dispose() {
    _searchController.dispose();
    _debounceTimer?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String val) {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 250), () {
      ref.read(taskSearchQueryProvider.notifier).setQuery(val);
    });
  }

  void _clearSearch() {
    _searchController.clear();
    _debounceTimer?.cancel();
    ref.read(taskSearchQueryProvider.notifier).clear();
  }

  @override
  Widget build(BuildContext context) {
    final user = ref.watch(authStateProvider).value;
    final selectedFilter = ref.watch(selectedStatusFilterProvider);
    final tasksAsync = ref.watch(assignedTasksProvider);
    final currentQuery = ref.watch(taskSearchQueryProvider);

    return Scaffold(
      backgroundColor: AppColors.scaffoldBackground,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () => ref.refresh(assignedTasksProvider.future).then((_) {}, onError: (_) {}),
          child: CustomScrollView(
            slivers: [
              // Top Header: Profile on Left, Search Functionality on Right
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
                sliver: SliverToBoxAdapter(
                  child: AnimatedCrossFade(
                    duration: const Duration(milliseconds: 200),
                    crossFadeState: (_isSearching || currentQuery.isNotEmpty)
                        ? CrossFadeState.showSecond
                        : CrossFadeState.showFirst,
                    // State 1: Profile Info + Search Action Icon at Right
                    firstChild: Row(
                      children: [
                        Expanded(
                          child: InkWell(
                            key: TourTargetRegistry.profileHeaderKey,
                            onTap: () {
                              ref.read(navigationIndexProvider.notifier).setIndex(3);
                            },
                            borderRadius: BorderRadius.circular(16),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(vertical: 4),
                              child: Row(
                                children: [
                                  CircleAvatar(
                                    radius: 22,
                                    backgroundColor: AppColors.primaryLavender,
                                    child: Text(
                                      user?.displayName?.isNotEmpty == true
                                          ? user!.displayName![0].toUpperCase()
                                          : 'E',
                                      style: const TextStyle(
                                        color: AppColors.darkSlate,
                                        fontWeight: FontWeight.bold,
                                        fontSize: 18,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 12),
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          user?.displayName ?? 'Field Engineer',
                                          style: AppTypography.titleLarge
                                              .copyWith(fontWeight: FontWeight.bold),
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                        const SizedBox(height: 2),
                                        Text(
                                          user?.roleLabel != null
                                              ? '${user!.roleLabel} • Field Ops'
                                              : 'Field Operations',
                                          style: AppTypography.caption,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        const NotificationBell(),
                        const SizedBox(width: 8),
                        // Search Button on Right Side of Profile (Borderless)
                        IconButton.filledTonal(
                          key: TourTargetRegistry.searchButtonKey,
                          style: IconButton.styleFrom(
                            backgroundColor: AppColors.searchFieldBackground,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                            padding: const EdgeInsets.all(12),
                          ),
                          icon: const Icon(
                            Icons.search_rounded,
                            size: 22,
                            color: AppColors.darkSlate,
                          ),
                          tooltip: 'Search tasks',
                          onPressed: () {
                            setState(() => _isSearching = true);
                          },
                        ),
                      ],
                    ),
                    // State 2: Inline Active Search Bar in Header (Borderless)
                    secondChild: Container(
                      decoration: BoxDecoration(
                        color: AppColors.searchFieldBackground,
                        borderRadius: BorderRadius.circular(16),
                      ),
                      child: Row(
                        children: [
                          const Padding(
                            padding: EdgeInsets.only(left: 14, right: 6),
                            child: Icon(
                              Icons.search_rounded,
                              size: 20,
                              color: AppColors.textSecondary,
                            ),
                          ),
                          Expanded(
                            child: TextField(
                              controller: _searchController,
                              onChanged: _onSearchChanged,
                              autofocus: _isSearching,
                              decoration: InputDecoration(
                                filled: false,
                                fillColor: Colors.transparent,
                                border: InputBorder.none,
                                enabledBorder: InputBorder.none,
                                focusedBorder: InputBorder.none,
                                errorBorder: InputBorder.none,
                                disabledBorder: InputBorder.none,
                                focusedErrorBorder: InputBorder.none,
                                hintText: 'Search tasks, site code, civil...',
                                hintStyle: AppTypography.bodySmall
                                    .copyWith(color: AppColors.textSecondary),
                                isDense: true,
                                contentPadding: const EdgeInsets.symmetric(
                                  vertical: 12,
                                ),
                              ),
                            ),
                          ),
                          // Single dedicated action button (clear if text present, otherwise close)
                          IconButton(
                            icon: Icon(
                              currentQuery.isNotEmpty
                                  ? Icons.clear_rounded
                                  : Icons.close_rounded,
                              size: 20,
                              color: AppColors.darkSlate,
                            ),
                            tooltip: currentQuery.isNotEmpty
                                ? 'Clear search text'
                                : 'Close search',
                            onPressed: () {
                              if (currentQuery.isNotEmpty) {
                                _clearSearch();
                              } else {
                                setState(() => _isSearching = false);
                              }
                            },
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),

              // Section Header: "Your task" + "See All"
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(20, 14, 20, 10),
                sliver: SliverToBoxAdapter(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Your task',
                        style: AppTypography.headingMedium,
                      ),
                      TextButton(
                        onPressed: () {
                          _clearSearch();
                          ref.read(selectedStatusFilterProvider.notifier).setFilter('ALL');
                        },
                        child: Text(
                          'See All',
                          style: AppTypography.titleMedium.copyWith(
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

              // Horizontal Filter Bar
              SliverToBoxAdapter(
                child: StatusFilterBar(
                  key: TourTargetRegistry.statusFilterKey,
                  selectedStatus: selectedFilter,
                  onSelected: (val) {
                    ref.read(selectedStatusFilterProvider.notifier).setFilter(val);
                  },
                ),
              ),

              const SliverToBoxAdapter(child: SizedBox(height: 14)),

              // Task List Content
              tasksAsync.when(
                data: (tasks) {
                  if (tasks.isEmpty) {
                    return SliverFillRemaining(
                      hasScrollBody: false,
                      child: Center(
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.assignment_outlined, size: 44, color: AppColors.textTertiary),
                            const SizedBox(height: 12),
                            Text(
                              currentQuery.isNotEmpty
                                  ? 'No tasks matching "$currentQuery"'
                                  : 'No tasks found for this filter.',
                              style: AppTypography.bodyMedium,
                            ),
                            if (currentQuery.isNotEmpty || selectedFilter != 'ALL') ...[
                              const SizedBox(height: 8),
                              TextButton(
                                onPressed: () {
                                  _clearSearch();
                                  ref.read(selectedStatusFilterProvider.notifier).setFilter('ALL');
                                },
                                child: const Text('Reset Filters'),
                              ),
                            ],
                          ],
                        ),
                      ),
                    );
                  }

                  return SliverPadding(
                    padding: const EdgeInsets.fromLTRB(20, 0, 20, 100),
                    sliver: SliverList(
                      delegate: SliverChildBuilderDelegate(
                        (context, index) {
                          final task = tasks[index];
                          return Padding(
                            padding: const EdgeInsets.only(bottom: 14),
                            child: TaskCard(
                              key: index == 0 ? TourTargetRegistry.firstTaskCardKey : null,
                              task: task,
                              onTap: () {
                                Navigator.push(
                                  context,
                                  MaterialPageRoute<void>(
                                    builder: (_) => TaskDetailScreen(task: task),
                                  ),
                                );
                              },
                            ),
                          );
                        },
                        childCount: tasks.length,
                      ),
                    ),
                  );
                },
                loading: () => const SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(
                    child: CircularProgressIndicator(),
                  ),
                ),
                error: (error, _) => SliverFillRemaining(
                  hasScrollBody: false,
                  child: Center(
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.cloud_off_outlined, size: 40, color: AppColors.textSecondary),
                        const SizedBox(height: 12),
                        Text('Unable to load tasks', style: AppTypography.titleMedium),
                        const SizedBox(height: 4),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 32),
                          child: Text(
                            error.toString(),
                            style: AppTypography.bodySmall,
                            textAlign: TextAlign.center,
                          ),
                        ),
                        const SizedBox(height: 8),
                        TextButton.icon(
                          icon: const Icon(Icons.refresh_rounded, size: 16),
                          label: const Text('Retry'),
                          onPressed: () => ref.invalidate(assignedTasksProvider),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
