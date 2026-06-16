/// 插件与工具管理页面 — MCP Server 的增删查与状态监控
///
/// 提供服务器列表展示、添加/删除/重连操作，
/// 以及实时状态徽章（connected/connecting/disconnected/failed）。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/di/mcp_provider.dart';
import '../core/theme/app_animations.dart';
import '../core/theme/app_colors.dart';
import '../data/mcp_api.dart';

/// 插件与工具管理页面
class AdminPage extends ConsumerStatefulWidget {
  const AdminPage({super.key});

  @override
  ConsumerState<AdminPage> createState() => _AdminPageState();
}

class _AdminPageState extends ConsumerState<AdminPage> {
  @override
  Widget build(BuildContext context) {
    final serversAsync = ref.watch(mcpServersProvider);

    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(
        backgroundColor: AppColors.bgTertiary,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.textSecondary),
          onPressed: () => context.go('/'),
        ),
        title: const Text(
          '插件与工具',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 18,
            fontWeight: FontWeight.bold,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh, color: AppColors.textSecondary),
            onPressed: () => ref.read(mcpServersProvider.notifier).refresh(),
            tooltip: '刷新',
          ),
          IconButton(
            icon: const Icon(Icons.add, color: AppColors.green),
            onPressed: _showAddServerDialog,
            tooltip: '添加服务器',
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: serversAsync.when(
        loading: () => const Center(
          child: CircularProgressIndicator(color: AppColors.green),
        ),
        error: (error, _) => _buildErrorState(error),
        data: (servers) {
          if (servers.isEmpty) return _buildEmptyState();
          return _buildServerList(servers);
        },
      ),
    );
  }

  // ===== 服务器列表 =====

  Widget _buildServerList(List<McpConnectionInfo> servers) {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: servers.length,
      itemBuilder: (context, index) {
        return _buildServerCard(servers[index]);
      },
    );
  }

  /// 构建单个服务器卡片
  Widget _buildServerCard(McpConnectionInfo server) {
    final statusColor = _statusColor(server.status);
    final statusLabel = _statusLabel(server.status);
    final transportLabel = 'stdio';
    final transportColor = AppColors.warning; // stdio 用黄色标签

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 顶部：名称 + 标签 + 操作按钮
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 8, 0),
            child: Row(
              children: [
                // 服务器名称
                Expanded(
                  child: Text(
                    server.name,
                    style: const TextStyle(
                      color: AppColors.textPrimary,
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                // 传输类型标签
                _buildBadge(transportLabel, transportColor),
                const SizedBox(width: 8),
                // 连接状态徽章
                _buildBadge(statusLabel, statusColor),
              ],
            ),
          ),
          // 工具数量 + 错误信息
          if (server.toolCount != null || server.error != null)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Row(
                children: [
                  if (server.toolCount != null)
                    Text(
                      '${server.toolCount} 个工具',
                      style: const TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 13,
                      ),
                    ),
                  if (server.error != null) ...[
                    if (server.toolCount != null) const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        server.error!,
                        style: const TextStyle(
                          color: AppColors.error,
                          fontSize: 12,
                        ),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          // 底部操作按钮
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                // 重连按钮
                _buildActionButton(
                  label: '重连',
                  icon: Icons.refresh,
                  color: AppColors.textSecondary,
                  onPressed: () => _reconnectServer(server.name),
                ),
                const SizedBox(width: 8),
                // 删除按钮
                _buildActionButton(
                  label: '删除',
                  icon: Icons.delete_outline,
                  color: AppColors.error,
                  onPressed: () => _confirmDelete(server.name),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// 构建小圆角徽章（状态/传输类型标签）
  Widget _buildBadge(String label, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }

  /// 构建操作按钮（文字+图标）
  Widget _buildActionButton({
    required String label,
    required IconData icon,
    required Color color,
    required VoidCallback onPressed,
  }) {
    return InkWell(
      onTap: onPressed,
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 16, color: color),
            const SizedBox(width: 4),
            Text(
              label,
              style: TextStyle(
                color: color,
                fontSize: 13,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ===== 空状态 / 错误状态 =====

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.extension_outlined,
            size: 64,
            color: AppColors.textTertiary.withValues(alpha: 0.3),
          ),
          const SizedBox(height: 16),
          Text(
            '暂无 MCP Server',
            style: TextStyle(
              color: AppColors.textTertiary.withValues(alpha: 0.7),
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            '点击右上角 + 添加 MCP 服务器',
            style: TextStyle(
              color: AppColors.textTertiary.withValues(alpha: 0.5),
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildErrorState(Object error) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.error_outline,
            size: 64,
            color: AppColors.error,
          ),
          const SizedBox(height: 16),
          const Text(
            '加载失败',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 16,
            ),
          ),
          const SizedBox(height: 8),
          Text(
            error.toString(),
            style: const TextStyle(
              color: AppColors.textTertiary,
              fontSize: 13,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: () =>
                ref.read(mcpServersProvider.notifier).loadServers(),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.green,
              foregroundColor: Colors.white,
            ),
            child: const Text('重试'),
          ),
        ],
      ),
    );
  }

  // ===== 操作方法 =====

  /// 重连服务器
  Future<void> _reconnectServer(String name) async {
    try {
      final response =
          await ref.read(mcpServersProvider.notifier).reconnectServer(name);
      if (mounted) {
        if (response.status == McpConnectionStatus.failed) {
          _showSnackBar('重连失败: ${response.error ?? "未知错误"}', isError: true);
        } else {
          _showSnackBar('正在重连 $name...');
        }
      }
    } catch (e) {
      if (mounted) {
        _showSnackBar('重连请求失败: $e', isError: true);
      }
    }
  }

  /// 删除确认弹窗
  Future<void> _confirmDelete(String name) async {
    final confirmed = await AppAnimations.showSpringDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text(
          '删除服务器',
          style: TextStyle(color: AppColors.error),
        ),
        content: Text(
          '确定要删除 "$name" 吗？此操作不可恢复。',
          style: const TextStyle(color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text(
              '取消',
              style: TextStyle(color: AppColors.textSecondary),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text(
              '删除',
              style: TextStyle(color: AppColors.error),
            ),
          ),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        await ref.read(mcpServersProvider.notifier).removeServer(name);
        if (mounted) {
          _showSnackBar('已删除 $name');
        }
      } catch (e) {
        if (mounted) {
          _showSnackBar('删除失败: $e', isError: true);
        }
      }
    }
  }

  /// 显示添加服务器弹窗
  Future<void> _showAddServerDialog() async {
    final result = await AppAnimations.showSpringDialog<_AddServerResult>(
      context: context,
      builder: (ctx) => const _AddServerDialog(),
    );

    if (result == null || !mounted) return;

    try {
      final response = await ref
          .read(mcpServersProvider.notifier)
          .addServer(result.name, result.config);
      if (mounted) {
        if (response.status == McpConnectionStatus.failed) {
          _showSnackBar('添加失败: ${response.error ?? "未知错误"}', isError: true);
        } else {
          _showSnackBar('已添加 ${result.name}');
        }
      }
    } catch (e) {
      if (mounted) {
        _showSnackBar('添加失败: $e', isError: true);
      }
    }
  }

  /// 显示 SnackBar 提示
  void _showSnackBar(String message, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: isError ? AppColors.error : AppColors.surface,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 3),
      ),
    );
  }

  // ===== 状态映射辅助 =====

  /// 连接状态 → 颜色
  static Color _statusColor(McpConnectionStatus status) {
    return switch (status) {
      McpConnectionStatus.connected => AppColors.success,
      McpConnectionStatus.connecting => AppColors.warning,
      McpConnectionStatus.disconnected => AppColors.textTertiary,
      McpConnectionStatus.failed => AppColors.error,
    };
  }

  /// 连接状态 → 中文标签
  static String _statusLabel(McpConnectionStatus status) {
    return switch (status) {
      McpConnectionStatus.connected => '已连接',
      McpConnectionStatus.connecting => '连接中',
      McpConnectionStatus.disconnected => '未连接',
      McpConnectionStatus.failed => '连接失败',
    };
  }
}

