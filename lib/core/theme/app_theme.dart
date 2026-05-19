import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'app_colors.dart';

/// RIKO 暗色主题配置
///
/// 使用 MiSans 字体，构建完整的 Material 暗色主题（无亮色模式）。
/// 主题缓存到 _cachedDarkTheme 中，每次 buildDarkTheme() 返回同一实例。
class AppTheme {
  AppTheme._();

  static final ThemeData _cachedDarkTheme = _buildDarkTheme();

  static ThemeData buildDarkTheme() => _cachedDarkTheme;

  // _buildDarkTheme 仅调用一次，结果缓存到静态字段
  static ThemeData _buildDarkTheme() {
    final base = ThemeData.dark();
    // MiSans 为主字体，保留系统字体栈作为后备
    const fontFamily = 'MiSans';
    const fontFamilyFallback = [
      'MiSans',
      'Apple Color Emoji',
      'Segoe UI Emoji',
      'Segoe UI Symbol',
      'Noto Color Emoji',
      'PingFang SC',
      'Microsoft YaHei',
      'Noto Sans SC',
      'sans-serif',
    ];

    return base.copyWith(
      scaffoldBackgroundColor: AppColors.bgPrimary,
      colorScheme: const ColorScheme.dark(
        primary: AppColors.green,
        secondary: AppColors.cyan,
        surface: AppColors.surface,
        error: AppColors.error,
        onPrimary: AppColors.bgPrimary,
        onSecondary: AppColors.bgPrimary,
        onSurface: AppColors.textPrimary,
        onError: Colors.white,
      ),
      appBarTheme: const AppBarTheme(
        backgroundColor: AppColors.bgTertiary,
        foregroundColor: AppColors.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        centerTitle: true,
        systemOverlayStyle: SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: Brightness.light,
        ),
      ),
      cardTheme: CardThemeData(
        color: AppColors.surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: const BorderSide(color: AppColors.border),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.bgElevated,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 14,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.green, width: 1.5),
        ),
        hintStyle: const TextStyle(color: AppColors.textTertiary),
        labelStyle: const TextStyle(color: AppColors.textSecondary),
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.divider,
        thickness: 1,
        space: 1,
      ),
      iconTheme: const IconThemeData(color: AppColors.textSecondary),
      textTheme: const TextTheme(
        displayLarge: TextStyle(
          color: AppColors.textPrimary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        displayMedium: TextStyle(
          color: AppColors.textPrimary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        displaySmall: TextStyle(
          color: AppColors.textPrimary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        headlineLarge: TextStyle(
          color: AppColors.textPrimary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        headlineMedium: TextStyle(
          color: AppColors.textPrimary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        headlineSmall: TextStyle(
          color: AppColors.textPrimary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        titleLarge: TextStyle(
          color: AppColors.textPrimary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        titleMedium: TextStyle(
          color: AppColors.textPrimary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        titleSmall: TextStyle(
          color: AppColors.textSecondary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        bodyLarge: TextStyle(
          color: AppColors.textPrimary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        bodyMedium: TextStyle(
          color: AppColors.textSecondary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        bodySmall: TextStyle(
          color: AppColors.textTertiary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        labelLarge: TextStyle(
          color: AppColors.green,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        labelMedium: TextStyle(
          color: AppColors.cyan,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
        labelSmall: TextStyle(
          color: AppColors.textTertiary,
          fontFamily: fontFamily,
          fontFamilyFallback: fontFamilyFallback,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.green,
          foregroundColor: AppColors.bgPrimary,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
          ),
          textStyle: const TextStyle(
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.green,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
        ),
      ),
      listTileTheme: const ListTileThemeData(
        iconColor: AppColors.textSecondary,
        textColor: AppColors.textPrimary,
        selectedTileColor: AppColors.surfaceHover,
      ),
      drawerTheme: const DrawerThemeData(
        backgroundColor: AppColors.bgSecondary,
        elevation: 0,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.surface,
        contentTextStyle: const TextStyle(color: AppColors.textPrimary),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        behavior: SnackBarBehavior.floating,
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: AppColors.bgElevated,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppColors.borderLight),
        ),
        textStyle: const TextStyle(color: AppColors.textPrimary, fontSize: 12),
      ),
    );
  }
}
