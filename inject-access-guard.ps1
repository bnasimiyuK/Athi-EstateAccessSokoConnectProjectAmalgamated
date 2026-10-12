<#
.SYNOPSIS
    Injects <script src="js/access.js"></script> + data-requires
    into protected pages ONLY inside frontend\.
#>

param(
    [string]$Root = $PSScriptRoot,
    [switch]$DryRun
)

if (-not $Root -or -not (Test-Path $Root)) {
    Write-Error "Root path is empty or does not exist: '$Root'"
    Write-Error "Run this script from the project folder."
    exit 1
}

$FrontendDir = Join-Path $Root "frontend"

if (-not (Test-Path $FrontendDir)) {
    Write-Error "Frontend folder not found: $FrontendDir"
    exit 1
}

$FrontendDir = (Resolve-Path $FrontendDir).Path
$GuardMarker = 'js/access.js'

$RequiresMap = @{
    "dashboard.html"            = "auth ahe"
    "visitors.html"             = "auth ahe"
    "billing.html"              = "auth ahe"
    "payments.html"             = "auth ahe"

    "provider-profile.html"     = "auth vendor"
    "provider-dashboard.html"   = "auth vendor"

    "security-visitors.html"    = "auth security"

    "admin.html"                = "auth admin"
    "admin-health.html"         = "auth admin"
    "admin-house-numbers.html"  = "auth admin"
    "admin-invoices.html"       = "auth admin"
    "admin-payments.html"       = "auth admin"
    "admin-providers.html"      = "auth admin"
    "admin-residents.html"      = "auth admin"
    "admin-reviews.html"        = "auth admin"
    "admin-visitor-analytics.html" = "auth admin"
    "admin-visitors.html"       = "auth admin"
    "pending.html"              = "auth admin"

    "super-admin.html"              = "auth super"
    "super-admin-admins.html"       = "auth super"
    "super-admin-categories.html"   = "auth super"
    "super-admin-providers.html"    = "auth super"
    "super-admin-residents.html"    = "auth super"

    "ahewa.html"        = "auth ahewa"
    "ahewa-events.html" = "auth ahewa"
    "ahewa-event.html"  = "auth ahewa"
}

$PublicPages = @(
    "index.html", "about.html", "notices.html", "provider.html",
    "login.html", "register.html", "forgot-password.html",
    "reset-password.html", "social-callback.html", "change-password.html"
)

Write-Host ""
Write-Host "Access Guard Injector" -ForegroundColor Cyan
Write-Host "Root     : $Root" -ForegroundColor DarkGray
Write-Host "Frontend : $FrontendDir" -ForegroundColor DarkGray
if ($DryRun) { Write-Host "Mode: DRY RUN" -ForegroundColor Yellow }
Write-Host ""

$files = Get-ChildItem -Path $FrontendDir -Filter *.html -File -Recurse |
    Where-Object { $_.FullName -notmatch "\\_backup" -and
                   $_.FullName -notmatch "\\node_modules" }

Write-Host "Found $($files.Count) HTML files under frontend." -ForegroundColor DarkGray
Write-Host ""

$injected = 0
$skipped  = 0
$failed   = 0

foreach ($file in $files) {
    $rel = $file.FullName.Substring($Root.Length).TrimStart('\', '/')

    try {
        $name = $file.Name

        if ($PublicPages -contains $name) {
            Write-Host "  [SKIP] $rel  (public page)" -ForegroundColor DarkGray
            $skipped++
            continue
        }

        if (-not $RequiresMap.ContainsKey($name)) {
            Write-Host "  [SKIP] $rel  (no rule)" -ForegroundColor DarkGray
            $skipped++
            continue
        }

        $requires = $RequiresMap[$name]
        $content  = Get-Content -Path $file.FullName -Raw -Encoding UTF8

        if (-not $content) {
            Write-Host "  [SKIP] $rel  (empty)" -ForegroundColor DarkGray
            $skipped++
            continue
        }

        if ($content -match [regex]::Escape($GuardMarker)) {
            Write-Host "  [SKIP] $rel  (already has guard)" -ForegroundColor DarkGray
            $skipped++
            continue
        }

        $headMatch = [regex]::Match($content, '<head\b[^>]*>', 'IgnoreCase')
        if (-not $headMatch.Success) {
            Write-Host "  [SKIP] $rel  (no head tag)" -ForegroundColor DarkGray
            $skipped++
            continue
        }

        $headInsertPos = $headMatch.Index + $headMatch.Length
        $scriptTag     = "`r`n  <script src=""js/access.js""></script>"

        $newContent = $content.Substring(0, $headInsertPos) +
                      $scriptTag +
                      $content.Substring($headInsertPos)

        $bodyRegex = [regex]'<body\b([^>]*)>'
        $bodyMatch = $bodyRegex.Match($newContent)
        if (-not $bodyMatch.Success) {
            Write-Host "  [SKIP] $rel  (no body tag)" -ForegroundColor DarkGray
            $skipped++
            continue
        }

        $bodyAttrs = $bodyMatch.Groups[1].Value

        if ($bodyAttrs -match 'data-requires\s*=\s*"[^"]*"') {
            $newBodyAttrs = [regex]::Replace(
                $bodyAttrs,
                'data-requires\s*=\s*"[^"]*"',
                "data-requires=""$requires"""
            )
        } else {
            $newBodyAttrs = "$bodyAttrs data-requires=""$requires"""
        }

        $newBodyTag = "<body$newBodyAttrs>"
        $newContent = $newContent.Substring(0, $bodyMatch.Index) +
                      $newBodyTag +
                      $newContent.Substring($bodyMatch.Index + $bodyMatch.Length)

        if ($DryRun) {
            Write-Host "  [WOULD UPDATE] $rel  ->  $requires" -ForegroundColor Yellow
            $injected++
            continue
        }

        Copy-Item -Path $file.FullName -Destination ($file.FullName + ".bak") -Force
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($file.FullName, $newContent, $utf8NoBom)

        Write-Host "  [OK]   $rel  ->  $requires" -ForegroundColor Green
        $injected++
    }
    catch {
        Write-Host "  [FAIL] $rel  - $($_.Exception.Message)" -ForegroundColor Red
        $failed++
    }
}

Write-Host ""
Write-Host "---------------------------------------------" -ForegroundColor DarkGray
Write-Host "Injected: $injected" -ForegroundColor Green
Write-Host "Skipped : $skipped"  -ForegroundColor DarkGray
Write-Host "Failed  : $failed"   -ForegroundColor DarkGray
Write-Host "---------------------------------------------" -ForegroundColor DarkGray
Write-Host ""