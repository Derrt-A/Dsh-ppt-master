#requires -Version 5.1
<#
.SYNOPSIS
  Install the local engine + Python environment for the dsh-ppt plugin.

.DESCRIPTION
  Creates the data root, downloads ppt-master at a pinned tag (unless an engine
  path is supplied), creates a virtual environment, installs the engine's Python
  requirements, runs the engine integrity gate, and writes settings.json plus the
  git-ignored config.local.json that points this checkout at the data root.

.PARAMETER DataRoot
  Data directory (settings.json, projects, output, engine, .venv).
  Default: $env:DSH_HOME/dsh-ppt, falling back to ~/.dsh/dsh-ppt.

.PARAMETER EnginePath
  Reuse an existing engine root (the directory containing SKILL.md and scripts/).
  Skips the download entirely.

.PARAMETER EngineVersion
  ppt-master git tag to download. Default: v4.7.0 (the validated version).

.PARAMETER Python
  Use an existing Python interpreter instead of creating <DataRoot>/.venv.

.PARAMETER SkipDeps
  Do not run pip install -r requirements.txt.

.PARAMETER Force
  Replace an existing engine checkout and back up/overwrite settings.json.

.PARAMETER SkipLocalConfig
  Do not write config.local.json (useful for CI and temporary installs; pair it
  with the DSH_PPT_DATA environment variable).

.EXAMPLE
  pwsh -File scripts/setup.ps1
  pwsh -File scripts/setup.ps1 -DataRoot D:\ppt-data
  pwsh -File scripts/setup.ps1 -EnginePath C:\tools\ppt-master\skills\ppt-master -SkipDeps
#>
[CmdletBinding()]
param(
  [string]$DataRoot,
  [string]$EnginePath,
  [string]$EngineVersion = 'v4.7.0',
  [string]$Python,
  [switch]$SkipDeps,
  [switch]$Force,
  [switch]$SkipLocalConfig
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

function Write-Step([string]$Message) { Write-Host "[setup] $Message" -ForegroundColor Cyan }
function Write-Warn([string]$Message) { Write-Host "[setup] WARN: $Message" -ForegroundColor Yellow }
function Stop-Setup([string]$Message) { Write-Host "[setup] ERROR: $Message" -ForegroundColor Red; exit 1 }

function Test-EngineRoot([string]$Path) {
  return (Test-Path -LiteralPath (Join-Path $Path 'SKILL.md')) -and
         (Test-Path -LiteralPath (Join-Path $Path 'scripts/attribution_guard.py'))
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}

# --- prerequisites ---------------------------------------------------------
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Stop-Setup 'Node.js >= 22 was not found on PATH.' }
$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { Stop-Setup "Node.js >= 22 is required, found $(& node --version)." }

$git = Get-Command git -ErrorAction SilentlyContinue
if (-not $git) { Stop-Setup 'git was not found on PATH.' }

if (-not $env:DSH_HOME) { $env:DSH_HOME = Join-Path $HOME '.dsh' }
if (-not $DataRoot) { $DataRoot = Join-Path $env:DSH_HOME 'dsh-ppt' }
$DataRoot = [System.IO.Path]::GetFullPath($DataRoot)

Write-Step "data root: $DataRoot"
Write-Step "repository: $RepoRoot"
New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'projects') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $DataRoot 'output') | Out-Null

