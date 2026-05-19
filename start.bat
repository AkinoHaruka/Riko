@echo off
chcp 65001 >nul 2>&1
cd /d "%~dp0"

echo ========================================
echo   AI Chat App
echo ========================================
echo.

echo 停止旧进程...
call stop.bat silent
ping -n 3 127.0.0.1 >nul

echo 启动后端...
start "Backend" start_backend.bat

echo 启动前端...
start "Frontend" start_frontend.bat

echo.
echo 完成 - 后端和前端已分别启动
echo 关闭全部: 双击 stop.bat
ping -n 3 127.0.0.1 >nul
