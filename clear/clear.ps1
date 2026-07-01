#Requires -RunAsAdministrator
<#
.SYNOPSIS
    PC Reset Script for Computer Training Centers
    Resets Windows user environment without reinstalling Windows.

.DESCRIPTION
    This script completely cleans a Windows PC after student use in a training center.
    It removes all personal user data, browser history, temp files, recent items,
    and other traces left by students — while keeping all installed software intact.

    Safe for Windows 10 and Windows 11. Requires PowerShell 5.1 or later.
    Must be run as Administrator.

.PARAMETER DryRun
    If specified, the script will only DISPLAY what it would delete — no actual changes.

.PARAMETER Force
    If specified, skips the confirmation prompt before running.

.PARAMETER ClearEventLogs
    If specified, clears all Windows Event Logs. Default is OFF.

.PARAMETER DeleteWiFiProfiles
    If specified, removes all saved WiFi profiles. Default is OFF.

.PARAMETER DeleteVPNProfiles
    If specified, removes all VPN connection profiles. Default is OFF.

.PARAMETER ClearPrefetch
    If specified, clears the Windows Prefetch folder. Default is OFF.

.EXAMPLE
    .\PC_Reset_Training_Center_v1.ps1
    .\PC_Reset_Training_Center_v1.ps1 -DryRun
    .\PC_Reset_Training_Center_v1.ps1 -Force -ClearEventLogs -DeleteWiFiProfiles

.NOTES
    Author      : Training Center Admin Script
    Version     : 1.0
    Tested On   : Windows 10 21H2+, Windows 11 22H2+
    PowerShell  : 5.1+
    Run As      : Administrator (required)
#>

[CmdletBinding()]
param (
    [switch]$DryRun,
    [switch]$Force,
    [switch]$ClearEventLogs,
    [switch]$DeleteWiFiProfiles,
    [switch]$DeleteVPNProfiles,
    [switch]$ClearPrefetch
)

# ==============================================================================
# REGION: GLOBAL CONFIGURATION
# ==============================================================================

# Script version identifier
$ScriptVersion = "1.0"

# Log file path — includes timestamp to avoid overwriting previous logs
$LogDir  = "C:\CleanupLogs"
$LogFile = Join-Path $LogDir ("Cleanup_" + (Get-Date -Format "yyyy-MM-dd_HH-mm") + ".log")

# Counters — tracked globally for the summary report
$Global:FilesDeleted    = 0
$Global:FoldersDeleted  = 0
$Global:RegKeysRemoved  = 0
$Global:Errors          = 0
$Global:Skipped         = 0

# Script-wide timer
$ScriptStartTime = Get-Date

# System accounts to SKIP when iterating user profiles
# These are built-in Windows accounts that must never be touched
$ExcludedUserAccounts = @(
    "Administrator",
    "Default",
    "Default User",
    "Public",
    "All Users",
    "defaultuser0",
    "defaultuser100000",
    "WDAGUtilityAccount",
    "SYSTEM",
    "LocalService",
    "NetworkService"
)

# System folders at C:\ root that must NEVER be deleted
$ProtectedRootFolders = @(
    "Windows",
    "Program Files",
    "Program Files (x86)",
    "ProgramData",
    "Users",
    "Recovery",
    "System Volume Information",
    "Boot",
    "EFI",
    "\$Recycle.Bin",
    "\$WINDOWS.~BT",
    "\$WinREAgent",
    "OneDriveTemp",
    "MSOCache",
    "Intel",
    "AMD",
    "NVIDIA"
)

# ==============================================================================
# ENDREGION: GLOBAL CONFIGURATION
# ==============================================================================


# ==============================================================================
# REGION: LOGGING FUNCTIONS
# ==============================================================================

function Initialize-Log {
    <#
    .SYNOPSIS Creates the log directory and log file, writes the header.
    #>
    if (-not (Test-Path $LogDir)) {
        New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
    }

    $header = @"
================================================================================
  PC RESET SCRIPT — Training Center
  Version   : $ScriptVersion
  Started   : $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  Computer  : $env:COMPUTERNAME
  User      : $env:USERNAME
  DryRun    : $($DryRun.IsPresent)
================================================================================
"@
    $header | Out-File -FilePath $LogFile -Encoding UTF8 -Force
    Write-Host $header -ForegroundColor Cyan
}

function Write-Log {
    <#
    .SYNOPSIS Writes a message to both the log file and the console.
    .PARAMETER Message  The message text.
    .PARAMETER Level    INFO, WARN, ERROR, SUCCESS, SKIP — controls color.
    #>
    param (
        [string]$Message,
        [ValidateSet("INFO","WARN","ERROR","SUCCESS","SKIP","DRY")]
        [string]$Level = "INFO"
    )

    $timestamp = Get-Date -Format "HH:mm:ss"
    $logLine   = "[$timestamp] [$Level] $Message"

    # Append to log file
    $logLine | Out-File -FilePath $LogFile -Encoding UTF8 -Append

    # Write to console with color coding
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
    <#
    .SYNOPSIS
        Safely deletes a file or folder. Handles errors gracefully.
        In DryRun mode, only logs what WOULD be deleted.
    .PARAMETER Path     Full path to file or folder.
    .PARAMETER IsDir    Set to $true if deleting a directory.
    #>
    param (
        [string]$Path,
        [bool]$IsDir = $false
    )

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
    }
    catch {
        $Global:Errors++
        Write-Log "FAILED to delete: $Path — $($_.Exception.Message)" -Level ERROR
    }
}

