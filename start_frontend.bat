@echo off
chcp 65001 >nul 2>&1
title Frontend - AI Chat
cd /d "%~dp0"
echo ========================================
echo   AI Chat - Frontend (Flutter)
echo ========================================
flutter run -d windows
pause
