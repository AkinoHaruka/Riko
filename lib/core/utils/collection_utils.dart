/// 集合工具函数
///
/// 提供列表深度相等比较等通用集合操作，供多个模块共享使用。
library;

/// 列表深度相等比较
///
/// 逐元素比较两个列表是否完全相等，支持 null 列表。
/// 当两个列表为同一引用时直接返回 true（identical 快速路径）。
bool listEquals<T>(List<T>? a, List<T>? b) {
  if (identical(a, b)) return true;
  if (a == null || b == null) return a == b;
  if (a.length != b.length) return false;
  for (int i = 0; i < a.length; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}
