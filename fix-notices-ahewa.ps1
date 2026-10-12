<#
.SYNOPSIS
    1. Force-injects AHEWA sidebar links + the ahewa-nav.js loader
       into frontend\notices.html (which the previous injector skipped).
    2. Then runs a verification pass on all 28 target files to confirm
       each one has the 3 links and the loader script.
#>

param(
    [string]$Root = $PSScriptRoot,
    [switch]$DryRun
)

# ---- Guards ----
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

# ---- The block we want to guarantee is present ----
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

$LoaderTag = '  <script src="js/ahewa-nav.js"></script>'

# ---- Files to process (same allowlist as the main injector) ----
$TargetPages = @(
    "index.html","about.html","dashboard.html","billing.html","visitors.html",
    "provider-profile.html","provider-dashboard.html","security-visitors.html",
    "notices.html",
    "admin.html","admin-health.html","admin-house-numbers.html",
    "admin-invoices.html","admin-payments.html","admin-providers.html",
    "admin-residents.html","admin-reviews.html","admin-visitor-analytics.html",
    "admin-visitors.html","pending.html",
    "super-admin.html","super-admin-admins.html","super-admin-categories.html",
    "super-admin-providers.html","super-admin-residents.html",
    "ahewa.html","ahewa-events.html","ahewa-event.html"
)

Write-Host ""
Write-Host "AHEWA notices fixer" -ForegroundColor Cyan
Write-Host "Frontend : $Frontend" -ForegroundColor DarkGray
if ($DryRun) { Write-Host "Mode     : DRY RUN" -ForegroundColor Yellow }
Write-Host ""

$fixed   = 0
$ok      = 0
$skipped = 0
$failed  = 0

foreach ($name in $TargetPages) {
    $file = Join-Path $Frontend $name
    if (-not (Test-Path $file)) {
        Write-Host "  [MISSING] $name" -ForegroundColor Yellow
        $skipped++
        continue
    }

    try {
        $content = Get-Content -Path $file -Raw -Encoding UTF8
        if (-not $content) {
            Write-Host "  [SKIP] $name  (empty)" -ForegroundColor DarkGray
            $skipped++
            continue
        }

        # Not a side-rail page → skip
        if ($content -notmatch 'class="side-rail__nav"') {
            Write-Host "  [SKIP] $name  (no side-rail)" -ForegroundColor DarkGray
            $skipped++
            continue
        }

        $needsLinks  = $content -notmatch 'href="ahewa\.html"'
        $needsLoader = $content -notmatch 'js/ahewa-nav\.js'

        if (-not $needsLinks -and -not $needsLoader) {
            Write-Host "  [OK]   $name  (already correct)" -ForegroundColor Green
            $ok++
            continue
        }

        if ($DryRun) {
            Write-Host "  [WOULD FIX] $name  (links=$needsLinks loader=$needsLoader)" -ForegroundColor Yellow
            $fixed++
            continue
        }

        # --- Inject links if missing ---
        if ($needsLinks) {
            $anchorRegex = [regex]'(?s)(<a\s[^>]*href="notices\.html"[^>]*>.*?</a>)'
            $m = $anchorRegex.Match($content)
            if ($m.Success) {
                $insertPos = $m.Index + $m.Length
                $content = $content.Substring(0, $insertPos) +
                           "`r`n`r`n" + $AhewaLinksBlock +
                           $content.Substring($insertPos)
            } else {
                Write-Host "  [WARN] $name  (couldn't find notices.html anchor for link insertion)" -ForegroundColor Yellow
            }
        }

        # --- Inject loader script if missing ---
        if ($needsLoader) {
            $scriptRegex = [regex]'(<script\s+src="js/main\.js[^"]*"\s*>\s*</script>)'
            if ($scriptRegex.IsMatch($content)) {
                $content = $scriptRegex.Replace(
                    $content,
                    "`$1`r`n$LoaderTag",
                    1
                )
            } else {
                Write-Host "  [WARN] $name  (no main.js script tag to anchor on)" -ForegroundColor Yellow
            }
        }

        # Backup + write
        Copy-Item -Path $file -Destination ($file + ".bak") -Force
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($file, $content, $utf8NoBom)

        Write-Host "  [FIXED] $name" -ForegroundColor Green
        $fixed++
    }
    catch {
        Write-Host "  [FAIL] $name  - $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "---------------------------------------------" -ForegroundColor DarkGray
Write-Host "Fixed   : $fixed"
Write-Host "Already : $ok"
Write-Host "Skipped : $skipped"
Write-Host "Failed  : $failed" -ForegroundColor $(if ($failed -gt 0) { "Red" } else { "DarkGray" })
Write-Host "---------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# ============================================================
# VERIFICATION PASS
# ============================================================
Write-Host "Verification pass" -ForegroundColor Cyan
Write-Host "---------------------------------------------" -ForegroundColor DarkGray

$verified = 0
$missing  = @()

foreach ($name in $TargetPages) {
    $file = Join-Path $Frontend $name
    if (-not (Test-Path $file)) { continue }

    try {
        $content = Get-Content -Path $file -Raw -Encoding UTF8
        if ($content -notmatch 'class="side-rail__nav"') { continue }

        $hasLinks  = $content -match 'href="ahewa\.html"'
        $hasLoader = $content -match 'js/ahewa-nav\.js'

        if ($hasLinks -and $hasLoader) {
            $verified++
        } else {
            $missing += ("{0} (links={1} loader={2})" -f $name, $hasLinks, $hasLoader)
        }
    } catch { /* ignore */ }
}

Write-Host "Files verified OK  : $verified" -ForegroundColor Green
if ($missing.Count -eq 0) {
    Write-Host "Files still missing: 0" -ForegroundColor Green
} else {
    Write-Host "Files still missing:" -ForegroundColor Yellow
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}
Write-Host ""