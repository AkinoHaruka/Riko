/// 设置分组容器 — 可展开/收起的圆角卡片
///
/// 将一组相关设置项包裹在统一的圆角卡片中，顶部显示大写加粗的分组标题。
/// 点击标题可展开/收起详细设置；折叠态显示 [summary] 提供当前设置值的快速概览。
/// 展开/收起使用 [AnimatedCrossFade]，时长 250ms，并响应系统动画禁用开关。
library;

import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_radius.dart';
import '../../../core/theme/app_typography.dart';

/// 设置分组容器 — 可展开/收起的圆角卡片
///
/// [title] 为分组标题；[children] 为展开后显示的设置项列表；
/// [summary] 为折叠态显示的当前值摘要，不传入时折叠态仅显示空占位。
/// [initiallyExpanded] 控制初始展开状态，默认为折叠。
class SettingsGroup extends StatefulWidget {
  final String title;
  final List<Widget> children;
  final Widget? summary;
  final bool initiallyExpanded;

  const SettingsGroup({
    super.key,
    required this.title,
    required this.children,
    this.summary,
    this.initiallyExpanded = false,
  });

  @override
  State<SettingsGroup> createState() => _SettingsGroupState();
}

class _SettingsGroupState extends State<SettingsGroup>
    with SingleTickerProviderStateMixin {
  late bool _expanded;

  @override
  void initState() {
    super.initState();
    _expanded = widget.initiallyExpanded;
  }

  void _toggle() {
    setState(() => _expanded = !_expanded);
  }

  @override
  Widget build(BuildContext context) {
    final disableAnimations = MediaQuery.of(context).disableAnimations;

    return Padding(
      padding: const EdgeInsets.only(bottom: 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 组标题 — 可点击切换展开/收起
          InkWell(
            onTap: _toggle,
            borderRadius: AppRadius.mdAll,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(4, 4, 4, 12),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      widget.title.toUpperCase(),
                      style: TextStyle(
                        color: AppColors.textPrimary.withValues(alpha: 0.6),
                        fontSize: AppTypography.caption,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.5,
                      ),
                    ),
                  ),
                  AnimatedRotation(
                    turns: _expanded ? 0.5 : 0.0,
                    duration: disableAnimations
                        ? Duration.zero
                        : const Duration(milliseconds: 250),
                    child: Icon(
                      Icons.keyboard_arrow_down,
                      color: AppColors.textPrimary.withValues(alpha: 0.5),
                      size: 20,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // 卡片容器 — 内部使用 AnimatedCrossFade 切换摘要/详情
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: AppRadius.lgAll,
              border: Border.all(color: AppColors.border),
            ),
            child: AnimatedCrossFade(
              firstChild: _buildCollapsed(),
              secondChild: _buildExpanded(),
              crossFadeState: _expanded
                  ? CrossFadeState.showSecond
                  : CrossFadeState.showFirst,
              duration: disableAnimations
                  ? Duration.zero
                  : const Duration(milliseconds: 250),
              firstCurve: Curves.easeOutCubic,
              secondCurve: Curves.easeOutCubic,
              sizeCurve: Curves.easeInOutCubic,
            ),
          ),
        ],
      ),
    );
  }

  /// 折叠态 — 显示当前值摘要，不显示冗余说明文字
  Widget _buildCollapsed() {
    return AnimatedSwitcher(
      duration: Duration.zero,
      child: widget.summary != null
          ? Padding(
              key: ValueKey('summary_${widget.title}'),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
              child: DefaultTextStyle(
                style: TextStyle(
                  color: AppColors.textPrimary.withValues(alpha: 0.85),
                  fontSize: 14,
                ),
                child: widget.summary!,
              ),
            )
          : const SizedBox(
              key: ValueKey('empty_summary'),
              width: double.infinity,
              height: 0,
            ),
    );
  }

  /// 展开态 — 显示完整设置项列表
  Widget _buildExpanded() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: widget.children,
    );
  }
}
