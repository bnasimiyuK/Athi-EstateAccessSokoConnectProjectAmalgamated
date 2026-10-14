# fix-emoji.ps1 — replace mojibake in .\frontend\ with correct chars / HTML entities
# The pattern strings are built from codepoints so the script file stays pure ASCII.

$root = ".\frontend"

# Each entry: [array of codepoints to match] = "replacement"
$rules = @(
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x00B1); rep = "&#x1F4F1;" },  # 📱
  @{ pat = @(0x00F0, 0x0178, 0x2019, 0x00B3); rep = "&#x1F4B3;" },  # 💳
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x201E); rep = "&#x1F4C4;" },  # 📄
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x2039); rep = "&#x1F4CB;" },  # 📋
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x0152); rep = "&#x1F4CC;" },  # 📌
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x00A2); rep = "&#x1F4E2;" },  # 📢
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x2018); rep = "&#x1F4DD;" },  # 📝
  @{ pat = @(0x00F0, 0x0178, 0x2020, 0x2022); rep = "&#x1F196;" },  # 🆕
  @{ pat = @(0x00F0, 0x0178, 0x2019, 0x00B0); rep = "&#x1F4B0;" },  # 💰
  @{ pat = @(0x00F0, 0x0178, 0x2019, 0x00BE); rep = "&#x1F4BE;" },  # 💾
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x017E); rep = "&#x1F4DE;" },  # 📞
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x00A7); rep = "&#x1F4E7;" },  # 📧
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x00B0); rep = "&#x1F4F0;" },  # 📰
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x0160); rep = "&#x1F4CA;" },  # 📊
  @{ pat = @(0x00F0, 0x0178, 0x201C, 0x2026); rep = "&#x1F4C5;" },  # 📅
  @{ pat = @(0x00F0, 0x0178, 0x2019, 0x00BB); rep = "&#x1F4BB;" },  # 💻
  @{ pat = @(0x00F0, 0x0178, 0x2018, 0x00A4); rep = "&#x1F464;" },  # 👤
  @{ pat = @(0x00F0, 0x0178, 0x2018, 0x00A5); rep = "&#x1F465;" },  # 👥
  @{ pat = @(0x00F0, 0x0178, 0x2019, 0x00AC); rep = "&#x1F4AC;" },  # 💬
  @{ pat = @(0x00F0, 0x0178, 0x017D, 0x2030); rep = "&#x1F389;" },  # 🎉
  @{ pat = @(0x00F0, 0x0178, 0x017D, 0x00AF); rep = "&#x1F3AF;" },  # 🎯
  @{ pat = @(0x00F0, 0x0178, 0x0161, 0x2014); rep = "&#x1F697;" },  # 🚗
  @{ pat = @(0x00F0, 0x0178, 0x0161, 0x00A8); rep = "&#x1F6A8;" },  # 🚨
  @{ pat = @(0x00F0, 0x0178, 0x0161, 0x00A7); rep = "&#x1F6A7;" },  # 🚧
  @{ pat = @(0x00F0, 0x0178, 0x201D, 0x2019); rep = "&#x1F512;" },  # 🔒
  @{ pat = @(0x00F0, 0x0178, 0x201D, 0x201C); rep = "&#x1F513;" },  # 🔓
  @{ pat = @(0x00F0, 0x0178, 0x201D, 0x2018); rep = "&#x1F511;" },  # 🔑
  @{ pat = @(0x00F0, 0x0178, 0x0161, 0x00AB); rep = "&#x1F6AB;" },  # 🚫
  @{ pat = @(0x00F0, 0x0178, 0x203A, 0x00A1); rep = "&#x1F6E1;" },  # 🛡
  @{ pat = @(0x00E2, 0x20AC, 0x201D);         rep = "&mdash;"  },  # —
  @{ pat = @(0x00E2, 0x20AC, 0x201C);         rep = "&ndash;"  },  # –
  @{ pat = @(0x00E2, 0x20AC, 0x2122);         rep = "&rsquo;"  },  # ’
  @{ pat = @(0x00E2, 0x20AC, 0x02DC);         rep = "&lsquo;"  },  # ‘
  @{ pat = @(0x00E2, 0x20AC, 0x0153);         rep = "&ldquo;"  },  # “
  @{ pat = @(0x00E2, 0x20AC, 0x009D);         rep = "&rdquo;"  },  # ”
  @{ pat = @(0x00E2, 0x20AC, 0x00A2);         rep = "&bull;"   },  # •
  @{ pat = @(0x00E2, 0x20AC, 0x00A6);         rep = "&hellip;" },  # …
  @{ pat = @(0x00C2, 0x00A0);                 rep = "&nbsp;"   },  # nbsp
  @{ pat = @(0x00C3, 0x00A9);                 rep = "&eacute;" },  # é
  @{ pat = @(0x00E2, 0x0161, 0x2122);         rep = "&#x2699;&#xFE0F;" },  # ⚙
  @{ pat = @(0x00E2, 0x0161, 0x00A0);         rep = "&#x26A0;&#xFE0F;" },  # ⚠
  @{ pat = @(0x00E2, 0x0153, 0x2026);         rep = "&#x2705;" },          # ✅
  @{ pat = @(0x00E2, 0x0153, 0x201D);         rep = "&#x2714;&#xFE0F;" },  # ✔
  @{ pat = @(0x00E2, 0x0153, 0x0161);         rep = "&#x271A;" }           # ✚
)

# Convert the numeric codepoint arrays into real strings
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
    $report += [PSCustomObject]@{
      File    = $file.FullName.Replace((Get-Location).Path + "\", "")
      Changes = $changes
    }
  }
}

$report | Sort-Object Changes -Descending | Format-Table -AutoSize
"Total files changed: $($report.Count)"
"Total replacements:  $(($report | Measure-Object Changes -Sum).Sum)"