@echo off
chcp 65001 >nul 2>&1
title Backend - AI Chat
cd /d "%~dp0ts_backend"

echo ========================================
echo   AI Chat - Backend (port 3000)
echo ========================================

:: Kill any old process on port 3000
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do taskkill /PID %%P /F >nul 2>&1

npm run dev
pause
