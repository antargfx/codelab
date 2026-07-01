#Requires -RunAsAdministrator
<#
.SYNOPSIS
    PC Reset Script for Computer Training Centers
    Hosted on GitHub Pages — runs directly via:
    irm https://antargfx.github.io/pc-reset/PC_Reset_Training_Center_v2.ps1 | iex

.DESCRIPTION
    This is the online-hosted version of the Training Center PC Reset Script.
    It is identical to v1 with one addition: it is self-elevating.
    If not already running as Administrator, it re-launches itself elevated automatically.

    All parameters still work when called via irm | iex by setting variables
    before invoking — see the "HOW TO USE" section at the bottom of this file.

.NOTES
    Hosted at  : https://antargfx.github.io/pc-reset/PC_Reset_Training_Center_v2.ps1
    Raw URL    : https://raw.githubusercontent.com/antargfx/pc-reset/main/PC_Reset_Training_Center_v2.ps1
    Version    : 2.0 (GitHub Pages / online edition)
    Requires   : PowerShell 5.1+, Windows 10/11, Administrator
#>

# ==============================================================================
# REGION: SELF-ELEVATION
# When run via "irm ... | iex", the script runs in the current session.
# If that session is not elevated, we relaunch as Administrator automatically.
# ==============================================================================

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)) {

    Write-Host ""
    Write-Host "  [!] Not running as Administrator." -ForegroundColor Yellow
    Write-Host "  [>] Re-launching with elevated privileges..." -ForegroundColor Cyan
    Write-Host ""

    # Re-download and run the script elevated in a new PowerShell window
    $url = "https://raw.githubusercontent.com/antargfx/pc-reset/main/PC_Reset_Training_Center_v2.ps1"
    $elevatedCommand = "Set-ExecutionPolicy Bypass -Scope Process -Force; irm '$url' | iex"

    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command `"$elevatedCommand`"" `
        -Verb RunAs

    exit
}

# ==============================================================================
# ENDREGION: SELF-ELEVATION
# ==============================================================================


# ==============================================================================
# REGION: RUNTIME CONFIGURATION
# These variables replace the param() block so the script works with irm | iex.
# To customise behaviour, edit these values before hosting on GitHub.
# Or pass them as environment variables before running (see HOW TO USE below).
# ==============================================================================

# Set to $true to preview only — no deletions
$DryRun            = if ($env:RESET_DRYRUN     -eq "1") { $true } else { $false }

# Set to $true to skip confirmation prompt
$Force             = if ($env:RESET_FORCE      -eq "1") { $true } else { $false }

# Set to $true to clear Windows Event Logs
$ClearEventLogs    = if ($env:RESET_EVENTLOGS  -eq "1") { $true } else { $false }

# Set to $true to delete all saved WiFi profiles
$DeleteWiFiProfiles = if ($env:RESET_WIFI      -eq "1") { $true } else { $false }

# Set to $true to delete all VPN profiles
$DeleteVPNProfiles = if ($env:RESET_VPN        -eq "1") { $true } else { $false }

# Set to $true to clear Windows Prefetch folder
$ClearPrefetch     = if ($env:RESET_PREFETCH   -eq "1") { $true } else { $false }

# ==============================================================================
# ENDREGION: RUNTIME CONFIGURATION
# ==============================================================================


# ==============================================================================
# REGION: GLOBAL CONFIGURATION
# ==============================================================================

$ScriptVersion = "2.0"

$LogDir  = "C:\CleanupLogs"
$LogFile = Join-Path $LogDir ("Cleanup_" + (Get-Date -Format "yyyy-MM-dd_HH-mm") + ".log")

$Global:FilesDeleted   = 0
$Global:FoldersDeleted = 0
$Global:RegKeysRemoved = 0
$Global:Errors         = 0
$Global:Skipped        = 0

$ScriptStartTime = Get-Date

$ExcludedUserAccounts = @(
    "Administrator", "Default", "Default User", "Public", "All Users",
    "defaultuser0", "defaultuser100000", "WDAGUtilityAccount",
    "SYSTEM", "LocalService", "NetworkService"
)

$ProtectedRootFolders = @(
    "Windows", "Program Files", "Program Files (x86)", "ProgramData",
    "Users", "Recovery", "System Volume Information", "Boot", "EFI",
    "\$Recycle.Bin", "\$WINDOWS.~BT", "\$WinREAgent",
    "OneDriveTemp", "MSOCache", "Intel", "AMD", "NVIDIA"
)

# ==============================================================================
# ENDREGION: GLOBAL CONFIGURATION
# ==============================================================================


# ==============================================================================
# REGION: LOGGING FUNCTIONS
# ==============================================================================

function Initialize-Log {
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
    $header = @"
================================================================================
  PC RESET SCRIPT — Training Center (Online Edition)
  Version   : $ScriptVersion
  Source    : https://antargfx.github.io/pc-reset/
  Started   : $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  Computer  : $env:COMPUTERNAME
  User      : $env:USERNAME
  DryRun    : $DryRun
================================================================================
"@
    $header | Out-File -FilePath $LogFile -Encoding UTF8 -Force
    Write-Host $header -ForegroundColor Cyan
}

function Write-Log {
    param (
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR","SUCCESS","SKIP","DRY")]
        [string]$Level = "INFO"
    )
    $timestamp = Get-Date -Format "HH:mm:ss"
    $logLine   = "[$timestamp] [$Level] $Message"
    $logLine | Out-File -FilePath $LogFile -Encoding UTF8 -Append
    switch ($Level) {
        "INFO"    { Write-Host $logLine -ForegroundColor Gray }
        "WARN"    { Write-Host $logLine -ForegroundColor Yellow }
        "ERROR"   { Write-Host $logLine -ForegroundColor Red }
        "SUCCESS" { Write-Host $logLine -ForegroundColor Green }
        "SKIP"    { Write-Host $logLine -ForegroundColor DarkGray }
        "DRY"     { Write-Host $logLine -ForegroundColor Magenta }
    }
}

# ==============================================================================
# ENDREGION: LOGGING FUNCTIONS
# ==============================================================================


# ==============================================================================
# REGION: HELPER FUNCTIONS
# ==============================================================================

function Remove-ItemSafely {
    param ([string]$Path, [bool]$IsDir = $false)
    if (-not (Test-Path $Path)) { return }
    if ($DryRun) {
        Write-Log "[DRY] Would delete: $Path" -Level DRY
        if ($IsDir) { $Global:FoldersDeleted++ } else { $Global:FilesDeleted++ }
        return
    }
    try {
        if ($IsDir) {
            Remove-Item -Path $Path -Recurse -Force -ErrorAction Stop
            $Global:FoldersDeleted++
            Write-Log "Deleted folder: $Path" -Level SUCCESS
        } else {
            Remove-Item -Path $Path -Force -ErrorAction Stop
            $Global:FilesDeleted++
            Write-Log "Deleted file: $Path" -Level SUCCESS
        }
    } catch {
        $Global:Errors++
        Write-Log "FAILED: $Path — $($_.Exception.Message)" -Level ERROR
    }
}

function Remove-FolderContents {
    param ([string]$FolderPath)
    if (-not (Test-Path $FolderPath)) {
        Write-Log "Not found (skipped): $FolderPath" -Level SKIP
        $Global:Skipped++
        return
    }
    Write-Log "Clearing: $FolderPath" -Level INFO
    Get-ChildItem -Path $FolderPath -File      -Force -ErrorAction SilentlyContinue | ForEach-Object { Remove-ItemSafely -Path $_.FullName -IsDir $false }
    Get-ChildItem -Path $FolderPath -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object { Remove-ItemSafely -Path $_.FullName -IsDir $true  }
}

function Remove-RegistryValue {
    param ([string]$KeyPath, [string]$ValueName = "")
    if (-not (Test-Path $KeyPath)) { return }
    if ($DryRun) { Write-Log "[DRY] Would remove registry: $KeyPath\$ValueName" -Level DRY; $Global:RegKeysRemoved++; return }
    try {
        if ($ValueName -ne "") { Remove-ItemProperty -Path $KeyPath -Name $ValueName -Force -ErrorAction Stop }
        else                   { Remove-Item         -Path $KeyPath -Recurse -Force -ErrorAction Stop }
        $Global:RegKeysRemoved++
        Write-Log "Registry removed: $KeyPath $ValueName" -Level SUCCESS
    } catch {
        $Global:Errors++
        Write-Log "Registry FAILED: $KeyPath — $($_.Exception.Message)" -Level ERROR
    }
}

function Get-LocalUserProfiles {
    $profiles = @()
    Get-ChildItem -Path "C:\Users" -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
        if ($ExcludedUserAccounts -notcontains $_.Name) { $profiles += $_.FullName }
        else { Write-Log "Skipping system account: $($_.Name)" -Level SKIP }
    }
    return $profiles
}

function Write-SectionHeader {
    param ([string]$Title)
    $line = "=" * 70
    Write-Log "`n$line`n  $Title`n$line" -Level INFO
}

