#Requires -Version 5.1
<#
.SYNOPSIS
    Stop all AI Chat development services (backend + frontend)

.DESCRIPTION
    Find and terminate processes occupying the following ports:
    - 3000: Python FastAPI backend
    - 8080: Flutter Web frontend
    Also try to terminate all python.exe, dart.exe, riko.exe processes.

.EXAMPLE
    .\scripts\stop_all.ps1
#>

[CmdletBinding()]
param()

# ── Color output helpers ──
function Write-Info    ($msg) { Write-Host "[INFO]  $msg" -ForegroundColor Cyan }
function Write-Success ($msg) { Write-Host "[OK]    $msg" -ForegroundColor Green }
function Write-Warn    ($msg) { Write-Host "[WARN]  $msg" -ForegroundColor Yellow }
function Write-Error   ($msg) { Write-Host "[ERROR] $msg" -ForegroundColor Red }

# ── Kill process by port ──
function Stop-ProcessByPort {
    param([int]$Port)
    $found = $false
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
                 Where-Object { $_.State -eq "Listen" -or $_.State -eq "Established" }
        foreach ($conn in $conns) {
            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            if ($proc) {
                Write-Warn "Port $Port found process PID $($proc.Id) ($($proc.ProcessName)), terminating..."
                Stop-Process -Id $proc.Id -Force
                $found = $true
            }
        }
    } catch {
        # ignore
    }
    if (-not $found) {
        Write-Info "Port $Port has no occupying process"
    } else {
        Write-Success "Port $Port cleaned up"
    }
}

# ── Kill process by name ──
function Stop-ProcessByName {
    param([string]$Name, [string]$DisplayName)
    $procs = Get-Process -Name $Name -ErrorAction SilentlyContinue
    if ($procs) {
        foreach ($proc in $procs) {
            Write-Warn "Found $DisplayName process PID $($proc.Id), terminating..."
            Stop-Process -Id $proc.Id -Force
        }
        Write-Success "$DisplayName process cleaned up"
    } else {
        Write-Info "No $DisplayName process found"
    }
}

# ── Main logic ──
Write-Host ""
Write-Host "========================================" -ForegroundColor Blue
Write-Host "  AI Chat Development Service Stopper" -ForegroundColor Blue
Write-Host "========================================" -ForegroundColor Blue
Write-Host ""

# 1. Clean by port
Write-Info "Finding and terminating processes by port..."
Stop-ProcessByPort -Port 3000
Stop-ProcessByPort -Port 8080

Write-Host ""

# 2. Clean by process name (fallback)
Write-Info "Finding and terminating by process name..."
Stop-ProcessByName -Name "python" -DisplayName "Python"
Stop-ProcessByName -Name "python3" -DisplayName "Python3"
Stop-ProcessByName -Name "dart" -DisplayName "Dart"
Stop-ProcessByName -Name "riko" -DisplayName "Flutter Windows App"

Write-Host ""
Write-Success "All services stopped"
Write-Host ""
