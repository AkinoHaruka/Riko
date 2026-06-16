/// 记忆管理页面 — 浏览、搜索和删除 AI 自动记录的记忆条目
///
/// 提供关键词搜索（后端 FTS5 BM25 排序）和类型筛选（事实/偏好/事件/情感），支持删除单条记忆。
/// 记忆由后端会话记忆子代理自动提取并存储。
library;

import 'dart:async';

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

  /// 搜索防抖定时器，避免频繁请求后端
  Timer? _searchDebounce;

  @override
  void dispose() {
    _searchDebounce?.cancel();
    super.dispose();
  }

  /// 根据当前搜索关键词和筛选类型刷新记忆列表
  /// 有关键词时使用后端 FTS5 搜索（忽略类型筛选），无关键词时按类型加载
  void _refreshMemories() {
    final memoryRepo = ref.read(memoryRepositoryProvider);
    if (_searchQuery.isNotEmpty) {
      _memoriesFuture = memoryRepo.search(_searchQuery);
    } else {
      _memoriesFuture = _selectedType == 'all'
          ? memoryRepo.getAll()
          : memoryRepo.getByType(_selectedType);
    }
  }

  @override
  Widget build(BuildContext context) {
    final memoryRepo = ref.watch(memoryRepositoryProvider);
    // 首次构建时初始化数据，后续由 _refreshMemories() 驱动
    _memoriesFuture ??= _searchQuery.isNotEmpty
        ? memoryRepo.search(_searchQuery)
        : _selectedType == 'all'
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

  /// 构建搜索栏 — 圆角输入框，实时过滤记忆内容
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
          onChanged: (value) {
            // 300ms 防抖，避免每次按键都请求后端
            _searchDebounce?.cancel();
            _searchDebounce = Timer(const Duration(milliseconds: 300), () {
              setState(() {
                _searchQuery = value;
                _refreshMemories();
              });
            });
          },
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

  /// 构建类型筛选标签栏 — 全部/事实/偏好/事件/情感，选中态带绿色高亮
  Widget _buildTypeFilter() {
    final types = [
      ('all', '全部'),
      ('fact', '事实'),
      ('preference', '偏好'),
      ('event', '事件'),
      ('emotions', '情感'),
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

  /// 构建记忆列表 — FutureBuilder 加载数据
  /// 搜索时由后端 FTS5 过滤，无搜索时按类型前端筛选
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
        // 搜索时后端已过滤，无需前端再筛选；无搜索时按类型前端筛选
        final filtered = _searchQuery.isEmpty && _selectedType != 'all'
            ? memories.where((m) => m.type == _selectedType).toList()
            : memories;

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

  /// 构建单条记忆卡片 — 显示类型标签、键名、内容和来源
  Widget _buildMemoryCard(MemoryItem memory, RemoteMemoryRepository repo) {
    final typeColors = {
      'fact': AppColors.cyan,
      'preference': AppColors.green,
      'event': AppColors.success,
      'emotions': AppColors.warning,
    };
    final typeColor = typeColors[memory.type] ?? AppColors.textTertiary;
    final typeLabels = {
      'fact': '事实',
      'preference': '偏好',
      'event': '事件',
      'emotions': '情感',
    };

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

  /// 删除确认对话框 — 防止误操作
  Future<void> _confirmDelete(
    MemoryItem memory,
    RemoteMemoryRepository repo,
  ) async {
    final confirmed = await AppAnimations.showSpringDialog<bool>(
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