# ==============================================================================
# ENDREGION: HELPER FUNCTIONS
# ==============================================================================


# ==============================================================================
# REGION: ALL 18 CLEANUP STEPS
# ==============================================================================

function Clear-UserProfileFiles {
    Write-SectionHeader "STEP 1: Clear User Profile Files"
    $folders = @("Desktop","Documents","Downloads","Pictures","Videos","Music","Favorites",
                 "Links","Saved Games","Contacts","Searches","3D Objects","OneDrive",
                 "OneDrive - Personal","AppData\Local\Microsoft\OneDrive")
    foreach ($profile in (Get-LocalUserProfiles)) {
        foreach ($folder in $folders) { Remove-FolderContents -FolderPath "$profile\$folder" }
    }
}

function Clear-RecycleBin {
    Write-SectionHeader "STEP 2: Empty Recycle Bin"
    if ($DryRun) { Write-Log "[DRY] Would empty Recycle Bin." -Level DRY; return }
    try { Clear-RecycleBin -Force -ErrorAction Stop; Write-Log "Recycle Bin emptied." -Level SUCCESS }
    catch {
        Get-PSDrive -PSProvider FileSystem | ForEach-Object {
            $bin = "$($_.Root)`$Recycle.Bin"
            if (Test-Path $bin) {
                Get-ChildItem -Path $bin -Force -ErrorAction SilentlyContinue |
                ForEach-Object { Remove-ItemSafely -Path $_.FullName -IsDir ($_.PSIsContainer) }
            }
        }
    }
}

