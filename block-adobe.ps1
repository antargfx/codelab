# =========================================================
# Adobe Internet Blocker (Auto Detect Version)
# Automatically detects Adobe installations on ALL drives
# Blocks all Adobe executables using Windows Firewall
# =========================================================

# =========================
# ADMIN CHECK
# =========================

$isAdmin = ([Security.Principal.WindowsPrincipal]
    [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host ""
    Write-Host "ERROR: Run this script as Administrator." -ForegroundColor Red
    Pause
    exit
}

# =========================
# SETTINGS
# =========================

$RulePrefix = "AdobeBlock_"
$BlockedCount = 0
$ScannedEXE = 0

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " Adobe Internet Blocker (Auto Detect)" -ForegroundColor Yellow
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# =========================
# GET ALL DRIVES
# =========================

$Drives = Get-PSDrive -PSProvider FileSystem

# =========================
# FIND ADOBE FOLDERS
# =========================

$AdobeFolders = @()

foreach ($Drive in $Drives) {

    Write-Host "Scanning Drive: $($Drive.Root)" -ForegroundColor Green

    try {

        $Folders = Get-ChildItem `
            -Path $Drive.Root `
            -Directory `
            -Recurse `
            -ErrorAction SilentlyContinue | Where-Object {

                $_.FullName -match "Adobe"
            }

        $AdobeFolders += $Folders

    }
    catch {
        # Ignore inaccessible folders
    }
}

# Remove duplicates
$AdobeFolders = $AdobeFolders | Select-Object -Unique

# =========================
# NO ADOBE FOUND
# =========================

if ($AdobeFolders.Count -eq 0) {

    Write-Host ""
    Write-Host "No Adobe installation detected." -ForegroundColor Red
    Write-Host ""

    Pause
    exit
}

# =========================
# BLOCK EXECUTABLES
# =========================

foreach ($Folder in $AdobeFolders) {

    Write-Host ""
    Write-Host "Found Adobe Folder:" -ForegroundColor Cyan
    Write-Host $Folder.FullName -ForegroundColor White

    try {

        Get-ChildItem `
            -Path $Folder.FullName `
            -Filter *.exe `
            -Recurse `
            -ErrorAction SilentlyContinue | ForEach-Object {

                $ScannedEXE++

                $ExePath = $_.FullName

                # Safe firewall rule name
                $SafeName = $_.BaseName -replace '[^a-zA-Z0-9]', '_'
                $RuleName = "$RulePrefix$SafeName"

                # Skip existing rules
                $ExistingRule = Get-NetFirewallRule `
                    -DisplayName $RuleName `
                    -ErrorAction SilentlyContinue

                if (-not $ExistingRule) {

                    try {

                        New-NetFirewallRule `
                            -DisplayName $RuleName `
                            -Direction Outbound `
                            -Program $ExePath `
                            -Action Block `
                            -Profile Any | Out-Null

                        Write-Host "BLOCKED: $($_.Name)" -ForegroundColor Yellow
                        $BlockedCount++

                    }
                    catch {

                        Write-Host "FAILED: $($_.Name)" -ForegroundColor Red

                    }

                }
                else {

                    Write-Host "Already Blocked: $($_.Name)" -ForegroundColor DarkGray

                }

            }

    }
    catch {
        # Ignore inaccessible subfolders
    }

}

# =========================
# FINISHED
# =========================

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host " Scan Complete" -ForegroundColor Green
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Executables Scanned : $ScannedEXE" -ForegroundColor White
Write-Host "Programs Blocked    : $BlockedCount" -ForegroundColor Yellow
Write-Host ""

Pause