// ===== 添加服务器弹窗 =====

/// 添加服务器弹窗的返回结果
class _AddServerResult {
  final String name;
  final McpServerConfig config;

  const _AddServerResult({required this.name, required this.config});
}

/// 添加 MCP Server 弹窗
///
/// 支持切换 stdio/http 传输类型，根据类型展示不同的配置表单。
class _AddServerDialog extends StatefulWidget {
  const _AddServerDialog();

  @override
  State<_AddServerDialog> createState() => _AddServerDialogState();
}

class _AddServerDialogState extends State<_AddServerDialog> {
  /// 当前选中的传输类型
  McpTransportType _transportType = McpTransportType.stdio;

  /// 表单控制器
  final _nameController = TextEditingController();
  final _commandController = TextEditingController();
  final _argsController = TextEditingController();
  final _urlController = TextEditingController();

  /// 环境变量输入（每行一个 KEY=VALUE）
  final _envController = TextEditingController();

  /// 请求头输入（每行一个 KEY: VALUE）
  final _headersController = TextEditingController();

  final _formKey = GlobalKey<FormState>();

  /// 是否正在提交
  bool _isSubmitting = false;

  @override
  void dispose() {
    _nameController.dispose();
    _commandController.dispose();
    _argsController.dispose();
    _urlController.dispose();
    _envController.dispose();
    _headersController.dispose();
    super.dispose();
  }

