import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/theme/app_animations.dart';
import '../core/theme/app_colors.dart';
import '../core/di/providers.dart';
import '../data/repositories/remote_memory_repository.dart';

/// 记忆管理页面 — 浏览、搜索和删除 AI 自动记录的记忆条目
class MemoryPage extends ConsumerStatefulWidget {
  const MemoryPage({super.key});

  @override
  ConsumerState<MemoryPage> createState() => _MemoryPageState();
}

class _MemoryPageState extends ConsumerState<MemoryPage> {
  String _searchQuery = '';
  String _selectedType = 'all';
  Future<List<MemoryItem>>? _memoriesFuture;

  void _refreshMemories() {
    final memoryRepo = ref.read(memoryRepositoryProvider);
    _memoriesFuture = _selectedType == 'all'
        ? memoryRepo.getAll()
        : memoryRepo.getByType(_selectedType);
  }

  @override
  Widget build(BuildContext context) {
    final memoryRepo = ref.watch(memoryRepositoryProvider);
    _memoriesFuture ??= _selectedType == 'all'
        ? memoryRepo.getAll()
        : memoryRepo.getByType(_selectedType);

    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(
        backgroundColor: AppColors.bgTertiary,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.textSecondary),
          onPressed: () => context.go('/'),
        ),
        title: const Text(
          '记忆管理',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
      ),
      body: Column(
        children: [
          _buildSearchBar(),
          _buildTypeFilter(),
          Expanded(child: _buildMemoryList(memoryRepo)),
        ],
      ),
    );
  }

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.bgElevated,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.border),
        ),
        child: TextField(
          onChanged: (value) => setState(() => _searchQuery = value),
          style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
          decoration: const InputDecoration(
            hintText: '搜索记忆...',
            hintStyle: TextStyle(color: AppColors.textTertiary),
            prefixIcon: Icon(
              Icons.search,
              color: AppColors.textTertiary,
              size: 20,
            ),
            border: InputBorder.none,
            contentPadding: EdgeInsets.symmetric(vertical: 12),
          ),
        ),
      ),
    );
  }

  Widget _buildTypeFilter() {
    final types = [
      ('all', '全部'),
      ('fact', '事实'),
      ('preference', '偏好'),
      ('event', '事件'),
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: types.map((type) {
            final isSelected = _selectedType == type.$1;
            return Padding(
              padding: const EdgeInsets.only(right: 8),
              child: AppAnimations.scaleTap(
                onTap: () => setState(() {
                  _selectedType = type.$1;
                  _refreshMemories();
                }),
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? AppColors.green.withValues(alpha: 0.15)
                        : AppColors.bgElevated,
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(
                      color: isSelected
                          ? AppColors.green.withValues(alpha: 0.5)
                          : AppColors.border,
                    ),
                  ),
                  child: Text(
                    type.$2,
                    style: TextStyle(
                      color: isSelected
                          ? AppColors.green
                          : AppColors.textSecondary,
                      fontSize: 13,
                      fontWeight: isSelected
                          ? FontWeight.w600
                          : FontWeight.normal,
                    ),
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      ),
    );
  }

  Widget _buildMemoryList(RemoteMemoryRepository memoryRepo) {
    return FutureBuilder<List<MemoryItem>>(
      future: _memoriesFuture,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const Center(
            child: CircularProgressIndicator(color: AppColors.green),
          );
        }

        final memories = snapshot.data ?? [];
        final filtered = _searchQuery.isEmpty
            ? memories
            : memories
                  .where(
                    (m) =>
                        m.content.toLowerCase().contains(
                          _searchQuery.toLowerCase(),
                        ) ||
                        m.key.toLowerCase().contains(
                          _searchQuery.toLowerCase(),
                        ),
                  )
                  .toList();

        if (filtered.isEmpty) {
          return _buildEmptyState();
        }

        return ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: filtered.length,
          itemBuilder: (context, index) {
            final memory = filtered[index];
            return _buildMemoryCard(memory, memoryRepo);
          },
        );
      },
    );
  }

  Widget _buildMemoryCard(MemoryItem memory, RemoteMemoryRepository repo) {
    final typeColors = {
      'fact': AppColors.cyan,
      'preference': AppColors.green,
      'event': AppColors.success,
    };
    final typeColor = typeColors[memory.type] ?? AppColors.textTertiary;
    final typeLabels = {'fact': '事实', 'preference': '偏好', 'event': '事件'};

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: typeColor.withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    typeLabels[memory.type] ?? memory.type,
                    style: TextStyle(
                      color: typeColor,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
                const Spacer(),
                IconButton(
                  icon: const Icon(
                    Icons.delete_outline,
                    color: AppColors.error,
                    size: 18,
                  ),
                  onPressed: () => _confirmDelete(memory, repo),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
            child: Text(
              memory.key,
              style: const TextStyle(
                color: AppColors.textPrimary,
                fontSize: 15,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: Text(
              memory.content,
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 14,
                height: 1.5,
              ),
            ),
          ),
          if (memory.source?.isNotEmpty == true)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Text(
                '来源: ${memory.source}',
                style: const TextStyle(
                  color: AppColors.textTertiary,
                  fontSize: 11,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.psychology_outlined,
            size: 64,
            color: AppColors.textTertiary.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 16),
          Text(
            '暂无记忆',
            style: TextStyle(
              color: AppColors.textTertiary.withValues(alpha: 0.7),
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '在 AI 对话时，重要信息会自动记录到这里',
            style: TextStyle(
              color: AppColors.textTertiary.withValues(alpha: 0.5),
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _confirmDelete(
    MemoryItem memory,
    RemoteMemoryRepository repo,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('删除记忆', style: TextStyle(color: AppColors.error)),
        content: Text(
          '确定要删除"${memory.key}" 吗？此操作不可恢复',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('取消'),
          ),
          TextButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('删除', style: TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await repo.deleteMemory(memory.id);
      if (mounted) {
        _refreshMemories();
        setState(() {});
      }
    }
  }
}