# --- engine ----------------------------------------------------------------
if ($EnginePath) {
  if (-not (Test-EngineRoot $EnginePath)) { Stop-Setup "not an engine root (SKILL.md + scripts/attribution_guard.py missing): $EnginePath" }
  Write-Step "using existing engine: $EnginePath"
} else {
  $engineRepo = Join-Path $DataRoot 'engine/ppt-master'
  $candidate = Join-Path $engineRepo 'skills/ppt-master'
  if (Test-EngineRoot $candidate) {
    Write-Step "reusing downloaded engine: $candidate"
  } else {
    if (Test-Path -LiteralPath $engineRepo) {
      if (-not $Force) { Stop-Setup "engine directory exists but is incomplete: $engineRepo (rerun with -Force to replace it)" }
      Remove-Item -LiteralPath $engineRepo -Recurse -Force
    }
    Write-Step "downloading ppt-master $EngineVersion ..."
    & git -c core.longpaths=true clone --depth 1 --branch $EngineVersion `
      https://github.com/hugohe3/ppt-master.git $engineRepo
    if ($LASTEXITCODE -ne 0) { Stop-Setup "git clone failed (tag: $EngineVersion)." }
    if (-not (Test-EngineRoot $candidate)) { Stop-Setup "downloaded layout is not the expected engine root: $candidate" }
  }
  $EnginePath = $candidate
}
$EnginePath = [System.IO.Path]::GetFullPath($EnginePath)

$skillVersion = ''
$versionMatch = Select-String -LiteralPath (Join-Path $EnginePath 'SKILL.md') -Pattern '^\s+version:\s*"([^"]+)"' |
  Select-Object -First 1
if ($versionMatch) { $skillVersion = $versionMatch.Matches[0].Groups[1].Value }
if ($skillVersion -and $skillVersion -ne '4.7.0') {
  Write-Warn "engine $skillVersion detected; this plugin is validated against 4.7.0."
}

# --- python ----------------------------------------------------------------
if ($Python) {
  if (-not (Test-Path -LiteralPath $Python)) { Stop-Setup "Python interpreter not found: $Python" }
  $Python = [System.IO.Path]::GetFullPath($Python)
  Write-Step "using existing interpreter: $Python"
} else {
  $venv = Join-Path $DataRoot '.venv'
  $venvPython = Join-Path $venv 'Scripts/python.exe'
  if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Step "creating virtual environment: $venv"
    $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
    if ($pyLauncher) { & py -3 -m venv $venv }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPython)) {
      & python -m venv $venv
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPython)) { Stop-Setup 'failed to create the virtual environment.' }
  }
  $Python = $venvPython
}

$pyVersion = (& $Python -c "import sys; print('%d.%d' % sys.version_info[:2])").Trim()
$pyParts = $pyVersion.Split('.')
if ([int]$pyParts[0] -lt 3 -or ([int]$pyParts[0] -eq 3 -and [int]$pyParts[1] -lt 10)) {
  Stop-Setup "Python >= 3.10 is required, found $pyVersion."
}
Write-Step "python: $Python ($pyVersion)"

if (-not $SkipDeps) {
  Write-Step 'installing engine requirements (this can take several minutes) ...'
  & $Python -m pip install --upgrade pip
  if ($LASTEXITCODE -ne 0) { Stop-Setup 'pip upgrade failed.' }
  & $Python -m pip install -r (Join-Path $EnginePath 'requirements.txt')
  if ($LASTEXITCODE -ne 0) { Stop-Setup 'pip install -r requirements.txt failed.' }
} else {
  Write-Step 'skipping Python dependencies (-SkipDeps)'
}

# --- integrity gate --------------------------------------------------------
Write-Step 'running engine attribution guard ...'
& $Python (Join-Path $EnginePath 'scripts/attribution_guard.py')
if ($LASTEXITCODE -ne 0) {
  Stop-Setup "engine integrity check failed (exit $LASTEXITCODE). Re-download the engine; do not edit its attribution files."
}

# --- settings --------------------------------------------------------------
$settingsPath = Join-Path $DataRoot 'settings.json'
if ((Test-Path -LiteralPath $settingsPath) -and -not $Force) {
  Copy-Item -LiteralPath $settingsPath -Destination "$settingsPath.bak" -Force
  Write-Step "existing settings backed up to settings.json.bak"
}
$settingsJson = @"
{
  "input_mode": "sources_only",
  "language": "zh",
  "canvas": "16:9",
  "image_backend": "none",
  "audio": false,
  "critic": {
    "enabled": true,
    "target": "both",
    "max_rounds": 2,
    "checklist": "four_dimensions"
  },
  "engine_root": $($EnginePath | ConvertTo-Json -Compress),
  "python": $($Python | ConvertTo-Json -Compress)
}
"@
Write-Utf8NoBom $settingsPath ($settingsJson + "`n")

if (-not $SkipLocalConfig) {
  $configPath = Join-Path $RepoRoot 'config.local.json'
  $configJson = @"
{
  "dataRoot": $($DataRoot | ConvertTo-Json -Compress)
}
"@
  Write-Utf8NoBom $configPath ($configJson + "`n")
  Write-Step "wrote $configPath"
}

& $Python -c "import json,sys; json.load(open(sys.argv[1], encoding='utf-8')); print('[setup] settings JSON OK')" $settingsPath
if ($LASTEXITCODE -ne 0) { Stop-Setup 'settings.json is not valid JSON.' }

Write-Host ''
Write-Step 'installation data is ready.'
Write-Host "  settings : $settingsPath"
Write-Host "  engine   : $EnginePath"
Write-Host "  python   : $Python"
Write-Host ''
Write-Host '  Next steps:' -ForegroundColor Green
Write-Host "    dsh plugin --profile web add link:$RepoRoot"
Write-Host '    restart your DSH Web host, then call ppt_status with no arguments.'
Write-Host ''