function Clear-TempFiles {
    Write-SectionHeader "STEP 3: Delete Temporary Files"
    Remove-FolderContents "C:\Windows\Temp"
    Remove-FolderContents $env:TEMP
    foreach ($p in (Get-LocalUserProfiles)) {
        Remove-FolderContents "$p\AppData\Local\Temp"
        Remove-FolderContents "$p\AppData\Local\Microsoft\Windows\INetCache"
        Remove-FolderContents "$p\AppData\Local\Microsoft\Windows\INetCookies"
        Remove-FolderContents "$p\AppData\Local\Microsoft\Windows\Explorer"
    }
    Remove-FolderContents "C:\ProgramData\Microsoft\Windows\WER\ReportArchive"
    Remove-FolderContents "C:\ProgramData\Microsoft\Windows\WER\ReportQueue"
    @("C:\Windows\MEMORY.DMP","C:\Windows\Minidump") | ForEach-Object {
        if (Test-Path $_) { Remove-ItemSafely -Path $_ -IsDir (Test-Path $_ -PathType Container) }
    }
    Remove-FolderContents "C:\Windows\SoftwareDistribution\Download"
    Remove-FolderContents "C:\Windows\SoftwareDistribution\DeliveryOptimization"
    Remove-FolderContents "C:\Windows\LiveKernelReports"
    Remove-FolderContents "C:\Windows\Logs\CBS"
    if ($ClearPrefetch) { Remove-FolderContents "C:\Windows\Prefetch" }
    else { Write-Log "Prefetch skipped (set RESET_PREFETCH=1 to enable)." -Level SKIP }
}

function Clear-RecentItems {
    Write-SectionHeader "STEP 4: Clear Recent Items"
    foreach ($p in (Get-LocalUserProfiles)) {
        Remove-FolderContents "$p\AppData\Roaming\Microsoft\Windows\Recent"
        Remove-FolderContents "$p\AppData\Roaming\Microsoft\Windows\Recent\AutomaticDestinations"
        Remove-FolderContents "$p\AppData\Roaming\Microsoft\Windows\Recent\CustomDestinations"
    }
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\RunMRU"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\TypedPaths"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\WordWheelQuery"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComDlg32\LastVisitedPidlMRU"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComDlg32\OpenSavePidlMRU"
}

