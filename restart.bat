@echo off
cd /d "%~dp0"
echo 重启 AI Chat App...
call "%~dp0stop.bat"
ping -n 3 127.0.0.1 >nul
call "%~dp0start.bat"
