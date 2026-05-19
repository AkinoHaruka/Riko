import 'dart:typed_data';

import 'package:crop_your_image/crop_your_image.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/app_colors.dart';

/// 头像裁剪页面 — 全屏裁剪，锁定 1:1 正方形
///
/// 接收图片 bytes，返回裁剪后的 Uint8List。
class AvatarCropPage extends StatefulWidget {
  final Uint8List imageBytes;
  const AvatarCropPage({super.key, required this.imageBytes});

  @override
  State<AvatarCropPage> createState() => _AvatarCropPageState();
}

class _AvatarCropPageState extends State<AvatarCropPage> {
  final _controller = CropController();
  bool _isCropping = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.bgPrimary,
      appBar: AppBar(
        backgroundColor: AppColors.bgTertiary,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.textSecondary),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text(
          '裁剪头像',
          style: TextStyle(color: AppColors.textPrimary, fontSize: 18, fontWeight: FontWeight.bold),
        ),
        actions: [
          TextButton(
            onPressed: _isCropping ? null : () => _controller.crop(),
            child: _isCropping
                ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.green))
                : const Text('确认', style: TextStyle(color: AppColors.green, fontSize: 15, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
      body: Crop(
        image: widget.imageBytes,
        controller: _controller,
        aspectRatio: 1.0,
        baseColor: AppColors.bgPrimary,
        maskColor: Colors.black.withValues(alpha: 0.7),
        radius: 12,
        onCropped: (result) {
          if (!mounted) return;
          switch (result) {
            case CropSuccess(:final croppedImage):
              Navigator.pop(context, croppedImage);
            case CropFailure(:final cause):
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('裁剪失败: $cause')),
              );
              setState(() => _isCropping = false);
          }
        },
      ),
    );
  }
}