function Clear-BrowserData {
    Write-SectionHeader "STEP 5: Clear Browser Data"
    foreach ($profile in (Get-LocalUserProfiles)) {

        # Chromium-based browsers
        $chromiumBrowsers = @{
            "Google Chrome"  = "$profile\AppData\Local\Google\Chrome\User Data"
            "Microsoft Edge" = "$profile\AppData\Local\Microsoft\Edge\User Data"
            "Brave"          = "$profile\AppData\Local\BraveSoftware\Brave-Browser\User Data"
            "Opera"          = "$profile\AppData\Roaming\Opera Software\Opera Stable"
            "Opera GX"       = "$profile\AppData\Roaming\Opera Software\Opera GX Stable"
            "Vivaldi"        = "$profile\AppData\Local\Vivaldi\User Data"
        }
        foreach ($browser in $chromiumBrowsers.GetEnumerator()) {
            if (-not (Test-Path $browser.Value)) { Write-Log "$($browser.Key) not found." -Level SKIP; continue }
            Write-Log "Clearing $($browser.Key)..." -Level INFO
            Get-ChildItem -Path $browser.Value -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match "^(Default|Profile \d+|Guest Profile)$" } |
            ForEach-Object {
                $chromiumItems = @("History","History-journal","Cookies","Cookies-journal","Cache","Code Cache",
                    "GPUCache","Login Data","Login Data For Account","Login Data-journal","Bookmarks","Bookmarks.bak",
                    "Sessions","Extension State","Local Storage","Session Storage","IndexedDB","databases",
                    "Web Data","Web Data-journal","Shortcuts","Download Service","Network Action Predictor",
                    "Visited Links","Last Session","Last Tabs","Current Session","Current Tabs","Preferences")
                foreach ($item in $chromiumItems) {
                    $itemPath = Join-Path $_.FullName $item
                    if (Test-Path $itemPath) { Remove-ItemSafely -Path $itemPath -IsDir ((Get-Item $itemPath -Force).PSIsContainer) }
                }
            }
            @("ShaderCache","GrShaderCache","Crashpad","SafeBrowsing") | ForEach-Object {
                $p2 = Join-Path $browser.Value $_
                if (Test-Path $p2) { Remove-ItemSafely -Path $p2 -IsDir $true }
            }
        }

        # Firefox
        $ffRoot = "$profile\AppData\Roaming\Mozilla\Firefox\Profiles"
        if (Test-Path $ffRoot) {
            Get-ChildItem -Path $ffRoot -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
                $ffItems = @("places.sqlite","places.sqlite-wal","places.sqlite-shm","cookies.sqlite",
                    "cookies.sqlite-wal","cookies.sqlite-shm","formhistory.sqlite","logins.json","key4.db",
                    "cert9.db","sessionstore.jsonlz4","sessionstore-backups","cache2","startupCache",
                    "thumbnails","weave","datareporting","storage","webappsstore.sqlite",
                    "content-prefs.sqlite","permissions.sqlite","favicons.sqlite")
                foreach ($item in $ffItems) {
                    $ip = Join-Path $_.FullName $item
                    if (Test-Path $ip) { Remove-ItemSafely -Path $ip -IsDir ((Get-Item $ip -Force).PSIsContainer) }
                }
            }
        } else { Write-Log "Firefox not found." -Level SKIP }
    }
}

function Clear-OfficeHistory {
    Write-SectionHeader "STEP 6: Clear Microsoft Office History"
    $versions = @("16.0","15.0","14.0")
    $apps = @("Word","Excel","PowerPoint","Access","Publisher","OneNote","Outlook","Visio","Project")
    foreach ($ver in $versions) {
        foreach ($app in $apps) {
            Remove-RegistryValue "HKCU:\Software\Microsoft\Office\$ver\$app\File MRU"
            Remove-RegistryValue "HKCU:\Software\Microsoft\Office\$ver\$app\Place MRU"
        }
        Remove-RegistryValue "HKCU:\Software\Microsoft\Office\$ver\Common\File MRU"
        Remove-RegistryValue "HKCU:\Software\Microsoft\Office\$ver\Common\Open Find"
    }
    foreach ($p in (Get-LocalUserProfiles)) {
        Remove-FolderContents "$p\AppData\Local\Microsoft\Office\16.0\OfficeFileCache"
        Remove-FolderContents "$p\AppData\Local\Microsoft\Office\UnsavedFiles"
        Remove-FolderContents "$p\AppData\Local\Microsoft\Windows\INetCache\Content.Outlook"
        Remove-FolderContents "$p\AppData\Local\Microsoft\OneNote"
    }
}

