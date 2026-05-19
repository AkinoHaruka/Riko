#Requires -Version 5.1
<#
.SYNOPSIS
    One-click start AI Chat Web dev environment (backend + frontend)

.DESCRIPTION
    1. Clean up residual processes on ports 3000 (backend) and 8080 (frontend)
    2. Start Python FastAPI backend service
    3. Wait for backend health check to pass
    4. Start Flutter Web frontend service
    5. Graceful shutdown on Ctrl+C

.EXAMPLE
    .\scripts\start_web.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

# --- Config ---
$BackendPort = 3000
$FrontendPort = 8080
$BackendHealthUrl = "http://localhost:$BackendPort/health"
$BackendWaitTimeout = 30
$BackendPollInterval = 500
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = Split-Path -Parent $ScriptDir
$BackendDir = Join-Path $ProjectRoot "python_backend"

# --- Color output helpers ---
function Write-Info    ($msg) { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Success ($msg) { Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn    ($msg) { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Err     ($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

# --- Kill process by port ---
function Stop-ProcessByPort {
    param([int]$Port)
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
                Where-Object { $_.State -eq "Listen" }
        if ($conn) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Warn "Port $Port occupied by PID $($proc.Id) ($($proc.ProcessName)), terminating..."
                Stop-Process -Id $proc.Id -Force
                Start-Sleep -Milliseconds 500
                Write-Success "Port $Port released"
            }
        }
    } catch {
        # port not occupied, ignore
    }
}

# --- Main logic ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Blue
Write-Host "  AI Chat Web Dev Environment Launcher" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host ""

# 1. Clean residual ports
Write-Info "Checking and cleaning residual processes..."
Stop-ProcessByPort -Port $BackendPort
Stop-ProcessByPort -Port $FrontendPort

# 2. Start backend (background job)
Write-Info "Starting Python backend service (port $BackendPort)..."
$backendJob = Start-Job -ScriptBlock {
    param($dir)
    Set-Location $dir
    python main.py
} -ArgumentList $BackendDir

# Give backend some startup time
Start-Sleep -Seconds 1

# 3. Poll health check
Write-Info "Waiting for backend ready (max ${BackendWaitTimeout}s)..."
$backendReady = $false
$elapsed = 0
while ($elapsed -lt $BackendWaitTimeout) {
    try {
        $resp = Invoke-RestMethod -Uri $BackendHealthUrl -Method GET -TimeoutSec 2 -ErrorAction Stop
        if ($resp.status -eq "ok") {
            $backendReady = $true
            break
        }
    } catch {
        # keep waiting
    }
    Start-Sleep -Milliseconds $BackendPollInterval
    $elapsed += ($BackendPollInterval / 1000)
}

if (-not $backendReady) {
    Write-Err "Backend service failed to start or health check timed out"
    Stop-Job $backendJob -ErrorAction SilentlyContinue
    Remove-Job $backendJob -ErrorAction SilentlyContinue
    exit 1
}
Write-Success "Backend service ready: $BackendHealthUrl"

# 4. Start Flutter Web frontend (foreground, interactive)
Write-Info "Starting Flutter Web frontend (port $FrontendPort)..."
Write-Host ""

# Cleanup function
$script:cleanupDone = $false
function Invoke-Cleanup {
    if ($script:cleanupDone) { return }
    $script:cleanupDone = $true
    Write-Host ""
    Write-Warn "Shutting down all services..."

    if ($backendJob) {
        Stop-Job $backendJob -ErrorAction SilentlyContinue
        Remove-Job $backendJob -ErrorAction SilentlyContinue
    }

    Stop-ProcessByPort -Port $BackendPort
    Stop-ProcessByPort -Port $FrontendPort

    Write-Success "All services closed"
}

# Register exit event
$null = Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    Invoke-Cleanup
} -SupportEvent

# Display access info
Write-Host ""
Write-Host "----------------------------------------" -ForegroundColor Green
Write-Success "All services started!"
Write-Host ""
Write-Host "  Frontend: http://localhost:$FrontendPort" -ForegroundColor White
Write-Host "  Backend:  http://localhost:$BackendPort" -ForegroundColor White
Write-Host "  Health:   $BackendHealthUrl" -ForegroundColor White
Write-Host ""
Write-Host "  Press Ctrl+C to stop all services" -ForegroundColor Yellow
Write-Host "----------------------------------------" -ForegroundColor Green
Write-Host ""

# Start frontend (blocking, user sees Flutter logs and hot reload)
try {
    Set-Location $ProjectRoot
    flutter run -d web-server --web-port $FrontendPort
} finally {
    Invoke-Cleanup
}
