import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/di/providers.dart';
import '../../core/theme/app_colors.dart';

/// 记忆文件浏览器 — 浏览后端记忆文件目录，支持目录导航与 Markdown/纯文本预览
class MemoryFileBrowser extends ConsumerStatefulWidget {
  const MemoryFileBrowser({super.key});

  @override
  ConsumerState<MemoryFileBrowser> createState() => _MemoryFileBrowserState();
}

class _MemoryFileBrowserState extends ConsumerState<MemoryFileBrowser> {
  String _currentDir = '';
  List<_FileEntry> _files = [];
  bool _loading = true;
  String? _error;
  _FileContent? _previewFile;

  String _friendlyError(Object e) {
    if (e is DioException && e.response?.data is Map) {
      final data = e.response!.data as Map;
      if (data['error'] is String) return data['error'] as String;
    }
    if (e is DioException && e.response?.statusCode == 404) {
      return '目录不存在或已被删除';
    }
    return '加载失败，请重试';
  }

  @override
  void initState() {
    super.initState();
    _fetchDir('');
  }

  Future<void> _fetchDir(String dir) async {
    setState(() {
      _loading = true;
      _error = null;
      _previewFile = null;
    });

    try {
      final api = ref.read(apiClientProvider);
      final resp = await api.get('/memory-files', queryParameters: {
        if (dir.isNotEmpty) 'dir': dir,
      });
      final data = resp is Map ? resp : jsonDecode(jsonEncode(resp)) as Map;
      setState(() {
        _currentDir = (data['dir'] as String?) ?? '';
        _files = (data['files'] as List)
            .map((f) => _FileEntry.fromJson(f as Map<String, dynamic>))
            .toList();
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = _friendlyError(e);
        _loading = false;
      });
    }
  }

  Future<void> _readFile(String filePath) async {
    setState(() => _loading = true);

    try {
      final api = ref.read(apiClientProvider);
      final resp = await api.get('/memory-files/read', queryParameters: {
        'file': filePath,
      });
      final data = resp is Map ? resp : jsonDecode(jsonEncode(resp)) as Map;
      setState(() {
        _previewFile = _FileContent.fromJson(data as Map<String, dynamic>);
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = _friendlyError(e);
        _loading = false;
      });
    }
  }

  String _parentDir() {
    if (_currentDir.isEmpty) return '';
    final idx = _currentDir.lastIndexOf('/');
    return idx == -1 ? '' : _currentDir.substring(0, idx);
  }

  @override
  Widget build(BuildContext context) {
    if (_previewFile != null) {
      return _buildPreview();
    }

    return Column(
      children: [
        _buildBreadcrumb(),
        Expanded(child: _buildFileList()),
      ],
    );
  }