function Clear-MediaHistory {
    Write-SectionHeader "STEP 7: Clear Media App History"
    Remove-RegistryValue "HKCU:\Software\Microsoft\MediaPlayer\Player\RecentFileList"
    Remove-RegistryValue "HKCU:\Software\Microsoft\MediaPlayer\Player\RecentURLList"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Notepad"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Applets\Wordpad\Recent File List"
    foreach ($p in (Get-LocalUserProfiles)) {
        Remove-FolderContents "$p\AppData\Local\Microsoft\Media Player"
        Remove-FolderContents "$p\AppData\Local\Packages\Microsoft.Windows.Photos_8wekyb3d8bbwe\LocalState"
    }
}

function Clear-WindowsSearchHistory {
    Write-SectionHeader "STEP 8: Clear Windows Search History"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Search"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\WordWheelQuery"
    foreach ($p in (Get-LocalUserProfiles)) {
        Remove-FolderContents "$p\AppData\Local\Packages\Microsoft.Windows.Search_cw5n1h2txyewy\LocalState\AppIconCache"
        Remove-FolderContents "$p\AppData\Local\Packages\Microsoft.Windows.Cortana_cw5n1h2txyewy\LocalState"
    }
}

function Clear-ClipboardContents {
    Write-SectionHeader "STEP 9: Clear Clipboard"
    if ($DryRun) { Write-Log "[DRY] Would clear clipboard." -Level DRY; return }
    try {
        Set-Clipboard -Value $null -ErrorAction SilentlyContinue
        cmd /c "echo off | clip" 2>$null
        Remove-RegistryValue "HKCU:\Software\Microsoft\Clipboard"
        Write-Log "Clipboard cleared." -Level SUCCESS
    } catch { $Global:Errors++; Write-Log "Clipboard failed: $($_.Exception.Message)" -Level ERROR }
}

function Clear-NetworkHistory {
    Write-SectionHeader "STEP 10: Clear Network History"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComputerDescriptions"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Map Network Drive MRU"
    if (-not $DryRun) {
        Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayRoot -like "\\*" } |
        ForEach-Object { net use "$($_.Name):" /delete /y 2>$null }
    }
    Remove-FolderContents "$env:APPDATA\Microsoft\Windows\Network Shortcuts"
    if ($DeleteWiFiProfiles -and -not $DryRun) {
        netsh wlan show profiles | Select-String "All User Profile" |
        ForEach-Object { netsh wlan delete profile name="$(($_ -split ':')[1].Trim())" 2>$null }
    } else { Write-Log "WiFi profiles skipped (set RESET_WIFI=1 to enable)." -Level SKIP }
    if ($DeleteVPNProfiles -and -not $DryRun) {
        Get-VpnConnection -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-VpnConnection -Name $_.Name -Force -ErrorAction SilentlyContinue }
    } else { Write-Log "VPN profiles skipped (set RESET_VPN=1 to enable)." -Level SKIP }
}

function Clear-EventLogs {
    Write-SectionHeader "STEP 11: Clear Windows Event Logs"
    if (-not $ClearEventLogs) { Write-Log "Event logs skipped (set RESET_EVENTLOGS=1 to enable)." -Level SKIP; return }
    if ($DryRun) { Write-Log "[DRY] Would clear all Event Logs." -Level DRY; return }
    Get-EventLog -List -ErrorAction SilentlyContinue | ForEach-Object {
        try { Clear-EventLog -LogName $_.Log -ErrorAction Stop; Write-Log "Cleared: $($_.Log)" -Level SUCCESS }
        catch { Write-Log "Could not clear: $($_.Log)" -Level WARN }
    }
    wevtutil el 2>$null | ForEach-Object { wevtutil cl "$_" 2>$null }
}

function Clear-WindowsStoreCache {
    Write-SectionHeader "STEP 12: Clear Windows Store Cache"
    if ($DryRun) { Write-Log "[DRY] Would run wsreset and delete Store cache." -Level DRY; return }
    $ws = "C:\Windows\System32\wsreset.exe"
    if (Test-Path $ws) {
        try { Start-Process $ws -WindowStyle Hidden -Wait; Write-Log "wsreset complete." -Level SUCCESS }
        catch { Write-Log "wsreset failed: $($_.Exception.Message)" -Level WARN }
    }
    foreach ($p in (Get-LocalUserProfiles)) {
        Remove-FolderContents "$p\AppData\Local\Packages\WinStore_cw5n1h2txyewy\LocalCache"
        Remove-FolderContents "$p\AppData\Local\Packages\Microsoft.WindowsStore_8wekyb3d8bbwe\LocalCache"
    }
}