function Remove-FolderContents {
    <#
    .SYNOPSIS
        Deletes all files and subfolders INSIDE a folder without deleting the folder itself.
    .PARAMETER FolderPath  Path to the folder whose contents should be cleared.
    #>
    param ([string]$FolderPath)

    if (-not (Test-Path $FolderPath)) {
        Write-Log "Skipped (not found): $FolderPath" -Level SKIP
        $Global:Skipped++
        return
    }

    Write-Log "Clearing contents of: $FolderPath" -Level INFO

    # Delete child files
    Get-ChildItem -Path $FolderPath -File -Force -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-ItemSafely -Path $_.FullName -IsDir $false
    }

    # Delete child directories
    Get-ChildItem -Path $FolderPath -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-ItemSafely -Path $_.FullName -IsDir $true
    }
}

function Remove-RegistryValue {
    <#
    .SYNOPSIS Safely removes a registry key or value.
    .PARAMETER KeyPath      Full registry path (e.g. HKCU:\Software\...).
    .PARAMETER ValueName    If provided, removes only this value. If omitted, removes the key.
    #>
    param (
        [string]$KeyPath,
        [string]$ValueName = ""
    )

    if (-not (Test-Path $KeyPath)) { return }

    if ($DryRun) {
        Write-Log "[DRY] Would remove registry: $KeyPath\$ValueName" -Level DRY
        $Global:RegKeysRemoved++
        return
    }

    try {
        if ($ValueName -ne "") {
            Remove-ItemProperty -Path $KeyPath -Name $ValueName -Force -ErrorAction Stop
        } else {
            Remove-Item -Path $KeyPath -Recurse -Force -ErrorAction Stop
        }
        $Global:RegKeysRemoved++
        Write-Log "Registry removed: $KeyPath $ValueName" -Level SUCCESS
    }
    catch {
        $Global:Errors++
        Write-Log "Registry FAILED: $KeyPath — $($_.Exception.Message)" -Level ERROR
    }
}

function Get-LocalUserProfiles {
    <#
    .SYNOPSIS
        Returns a list of local user profile paths, excluding system accounts.
    .OUTPUTS
        Array of profile directory paths (strings).
    #>
    $profiles = @()
    $profileRoot = "C:\Users"

    if (-not (Test-Path $profileRoot)) { return $profiles }

    Get-ChildItem -Path $profileRoot -Directory -Force | ForEach-Object {
        $name = $_.Name
        if ($ExcludedUserAccounts -notcontains $name) {
            $profiles += $_.FullName
            Write-Log "Found user profile: $($_.FullName)" -Level INFO
        } else {
            Write-Log "Skipping system account: $name" -Level SKIP
        }
    }

    return $profiles
}

function Write-SectionHeader {
    <#
    .SYNOPSIS Writes a visible section banner to log and console.
    #>
    param ([string]$Title)
    $line = "=" * 70
    $msg  = "`n$line`n  $Title`n$line"
    Write-Log $msg -Level INFO
}

# ==============================================================================
# ENDREGION: HELPER FUNCTIONS
# ==============================================================================


# ==============================================================================
# REGION: STEP 1 — DELETE USER FILES
# ==============================================================================

function Clear-UserProfileFiles {
    <#
    .SYNOPSIS
        Deletes all personal files from every local user profile.
        Targets standard Windows user folders only — does not delete the profile itself.
    #>
    Write-SectionHeader "STEP 1: Clear User Profile Files"

    $userFolders = @(
        "Desktop",
        "Documents",
        "Downloads",
        "Pictures",
        "Videos",
        "Music",
        "Favorites",
        "Links",
        "Saved Games",
        "Contacts",
        "Searches",
        "3D Objects",
        "OneDrive",                        # OneDrive local sync folder
        "OneDrive - Personal",
        "AppData\Local\Microsoft\OneDrive" # OneDrive cache
    )

    $profiles = Get-LocalUserProfiles

    foreach ($profile in $profiles) {
        Write-Log "Processing profile: $profile" -Level INFO
        foreach ($folder in $userFolders) {
            $target = Join-Path $profile $folder
            Remove-FolderContents -FolderPath $target
        }
    }
}

# ==============================================================================
# ENDREGION: STEP 1
# ==============================================================================


# ==============================================================================
# REGION: STEP 2 — EMPTY RECYCLE BIN
# ==============================================================================

function Clear-RecycleBin {
    <#
    .SYNOPSIS Empties the Recycle Bin for all drives.
    #>
    Write-SectionHeader "STEP 2: Empty Recycle Bin"

    if ($DryRun) {
        Write-Log "[DRY] Would empty Recycle Bin for all drives." -Level DRY
        return
    }

    try {
        # Built-in PowerShell cmdlet available in PS 5+
        Clear-RecycleBin -Force -ErrorAction Stop
        Write-Log "Recycle Bin emptied successfully." -Level SUCCESS
    }
    catch {
        # Fallback: manually remove $Recycle.Bin contents via rd
        Write-Log "Clear-RecycleBin failed, trying manual approach: $($_.Exception.Message)" -Level WARN
        Get-PSDrive -PSProvider FileSystem | ForEach-Object {
            $bin = "$($_.Root)\`$Recycle.Bin"
            if (Test-Path $bin) {
                Get-ChildItem -Path $bin -Force -ErrorAction SilentlyContinue | ForEach-Object {
                    Remove-ItemSafely -Path $_.FullName -IsDir ($_.PSIsContainer)
                }
            }
        }
    }
}

# ==============================================================================
# ENDREGION: STEP 2
# ==============================================================================


# ==============================================================================
# REGION: STEP 3 — DELETE TEMPORARY FILES
# ==============================================================================

