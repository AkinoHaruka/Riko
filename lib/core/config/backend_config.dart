/// 后端服务配置常量
///
/// 集中管理所有硬编码的后端地址，作为单一常量源。
/// 各模块通过引用此类避免地址分散导致的维护困难。
library;

/// 后端服务地址常量
class BackendConfig {
  const BackendConfig._();

  /// 默认后端主机
  static const String defaultHost = '127.0.0.1';

  /// 默认后端端口
  static const int defaultPort = 3000;

  /// 默认后端 baseUrl（桌面端 + Android 真机 proot）
  static const String defaultBaseUrl = 'http://$defaultHost:$defaultPort';

  /// Android 模拟器访问宿主机的 baseUrl（10.0.2.2 映射到宿主机 localhost）
  static const String emulatorBaseUrl = 'http://10.0.2.2:$defaultPort';
}