function Clear-PersonalizationHistory {
    Write-SectionHeader "STEP 13: Clear Personalization History"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Wallpapers"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes" "ThemeMRU"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Accent"
    foreach ($p in (Get-LocalUserProfiles)) {
        Remove-FolderContents "$p\AppData\Local\Packages\Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy\LocalState\Assets"
        Remove-FolderContents "$p\AppData\Roaming\Microsoft\Windows\AccountPictures"
    }
}

function Clear-CRootUserFiles {
    Write-SectionHeader "STEP 14: Clear User Files from C:\ Root"
    Get-ChildItem -Path "C:\" -Force -ErrorAction SilentlyContinue | ForEach-Object {
        if ($ProtectedRootFolders | Where-Object { $_.Name -ieq $_ }) {
            Write-Log "Protected — skipping: C:\$($_.Name)" -Level SKIP
        } else {
            Remove-ItemSafely -Path $_.FullName -IsDir ($_.PSIsContainer)
        }
    }
}

function Clear-StartupFolders {
    Write-SectionHeader "STEP 15: Clear Startup Folders"
    Remove-FolderContents ([System.Environment]::GetFolderPath("CommonStartup"))
    foreach ($p in (Get-LocalUserProfiles)) {
        Remove-FolderContents "$p\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup"
    }
}

function Clear-UserShortcuts {
    Write-SectionHeader "STEP 16: Delete Custom Shortcuts"
    foreach ($p in (Get-LocalUserProfiles)) {
        Get-ChildItem "$p\Desktop" -Include "*.lnk","*.url" -Force -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-ItemSafely -Path $_.FullName -IsDir $false }
        Get-ChildItem "$p\AppData\Roaming\Microsoft\Windows\Start Menu" -Include "*.lnk","*.url" -Recurse -Force -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-ItemSafely -Path $_.FullName -IsDir $false }
    }
}

function Clear-CommandHistory {
    Write-SectionHeader "STEP 17: Clear Command History"
    foreach ($p in (Get-LocalUserProfiles)) {
        Remove-ItemSafely "$p\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt" $false
        Remove-FolderContents "$p\AppData\Local\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState"
        Remove-FolderContents "$p\AppData\Local\Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState"
    }
    if (-not $DryRun) { doskey /reinstall 2>$null }
}

function Clear-RegistryMRU {
    Write-SectionHeader "STEP 18: Clear Registry MRU Entries"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\RecentDocs"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\RunMRU"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Internet Explorer\TypedURLs"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Internet Explorer\TypedURLsTime"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComDlg32\LastVisitedPidlMRU"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComDlg32\LastVisitedPidlMRULegacy"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComDlg32\OpenSavePidlMRU"
    Remove-RegistryValue "HKCU:\Software\Microsoft\MediaPlayer\Player\RecentFileList"
    Remove-RegistryValue "HKCU:\Software\Microsoft\MediaPlayer\Player\RecentURLList"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\TypedPaths"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Map Network Drive MRU"
    Remove-RegistryValue "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist"
}

# ==============================================================================
# ENDREGION: ALL 18 CLEANUP STEPS
# ==============================================================================


# ==============================================================================
# REGION: PRE-FLIGHT, CONFIRMATION, SUMMARY
# ==============================================================================

function Show-PreflightInfo {
    $modeText = if ($DryRun) { "DRY RUN (no changes)" } else { "LIVE RUN (files WILL be deleted)" }
    Write-Host ""
    Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║  PC RESET — Training Center   (Online Edition v$ScriptVersion)          ║" -ForegroundColor Cyan
    Write-Host "║  Source: https://antargfx.github.io/pc-reset/                   ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Mode     : " -NoNewline; Write-Host $modeText -ForegroundColor Yellow
    Write-Host "  Computer : $env:COMPUTERNAME"
    Write-Host "  Log File : $LogFile"
    Write-Host ""
    Write-Host "  ⚠  Installed software, Windows, and drivers will NOT be touched." -ForegroundColor Green
    Write-Host ""
}