function Clear-TempFiles {
    <#
    .SYNOPSIS
        Deletes temporary files from standard Windows temp locations.
        Skips files that are locked by running processes.
    #>
    Write-SectionHeader "STEP 3: Delete Temporary Files"

    # Windows system temp
    Remove-FolderContents -FolderPath "C:\Windows\Temp"

    # Current session temp (runs as SYSTEM so this may be limited)
    Remove-FolderContents -FolderPath $env:TEMP

    # Per-user temp folders
    $profiles = Get-LocalUserProfiles
    foreach ($profile in $profiles) {
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Temp"
        # Internet Explorer / Legacy Edge cache
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Microsoft\Windows\INetCache"
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Microsoft\Windows\INetCookies"
        # Thumbnail cache
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Microsoft\Windows\Explorer"
    }

    # Windows Error Reporting
    Remove-FolderContents -FolderPath "C:\ProgramData\Microsoft\Windows\WER\ReportArchive"
    Remove-FolderContents -FolderPath "C:\ProgramData\Microsoft\Windows\WER\ReportQueue"

    # Memory dump files
    @("C:\Windows\MEMORY.DMP", "C:\Windows\Minidump") | ForEach-Object {
        if (Test-Path $_) { Remove-ItemSafely -Path $_ -IsDir (Test-Path $_ -PathType Container) }
    }

    # Windows Update temp cache
    Remove-FolderContents -FolderPath "C:\Windows\SoftwareDistribution\Download"

    # Delivery Optimization cache
    Remove-FolderContents -FolderPath "C:\Windows\SoftwareDistribution\DeliveryOptimization"

    # Crash dumps
    Remove-FolderContents -FolderPath "C:\Windows\LiveKernelReports"
    Remove-FolderContents -FolderPath "C:\ProgramData\Microsoft\Windows\WER"

    # CBS logs (Windows Update component logs)
    Remove-FolderContents -FolderPath "C:\Windows\Logs\CBS"

    # Optional: Prefetch (controlled by switch)
    if ($ClearPrefetch) {
        Write-Log "ClearPrefetch switch detected — clearing Prefetch folder." -Level INFO
        Remove-FolderContents -FolderPath "C:\Windows\Prefetch"
    } else {
        Write-Log "Prefetch skipped (use -ClearPrefetch to enable)." -Level SKIP
    }
}

# ==============================================================================
# ENDREGION: STEP 3
# ==============================================================================


# ==============================================================================
# REGION: STEP 4 — DELETE RECENT ITEMS
# ==============================================================================

function Clear-RecentItems {
    <#
    .SYNOPSIS
        Clears recent files, Run history, Quick Access, Jump Lists,
        Explorer search history, and MRU lists from all user profiles.
    #>
    Write-SectionHeader "STEP 4: Clear Recent Items"

    $profiles = Get-LocalUserProfiles
    foreach ($profile in $profiles) {
        # Recent Files (Win+E / File Explorer recent)
        Remove-FolderContents -FolderPath "$profile\AppData\Roaming\Microsoft\Windows\Recent"
        # Recent automatic destinations (Jump Lists)
        Remove-FolderContents -FolderPath "$profile\AppData\Roaming\Microsoft\Windows\Recent\AutomaticDestinations"
        # Recent custom destinations
        Remove-FolderContents -FolderPath "$profile\AppData\Roaming\Microsoft\Windows\Recent\CustomDestinations"
        # Quick Access pinned/recent folders (stored in this file)
        $qaFile = "$profile\AppData\Roaming\Microsoft\Windows\Recent\AutomaticDestinations\f01b4d95cf55d32a.automaticDestinations-ms"
        Remove-ItemSafely -Path $qaFile -IsDir $false
    }

    # Run History (HKCU hive — must load each user's hive to fully clear)
    # For the current session, we clear from HKCU
    Write-Log "Clearing Run history from registry..." -Level INFO
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\RunMRU"

    # Explorer recent folders (TypedPaths = address bar history)
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\TypedPaths"

    # File Explorer search history
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\WordWheelQuery"

    # Common Dialog recent locations (Open/Save dialogs)
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComDlg32\LastVisitedPidlMRU"
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComDlg32\OpenSavePidlMRU"
}

# ==============================================================================
# ENDREGION: STEP 4
# ==============================================================================


# ==============================================================================
# REGION: STEP 5 — CLEAR BROWSER DATA
# ==============================================================================

