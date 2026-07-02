<#
.SYNOPSIS
    Helps install MongoDB as a Windows Service running as a Replica Set (rs0).

.DESCRIPTION
    This script uses NSSM (Non-Sucking Service Manager) to install MongoDB as a reliable Windows Service.
    It is strongly recommended for daily development.

.REQUIREMENTS
    - MongoDB installed (mongod.exe in PATH)
    - NSSM downloaded from https://nssm.cc/download
    - Run this script as Administrator

.EXAMPLE
    .\setup-mongodb-service.ps1
#>

Write-Host "=== MongoDB Replica Set Windows Service Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check for Administrator privileges
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "This script must be run as Administrator. Right-click PowerShell and choose 'Run as Administrator'."
    exit 1
}

# Ask for NSSM path
$nssmPath = Read-Host "Enter the full path to nssm.exe (e.g. C:\Tools\nssm\nssm.exe)"

if (-not (Test-Path $nssmPath)) {
    Write-Error "NSSM not found at '$nssmPath'. Please download it from https://nssm.cc/download"
    exit 1
}

# MongoDB executable path
$mongodPath = (Get-Command mongod -ErrorAction SilentlyContinue).Source

if (-not $mongodPath) {
    Write-Error "mongod.exe not found in PATH. Please install MongoDB or add it to your system PATH."
    exit 1
}

Write-Host "Found mongod at: $mongodPath" -ForegroundColor Green

# Service configuration
$serviceName = "MongoDB-RS0"
$displayName = "MongoDB Replica Set (rs0)"
$dataPath = "C:\data\rs0"
$logPath = "C:\data\rs0\mongo.log"

# Ensure data directory exists
if (-not (Test-Path $dataPath)) {
    New-Item -ItemType Directory -Path $dataPath -Force | Out-Null
    Write-Host "Created data directory: $dataPath" -ForegroundColor Yellow
}

# Build arguments
$arguments = @(
    "--replSet rs0",
    "--dbpath `"$dataPath`"",
    "--port 27017",
    "--bind_ip localhost",
    "--logpath `"$logPath`"",
    "--logappend"
) -join " "

Write-Host ""
Write-Host "Installing service '$serviceName'..." -ForegroundColor Cyan

# Remove existing service if present
& $nssmPath remove $serviceName confirm 2>$null

# Install service
& $nssmPath install $serviceName $mongodPath $arguments

# Set service details
& $nssmPath set $serviceName DisplayName $displayName
& $nssmPath set $serviceName Start SERVICE_AUTO_START
& $nssmPath set $serviceName AppStdout "C:\data\rs0\service.log"
& $nssmPath set $serviceName AppStderr "C:\data\rs0\service-error.log"

Write-Host ""
Write-Host "Service installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "You can manage it using:" -ForegroundColor Yellow
Write-Host "  services.msc" -ForegroundColor White
Write-Host ""
Write-Host "Or use these commands:" -ForegroundColor Yellow
Write-Host "  Start-Service $serviceName" -ForegroundColor White
Write-Host "  Stop-Service  $serviceName" -ForegroundColor White
Write-Host "  Restart-Service $serviceName" -ForegroundColor White
Write-Host ""
Write-Host "After starting the service, remember to run 'rs.initiate()' in mongosh if this is the first time." -ForegroundColor Cyan
