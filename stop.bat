@echo off
if not "%1"=="silent" echo 停止 AI Chat App...

:: Kill backend and frontend processes by window title
taskkill /fi "WINDOWTITLE eq Backend" /f >nul 2>&1
taskkill /fi "WINDOWTITLE eq Frontend" /f >nul 2>&1

:: Kill node.exe processes related to ts_backend
powershell -NoProfile -Command "Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'ts_backend' } | Stop-Process -Force" 2>nul

:: Kill dart.exe processes related to riko
powershell -NoProfile -Command "Get-Process -Name dart -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'riko' } | Stop-Process -Force" 2>nul

if not "%1"=="silent" (
    echo 已停止。
    ping -n 2 127.0.0.1 >nul
)