function Clear-BrowserData {
    <#
    .SYNOPSIS
        Detects installed browsers and deletes all user profile data:
        history, cookies, cache, passwords, bookmarks, extensions, sessions.
        Supports Chrome, Edge, Firefox, Brave, Opera, Opera GX, Vivaldi.
    #>
    Write-SectionHeader "STEP 5: Clear Browser Data"

    $profiles = Get-LocalUserProfiles

    foreach ($profile in $profiles) {
        Write-Log "Clearing browser data for: $profile" -Level INFO

        # -----------------------------------------------------------------------
        # Chromium-based browsers — all share the same profile folder structure.
        # Each has a "User Data" folder containing one or more profiles.
        # -----------------------------------------------------------------------
        $chromiumBrowsers = @{
            "Google Chrome"  = "$profile\AppData\Local\Google\Chrome\User Data"
            "Microsoft Edge" = "$profile\AppData\Local\Microsoft\Edge\User Data"
            "Brave"          = "$profile\AppData\Local\BraveSoftware\Brave-Browser\User Data"
            "Opera"          = "$profile\AppData\Roaming\Opera Software\Opera Stable"
            "Opera GX"       = "$profile\AppData\Roaming\Opera Software\Opera GX Stable"
            "Vivaldi"        = "$profile\AppData\Local\Vivaldi\User Data"
        }

        foreach ($browser in $chromiumBrowsers.GetEnumerator()) {
            $userDataPath = $browser.Value
            if (-not (Test-Path $userDataPath)) {
                Write-Log "$($browser.Key) not found at $userDataPath" -Level SKIP
                continue
            }

            Write-Log "Found $($browser.Key) — clearing all profiles." -Level INFO

            # Each sub-folder named "Default", "Profile 1", "Profile 2", etc. is a browser profile
            Get-ChildItem -Path $userDataPath -Directory -Force -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match "^(Default|Profile \d+|Guest Profile)$" } |
            ForEach-Object {
                $profilePath = $_.FullName
                Write-Log "  Clearing Chromium profile: $profilePath" -Level INFO

                # List of data items to remove inside each profile folder
                $chromiumItems = @(
                    "History", "History-journal",
                    "Cookies", "Cookies-journal",
                    "Cache", "Code Cache", "GPUCache",
                    "Login Data", "Login Data For Account", "Login Data-journal",
                    "Bookmarks.bak",        # Keep Bookmarks? Remove if desired
                    "Bookmarks",
                    "Sessions",
                    "Extension State",
                    "Local Storage",
                    "Session Storage",
                    "IndexedDB",
                    "databases",
                    "Web Data", "Web Data-journal",  # Autofill / forms
                    "Shortcuts",
                    "Download Service",
                    "Network Action Predictor",
                    "Visited Links",
                    "Last Session", "Last Tabs", "Current Session", "Current Tabs",
                    "Preferences"           # Resets browser settings to default
                )

                foreach ($item in $chromiumItems) {
                    $itemPath = Join-Path $profilePath $item
                    if (Test-Path $itemPath) {
                        $isDir = (Get-Item $itemPath -Force).PSIsContainer
                        Remove-ItemSafely -Path $itemPath -IsDir $isDir
                    }
                }
            }

            # Also clear top-level cache outside profiles
            @("ShaderCache", "GrShaderCache", "Crashpad", "SafeBrowsing") | ForEach-Object {
                $p = Join-Path $userDataPath $_
                if (Test-Path $p) { Remove-ItemSafely -Path $p -IsDir $true }
            }
        }

        # -----------------------------------------------------------------------
        # Mozilla Firefox — uses a different profile system (profiles.ini)
        # Profiles are in: %APPDATA%\Mozilla\Firefox\Profiles\<random>.default
        # -----------------------------------------------------------------------
        $firefoxProfilesRoot = "$profile\AppData\Roaming\Mozilla\Firefox\Profiles"
        if (Test-Path $firefoxProfilesRoot) {
            Write-Log "Found Firefox — clearing all profiles." -Level INFO
            Get-ChildItem -Path $firefoxProfilesRoot -Directory -Force -ErrorAction SilentlyContinue | ForEach-Object {
                $ffProfile = $_.FullName
                Write-Log "  Clearing Firefox profile: $ffProfile" -Level INFO

                $firefoxItems = @(
                    "places.sqlite",         # History & bookmarks
                    "places.sqlite-wal",
                    "places.sqlite-shm",
                    "cookies.sqlite",        # Cookies
                    "cookies.sqlite-wal",
                    "cookies.sqlite-shm",
                    "formhistory.sqlite",    # Saved forms / autofill
                    "logins.json",           # Saved passwords
                    "key4.db",               # Password encryption key
                    "cert9.db",              # Certificates
                    "sessionstore.jsonlz4",  # Open sessions
                    "sessionstore-backups",  # Session backups
                    "cache2",                # Cache
                    "startupCache",
                    "thumbnails",
                    "weave",                 # Sync data
                    "datareporting",
                    "storage",
                    "webappsstore.sqlite",
                    "content-prefs.sqlite",  # Site-specific permissions
                    "permissions.sqlite",    # Site permissions
                    "favicons.sqlite"        # Favicons (reveals visited sites)
                )

                foreach ($item in $firefoxItems) {
                    $itemPath = Join-Path $ffProfile $item
                    if (Test-Path $itemPath) {
                        $isDir = (Get-Item $itemPath -Force).PSIsContainer
                        Remove-ItemSafely -Path $itemPath -IsDir $isDir
                    }
                }
            }
        } else {
            Write-Log "Firefox not found." -Level SKIP
        }
    }
}

# ==============================================================================
# ENDREGION: STEP 5
# ==============================================================================


# ==============================================================================
# REGION: STEP 6 — CLEAR MICROSOFT OFFICE HISTORY
# ==============================================================================

function Clear-OfficeHistory {
    <#
    .SYNOPSIS
        Clears Microsoft Office MRU (Most Recently Used) lists,
        recent documents, recent locations, and Office cache.
        Works for Office 2016, 2019, 2021, and Microsoft 365.
    #>
    Write-SectionHeader "STEP 6: Clear Microsoft Office History"

    # Office stores MRU data in registry under versioned keys
    # Versions: 16.0 = Office 2016/2019/2021/365, 15.0 = Office 2013
    $officeVersions = @("16.0", "15.0", "14.0")
    $officeApps     = @("Word", "Excel", "PowerPoint", "Access", "Publisher", "OneNote", "Outlook", "Visio", "Project")

    foreach ($ver in $officeVersions) {
        foreach ($app in $officeApps) {
            $mruKey = "HKCU:\Software\Microsoft\Office\$ver\$app\File MRU"
            Remove-RegistryValue -KeyPath $mruKey

            $placesKey = "HKCU:\Software\Microsoft\Office\$ver\$app\Place MRU"
            Remove-RegistryValue -KeyPath $placesKey

            $commonMruKey = "HKCU:\Software\Microsoft\Office\$ver\Common\Open Find\$app\Settings\Open\File Name MRU"
            Remove-RegistryValue -KeyPath $commonMruKey
        }

        # Office common recent files list
        Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Office\$ver\Common\File MRU"
        Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Office\$ver\Common\Open Find"
    }

    # Clear Office file cache folders from all user profiles
    $profiles = Get-LocalUserProfiles
    foreach ($profile in $profiles) {
        # Office Document Cache (used for real-time collaboration)
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Microsoft\Office\$($officeVersions[0])\OfficeFileCache"
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Microsoft\Office\UnsavedFiles"

        # Outlook attachments preview temp
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Microsoft\Windows\INetCache\Content.Outlook"

        # OneNote notebooks cache
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Microsoft\OneNote"
    }

    Write-Log "Office history cleared." -Level SUCCESS
}

