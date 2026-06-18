import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'app_colors.dart';
import 'app_radius.dart';
import 'app_spacing.dart';
import 'app_typography.dart';

/// RIKO 暗色主题配置 — 类 iOS 设计语言
///
/// 使用 MiSans 字体，构建完整的 Material 暗色主题（无亮色模式）。
/// 所有圆角、间距、字号均引用 AppRadius / AppSpacing / AppTypography 令牌。
/// 主题缓存到 _cachedDarkTheme 中，每次 buildDarkTheme() 返回同一实例。
class AppTheme {
  AppTheme._();

  static final ThemeData _cachedDarkTheme = _buildDarkTheme();

  static ThemeData buildDarkTheme() => _cachedDarkTheme;

  static ThemeData _buildDarkTheme() {
    final base = ThemeData.dark();

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
          borderRadius: AppRadius.card,
          side: const BorderSide(color: AppColors.border),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.bgElevated,
        contentPadding: AppSpacing.inputPadding,
        border: OutlineInputBorder(
          borderRadius: AppRadius.input,
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadius.input,
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppRadius.input,
          borderSide: const BorderSide(color: AppColors.green, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppRadius.input,
          borderSide: const BorderSide(color: AppColors.error),
        ),
        focusedErrorBorder: OutlineInputBorder(
          borderRadius: AppRadius.input,
          borderSide: const BorderSide(color: AppColors.error, width: 1.5),
        ),
        hintStyle: const TextStyle(color: AppColors.textTertiary),
        labelStyle: const TextStyle(color: AppColors.textSecondary),
      ),
      dividerTheme: const DividerThemeData(
        color: AppColors.divider,
        thickness: 1,
        space: 1,
      ),
      iconTheme: const IconThemeData(
        color: AppColors.textSecondary,
        size: AppTypography.iconLg,
      ),
      textTheme: TextTheme(
        displayLarge: AppTypography.displayStyle.copyWith(
          color: AppColors.textPrimary,
        ),
        displayMedium: AppTypography.headlineStyle.copyWith(
          color: AppColors.textPrimary,
        ),
        displaySmall: AppTypography.titleStyle.copyWith(
          color: AppColors.textPrimary,
        ),
        headlineLarge: AppTypography.headlineStyle.copyWith(
          color: AppColors.textPrimary,
        ),
        headlineMedium: AppTypography.titleStyle.copyWith(
          color: AppColors.textPrimary,
        ),
        headlineSmall: AppTypography.subtitleStyle.copyWith(
          color: AppColors.textPrimary,
        ),
        titleLarge: AppTypography.titleStyle.copyWith(
          color: AppColors.textPrimary,
        ),
        titleMedium: AppTypography.subtitleStyle.copyWith(
          color: AppColors.textPrimary,
        ),
        titleSmall: AppTypography.bodyEmphasis.copyWith(
          color: AppColors.textSecondary,
        ),
        bodyLarge: AppTypography.subtitleStyle.copyWith(
          color: AppColors.textPrimary,
        ),
        bodyMedium: AppTypography.bodyLgStyle.copyWith(
          color: AppColors.textSecondary,
        ),
        bodySmall: AppTypography.captionStyle.copyWith(
          color: AppColors.textTertiary,
        ),
        labelLarge: AppTypography.bodyEmphasis.copyWith(
          color: AppColors.green,
        ),
        labelMedium: AppTypography.captionStyle.copyWith(
          color: AppColors.cyan,
        ),
        labelSmall: AppTypography.microStyle.copyWith(
          color: AppColors.textTertiary,
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.green,
          foregroundColor: AppColors.bgPrimary,
          elevation: 0,
          padding: AppSpacing.buttonPadding,
          shape: RoundedRectangleBorder(
            borderRadius: AppRadius.button,
          ),
          textStyle: AppTypography.bodyEmphasis.copyWith(
            letterSpacing: 0.5,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.green,
          shape: RoundedRectangleBorder(
            borderRadius: AppRadius.smAll,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.textPrimary,
          side: const BorderSide(color: AppColors.borderLight),
          padding: AppSpacing.buttonPadding,
          shape: RoundedRectangleBorder(
            borderRadius: AppRadius.button,
          ),
          textStyle: AppTypography.bodyEmphasis,
        ),
      ),
      listTileTheme: const ListTileThemeData(
        iconColor: AppColors.textSecondary,
        textColor: AppColors.textPrimary,
        selectedTileColor: AppColors.surfaceHover,
        contentPadding: EdgeInsets.symmetric(horizontal: AppSpacing.md),
      ),
      drawerTheme: const DrawerThemeData(
        backgroundColor: AppColors.bgSecondary,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.horizontal(
            right: Radius.circular(AppRadius.xl),
          ),
        ),
      ),
      bottomSheetTheme: BottomSheetThemeData(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.bottomSheetTop,
        ),
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.bgElevated,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.dialog,
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.surface,
        contentTextStyle: const TextStyle(color: AppColors.textPrimary),
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.mdAll,
        ),
        behavior: SnackBarBehavior.floating,
      ),
      tooltipTheme: TooltipThemeData(
        decoration: BoxDecoration(
          color: AppColors.bgElevated,
          borderRadius: AppRadius.smAll,
          border: Border.all(color: AppColors.borderLight),
        ),
        textStyle: const TextStyle(
          color: AppColors.textPrimary,
          fontSize: AppTypography.caption,
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.surface,
        selectedColor: AppColors.greenGlow,
        labelStyle: AppTypography.captionStyle.copyWith(
          color: AppColors.textSecondary,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.smAll,
          side: const BorderSide(color: AppColors.border),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: AppSpacing.xs,
        ),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return AppColors.green;
          }
          return AppColors.textTertiary;
        }),
        trackColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.selected)) {
            return AppColors.greenGlow;
          }
          return AppColors.surface;
        }),
      ),
      sliderTheme: const SliderThemeData(
        activeTrackColor: AppColors.green,
        inactiveTrackColor: AppColors.surface,
        thumbColor: AppColors.green,
        overlayColor: AppColors.greenGlow,
      ),
      popupMenuTheme: PopupMenuThemeData(
        color: AppColors.bgElevated,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.lgAll,
          side: const BorderSide(color: AppColors.border),
        ),
      ),
      scrollbarTheme: ScrollbarThemeData(
        thickness: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.hovered) ? 6.0 : 4.0;
        }),
        radius: const Radius.circular(AppRadius.full),
        thumbColor: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.hovered)
              ? AppColors.textTertiary
              : AppColors.surfaceHover;
        }),
        trackVisibility: WidgetStateProperty.resolveWith((states) {
          return states.contains(WidgetState.hovered);
        }),
      ),
    );
  }
}
