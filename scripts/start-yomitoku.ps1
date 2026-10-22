param([switch]$InstallOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$envDir = Join-Path $projectRoot '.build-tools\yomitoku-env'
$env:HF_HOME = Join-Path $projectRoot '.build-tools\yomitoku-models'
$pythonExe = Join-Path $envDir 'Scripts\python.exe'
if (-not (Test-Path -LiteralPath $pythonExe)) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundledPython) { $basePython = $bundledPython }
    elseif (Get-Command py -ErrorAction SilentlyContinue) { $basePython = (& py -3 -c 'import sys; print(sys.executable)') }
    else { $basePython = 'python' }
    & $basePython -m venv $envDir
    if ($LASTEXITCODE -ne 0) { throw 'Please install Python 3.10-3.13.' }
}
& $pythonExe -c 'import yomitoku, torch, cv2' 2>$null
if ($LASTEXITCODE -ne 0) {
    & $pythonExe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
    if ($LASTEXITCODE -ne 0) { throw 'CPU PyTorch installation failed.' }
    & $pythonExe -m pip install 'yomitoku==0.15.1'
    if ($LASTEXITCODE -ne 0) { throw 'YomiToku installation failed.' }
}
if (-not $InstallOnly) { & $pythonExe (Join-Path $PSScriptRoot 'yomitoku_service.py') }
