import 'package:flutter/material.dart';

/// RIKO 圆角令牌系统 — 类 iOS 设计语言
///
/// 基于 4pt 网格，从 xs 到 full 共 7 级圆角。
/// 所有 BorderRadius.circular() 必须引用此文件中的常量，禁止硬编码。
class AppRadius {
  AppRadius._();

  // ===== 圆角半径 =====

  /// 极小圆角（4）— 代码块、终端内小组件、badge 内部元素
  static const double xs = 4;

  /// 小圆角（8）— 图标按钮、小标签、搜索栏、tooltip
  static const double sm = 8;

  /// 中圆角（12）— 输入框、主按钮、Toast、会话列表项、抽屉
  static const double md = 12;

  /// 大圆角（16）— 卡片、设置组、对话框、页面级容器
  static const double lg = 16;

  /// 超大圆角（20）— 底部弹窗顶部圆角、头像、大卡片
  static const double xl = 20;

  /// 巨大圆角（24）— 全屏弹窗、特殊容器
  static const double xxl = 24;

  /// 全圆角（9999）— 胶囊按钮、圆形头像
  static const double full = 9999;

  // ===== 便捷 BorderRadius =====

  /// 极小圆角
  static BorderRadius get xsAll => BorderRadius.circular(xs);

  /// 小圆角
  static BorderRadius get smAll => BorderRadius.circular(sm);

  /// 中圆角
  static BorderRadius get mdAll => BorderRadius.circular(md);

  /// 大圆角
  static BorderRadius get lgAll => BorderRadius.circular(lg);

  /// 超大圆角
  static BorderRadius get xlAll => BorderRadius.circular(xl);

  /// 巨大圆角
  static BorderRadius get xxlAll => BorderRadius.circular(xxl);

  /// 全圆角（胶囊形）
  static BorderRadius get fullAll => BorderRadius.circular(full);

  /// 底部弹窗圆角（仅顶部圆角）
  static BorderRadius get bottomSheetTop =>
      const BorderRadius.vertical(top: Radius.circular(xl));

  /// 对话框圆角
  static BorderRadius get dialog => lgAll;

  /// 卡片圆角
  static BorderRadius get card => lgAll;

  /// 输入框圆角
  static BorderRadius get input => mdAll;

  /// 按钮圆角
  static BorderRadius get button => mdAll;

  /// 胶囊按钮圆角
  static BorderRadius get pill => fullAll;

  /// 头像圆角
  static BorderRadius get avatar => xlAll;
}
