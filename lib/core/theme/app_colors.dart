import 'package:flutter/material.dart';

/// RIKO 暗色主题色板
///
/// 统一管理所有颜色常量，以绿色（#3eb573）和青色（#00D4FF）为主色调。
/// 分为以下色组：背景色、表面色、主色调、文本色、状态色、边框色。
class AppColors {
  AppColors._();

  // ===== 背景色 =====

  /// 主背景色（#111111），用于 Scaffold
  static const Color bgPrimary = Color(0xFF111111);

  /// 次级背景色（#1A1A1A），用于侧边栏、抽屉
  static const Color bgSecondary = Color(0xFF1A1A1A);

  /// 三级背景色（#121212），用于 AppBar
  static const Color bgTertiary = Color(0xFF121212);

  /// 提升背景色（#1E1E1E），用于输入框、底部弹窗
  static const Color bgElevated = Color(0xFF1E1E1E);

  // ===== 表面色 =====

  /// 卡片/容器表面色（#252525）
  static const Color surface = Color(0xFF252525);

  /// 悬停态表面色（#292929）
  static const Color surfaceHover = Color(0xFF292929);

  /// 毛玻璃表面色（8% 白色透明）
  static const Color surfaceGlass = Color(0x14FFFFFF);

  // ===== 主色调 =====

  /// 绿色主色（#3eb573），用于主按钮、选中态、品牌色
  static const Color green = Color(0xFF3eb573);

  /// 浅绿色，用于悬停态
  static const Color greenLight = Color(0xFF6fdfa0);

  /// 深绿色，用于按下态
  static const Color greenDark = Color(0xFF2a9a5a);

  /// 绿色辉光（25% 透明），用于发光效果
  static const Color greenGlow = Color(0x403eb573);

  /// 青色辅色（#00D4FF），用于次要操作、标签
  static const Color cyan = Color(0xFF00D4FF);

  /// 浅青色
  static const Color cyanLight = Color(0xFF80E8FF);

  /// 深青色
  static const Color cyanDark = Color(0xFF00A8CC);

  /// 青色辉光（25% 透明）
  static const Color cyanGlow = Color(0x4000D4FF);

  // ===== 文本色 =====

  /// 主文本色（#d5d5d5），用于正文
  static const Color textPrimary = Color(0xFFd5d5d5);

  /// 次级文本色（#999999），用于副标题、描述
  static const Color textSecondary = Color(0xFF999999);

  /// 三级文本色（#777777），用于提示文本
  static const Color textTertiary = Color(0xFF777777);

  /// 禁用态文本色（#666666）
  static const Color textDisabled = Color(0xFF666666);

  // ===== 状态色 =====

  /// 错误色（#FF4757）
  static const Color error = Color(0xFFFF4757);

  /// 错误背景色（12% 红色透明）
  static const Color errorBg = Color(0x20FF4757);

  /// 警告色（#FFA500），用于警告图标和提示
  static const Color warning = Color(0xFFFFA500);

  /// 警告背景色（12% 橙色透明）
  static const Color warningBg = Color(0x20FFA500);

  /// 成功色（#2ED573）
  static const Color success = Color(0xFF2ED573);

  /// 成功背景色（12% 绿色透明）
  static const Color successBg = Color(0x202ED573);

  /// 信息色（#00D4FF），与 cyan 一致
  static const Color info = cyan;

  /// 信息背景色（12% 青色透明）
  static const Color infoBg = Color(0x2000D4FF);

  // ===== 覆盖色 =====

  /// 遮罩层（60% 黑色透明），用于弹窗背景
  static const Color overlay = Color(0x99111111);

  /// 轻遮罩层（40% 黑色透明），用于下拉菜单背景
  static const Color overlayLight = Color(0x66111111);

  /// 高亮覆盖（8% 白色透明），用于按下/选中态
  static const Color highlight = Color(0x14FFFFFF);

  /// 焦点环色（主色 50% 透明）
  static const Color focusRing = Color(0x803eb573);

  // ===== 边框色 =====

  /// 默认边框色（#2C2C2C）
  static const Color border = Color(0xFF2C2C2C);

  /// 浅边框色（#3C3C3C），用于聚焦态
  static const Color borderLight = Color(0xFF3C3C3C);

  /// 分隔线色（#1A1A1A）
  static const Color divider = Color(0xFF1A1A1A);
}