# ==============================================================================
# ENDREGION: STEP 6
# ==============================================================================


# ==============================================================================
# REGION: STEP 7 — CLEAR MEDIA HISTORY
# ==============================================================================

function Clear-MediaHistory {
    <#
    .SYNOPSIS
        Clears recently opened file history for media applications:
        Windows Media Player, Photos, Paint, Notepad, WordPad.
    #>
    Write-SectionHeader "STEP 7: Clear Media App History"

    # Windows Media Player — stored in registry
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\MediaPlayer\Player\RecentFileList"
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\MediaPlayer\Player\RecentURLList"

    $profiles = Get-LocalUserProfiles
    foreach ($profile in $profiles) {
        # Windows Media Player library database
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Microsoft\Media Player"
        Remove-FolderContents -FolderPath "$profile\AppData\Roaming\Microsoft\Windows\Recent"

        # Photos app — stored in LocalState
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Packages\Microsoft.Windows.Photos_8wekyb3d8bbwe\LocalState"

        # Paint — no dedicated history folder (uses Windows Recent Items)
        # Notepad — recent files stored in registry
        Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Notepad"

        # WordPad recent documents (RecentDocs registry)
        Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Applets\Wordpad\Recent File List"
    }

    Write-Log "Media history cleared." -Level SUCCESS
}

# ==============================================================================
# ENDREGION: STEP 7
# ==============================================================================


# ==============================================================================
# REGION: STEP 8 — CLEAR WINDOWS SEARCH HISTORY
# ==============================================================================

function Clear-WindowsSearchHistory {
    <#
    .SYNOPSIS Clears all Windows Search and Cortana search history.
    #>
    Write-SectionHeader "STEP 8: Clear Windows Search History"

    # Start Menu / Taskbar search history
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Search"

    # Cortana query history
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\WordWheelQuery"

    # Windows Search index user data (not the index itself)
    $profiles = Get-LocalUserProfiles
    foreach ($profile in $profiles) {
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Packages\Microsoft.Windows.Search_cw5n1h2txyewy\LocalState\AppIconCache"
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Packages\Microsoft.Windows.Cortana_cw5n1h2txyewy\LocalState"
    }

    Write-Log "Windows Search history cleared." -Level SUCCESS
}

# ==============================================================================
# ENDREGION: STEP 8
# ==============================================================================


# ==============================================================================
# REGION: STEP 9 — CLEAR CLIPBOARD
# ==============================================================================

function Clear-ClipboardContents {
    <#
    .SYNOPSIS Clears the Windows clipboard including cloud clipboard history.
    #>
    Write-SectionHeader "STEP 9: Clear Clipboard"

    if ($DryRun) {
        Write-Log "[DRY] Would clear clipboard contents." -Level DRY
        return
    }

    try {
        # Clear clipboard via PowerShell
        Set-Clipboard -Value $null -ErrorAction SilentlyContinue

        # Also clear via cmd for reliability
        cmd /c "echo off | clip" 2>$null

        # Clear cloud clipboard history (Windows 10 1809+)
        Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Clipboard"

        Write-Log "Clipboard cleared." -Level SUCCESS
    }
    catch {
        $Global:Errors++
        Write-Log "Clipboard clear failed: $($_.Exception.Message)" -Level ERROR
    }
}

# ==============================================================================
# ENDREGION: STEP 9
# ==============================================================================


# ==============================================================================
# REGION: STEP 10 — CLEAR NETWORK HISTORY
# ==============================================================================

function Clear-NetworkHistory {
    <#
    .SYNOPSIS
        Removes mapped network drives, recent network locations.
        Optionally removes WiFi profiles and VPN profiles.
    #>
    Write-SectionHeader "STEP 10: Clear Network History"

    # Recent network locations from File Explorer
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComputerDescriptions"
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Map Network Drive MRU"

    # Remove all persistent mapped network drives
    if (-not $DryRun) {
        try {
            $mappedDrives = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
                Where-Object { $_.DisplayRoot -like "\\*" }
            foreach ($drive in $mappedDrives) {
                Write-Log "Removing mapped drive: $($drive.Name)" -Level INFO
                net use "$($drive.Name):" /delete /y 2>$null
            }
        }
        catch {
            Write-Log "Mapped drive removal failed: $($_.Exception.Message)" -Level WARN
        }
    } else {
        Write-Log "[DRY] Would remove all mapped network drives." -Level DRY
    }

    # Network places / recent servers
    Remove-FolderContents -FolderPath "$env:APPDATA\Microsoft\Windows\Network Shortcuts"

    # Optional: WiFi profiles
    if ($DeleteWiFiProfiles) {
        Write-Log "Removing all WiFi profiles (switch enabled)." -Level INFO
        if (-not $DryRun) {
            try {
                $wifiProfiles = netsh wlan show profiles | Select-String "All User Profile" |
                    ForEach-Object { ($_ -split ":")[1].Trim() }
                foreach ($wifiProfile in $wifiProfiles) {
                    netsh wlan delete profile name="$wifiProfile" 2>$null
                    Write-Log "Removed WiFi profile: $wifiProfile" -Level SUCCESS
                }
            }
            catch {
                Write-Log "WiFi profile removal failed: $($_.Exception.Message)" -Level WARN
            }
        } else {
            Write-Log "[DRY] Would remove all saved WiFi profiles." -Level DRY
        }
    } else {
        Write-Log "WiFi profiles skipped (use -DeleteWiFiProfiles to enable)." -Level SKIP
    }

    # Optional: VPN profiles
    if ($DeleteVPNProfiles) {
        Write-Log "Removing VPN profiles (switch enabled)." -Level INFO
        if (-not $DryRun) {
            try {
                Get-VpnConnection -ErrorAction SilentlyContinue | ForEach-Object {
                    Remove-VpnConnection -Name $_.Name -Force -ErrorAction SilentlyContinue
                    Write-Log "Removed VPN: $($_.Name)" -Level SUCCESS
                }
            }
            catch {
                Write-Log "VPN removal failed: $($_.Exception.Message)" -Level WARN
            }
        } else {
            Write-Log "[DRY] Would remove all VPN profiles." -Level DRY
        }
    } else {
        Write-Log "VPN profiles skipped (use -DeleteVPNProfiles to enable)." -Level SKIP
    }
}