  /// 解析多行文本为 Map（KEY=VALUE 或 KEY: VALUE 格式）
  Map<String, String> _parseKeyValuePairs(String text, {bool colon = false}) {
    final result = <String, String>{};
    for (final line in text.split('\n')) {
      final trimmed = line.trim();
      if (trimmed.isEmpty) continue;
      final sep = colon ? ':' : '=';
      final idx = trimmed.indexOf(sep);
      if (idx > 0) {
        final key = trimmed.substring(0, idx).trim();
        final value = trimmed.substring(idx + 1).trim();
        if (key.isNotEmpty) result[key] = value;
      }
    }
    return result;
  }

  /// 提交表单
  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSubmitting = true);

    final name = _nameController.text.trim();
    final McpServerConfig config;

    if (_transportType == McpTransportType.stdio) {
      final args = _argsController.text.trim();
      final env = _parseKeyValuePairs(_envController.text);
      config = McpServerConfig(
        stdio: McpStdioConfig(
          command: _commandController.text.trim(),
          args: args.isEmpty ? null : args.split(RegExp(r'\s+')),
          env: env.isEmpty ? null : env,
        ),
      );
    } else {
      final headers = _parseKeyValuePairs(_headersController.text, colon: true);
      config = McpServerConfig(
        http: McpHttpConfig(
          url: _urlController.text.trim(),
          headers: headers.isEmpty ? null : headers,
        ),
      );
    }

    if (mounted) {
      Navigator.of(context).pop(_AddServerResult(name: name, config: config));
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: AppColors.bgElevated,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: const Text(
        '添加 MCP Server',
        style: TextStyle(
          color: AppColors.textPrimary,
          fontSize: 18,
          fontWeight: FontWeight.bold,
        ),
      ),
      content: SizedBox(
        width: 420,
        child: Form(
          key: _formKey,
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 服务器名称
                _buildLabel('服务器名称'),
                const SizedBox(height: 6),
                _buildTextField(
                  controller: _nameController,
                  hint: '例如: filesystem',
                  validator: (v) =>
                      v == null || v.trim().isEmpty ? '请输入服务器名称' : null,
                ),
                const SizedBox(height: 16),

                // 传输类型切换
                _buildLabel('传输类型'),
                const SizedBox(height: 6),
                _buildTransportToggle(),
                const SizedBox(height: 16),

                // 根据传输类型展示不同表单
                if (_transportType == McpTransportType.stdio)
                  _buildStdioForm()
                else
                  _buildHttpForm(),
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed:
              _isSubmitting ? null : () => Navigator.of(context).pop(null),
          child: const Text(
            '取消',
            style: TextStyle(color: AppColors.textSecondary),
          ),
        ),
        ElevatedButton(
          onPressed: _isSubmitting ? null : _submit,
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.green,
            foregroundColor: Colors.white,
            disabledBackgroundColor: AppColors.green.withValues(alpha: 0.5),
          ),
          child: _isSubmitting
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: Colors.white,
                  ),
                )
              : const Text('添加'),
        ),
      ],
    );
  }

  /// 构建表单标签
  Widget _buildLabel(String text) {
    return Text(
      text,
      style: const TextStyle(
        color: AppColors.textSecondary,
        fontSize: 13,
        fontWeight: FontWeight.w500,
      ),
    );
  }

  /// 构建输入框
  Widget _buildTextField({
    required TextEditingController controller,
    required String hint,
    String? Function(String?)? validator,
    int maxLines = 1,
    int? minLines,
  }) {
    return TextFormField(
      controller: controller,
      validator: validator,
      maxLines: maxLines,
      minLines: minLines,
      style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: const TextStyle(color: AppColors.textTertiary, fontSize: 14),
        filled: true,
        fillColor: AppColors.bgPrimary,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.green),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.error),
        ),
      ),
    );
  }

  /// 构建传输类型切换 Tab
  Widget _buildTransportToggle() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.bgPrimary,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          _buildTransportTab(
            label: 'Stdio',
            type: McpTransportType.stdio,
            color: AppColors.warning,
          ),
          _buildTransportTab(
            label: 'HTTP',
            type: McpTransportType.http,
            color: AppColors.cyan,
          ),
        ],
      ),
    );
  }

  /// 构建单个传输类型 Tab
  Widget _buildTransportTab({
    required String label,
    required McpTransportType type,
    required Color color,
  }) {
    final isSelected = _transportType == type;
    return Expanded(
      child: GestureDetector(
        onTap: () => setState(() => _transportType = type),
        child: AnimatedContainer(
          duration: AppAnimations.quick,
          curve: AppAnimations.springIOS,
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? color.withValues(alpha: 0.15) : Colors.transparent,
            borderRadius: BorderRadius.circular(7),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                color: isSelected ? color : AppColors.textTertiary,
                fontSize: 14,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.normal,
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// 构建 Stdio 配置表单
  Widget _buildStdioForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildLabel('命令'),
        const SizedBox(height: 6),
        _buildTextField(
          controller: _commandController,
          hint: '例如: npx',
          validator: (v) =>
              _transportType == McpTransportType.stdio && (v == null || v.trim().isEmpty)
                  ? '请输入命令'
                  : null,
        ),
        const SizedBox(height: 12),
        _buildLabel('参数（空格分隔）'),
        const SizedBox(height: 6),
        _buildTextField(
          controller: _argsController,
          hint: '例如: -y @modelcontextprotocol/server-filesystem /tmp',
        ),
        const SizedBox(height: 12),
        _buildLabel('环境变量（每行 KEY=VALUE）'),
        const SizedBox(height: 6),
        _buildTextField(
          controller: _envController,
          hint: '例如:\nNODE_ENV=production\nAPI_KEY=xxx',
          maxLines: 3,
          minLines: 2,
        ),
      ],
    );
  }

  /// 构建 HTTP 配置表单
  Widget _buildHttpForm() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildLabel('URL'),
        const SizedBox(height: 6),
        _buildTextField(
          controller: _urlController,
          hint: '例如: http://localhost:8080/sse',
          validator: (v) =>
              _transportType == McpTransportType.http && (v == null || v.trim().isEmpty)
                  ? '请输入 URL'
                  : null,
        ),
        const SizedBox(height: 12),
        _buildLabel('请求头（每行 KEY: VALUE）'),
        const SizedBox(height: 6),
        _buildTextField(
          controller: _headersController,
          hint: '例如:\nAuthorization: Bearer xxx',
          maxLines: 3,
          minLines: 2,
        ),
      ],
    );
  }
}