function Request-Confirmation {
    if ($Force) { Write-Log "Force mode — skipping confirmation." -Level INFO; return $true }
    Write-Host "  Type YES to confirm and run the cleanup: " -ForegroundColor Yellow -NoNewline
    $answer = Read-Host
    if ($answer -ne "YES") {
        Write-Host "`n  Cancelled. No changes were made." -ForegroundColor Red
        Write-Log "Cancelled by user." -Level WARN
        return $false
    }
    return $true
}

function Show-Summary {
    $elapsed    = (Get-Date) - $ScriptStartTime
    $elapsedStr = "{0:D2}:{1:D2}:{2:D2}" -f $elapsed.Hours, $elapsed.Minutes, $elapsed.Seconds
    $summary = @"

================================================================================
  CLEANUP SUMMARY
================================================================================
  Files Deleted   : $($Global:FilesDeleted)
  Folders Deleted : $($Global:FoldersDeleted)
  Registry Keys   : $($Global:RegKeysRemoved)
  Skipped         : $($Global:Skipped)
  Errors          : $($Global:Errors)
  Elapsed Time    : $elapsedStr
  Log File        : $LogFile
  Mode            : $(if($DryRun){'DRY RUN — No changes made'}else{'LIVE — Cleanup complete'})
================================================================================
"@
    Write-Host $summary -ForegroundColor Cyan
    $summary | Out-File -FilePath $LogFile -Encoding UTF8 -Append
}

# ==============================================================================
# ENDREGION
# ==============================================================================


# ==============================================================================
# REGION: MAIN
# ==============================================================================

Initialize-Log
Show-PreflightInfo
if (-not (Request-Confirmation)) { exit 0 }

Write-Log "Starting cleanup. Mode: $(if($DryRun){'DRY RUN'}else{'LIVE'})" -Level INFO

Clear-UserProfileFiles
Clear-RecycleBin
Clear-TempFiles
Clear-RecentItems
Clear-BrowserData
Clear-OfficeHistory
Clear-MediaHistory
Clear-WindowsSearchHistory
Clear-ClipboardContents
Clear-NetworkHistory
Clear-EventLogs
Clear-WindowsStoreCache
Clear-PersonalizationHistory
Clear-CRootUserFiles
Clear-StartupFolders
Clear-UserShortcuts
Clear-CommandHistory
Clear-RegistryMRU

Show-Summary
Write-Log "Script finished." -Level SUCCESS
exit 0

# ==============================================================================
# ENDREGION: MAIN
# ==============================================================================


<#
================================================================================
  HOW TO USE — ONLINE EDITION
================================================================================

STEP 1: Push this file to your GitHub repo
  - Repo  : github.com/antargfx/pc-reset
  - File  : PC_Reset_Training_Center_v2.ps1
  - Branch: main

STEP 2: Open PowerShell as Administrator on the target PC

STEP 3: Run one of these commands:

  ── Standard run (with confirmation prompt): ──────────────────────────────────
  irm https://raw.githubusercontent.com/antargfx/pc-reset/main/PC_Reset_Training_Center_v2.ps1 | iex

  ── Dry run (preview only, no deletions): ────────────────────────────────────
  $env:RESET_DRYRUN="1"; irm https://raw.githubusercontent.com/antargfx/pc-reset/main/PC_Reset_Training_Center_v2.ps1 | iex

  ── Silent full run (no prompt, all optional steps on): ──────────────────────
  $env:RESET_FORCE="1"; $env:RESET_EVENTLOGS="1"; $env:RESET_WIFI="1"; irm https://raw.githubusercontent.com/antargfx/pc-reset/main/PC_Reset_Training_Center_v2.ps1 | iex

ENVIRONMENT VARIABLES (optional flags):
  $env:RESET_DRYRUN    = "1"   → preview only, no deletions
  $env:RESET_FORCE     = "1"   → skip confirmation prompt
  $env:RESET_EVENTLOGS = "1"   → clear Windows Event Logs
  $env:RESET_WIFI      = "1"   → delete saved WiFi profiles
  $env:RESET_VPN       = "1"   → delete VPN profiles
  $env:RESET_PREFETCH  = "1"   → clear Windows Prefetch

NOTE: GitHub Pages serves the rendered site. For raw .ps1 downloads,
always use raw.githubusercontent.com (not antargfx.github.io).
================================================================================
#>
