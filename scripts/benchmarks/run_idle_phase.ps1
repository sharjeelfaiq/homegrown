param(
    [ValidateSet('baseline', 'candidate')][string]$Phase = 'baseline'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$python = Join-Path $repo '.venv/Scripts/python.exe'
$backend = Join-Path $repo 'services/voice-api'
$queue = Invoke-RestMethod 'http://127.0.0.1:8000/api/queue'
if (@($queue.queue | Where-Object { $_.status -in @('queued', 'running', 'canceling') }).Count) {
    throw 'Generation is active; defer the benchmark.'
}
$allProcesses = @(Get-CimInstance Win32_Process)
$processes = @($allProcesses | Where-Object {
    $_.Name -eq 'python.exe' -and ($_.ExecutablePath -eq $python -or $_.CommandLine -like "$python *") `
        -and $_.CommandLine -match '-m uvicorn homegrown_api\.app:app --host 127\.0\.0\.1 --port 8000(\s|$)'
})
if (!$processes.Count) { throw 'Cannot identify original backend; leave it running.' }
$restoreDev = $false
foreach ($process in $processes) {
    $ancestor = $process
    for ($depth = 0; $depth -lt 10 -and $ancestor; $depth++) {
        if ($ancestor.Name -eq 'node.exe' -and $ancestor.CommandLine -match 'scripts[\\/]dev\.mjs') {
            $restoreDev = $true
            break
        }
        $parentId = $ancestor.ParentProcessId
        $ancestor = $allProcesses | Where-Object { $_.ProcessId -eq $parentId } | Select-Object -First 1
    }
}
$arguments = @('scripts/benchmarks/voice_generation.py', '--phase', $Phase,
    '--output', ".tmp/voice-speed/$Phase", '--budget-seconds', '600')
if ($Phase -eq 'candidate') { $arguments += @('--baseline', '.tmp/voice-speed/baseline') }
# Repeat the live check immediately before stopping; never cancel jobs.
$queue = Invoke-RestMethod 'http://127.0.0.1:8000/api/queue'
if (@($queue.queue | Where-Object { $_.status -in @('queued', 'running', 'canceling') }).Count) {
    throw 'Generation became active; defer the benchmark.'
}
try {
    $processes | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
    Push-Location $repo
    try {
        & $python @arguments
        if ($LASTEXITCODE -ne 0) { throw "Benchmark failed: $LASTEXITCODE" }
    } finally { Pop-Location }
} finally {
    # A user may have restarted the app meanwhile. Never replace that process
    # or launch a competing model instance.
    $alreadyRunning = $false
    try {
        $null = Invoke-RestMethod 'http://127.0.0.1:8000/api/health' -TimeoutSec 2
        $alreadyRunning = $true
    } catch { }
    if (!$alreadyRunning) {
        $restoreExecutable = $python
        $restoreArguments = @('-X', 'faulthandler', '-m', 'uvicorn',
            'homegrown_api.app:app', '--host', '127.0.0.1', '--port', '8000')
        $restoreDirectory = $backend
        if ($restoreDev) {
            $restoreExecutable = 'node'
            $restoreArguments = @('scripts/dev.mjs')
            $restoreDirectory = $repo
        }
        Start-Process -FilePath $restoreExecutable -ArgumentList $restoreArguments -WorkingDirectory $restoreDirectory `
            -WindowStyle Hidden -RedirectStandardOutput (Join-Path $repo ".tmp/voice-speed/backend-$Phase.stdout.log") `
            -RedirectStandardError (Join-Path $repo ".tmp/voice-speed/backend-$Phase.stderr.log")
    }
}
