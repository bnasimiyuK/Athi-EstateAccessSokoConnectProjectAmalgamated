# ---------- CONFIG ----------
$file = ".\backend\routes\visitors.js"
# ----------------------------

if (-not (Test-Path $file)) {
    Write-Error "File not found: $file"
    exit 1
}

# Backup with timestamp
$stamp  = Get-Date -Format "yyyyMMdd_HHmmss"
$backup = "$file.bak_superadmin_$stamp"
Copy-Item -LiteralPath $file -Destination $backup -Force
Write-Host "Backup written: $backup" -ForegroundColor Cyan

$lines = Get-Content -LiteralPath $file
$changes = 0

# Map of 1-based line number -> replacement text for the requireRole(...) call.
# We replace the entire requireRole(...) expression, keeping the rest of the line intact.
$replacements = @{
    531  = 'requireRole("security", "admin", "super-admin")'
    570  = 'requireRole("admin", "security", "super-admin")'
    654  = 'requireRole("security", "admin", "super-admin")'
    700  = 'requireRole("security", "admin", "super-admin")'
    760  = 'requireRole("admin", "security", "super-admin")'
    834  = 'requireRole("security", "admin", "super-admin")'
    864  = 'requireRole("admin", "security", "super-admin")'
    965  = 'requireRole("admin", "security", "super-admin")'
    1010 = 'requireRole("security", "admin", "super-admin")'
    1092 = 'requireRole("security", "admin", "super-admin")'
    1159 = 'requireRole("admin", "security", "super-admin")'
    1246 = 'requireRole("admin", "security", "super-admin")'
    1273 = 'requireRole("admin", "security", "resident", "super-admin")'
}

foreach ($lineNo in $replacements.Keys | Sort-Object) {
    $idx = $lineNo - 1
    $orig = $lines[$idx]

    if ($orig -notmatch 'requireRole\(') {
        Write-Warning "Line $lineNo does not contain requireRole(...). Skipping. Content: $orig"
        continue
    }

    $new = $orig -replace 'requireRole\([^)]*\)', $replacements[$lineNo]

    if ($new -eq $orig) {
        Write-Host "Line $lineNo already correct, skipping." -ForegroundColor DarkGray
        continue
    }

    $lines[$idx] = $new
    $changes++
    Write-Host "✔ Line $lineNo" -ForegroundColor Green
    Write-Host "   - $($orig.Trim())"
    Write-Host "   + $($new.Trim())"
}

if ($changes -eq 0) {
    Write-Host "`nNo changes made." -ForegroundColor Yellow
    exit 0
}

Set-Content -LiteralPath $file -Value ($lines -join "`r`n") -Encoding UTF8
Write-Host "`nPatched $changes line(s) in $file" -ForegroundColor Green
Write-Host "Backup: $backup" -ForegroundColor Cyan