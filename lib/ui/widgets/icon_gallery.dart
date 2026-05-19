import 'package:flutter/material.dart';
import 'package:font_awesome_flutter/font_awesome_flutter.dart';
import 'dart:math' as math;

/// 图标展示页面 — 预览自定义圆形图标和 Font Awesome 图标，与主应用逻辑隔离
class IconGalleryPage extends StatelessWidget {
  const IconGalleryPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF121212),
      appBar: AppBar(
        backgroundColor: const Color(0xFF1E1E1E),
        title: const Text(
          '图标选择器',
          style: TextStyle(color: Colors.white, fontSize: 18),
        ),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildSectionTitle('🎨 自定义样式'),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                _buildCustomIconCard(
                  name: 'circleWifiRotated',
                  icon: _buildCustomWifiIcon(),
                ),
                _buildCustomIconCard(
                  name: 'circlePlus',
                  icon: _buildCustomPlusIcon(),
                ),
                _buildCustomIconCard(
                  name: 'circleMicrophone',
                  icon: _buildCustomMicrophoneIcon(),
                ),
                _buildCustomIconCard(
                  name: 'angleLeft',
                  icon: const FaIcon(
                    FontAwesomeIcons.angleLeft,
                    color: Color(0xFFd5d5d5),
                    size: 24,
                  ),
                ),
                _buildCustomIconCard(
                  name: 'chevronLeft',
                  icon: const FaIcon(
                    FontAwesomeIcons.chevronLeft,
                    color: Color(0xFFd5d5d5),
                    size: 24,
                  ),
                ),
                _buildCustomIconCard(
                  name: 'ellipsis',
                  icon: const FaIcon(
                    FontAwesomeIcons.ellipsis,
                    color: Color(0xFFd5d5d5),
                    size: 24,
                  ),
                ),
                _buildCustomIconCard(
                  name: 'faceLaugh',
                  icon: const FaIcon(
                    FontAwesomeIcons.faceLaugh,
                    color: Color(0xFFd5d5d5),
                    size: 24,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 40),
          ],
        ),
      ),
    );
  }

  /// 自定义 WiFi 图标：圆形边框 + WiFi 图标，顺时针旋转 90°
  Widget _buildCustomWifiIcon() {
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: const Color(0xFFd5d5d5), width: 1.5),
      ),
      child: Center(
        child: Transform.rotate(
          angle: math.pi / 2, // 顺时针旋转 90°
          child: const FaIcon(
            FontAwesomeIcons.wifi,
            color: Color(0xFFd5d5d5),
            size: 18,
          ),
        ),
      ),
    );
  }

  /// 自定义加号图标：圆形边框 + 加号图标
  Widget _buildCustomPlusIcon() {
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: const Color(0xFFd5d5d5), width: 1.5),
      ),
      child: const Center(
        child: FaIcon(
          FontAwesomeIcons.plus,
          color: Color(0xFFd5d5d5),
          size: 18,
        ),
      ),
    );
  }

  /// 自定义麦克风图标：圆形边框 + 麦克风图标
  Widget _buildCustomMicrophoneIcon() {
    return Container(
      width: 36,
      height: 36,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        border: Border.all(color: const Color(0xFFd5d5d5), width: 1.5),
      ),
      child: const Center(
        child: FaIcon(
          FontAwesomeIcons.microphone,
          color: Color(0xFFd5d5d5),
          size: 18,
        ),
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Text(
        title,
        style: const TextStyle(
          color: Colors.white,
          fontSize: 16,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

Widget _buildCustomIconCard({required String name, required Widget icon}) {
  return Container(
    width: 80,
    height: 90,
    decoration: BoxDecoration(
      color: const Color(0xFF1E1E1E),
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: const Color(0xFF2C2C2C)),
    ),
    child: Column(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        icon,
        const SizedBox(height: 6),
        Text(
          name,
          style: const TextStyle(color: Color(0xFF8E8E93), fontSize: 9),
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ],
    ),
  );
}
