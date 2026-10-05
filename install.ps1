# Install the dsh-computer-use bundle into the desktop profile.
#
# Deliberately uses REAL directory copies, never junctions: the app's recovery
# flow ("disable third-party plugins, back up profile patch, restart") follows
# junctions and deletes their targets, which previously destroyed plugin sources.
#
# Usage:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File install.ps1 -WhatIf

[CmdletBinding()]
param(
  [switch]$WhatIf,
  [string]$Profile = "$env:USERPROFILE\.dsh\profiles\desktop"
)

$ErrorActionPreference = 'Stop'

$pluginName = 'dsh-computer-use'
$workspace  = Split-Path -Parent $PSScriptRoot
$source     = $PSScriptRoot

if (-not (Test-Path $Profile)) { throw "profile not found: $Profile" }

Write-Host "[1/5] backup profile configuration"
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $Profile "_backup_computeruse_$stamp"
if (-not $WhatIf) {
  New-Item -ItemType Directory -Path $backup -Force | Out-Null
  foreach ($f in @('package.json', 'cordis.patch.yml', 'cordis.yml')) {
    $src = Join-Path $Profile $f
    if (Test-Path $src) { Copy-Item $src $backup -Force }
  }
}
Write-Host "      -> $backup"

Write-Host "[2/5] copy plugin as a real directory"
$modules = Join-Path $Profile 'node_modules'
$target  = Join-Path $modules $pluginName
if (-not $WhatIf) {
  New-Item -ItemType Directory -Path $modules -Force | Out-Null
  if (Test-Path $target) {
    $item = Get-Item $target -Force
    # A junction must be removed with rmdir so its target is not followed.
    if ($item.LinkType) { cmd /c rmdir "`"$target`"" | Out-Null }
    else { Remove-Item $target -Recurse -Force }
  }
  # Copy plugin files only: no build tooling, no outputs, and no git metadata.
  # A deployed plugin has no use for .gitignore/.gitattributes, and copying them
  # would make verify-deployed's tree comparison report a spurious difference.
  robocopy $source $target /E /XJ /XD node_modules .git test-output /XF .gitignore .gitattributes /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed (exit $LASTEXITCODE)" }
  $count = (Get-ChildItem $target -Recurse -File).Count
  Write-Host "      -> $target ($count files)"
} else {
  Write-Host "      -> (whatif) $target"
}

Write-Host "[3/5] declare the bundle in the profile manifest"
$manifestPath = Join-Path $Profile 'package.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

$deps = [ordered]@{}
if ($manifest.dependencies) {
  foreach ($p in $manifest.dependencies.PSObject.Properties) { $deps[$p.Name] = $p.Value }
}
$deps[$pluginName] = "link:$source"

$bundles = @($manifest.dsh.profile.bundles)
if ($bundles -notcontains $pluginName) { $bundles += $pluginName }

if (-not $WhatIf) {
  $manifest.dependencies = $deps
  $manifest.dsh.profile.bundles = $bundles
  if (-not $manifest.name) { $manifest.name = 'dsh-profile-desktop' }
  if (-not $manifest.PSObject.Properties['private']) { $manifest | Add-Member -NotePropertyName private -NotePropertyValue $true }

  # NOTE: the manifest MUST be written without a UTF-8 BOM.
  #
  # dsh-host reads this file with a bare JSON.parse() in app-boot's
  # readProfileManifest(), so a leading U+FEFF throws
  # "Unexpected token '\uFEFF'" during host startup and the app dies before the
  # window appears -- with a dialog offering to reinstall, which does not help
  # because a reinstall never touches ~/.dsh.
  #
  # `Set-Content -Encoding UTF8` emits a BOM under Windows PowerShell 5.1, and
  # this script may be launched by either 5.1 or pwsh. WriteAllText with
  # UTF8Encoding($false) is BOM-less under both, so it is the only safe writer.
  $json = $manifest | ConvertTo-Json -Depth 20
  [System.IO.File]::WriteAllText($manifestPath, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))

  # Fail fast rather than leave a profile that cannot boot.
  $head = [System.IO.File]::ReadAllBytes($manifestPath)[0..2]
  if ($head[0] -eq 0xEF -and $head[1] -eq 0xBB -and $head[2] -eq 0xBF) {
    throw "package.json was written with a UTF-8 BOM; dsh would crash on startup. Aborted, profile left as-is."
  }
  Write-Host "      -> bundles: $($bundles -join ', ')"
} else {
  Write-Host "      -> (whatif) bundles would be: $($bundles -join ', ')"
}

Write-Host "[4/5] verify the deployed tree resolves its helpers"
$deployedEntry = Join-Path $target 'lib\index.js'
$deployedNative = Join-Path $target 'src\win32.cjs'
if (-not $WhatIf) {
  foreach ($required in @($deployedEntry, $deployedNative, (Join-Path $target 'cordis.patch.yml'))) {
    if (-not (Test-Path $required)) { throw "deployment incomplete, missing: $required" }
  }
  Write-Host "      -> lib/index.js, src/win32.cjs and cordis.patch.yml present"
}

Write-Host "[5/5] done"
Write-Host ""
Write-Host "Restart DeepSeek Harness, then pick '电脑操作模式' when starting a new task."
Write-Host "Rollback if needed:"
Write-Host "  Copy-Item '$backup\*' '$Profile' -Force"
Write-Host "  Remove-Item '$target' -Recurse -Force"
