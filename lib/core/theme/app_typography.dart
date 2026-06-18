import 'package:flutter/material.dart';

/// RIKO 排版令牌系统 — 类 iOS 排版层级
///
/// 基于 MiSans 字体族，定义语义化字号、字重和行高。
/// 所有 TextStyle 必须引用此文件中的常量或 AppTheme.textTheme 中的语义样式，
/// 禁止在组件中硬编码 fontSize / fontWeight。
class AppTypography {
  AppTypography._();

  // ===== 字体族 =====

  /// 主字体族
  static const String fontFamily = 'MiSans';

  /// 字体回退栈
  static const List<String> fontFamilyFallback = [
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

  // ===== 字号层级 =====

  /// 超大标题（28）— 页面主标题
  static const double display = 28;

  /// 大标题（22）— 区块标题
  static const double headline = 22;

  /// 标题（18）— 卡片标题、设置组标题
  static const double title = 18;

  /// 副标题（16）— 列表项标题、表单标签
  static const double subtitle = 16;

  /// 大正文（15）— 消息气泡、输入框等稍大的正文文本
  static const double bodyLg = 15;

  /// 正文（14）— 主要内容文本
  static const double body = 14;

  /// 小字（12）— 辅助说明、时间戳
  static const double caption = 12;

  /// 极小字（10）— badge、标签
  static const double micro = 10;

  // ===== 字重层级 =====

  /// 常规字重
  static const FontWeight regular = FontWeight.w400;

  /// 中等字重
  static const FontWeight medium = FontWeight.w500;

  /// 半粗字重
  static const FontWeight semibold = FontWeight.w600;

  /// 粗体字重
  static const FontWeight bold = FontWeight.w700;

  // ===== 行高倍率 =====

  /// 紧凑行高（1.2）
  static const double lineHeightTight = 1.2;

  /// 标准行高（1.5）
  static const double lineHeightNormal = 1.5;

  /// 宽松行高（1.7）
  static const double lineHeightRelaxed = 1.7;

  // ===== 语义化 TextStyle =====

  /// 页面主标题
  static TextStyle get displayStyle => const TextStyle(
        fontSize: display,
        fontWeight: bold,
        height: lineHeightTight,
        fontFamily: fontFamily,
        fontFamilyFallback: fontFamilyFallback,
      );

  /// 区块标题
  static TextStyle get headlineStyle => const TextStyle(
        fontSize: headline,
        fontWeight: semibold,
        height: lineHeightTight,
        fontFamily: fontFamily,
        fontFamilyFallback: fontFamilyFallback,
      );

  /// 卡片/设置组标题
  static TextStyle get titleStyle => const TextStyle(
        fontSize: title,
        fontWeight: semibold,
        height: lineHeightNormal,
        fontFamily: fontFamily,
        fontFamilyFallback: fontFamilyFallback,
      );

  /// 列表项标题
  static TextStyle get subtitleStyle => const TextStyle(
        fontSize: subtitle,
        fontWeight: medium,
        height: lineHeightNormal,
        fontFamily: fontFamily,
        fontFamilyFallback: fontFamilyFallback,
      );

  /// 正文
  static TextStyle get bodyStyle => const TextStyle(
        fontSize: body,
        fontWeight: regular,
        height: lineHeightRelaxed,
        fontFamily: fontFamily,
        fontFamilyFallback: fontFamilyFallback,
      );

  /// 正文强调
  static TextStyle get bodyEmphasis => const TextStyle(
        fontSize: body,
        fontWeight: medium,
        height: lineHeightRelaxed,
        fontFamily: fontFamily,
        fontFamilyFallback: fontFamilyFallback,
      );

  /// 大正文
  static TextStyle get bodyLgStyle => const TextStyle(
        fontSize: bodyLg,
        fontWeight: regular,
        height: lineHeightNormal,
        fontFamily: fontFamily,
        fontFamilyFallback: fontFamilyFallback,
      );

  /// 辅助说明
  static TextStyle get captionStyle => const TextStyle(
        fontSize: caption,
        fontWeight: regular,
        height: lineHeightNormal,
        fontFamily: fontFamily,
        fontFamilyFallback: fontFamilyFallback,
      );

  /// 极小文字
  static TextStyle get microStyle => const TextStyle(
        fontSize: micro,
        fontWeight: medium,
        height: lineHeightNormal,
        fontFamily: fontFamily,
        fontFamilyFallback: fontFamilyFallback,
      );

  // ===== 图标尺寸令牌 =====

  /// 小图标（16）
  static const double iconSm = 16;

  /// 标准图标（20）
  static const double iconMd = 20;

  /// 大图标（24）
  static const double iconLg = 24;

  /// 超大图标（32）
  static const double iconXl = 32;
}
