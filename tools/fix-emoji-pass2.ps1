# fix-emoji-2.ps1 — second-pass corrections
$root = ".\frontend"

$rules = @(
  # 📥 inbox tray (Excel/Upload buttons)
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x00A5); rep = "&#x1F4E5;" },  # 📥
  # 📷 camera (Add photo)
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x00B7); rep = "&#x1F4F7;" },  # 📷
  # 🖨️ printer with variation selector (5 bytes)
  @{ pat = @(0x00F0, 0x0178, 0x2013, 0x00A8, 0x00EF, 0x00B8, 0x008F); rep = "&#x1F5A8;&#xFE0F;" },  # 🖨️
  # 🔧 wrench
  @{ pat = @(0x00F0, 0x0178, 0x201D, 0x00A7); rep = "&#x1F527;" },  # 🔧
  # ✕ multiplication X (Clear, Deny, Close)
  @{ pat = @(0x00E2, 0x0153, 0x2022);         rep = "&#x2715;" },    # ✕
  # ✓ check mark (Approve)
  @{ pat = @(0x00E2, 0x0153, 0x201C);         rep = "&#x2713;" },    # ✓
  # ⌕ search / count icon in notices
  @{ pat = @(0x00E2, 0x0152, 0x2022);         rep = "&#x2315;" },    # ⌕ (adjust if wrong)
  # — em dash, double-corrupted (Ã¢â€)
  @{ pat = @(0x00C3, 0x00A2, 0x00E2, 0x20AC); rep = "&mdash;" }      # —
)

$map = @{}
foreach ($r in $rules) {
  $key = -join ($r.pat | ForEach-Object { [char]$_ })
  $map[$key] = $r.rep
}

$files = Get-ChildItem $root -Recurse -Include *.html, *.js, *.css
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$report = @()

foreach ($file in $files) {
  $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
  $changes = 0
  foreach ($find in $map.Keys) {
    if ($content.Contains($find)) {
      $count = ([regex]::Matches($content, [regex]::Escape($find))).Count
      $content = $content.Replace($find, $map[$find])
      $changes += $count
    }
  }
  if ($changes -gt 0) {
    [System.IO.File]::WriteAllText($file.FullName, $content, $utf8NoBom)
    $report += [PSCustomObject]@{ File = $file.FullName.Replace((Get-Location).Path + "\", ""); Changes = $changes }
  }
}

$report | Sort-Object Changes -Descending | Format-Table -AutoSize
"Total files changed: $($report.Count)"
"Total replacements:  $(($report | Measure-Object Changes -Sum).Sum)"