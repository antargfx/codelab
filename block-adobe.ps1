# =========================================================
# Adobe Internet Blocker
# =========================================================

# Admin check
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "Run PowerShell as Administrator." -ForegroundColor Red
    pause
    exit
}

Write-Host ""
Write-Host "Adobe Internet Blocker" -ForegroundColor Cyan
Write-Host ""

$AdobePaths = @(
    "C:\Program Files\Adobe",
    "C:\Program Files\Common Files\Adobe",
    "C:\Program Files (x86)\Adobe",
    "C:\Program Files (x86)\Common Files\Adobe"
)

$RulePrefix = "AdobeBlock_"
$BlockedCount = 0

foreach ($Path in $AdobePaths) {

    if (Test-Path $Path) {

        Write-Host "Scanning $Path" -ForegroundColor Yellow

        Get-ChildItem -Path $Path -Recurse -Filter *.exe -ErrorAction SilentlyContinue | ForEach-Object {

            $ExePath = $_.FullName
            $RuleName = "$RulePrefix$($_.BaseName)"

            $Exists = Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue

            if (-not $Exists) {

                try {

                    New-NetFirewallRule `
                        -DisplayName $RuleName `
                        -Direction Outbound `
                        -Program $ExePath `
                        -Action Block `
                        -Profile Any | Out-Null

                    Write-Host "Blocked $($_.Name)" -ForegroundColor Green
                    $BlockedCount++

                } catch {

                    Write-Host "Failed $($_.Name)" -ForegroundColor Red

                }

            }

        }

    }

}

Write-Host ""
Write-Host "Done. Total blocked: $BlockedCount" -ForegroundColor Cyan
pause