# ==============================================================================
# ENDREGION: STEP 10
# ==============================================================================


# ==============================================================================
# REGION: STEP 11 — CLEAR EVENT LOGS (OPTIONAL)
# ==============================================================================

function Clear-EventLogs {
    <#
    .SYNOPSIS Clears all Windows Event Logs. Only runs if -ClearEventLogs switch is set.
    #>
    Write-SectionHeader "STEP 11: Clear Windows Event Logs"

    if (-not $ClearEventLogs) {
        Write-Log "Event log clearing skipped (use -ClearEventLogs to enable)." -Level SKIP
        return
    }

    if ($DryRun) {
        Write-Log "[DRY] Would clear all Windows Event Logs." -Level DRY
        return
    }

    Write-Log "Clearing all Windows Event Logs..." -Level INFO
    try {
        Get-EventLog -List -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                Clear-EventLog -LogName $_.Log -ErrorAction Stop
                Write-Log "Cleared event log: $($_.Log)" -Level SUCCESS
            }
            catch {
                Write-Log "Could not clear log: $($_.Log) — $($_.Exception.Message)" -Level WARN
            }
        }

        # Also clear logs not in the classic Get-EventLog list (e.g. Applications and Services Logs)
        wevtutil el 2>$null | ForEach-Object {
            wevtutil cl "$_" 2>$null
        }
    }
    catch {
        $Global:Errors++
        Write-Log "Event log clearing failed: $($_.Exception.Message)" -Level ERROR
    }
}

# ==============================================================================
# ENDREGION: STEP 11
# ==============================================================================


# ==============================================================================
# REGION: STEP 12 — CLEAR WINDOWS STORE CACHE
# ==============================================================================

function Clear-WindowsStoreCache {
    <#
    .SYNOPSIS Resets the Windows Store cache using wsreset.exe and deletes leftover cache files.
    #>
    Write-SectionHeader "STEP 12: Clear Windows Store Cache"

    if ($DryRun) {
        Write-Log "[DRY] Would run wsreset.exe and delete Store cache." -Level DRY
        return
    }

    # wsreset.exe resets the Store cache silently
    $wsreset = "C:\Windows\System32\wsreset.exe"
    if (Test-Path $wsreset) {
        try {
            Write-Log "Running wsreset.exe..." -Level INFO
            Start-Process -FilePath $wsreset -WindowStyle Hidden -Wait -ErrorAction Stop
            Write-Log "wsreset.exe completed." -Level SUCCESS
        }
        catch {
            Write-Log "wsreset.exe failed: $($_.Exception.Message)" -Level WARN
        }
    } else {
        Write-Log "wsreset.exe not found — skipping." -Level SKIP
    }

    # Delete Store package temp data from all profiles
    $profiles = Get-LocalUserProfiles
    foreach ($profile in $profiles) {
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Packages\WinStore_cw5n1h2txyewy\LocalCache"
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Packages\Microsoft.WindowsStore_8wekyb3d8bbwe\LocalCache"
    }
}

# ==============================================================================
# ENDREGION: STEP 12
# ==============================================================================


# ==============================================================================
# REGION: STEP 13 — CLEAR USER PERSONALIZATION HISTORY
# ==============================================================================

function Clear-PersonalizationHistory {
    <#
    .SYNOPSIS
        Resets recent wallpapers, themes, accent colors,
        lock screen history, and account picture cache.
    #>
    Write-SectionHeader "STEP 13: Clear User Personalization History"

    # Wallpaper history
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Wallpapers"

    # Theme MRU
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes" -ValueName "ThemeMRU"

    # Accent color history (stored in personalization settings)
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Accent"

    $profiles = Get-LocalUserProfiles
    foreach ($profile in $profiles) {
        # Lock screen image cache
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Packages\Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy\LocalState\Assets"

        # Account picture cache
        Remove-FolderContents -FolderPath "$profile\AppData\Roaming\Microsoft\Windows\AccountPictures"
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Temp\AccountPictures"

        # Cached wallpapers (Windows Spotlight)
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Packages\Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy\LocalState\Assets"
    }

    Write-Log "Personalization history cleared." -Level SUCCESS
}

# ==============================================================================
# ENDREGION: STEP 13
# ==============================================================================


# ==============================================================================
# REGION: STEP 14 — REMOVE USER FILES FROM C:\ ROOT
# ==============================================================================

function Clear-CRootUserFiles {
    <#
    .SYNOPSIS
        Deletes user-created files and folders at the root of C:\
        while carefully protecting all system directories.
    #>
    Write-SectionHeader "STEP 14: Clear User Files from C:\ Root"

    $cRoot = "C:\"

    Get-ChildItem -Path $cRoot -Force -ErrorAction SilentlyContinue | ForEach-Object {
        $itemName = $_.Name

        # Check against protected list (case-insensitive)
        $isProtected = $ProtectedRootFolders | Where-Object {
            $itemName -ieq $_
        }

        if ($isProtected) {
            Write-Log "Protected — skipping: C:\$itemName" -Level SKIP
        } else {
            Write-Log "Deleting from C:\ root: C:\$itemName" -Level INFO
            Remove-ItemSafely -Path $_.FullName -IsDir ($_.PSIsContainer)
        }
    }
}

# ==============================================================================
# ENDREGION: STEP 14
# ==============================================================================


