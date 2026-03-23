# PowerShell script to permanently add Git to PATH
$gitPath = "C:\Program Files\Git\bin"
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")

if ($currentPath -notlike "*$gitPath*") {
    [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$gitPath", "User")
    Write-Host "Git added to PATH permanently. Please restart PowerShell to use 'git' command directly."
} else {
    Write-Host "Git is already in PATH."
}

# Also add to current session
$env:PATH += ";$gitPath"
Write-Host "Git available in current session."
