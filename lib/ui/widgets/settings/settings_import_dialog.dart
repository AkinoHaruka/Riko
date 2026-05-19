import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';

/// 导入预览对话框 — 显示导入文件中各类型数据的数量和操作概览
class ImportPreviewDialog extends StatelessWidget {
  final Map<String, dynamic> preview;

  const ImportPreviewDialog({super.key, required this.preview});

  @override
  Widget build(BuildContext context) {
    final summary = preview['summary'] as Map<String, dynamic>? ?? {};
    final entries = summary.entries
        .where((e) => (e.value as Map<String, dynamic>)['importCount'] != 0)
        .toList();

    return AlertDialog(
      backgroundColor: AppColors.surface,
      title: const Text(
        '导入数据预览',
        style: TextStyle(color: AppColors.textPrimary, fontSize: 18),
      ),
      content: SizedBox(
        width: double.maxFinite,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '记忆文件: ${preview['memoryFileCount'] ?? 0} 个',
              style: const TextStyle(
                color: AppColors.textTertiary,
                fontSize: 13,
              ),
            ),
            const SizedBox(height: 12),
            ...entries.map((e) {
              final v = e.value as Map<String, dynamic>;
              final willInsert = v['willInsert'] as int? ?? 0;
              final willUpdate = v['willUpdate'] as int? ?? 0;
              final parts = <String>[];
              if (willInsert > 0) parts.add('新增 $willInsert');
              if (willUpdate > 0) parts.add('覆盖 $willUpdate');
              if (parts.isEmpty) return const SizedBox.shrink();

              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Row(
                  children: [
                    SizedBox(
                      width: 100,
                      child: Text(
                        v['label'] as String? ?? e.key,
                        style: const TextStyle(
                          color: AppColors.textSecondary,
                          fontSize: 13,
                        ),
                      ),
                    ),
                    Text(
                      parts.join('，'),
                      style: TextStyle(
                        color: willUpdate > 0
                            ? AppColors.greenLight
                            : AppColors.green,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              );
            }),
            const SizedBox(height: 12),
            const Text(
              '导入后请刷新页面以加载最新数据',
              style: TextStyle(color: AppColors.textTertiary, fontSize: 12),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text(
            '取消',
            style: TextStyle(color: AppColors.textTertiary),
          ),
        ),
        ElevatedButton(
          onPressed: () => Navigator.of(context).pop(true),
          style: ElevatedButton.styleFrom(backgroundColor: AppColors.green),
          child: const Text('确认导入', style: TextStyle(color: Colors.black)),
        ),
      ],
    );
  }
}

/// 参数定义 — 标签、默认值和范围约束
class ParamDef {
  final String label;
  final int defaultValue;
  final int min;
  final int max;

  const ParamDef({
    required this.label,
    required this.defaultValue,
    required this.min,
    required this.max,
  });
}
