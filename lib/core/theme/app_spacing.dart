import 'package:flutter/material.dart';

/// RIKO 间距令牌系统 — 基于 4pt 网格
///
/// 所有 SizedBox、Padding、Margin 必须引用此文件中的常量，禁止硬编码。
/// 例外：仅当间距值不在令牌中且无法用令牌组合表达时，允许内联值并加注释说明。
class AppSpacing {
  AppSpacing._();

  // ===== 间距值 =====

  /// 极小间距（2）— 微调对齐
  static const double xxs = 2;

  /// 超小间距（4）— 紧凑元素间距、图标与文字间距
  static const double xs = 4;

  /// 小间距（8）— 同组元素间距、小按钮内边距
  static const double sm = 8;

  /// 中小间距（12）— 列表项内间距、表单元素间距
  static const double mdSm = 12;

  /// 中间距（16）— 卡片内边距、标准元素间距
  static const double md = 16;

  /// 中大间距（20）— 区块间距
  static const double mdLg = 20;

  /// 大间距（24）— 分区间距、大卡片内边距
  static const double lg = 24;

  /// 超大间距（32）— 页面级间距
  static const double xl = 32;

  /// 巨大间距（48）— 页面顶部/底部安全间距
  static const double xxl = 48;

  // ===== 便捷 SizedBox =====

  /// 水平极小间距
  static SizedBox get hXXS => const SizedBox(width: xxs);

  /// 水平超小间距
  static SizedBox get hXS => const SizedBox(width: xs);

  /// 水平小间距
  static SizedBox get hSM => const SizedBox(width: sm);

  /// 水平中小间距
  static SizedBox get hMDSm => const SizedBox(width: mdSm);

  /// 水平中间距
  static SizedBox get hMD => const SizedBox(width: md);

  /// 水平中大间距
  static SizedBox get hMDLg => const SizedBox(width: mdLg);

  /// 水平大间距
  static SizedBox get hLG => const SizedBox(width: lg);

  /// 水平超大间距
  static SizedBox get hXL => const SizedBox(width: xl);

  /// 垂直极小间距
  static SizedBox get vXXS => const SizedBox(height: xxs);

  /// 垂直超小间距
  static SizedBox get vXS => const SizedBox(height: xs);

  /// 垂直小间距
  static SizedBox get vSM => const SizedBox(height: sm);

  /// 垂直中小间距
  static SizedBox get vMDSm => const SizedBox(height: mdSm);

  /// 垂直中间距
  static SizedBox get vMD => const SizedBox(height: md);

  /// 垂直中大间距
  static SizedBox get vMDLg => const SizedBox(height: mdLg);

  /// 垂直大间距
  static SizedBox get vLG => const SizedBox(height: lg);

  /// 垂直超大间距
  static SizedBox get vXL => const SizedBox(height: xl);

  /// 垂直巨大间距
  static SizedBox get vXXL => const SizedBox(height: xxl);

  // ===== 便捷 EdgeInsets =====

  /// 卡片内边距（16 all）
  static EdgeInsets get cardPadding => const EdgeInsets.all(md);

  /// 页面内边距（16 horizontal）
  static EdgeInsets get pageHorizontal =>
      const EdgeInsets.symmetric(horizontal: md);

  /// 列表项内边距（16 h, 12 v）
  static EdgeInsets get listItemPadding =>
      const EdgeInsets.symmetric(horizontal: md, vertical: mdSm);

  /// 按钮内边距（24 h, 12 v）
  static EdgeInsets get buttonPadding =>
      const EdgeInsets.symmetric(horizontal: lg, vertical: mdSm);

  /// 输入框内边距（16 h, 12 v）
  static EdgeInsets get inputPadding =>
      const EdgeInsets.symmetric(horizontal: md, vertical: mdSm);

  /// 底部安全间距
  static EdgeInsets get bottomSafe =>
      const EdgeInsets.only(bottom: mdLg);
}