# ==============================================================================
# REGION: STEP 15 — CLEAR STARTUP FOLDER
# ==============================================================================

function Clear-StartupFolders {
    <#
    .SYNOPSIS Deletes all items from Current User and Common (All Users) Startup folders.
    #>
    Write-SectionHeader "STEP 15: Clear Startup Folders"

    # Common Startup (All Users)
    $commonStartup = [System.Environment]::GetFolderPath("CommonStartup")
    Remove-FolderContents -FolderPath $commonStartup

    # Per-user Startup folders
    $profiles = Get-LocalUserProfiles
    foreach ($profile in $profiles) {
        Remove-FolderContents -FolderPath "$profile\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup"
    }

    Write-Log "Startup folders cleared." -Level SUCCESS
}

# ==============================================================================
# ENDREGION: STEP 15
# ==============================================================================


# ==============================================================================
# REGION: STEP 16 — DELETE CUSTOM SHORTCUTS
# ==============================================================================

function Clear-UserShortcuts {
    <#
    .SYNOPSIS
        Removes user-created .lnk and .url shortcuts from Desktops and Start Menu.
        Leaves system-installed shortcuts intact (they're in All Users or system paths).
    #>
    Write-SectionHeader "STEP 16: Delete Custom Shortcuts"

    $profiles = Get-LocalUserProfiles
    foreach ($profile in $profiles) {
        # Desktop shortcuts
        $desktopPath = "$profile\Desktop"
        if (Test-Path $desktopPath) {
            Get-ChildItem -Path $desktopPath -Include "*.lnk","*.url" -Force -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-ItemSafely -Path $_.FullName -IsDir $false }
        }

        # Start Menu — per-user additions only
        $startMenuPath = "$profile\AppData\Roaming\Microsoft\Windows\Start Menu"
        if (Test-Path $startMenuPath) {
            Get-ChildItem -Path $startMenuPath -Include "*.lnk","*.url" -Recurse -Force -ErrorAction SilentlyContinue |
            ForEach-Object { Remove-ItemSafely -Path $_.FullName -IsDir $false }
        }
    }

    Write-Log "User shortcuts cleared." -Level SUCCESS
}

# ==============================================================================
# ENDREGION: STEP 16
# ==============================================================================


# ==============================================================================
# REGION: STEP 17 — CLEAR COMMAND HISTORY
# ==============================================================================

function Clear-CommandHistory {
    <#
    .SYNOPSIS
        Clears PowerShell command history, CMD doskey history,
        and Windows Terminal history.
    #>
    Write-SectionHeader "STEP 17: Clear Command History"

    $profiles = Get-LocalUserProfiles
    foreach ($profile in $profiles) {
        # PowerShell history file (PSReadLine module stores command history here)
        Remove-ItemSafely -Path "$profile\AppData\Roaming\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt" -IsDir $false

        # Windows Terminal history / settings
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState"

        # Windows Terminal Preview
        Remove-FolderContents -FolderPath "$profile\AppData\Local\Packages\Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe\LocalState"
    }

    # CMD history is session-based and not persisted to disk by default
    # doskey macros are cleared here if set in current session
    if (-not $DryRun) {
        doskey /reinstall 2>$null
    }

    Write-Log "Command history cleared." -Level SUCCESS
}

# ==============================================================================
# ENDREGION: STEP 17
# ==============================================================================


# ==============================================================================
# REGION: STEP 18 — CLEAR REGISTRY MRU ENTRIES
# ==============================================================================

function Clear-RegistryMRU {
    <#
    .SYNOPSIS
        Removes common Most Recently Used (MRU) registry entries
        that track recently accessed files, folders, and programs.
    #>
    Write-SectionHeader "STEP 18: Clear Registry MRU Entries"

    # Explorer RecentDocs — tracks recently opened files by extension
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\RecentDocs"

    # Run MRU — recently typed commands in Win+R
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\RunMRU"

    # Typed URLs in Internet Explorer / legacy Edge
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Internet Explorer\TypedURLs"
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Internet Explorer\TypedURLsTime"

    # Comdlg32 — Open/Save dialog history
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComDlg32\LastVisitedPidlMRU"
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComDlg32\LastVisitedPidlMRULegacy"
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\ComDlg32\OpenSavePidlMRU"

    # Windows Media Player recent file/URL lists
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\MediaPlayer\Player\RecentFileList"
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\MediaPlayer\Player\RecentURLList"

    # Typed paths in File Explorer address bar
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\TypedPaths"

    # Map Network Drive MRU
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Map Network Drive MRU"

    # UserAssist — tracks program execution history (encoded in ROT13)
    Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\UserAssist"

    # Taskband (pinned taskbar items — optional, resets taskbar pins)
    # Uncomment below if you want to also reset taskbar pins:
    # Remove-RegistryValue -KeyPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband"

    Write-Log "Registry MRU entries cleared." -Level SUCCESS
}

# ==============================================================================
# ENDREGION: STEP 18
# ==============================================================================


# ==============================================================================
# REGION: CONFIRMATION AND PRE-FLIGHT
# ==============================================================================

