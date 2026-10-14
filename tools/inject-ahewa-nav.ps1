<#
.SYNOPSIS
    Inserts 3 AHEWA links + the ahewa-nav.js loader into every
    frontend page that uses the side-rail layout.

.PARAMETER Root
    Project root. Defaults to the script's own folder.

.PARAMETER DryRun
    Report what would change. Do not modify files.
#>

param(
    [string]$Root = $PSScriptRoot,
    [switch]$DryRun
)

# ---- Guard against running with no root ----
if (-not $Root -or -not (Test-Path $Root)) {
    Write-Error "Root is empty or does not exist."
    exit 1
}

$Frontend = Join-Path $Root "frontend"
if (-not (Test-Path $Frontend)) {
    Write-Error "Frontend folder not found: $Frontend"
    exit 1
}
$Frontend = (Resolve-Path $Frontend).Path

# ---- What we're injecting ----
$AhewaLinksBlock = @'
    <a href="ahewa.html" data-nav="ahewa.html" data-ahewa-only hidden>
      <i class="fas fa-chart-pie" aria-hidden="true"></i>
      <span>AHEWA</span>
    </a>

    <a href="ahewa-events.html" data-nav="ahewa-events.html" data-ahewa-only hidden>
      <i class="fas fa-calendar-alt" aria-hidden="true"></i>
      <span>AHEWA Events</span>
    </a>

    <a href="ahewa-event.html" data-nav="ahewa-event.html" data-ahewa-only hidden>
      <i class="fas fa-calendar-day" aria-hidden="true"></i>
      <span>AHEWA Event</span>
    </a>
'@

Write-Host ""
Write-Host "AHEWA nav injector" -ForegroundColor Cyan
Write-Host "Frontend : $Frontend" -ForegroundColor DarkGray
if ($DryRun) { Write-Host "Mode     : DRY RUN" -ForegroundColor Yellow }
Write-Host ""

# ---- Enumerate files ----
# Pages that SHOULD receive the AHEWA sidebar links.
# Everything else is left untouched, even if it happens to contain
# a side-rail nav in some template.
$TargetPages = @(
    "index.html",
    "about.html",
    "dashboard.html",
    "billing.html",
    "visitors.html",
    "provider-profile.html",
    "provider-dashboard.html",
    "security-visitors.html",
    "notices.html",
    "admin.html",
    "admin-health.html",
    "admin-house-numbers.html",
    "admin-invoices.html",
    "admin-payments.html",
    "admin-providers.html",
    "admin-residents.html",
    "admin-reviews.html",
    "admin-visitor-analytics.html",
    "admin-visitors.html",
    "pending.html",
    "super-admin.html",
    "super-admin-admins.html",
    "super-admin-categories.html",
    "super-admin-providers.html",
    "super-admin-residents.html",
    "ahewa.html",
    "ahewa-events.html",
    "ahewa-event.html"
)

$files = Get-ChildItem -Path $Frontend -Filter *.html -File |
    Where-Object { $TargetPages -contains $_.Name -and
                   $_.FullName -notmatch "\\_backup" -and
                   $_.FullName -notmatch "\\node_modules" }

Write-Host "Found $($files.Count) HTML files under frontend." -ForegroundColor DarkGray
Write-Host ""

$updated = 0
$skipped = 0
$failed  = 0

foreach ($file in $files) {
    $rel = $file.FullName.Substring($Root.Length).TrimStart('\', '/')
    try {
        $content = Get-Content -Path $file.FullName -Raw -Encoding UTF8
        if (-not $content) {
            Write-Host "  [SKIP] $rel  (empty)" -ForegroundColor DarkGray
            $skipped++
            continue
        }

        # Only side-rail pages
        if ($content -notmatch 'class="side-rail__nav"') {
            Write-Host "  [SKIP] $rel  (no side-rail)" -ForegroundColor DarkGray
            $skipped++
            continue
        }

        $changed = $false

        # ---- 1. Insert AHEWA links after the notices.html anchor ----
        if ($content -notmatch 'href="ahewa\.html"\s+data-nav="ahewa\.html"\s+data-ahewa-only') {
            $anchorRegex = [regex]'(?s)(<a\s[^>]*href="notices\.html"[^>]*>.*?</a>)'
            $m = $anchorRegex.Match($content)
            if ($m.Success) {
                $insertPos = $m.Index + $m.Length
                $content = $content.Substring(0, $insertPos) +
                           "`r`n`r`n" + $AhewaLinksBlock +
                           $content.Substring($insertPos)
                $changed = $true
            }
        }

        # ---- 2. Load ahewa-nav.js after js/main.js ----
        if ($content -notmatch 'js/ahewa-nav\.js') {
            $scriptRegex = [regex]'(<script\s+src="js/main\.js[^"]*"\s*>\s*</script>)'
            if ($scriptRegex.IsMatch($content)) {
                $content = $scriptRegex.Replace(
                    $content,
                    "`$1`r`n  <script src=""js/ahewa-nav.js""></script>",
                    1
                )
                $changed = $true
            }
        }

        if (-not $changed) {
            Write-Host "  [SKIP] $rel  (already has AHEWA nav)" -ForegroundColor DarkGray
            $skipped++
            continue
        }

        if ($DryRun) {
            Write-Host "  [WOULD UPDATE] $rel" -ForegroundColor Yellow
            $updated++
            continue
        }

        Copy-Item -Path $file.FullName -Destination ($file.FullName + ".bak") -Force
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($file.FullName, $content, $utf8NoBom)

        Write-Host "  [OK]   $rel" -ForegroundColor Green
        $updated++
    }
    catch {
        Write-Host "  [FAIL] $rel  - $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "---------------------------------------------" -ForegroundColor DarkGray
Write-Host "Updated: $updated" -ForegroundColor Green
Write-Host "Skipped: $skipped" -ForegroundColor DarkGray
Write-Host "Failed : $failed"  -ForegroundColor DarkGray
Write-Host "---------------------------------------------" -ForegroundColor DarkGray
Write-Host ""