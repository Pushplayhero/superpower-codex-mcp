[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$InstallPath
)

$ErrorActionPreference = "Stop"
$InstallPath = [System.IO.Path]::GetFullPath($InstallPath)
$PackageRoot = Split-Path -Parent $PSScriptRoot
$PayloadPath = Join-Path $PackageRoot "payload"
$ManifestPath = Join-Path $PackageRoot "payload-manifest.sha256"
$TargetPackageJson = Join-Path $InstallPath "package.json"

if (-not (Test-Path -LiteralPath $PayloadPath -PathType Container)) {
  throw "Update payload not found: $PayloadPath"
}
if (-not (Test-Path -LiteralPath $TargetPackageJson -PathType Leaf)) {
  throw "Target is not a superpower-codex-mcp installation: $InstallPath"
}
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
  throw "Payload manifest not found: $ManifestPath"
}

$targetPackage = Get-Content -Raw -LiteralPath $TargetPackageJson |
  ConvertFrom-Json
if ($targetPackage.name -ne "superpower-codex-mcp") {
  throw "Unexpected package name '$($targetPackage.name)' at $InstallPath"
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npm) {
  throw "npm.cmd was not found. Install a supported Node.js release first."
}
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) {
  throw "node.exe was not found. Install a supported Node.js release first."
}
$nodeVersion = & $node.Source -p "process.versions.node"
if ($LASTEXITCODE -ne 0) {
  throw "Unable to determine the Node.js version."
}
$nodeSemVer = [version]$nodeVersion
$supportedNode = (
  ($nodeSemVer.Major -eq 20 -and $nodeSemVer -ge [version]"20.19.0") -or
  ($nodeSemVer.Major -ge 22 -and $nodeSemVer -ge [version]"22.12.0")
)
if (-not $supportedNode) {
  throw "Unsupported Node.js $nodeVersion. Use Node.js 20.19+ or 22.12+."
}

$manifestLines = Get-Content -LiteralPath $ManifestPath
foreach ($line in $manifestLines) {
  if ($line -notmatch '^([0-9a-f]{64})  (.+)$') {
    throw "Invalid payload manifest entry: $line"
  }
  $expectedHash = $Matches[1]
  $relativePath = $Matches[2].Replace("/", [System.IO.Path]::DirectorySeparatorChar)
  $payloadFile = Join-Path $PayloadPath $relativePath
  if (-not (Test-Path -LiteralPath $payloadFile -PathType Leaf)) {
    throw "Payload file is missing: $relativePath"
  }
  $actualHash = (Get-FileHash -LiteralPath $payloadFile -Algorithm SHA256).
    Hash.ToLower()
  if ($actualHash -ne $expectedHash) {
    throw "Payload integrity check failed: $relativePath"
  }
}

$version = (Get-Content -Raw -LiteralPath (Join-Path $PayloadPath "package.json") |
  ConvertFrom-Json).version
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $InstallPath ".update-backups\v$version-$timestamp"
New-Item -ItemType Directory -Path $backupPath -Force | Out-Null

$backupItems = @(
  "dist",
  "package.json",
  "package-lock.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "scripts"
)
$existingItems = @{}
foreach ($item in $backupItems) {
  $source = Join-Path $InstallPath $item
  $existingItems[$item] = Test-Path -LiteralPath $source
  if ($existingItems[$item]) {
    Copy-Item -LiteralPath $source -Destination $backupPath -Recurse -Force
  }
}

try {
  $targetDist = Join-Path $InstallPath "dist"
  if (Test-Path -LiteralPath $targetDist) {
    Remove-Item -LiteralPath $targetDist -Recurse -Force
  }
  Copy-Item -Path (Join-Path $PayloadPath "*") -Destination $InstallPath `
    -Recurse -Force

  Push-Location $InstallPath
  try {
    & $npm.Source ci --omit=dev
    if ($LASTEXITCODE -ne 0) {
      throw "npm ci --omit=dev failed with exit code $LASTEXITCODE"
    }

    & $node.Source (Join-Path $InstallPath "scripts\verify-install.mjs") `
      $InstallPath
    if ($LASTEXITCODE -ne 0) {
      throw "MCP verification failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
} catch {
  $updateError = $_
  Write-Warning "Update failed. Restoring the previous installation."

  foreach ($item in $backupItems) {
    $target = Join-Path $InstallPath $item
    if (Test-Path -LiteralPath $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
    if ($existingItems[$item]) {
      Copy-Item -LiteralPath (Join-Path $backupPath $item) `
        -Destination $InstallPath -Recurse -Force
    }
  }

  Push-Location $InstallPath
  try {
    & $npm.Source ci --omit=dev
  } catch {
    Write-Warning "Dependency rollback also failed: $($_.Exception.Message)"
  } finally {
    Pop-Location
  }
  throw $updateError
}

Write-Host "Updated superpower-codex-mcp to v$version."
Write-Host "Backup: $backupPath"
Write-Host "Restart Codex Desktop to load the updated MCP server."
