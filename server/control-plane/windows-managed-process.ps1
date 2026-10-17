Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$workerProcess = $null
$released = $false
try {
    $controlInput = [IO.StreamReader]::new([Console]::OpenStandardInput())
    $request = $controlInput.ReadLine() | ConvertFrom-Json -AsHashtable
    foreach ($entry in $request.environment.GetEnumerator()) { [Environment]::SetEnvironmentVariable([string]$entry.Key, [string]$entry.Value, 'Process') }
    Add-Type -Path (Join-Path $PSScriptRoot 'WindowsManagedProcess.cs')
    $workerProcess = [RsSdkManagedProcess]::Start($request.executable, $request.worker, $request.cwd, $request.stdout, $request.stderr)
    $command = $controlInput.ReadLineAsync()
    while (-not $command.IsCompleted) {
        if ($workerProcess.HasExited) { throw 'Managed worker exited before handoff.' }
        Start-Sleep -Milliseconds 50
    }
    if ($command.GetAwaiter().GetResult() -ne 'release' -or $workerProcess.HasExited) { throw 'Managed worker startup was not accepted.' }
    $released = $true
} catch {
    [Console]::Error.WriteLine('Managed process launch or handoff failed; private worker logs retained.')
    exit 1
} finally {
    if ($null -ne $workerProcess -and -not $released -and -not $workerProcess.HasExited) {
        $workerProcess.Kill()
        $workerProcess.WaitForExit()
    }
    if ($null -ne $workerProcess) { $workerProcess.Dispose() }
}