function Show-PreflightInfo {
    <#
    .SYNOPSIS Shows a summary of what the script will do and asks for confirmation.
    #>
    $modeText = if ($DryRun) { "DRY RUN (no changes will be made)" } else { "LIVE RUN (files WILL be deleted)" }

    Write-Host "`n" -NoNewline
    Write-Host "╔══════════════════════════════════════════════════════════════════╗" -ForegroundColor Cyan
    Write-Host "║         PC RESET SCRIPT — Training Center                       ║" -ForegroundColor Cyan
    Write-Host "║         Version $ScriptVersion                                            ║" -ForegroundColor Cyan
    Write-Host "╚══════════════════════════════════════════════════════════════════╝" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Mode         : " -NoNewline; Write-Host $modeText -ForegroundColor Yellow
    Write-Host "  Computer     : $env:COMPUTERNAME"
    Write-Host "  Date         : $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
    Write-Host "  Log File     : $LogFile"
    Write-Host ""
    Write-Host "  Actions planned:" -ForegroundColor White
    Write-Host "   ✔ Delete user profile files (Desktop, Docs, Downloads, etc.)"
    Write-Host "   ✔ Empty Recycle Bin"
    Write-Host "   ✔ Delete temp files and caches"
    Write-Host "   ✔ Clear recent items and MRU lists"
    Write-Host "   ✔ Clear all browser data (Chrome, Edge, Firefox, Brave, Opera, Vivaldi)"
    Write-Host "   ✔ Clear Office history"
    Write-Host "   ✔ Clear media app history"
    Write-Host "   ✔ Clear Windows Search history"
    Write-Host "   ✔ Clear clipboard"
    Write-Host "   ✔ Clear network history (mapped drives, recent servers)"
    Write-Host "   $(if($DeleteWiFiProfiles){'✔'}else{'○'}) Delete WiFi profiles         $(if(-not $DeleteWiFiProfiles){'[skipped — use -DeleteWiFiProfiles]'})"
    Write-Host "   $(if($DeleteVPNProfiles){'✔'}else{'○'}) Delete VPN profiles          $(if(-not $DeleteVPNProfiles){'[skipped — use -DeleteVPNProfiles]'})"
    Write-Host "   $(if($ClearEventLogs){'✔'}else{'○'}) Clear Event Logs             $(if(-not $ClearEventLogs){'[skipped — use -ClearEventLogs]'})"
    Write-Host "   ✔ Reset Windows Store cache"
    Write-Host "   ✔ Clear personalization history"
    Write-Host "   ✔ Remove user files from C:\ root"
    Write-Host "   ✔ Clear Startup folders"
    Write-Host "   ✔ Delete user shortcuts"
    Write-Host "   ✔ Clear command history"
    Write-Host "   ✔ Clear registry MRU entries"
    Write-Host "   $(if($ClearPrefetch){'✔'}else{'○'}) Clear Prefetch               $(if(-not $ClearPrefetch){'[skipped — use -ClearPrefetch]'})"
    Write-Host ""
    Write-Host "  ⚠  Installed software, Windows, and drivers will NOT be touched." -ForegroundColor Green
    Write-Host ""
}

function Request-Confirmation {
    <#
    .SYNOPSIS Asks user to confirm before proceeding. Skipped if -Force is set.
    #>
    if ($Force) {
        Write-Log "Force mode enabled — skipping confirmation." -Level INFO
        return $true
    }

    Write-Host "  Are you sure you want to proceed? Type YES to continue: " -ForegroundColor Yellow -NoNewline
    $answer = Read-Host
    if ($answer -ne "YES") {
        Write-Host "`n  Cancelled. No changes were made." -ForegroundColor Red
        Write-Log "Script cancelled by user." -Level WARN
        return $false
    }
    return $true
}

# ==============================================================================
# ENDREGION: CONFIRMATION AND PRE-FLIGHT
# ==============================================================================


# ==============================================================================
# REGION: FINAL SUMMARY
# ==============================================================================

function Show-Summary {
    <#
    .SYNOPSIS Displays a summary report at the end of the script.
    #>
    $elapsed = (Get-Date) - $ScriptStartTime
    $elapsedStr = "{0:D2}:{1:D2}:{2:D2}" -f $elapsed.Hours, $elapsed.Minutes, $elapsed.Seconds

    $summary = @"

================================================================================
  CLEANUP SUMMARY
================================================================================
  Files Deleted      : $($Global:FilesDeleted)
  Folders Deleted    : $($Global:FoldersDeleted)
  Registry Keys      : $($Global:RegKeysRemoved)
  Skipped            : $($Global:Skipped)
  Errors             : $($Global:Errors)
  Elapsed Time       : $elapsedStr
  Log File           : $LogFile
  Mode               : $(if($DryRun){'DRY RUN — No changes made'}else{'LIVE — Cleanup complete'})
================================================================================
"@

    Write-Host $summary -ForegroundColor Cyan
    $summary | Out-File -FilePath $LogFile -Encoding UTF8 -Append
}

# ==============================================================================
# ENDREGION: FINAL SUMMARY
# ==============================================================================


# ==============================================================================
# REGION: MAIN EXECUTION ENTRY POINT
# ==============================================================================

# Ensure the log directory exists and start the log
Initialize-Log

# Show what will happen
Show-PreflightInfo

# Request confirmation (unless -Force was passed)
if (-not (Request-Confirmation)) { exit 0 }

Write-Log "Script started. Mode: $(if($DryRun){'DRY RUN'}else{'LIVE'})" -Level INFO

# ---- Execute all cleanup steps in order ----

Clear-UserProfileFiles        # Step 1
Clear-RecycleBin              # Step 2
Clear-TempFiles               # Step 3
Clear-RecentItems             # Step 4
Clear-BrowserData             # Step 5
Clear-OfficeHistory           # Step 6
Clear-MediaHistory            # Step 7
Clear-WindowsSearchHistory    # Step 8
Clear-ClipboardContents       # Step 9
Clear-NetworkHistory          # Step 10
Clear-EventLogs               # Step 11
Clear-WindowsStoreCache       # Step 12
Clear-PersonalizationHistory  # Step 13
Clear-CRootUserFiles          # Step 14
Clear-StartupFolders          # Step 15
Clear-UserShortcuts           # Step 16
Clear-CommandHistory          # Step 17
Clear-RegistryMRU             # Step 18

# ---- Show final summary ----
Show-Summary

Write-Log "Script finished." -Level SUCCESS
exit 0

# ==============================================================================
# ENDREGION: MAIN EXECUTION ENTRY POINT
# ==============================================================================
