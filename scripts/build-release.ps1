[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Get-RelativePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$BasePath,
    [Parameter(Mandatory = $true)]
    [string]$FullPath
  )

  $baseFullPath = [System.IO.Path]::GetFullPath($BasePath).
    TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
    [System.IO.Path]::DirectorySeparatorChar
  $baseUri = [uri]$baseFullPath
  $fullUri = [uri][System.IO.Path]::GetFullPath($FullPath)
  return [uri]::UnescapeDataString(
    $baseUri.MakeRelativeUri($fullUri).ToString()
  ).Replace("/", [System.IO.Path]::DirectorySeparatorChar)
}

$package = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot "package.json") |
  ConvertFrom-Json
$version = $package.version
$releaseRoot = Join-Path $RepoRoot "release"
$stageRoot = Join-Path $releaseRoot "superpower-codex-mcp-v$version-windows"
$payload = Join-Path $stageRoot "payload"

if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $payload -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $payload "scripts") -Force |
  Out-Null
New-Item -ItemType Directory -Path (Join-Path $stageRoot "scripts") -Force |
  Out-Null

Push-Location $RepoRoot
try {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) {
    throw "npm ci failed with exit code $LASTEXITCODE"
  }
  & npm.cmd test
  if ($LASTEXITCODE -ne 0) {
    throw "Tests failed with exit code $LASTEXITCODE"
  }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) {
    throw "Build failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$payloadItems = @(
  "dist",
  "package.json",
  "package-lock.json",
  "README.md",
  "CHANGELOG.md",
  "LICENSE"
)
foreach ($item in $payloadItems) {
  Copy-Item -LiteralPath (Join-Path $RepoRoot $item) -Destination $payload `
    -Recurse -Force
}

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "update-installed.ps1") `
  -Destination (Join-Path $stageRoot "scripts") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "verify-install.mjs") `
  -Destination (Join-Path $stageRoot "scripts") -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "verify-install.mjs") `
  -Destination (Join-Path $payload "scripts") -Force

$manifestLines = Get-ChildItem -LiteralPath $payload -Recurse -File |
  Sort-Object FullName |
  ForEach-Object {
    $relativePath = (Get-RelativePath -BasePath $payload `
      -FullPath $_.FullName).Replace("\", "/")
    $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).
      Hash.ToLower()
    "$hash  $relativePath"
  }
Set-Content -LiteralPath (Join-Path $stageRoot "payload-manifest.sha256") `
  -Value $manifestLines -Encoding ascii

$instructions = @"
superpower-codex-mcp v$version Windows update

Run from PowerShell:

  powershell -NoProfile -ExecutionPolicy Bypass `
    -File .\scripts\update-installed.ps1 `
    -InstallPath "C:\path\to\superpower-codex-mcp"

The updater creates a backup, installs production dependencies, verifies MCP
tool discovery, and prompts you to restart Codex Desktop.
"@
Set-Content -LiteralPath (Join-Path $stageRoot "UPDATE.txt") `
  -Value $instructions -Encoding utf8

$zipPath = Join-Path $releaseRoot `
  "superpower-codex-mcp-v$version-windows.zip"
if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

$fixedTimestamp = [datetimeoffset]"2020-01-01T00:00:00Z"
Add-Type -AssemblyName System.IO.Compression
$zipStream = [System.IO.File]::Open(
  $zipPath,
  [System.IO.FileMode]::CreateNew
)
try {
  $archive = [System.IO.Compression.ZipArchive]::new(
    $zipStream,
    [System.IO.Compression.ZipArchiveMode]::Create,
    $false
  )
  try {
    $prefix = [System.IO.Path]::GetFileName($stageRoot)
    Get-ChildItem -LiteralPath $stageRoot -Recurse -File |
      Sort-Object FullName |
      ForEach-Object {
        $relativePath = (Get-RelativePath -BasePath $stageRoot `
          -FullPath $_.FullName).Replace("\", "/")
        $entry = $archive.CreateEntry(
          "$prefix/$relativePath",
          [System.IO.Compression.CompressionLevel]::Optimal
        )
        $entry.LastWriteTime = $fixedTimestamp
        $inputStream = [System.IO.File]::OpenRead($_.FullName)
        $outputStream = $entry.Open()
        try {
          $inputStream.CopyTo($outputStream)
        } finally {
          $outputStream.Dispose()
          $inputStream.Dispose()
        }
      }
  } finally {
    $archive.Dispose()
  }
} finally {
  $zipStream.Dispose()
}

$hash = Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
$hashLine = "$($hash.Hash.ToLower())  $([System.IO.Path]::GetFileName($zipPath))"
Set-Content -LiteralPath "$zipPath.sha256" -Value $hashLine -Encoding ascii

Write-Host "Created $zipPath"
Write-Host "Created $zipPath.sha256"