  Widget _buildBreadcrumb() {
    final parts = _currentDir.isEmpty ? <String>[] : _currentDir.split('/');

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppColors.divider)),
      ),
      child: Row(
        children: [
          GestureDetector(
            onTap: _currentDir.isEmpty ? null : () => _fetchDir(_parentDir()),
            child: Icon(
              Icons.arrow_back_ios,
              size: 16,
              color: _currentDir.isEmpty
                  ? AppColors.textDisabled
                  : AppColors.textPrimary,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  GestureDetector(
                    onTap: () => _fetchDir(''),
                    child: Text(
                      'memories',
                      style: TextStyle(
                        color: _currentDir.isEmpty
                            ? AppColors.textPrimary
                            : AppColors.success,
                        fontSize: 14,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                  for (var i = 0; i < parts.length; i++)
                    GestureDetector(
                      onTap:
                          i == parts.length - 1
                              ? null
                              : () => _fetchDir(
                                parts.sublist(0, i + 1).join('/'),
                              ),
                      child: Row(
                        children: [
                          const Text(
                            ' / ',
                            style: TextStyle(
                              color: AppColors.textTertiary,
                              fontSize: 14,
                            ),
                          ),
                          Text(
                            parts[i],
                            style: TextStyle(
                              color:
                                  i == parts.length - 1
                                      ? AppColors.textPrimary
                                      : AppColors.success,
                              fontSize: 14,
                              fontWeight:
                                  i == parts.length - 1
                                      ? FontWeight.w600
                                      : FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFileList() {
    if (_loading) {
      return const Center(
        child: CircularProgressIndicator(color: Color(0xFF3EB573)),
      );
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text(
            _error!,
            style: const TextStyle(color: AppColors.error, fontSize: 14),
          ),
        ),
      );
    }

    if (_files.isEmpty) {
      return const Center(
        child: Text(
          '空目录',
          style: TextStyle(color: AppColors.textTertiary, fontSize: 14),
        ),
      );
    }

    return ListView.separated(
      padding: EdgeInsets.zero,
      itemCount: _files.length,
      separatorBuilder: (_, _) => const Padding(
        padding: EdgeInsets.only(left: 68),
        child: Divider(height: 1, color: AppColors.divider),
      ),
      itemBuilder: (context, index) {
        final file = _files[index];
        return _FileItem(
          entry: file,
          onTap: () {
            if (file.type == 'directory') {
              _fetchDir(file.path);
            } else {
              _readFile(file.path);
            }
          },
        );
      },
    );
  }

  Widget _buildPreview() {
    final file = _previewFile!;
    final isMarkdown = file.name.endsWith('.md');

    return Column(
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: AppColors.divider)),
          ),
          child: Row(
            children: [
              GestureDetector(
                onTap: () => setState(() => _previewFile = null),
                child: const Icon(
                  Icons.arrow_back_ios,
                  size: 16,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  file.name,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
              Text(
                _formatSize(file.size),
                style: const TextStyle(
                  color: AppColors.textTertiary,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: isMarkdown && file.content.trim().isNotEmpty
              ? Markdown(
                data: file.content,
                styleSheet: MarkdownStyleSheet(
                  p: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 14,
                    height: 1.6,
                  ),
                  h1: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 22,
                    fontWeight: FontWeight.w600,
                  ),
                  h2: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                  ),
                  h3: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                  ),
                  code: const TextStyle(
                    color: Color(0xFF3EB573),
                    fontSize: 13,
                    fontFamily: 'monospace',
                  ),
                  codeblockDecoration: BoxDecoration(
                    color: AppColors.bgSecondary,
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              )
              : SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: SelectableText(
                  file.content,
                  style: const TextStyle(
                    color: AppColors.textPrimary,
                    fontSize: 14,
                    height: 1.6,
                  ),
                ),
              ),
        ),
      ],
    );
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}

/// 文件/目录条目 — 名称、路径、类型和大小
class _FileEntry {
  final String name;
  final String path;
  final String type;
  final int? size;

  const _FileEntry({
    required this.name,
    required this.path,
    required this.type,
    this.size,
  });

  factory _FileEntry.fromJson(Map<String, dynamic> json) {
    return _FileEntry(
      name: json['name'] as String? ?? '',
      path: json['path'] as String? ?? '',
      type: json['type'] as String? ?? 'file',
      size: json['size'] as int?,
    );
  }
}

/// 文件内容 — 文件名、内容和大小
class _FileContent {
  final String name;
  final String content;
  final int size;

  const _FileContent({
    required this.name,
    required this.content,
    required this.size,
  });

  factory _FileContent.fromJson(Map<String, dynamic> json) {
    return _FileContent(
      name: json['name'] as String? ?? '',
      content: json['content'] as String? ?? '',
      size: json['size'] as int? ?? 0,
    );
  }
}

/// 文件列表项 — 文件夹/文件图标、名称、大小和导航箭头
class _FileItem extends StatelessWidget {
  final _FileEntry entry;
  final VoidCallback onTap;

  const _FileItem({required this.entry, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final isDir = entry.type == 'directory';
    final isMarkdown = entry.name.endsWith('.md');

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: 56,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: [
            Icon(
              isDir ? Icons.folder : Icons.description,
              color: isDir
                  ? const Color(0xFF3EB573)
                  : isMarkdown
                      ? AppColors.cyan
                      : AppColors.textSecondary,
              size: 28,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    entry.name,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  if (entry.size != null && !isDir)
                    Text(
                      _formatSize(entry.size!),
                      style: const TextStyle(
                        color: AppColors.textTertiary,
                        fontSize: 12,
                      ),
                    ),
                ],
              ),
            ),
            if (isDir)
              const Icon(Icons.chevron_right, color: AppColors.textTertiary, size: 20),
          ],
        ),
      ),
    );
  }

  String _formatSize(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) return '${(bytes / 1024).toStringAsFixed(1)} KB';
    return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
  }
}
