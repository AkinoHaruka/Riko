import 'package:intl/intl.dart';

/// 时间格式化工具集
///
/// 提供多种时间格式化方法，适配不同 UI 场景：
/// - [relativeTime]: 相对时间（刚刚、3分钟前、2天前）
/// - [chatSeparator]: 聊天消息时间分隔符
/// - [agentListTime]: 代理列表中的时间显示
/// - [fullDateTime]: 完整日期时间（yyyy-MM-dd HH:mm）
class TimeFormatters {
  TimeFormatters._();

  /// 相对时间格式化
  ///
  /// 1分钟内 → "刚刚"，1小时内 → "X分钟前"，1天内 → "X小时前"，
  /// 7天内 → "X天前"，同年 → "M月D日"，跨年 → "YYYY年M月D日"
  static String relativeTime(DateTime time) {
    final local = time.toLocal();
    final now = DateTime.now();
    final diff = now.difference(local);

    if (diff.inMinutes < 1) return '刚刚';
    if (diff.inHours < 1) return '${diff.inMinutes}分钟前';
    if (diff.inDays < 1) return '${diff.inHours}小时前';
    if (diff.inDays < 7) return '${diff.inDays}天前';
    if (local.year == now.year) {
      return '${local.month}月${local.day}日';
    }
    return '${local.year}年${local.month}月${local.day}日';
  }

  /// 聊天消息时间分隔符
  ///
  /// 当天 → "HH:mm"，昨天 → "昨天 HH:mm"，更早 → "M月D日 HH:mm"
  static String chatSeparator(DateTime time) {
    final localTime = time.toLocal();
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final messageDate = DateTime(
      localTime.year,
      localTime.month,
      localTime.day,
    );
    final diffDays = today.difference(messageDate).inDays;

    final hm = '${_twoDigits(localTime.hour)}:${_twoDigits(localTime.minute)}';

    if (diffDays == 0) return hm;
    if (diffDays == 1) return '昨天 $hm';
    return '${localTime.month}月${localTime.day}日 $hm';
  }

  /// 代理列表时间格式化
  ///
  /// 当天 → "HH:mm"，昨天 → "昨天"，7天内 → "周X"，
  /// 同年 → "M月D日"，跨年 → "YYYY年M月D日"
  static String agentListTime(DateTime time) {
    final local = time.toLocal();
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final msgDay = DateTime(local.year, local.month, local.day);
    final diff = today.difference(msgDay);

    if (diff.inDays == 0) {
      return '${_twoDigits(local.hour)}:${_twoDigits(local.minute)}';
    } else if (diff.inDays == 1) {
      return '昨天';
    } else if (diff.inDays < 7) {
      return ['周一', '周二', '周三', '周四', '周五', '周六', '周日'][local.weekday - 1];
    } else if (local.year == now.year) {
      return '${local.month}月${local.day}日';
    } else {
      return '${local.year}年${local.month}月${local.day}日';
    }
  }

  /// 完整日期时间格式化（yyyy-MM-dd HH:mm）
  static String fullDateTime(DateTime time) {
    return DateFormat('yyyy-MM-dd HH:mm').format(time.toLocal());
  }

  static String _twoDigits(int n) => n.toString().padLeft(2, '0');
}
