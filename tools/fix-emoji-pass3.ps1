# fix-emoji-3.ps1 — double-encoded UTF-8 corrections
$root = ".\frontend"

# Ordered list of (find, replace) pairs — array preserves order
$pairs = @(
  # longest first, to avoid partial matches
  ,@( (-join @([char]0x00C3,[char]0x00A2,[char]0x00E2,[char]0x201A,[char]0x00AC,[char]0x00E2,[char]0x201E,[char]0x00A2)), "&mdash;" )     # Ã¢â‚¬â„¢
  ,@( (-join @([char]0x00C3,[char]0x00A2,[char]0x00E2,[char]0x201A,[char]0x00AC,[char]0x00E2,[char]0x20AC)),         "&mdash;" )     # Ã¢â‚¬â€
  ,@( (-join @([char]0x00C3,[char]0x00A2,[char]0x00E2,[char]0x201A,[char]0x00AC,[char]0x00C2,[char]0x00A6)),         "&hellip;" )    # Ã¢â‚¬Â¦
  ,@( (-join @([char]0x00C3,[char]0x00A2,[char]0x00E2,[char]0x201A,[char]0x00AC,[char]0x00C2,[char]0x009D)),         "&rdquo;" )     # Ã¢â‚¬Â
  ,@( (-join @([char]0x00C3,[char]0x00A2,[char]0x00E2,[char]0x201A,[char]0x00AC)),                                  "&mdash;" )     # Ã¢â‚¬
  ,@( (-join @([char]0x00C3,[char]0x00A2,[char]0x00E2,[char]0x20AC)),                                              "&mdash;" )     # Ã¢â‚¬ (shorter)
  ,@( (-join @([char]0x00C3,[char]0x2014)),                                                                        "&times;" )     # Ã—
  ,@( (-join @([char]0x00C3,[char]0x201A,[char]0x00C2,[char]0x00B7)),                                              "&middot;" )    # Ã‚Â·
  ,@( (-join @([char]0x00E2,[char]0x0152,[char]0x2022)),                                                            "&#x23F1;&#xFE0F;" )  # âŒ•
)

$files = Get-ChildItem $root -Recurse -Include *.html, *.js, *.css
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$report = @()

foreach ($file in $files) {
  $content = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
  $changes = 0
  foreach ($pair in $pairs) {
    $find = $pair[0]
    $rep  = $pair[1]
    if ($content.Contains($find)) {
      $count = ([regex]::Matches($content, [regex]::Escape($find))).Count
      $content = $content.Replace($find, $rep)
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