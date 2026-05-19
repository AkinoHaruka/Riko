import 'package:flutter/material.dart';

/// RIKO 暗色主题色板
///
/// 统一管理所有颜色常量，以绿色（#3eb573）和青色（#00D4FF）为主色调。
class AppColors {
  AppColors._();

  static const Color bgPrimary = Color(0xFF111111);
  static const Color bgSecondary = Color(0xFF1A1A1A);
  static const Color bgTertiary = Color(0xFF121212);
  static const Color bgElevated = Color(0xFF1E1E1E);

  static const Color surface = Color(0xFF252525);
  static const Color surfaceHover = Color(0xFF292929);
  static const Color surfaceGlass = Color(0x14FFFFFF);

  static const Color green = Color(0xFF3eb573);
  static const Color greenLight = Color(0xFF6fdfa0);
  static const Color greenDark = Color(0xFF2a9a5a);
  static const Color greenGlow = Color(0x403eb573);

  static const Color cyan = Color(0xFF00D4FF);
  static const Color cyanLight = Color(0xFF80E8FF);
  static const Color cyanDark = Color(0xFF00A8CC);
  static const Color cyanGlow = Color(0x4000D4FF);

  static const Color textPrimary = Color(0xFFd5d5d5);
  static const Color textSecondary = Color(0xFF999999);
  static const Color textTertiary = Color(0xFF666666);
  static const Color textDisabled = Color(0xFF555555);

  static const Color error = Color(0xFFFF4757);
  static const Color errorBg = Color(0x20FF4757);
  static const Color success = Color(0xFF2ED573);

  static const Color border = Color(0xFF2C2C2C);
  static const Color borderLight = Color(0xFF3C3C3C);
  static const Color divider = Color(0xFF1A1A1A);
}
