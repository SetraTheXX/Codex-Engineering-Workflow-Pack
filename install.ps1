param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("repo", "global")]
    [string]$Mode,

    [string]$Target,

    [switch]$Force
)

$ErrorActionPreference = "Stop"

$skillNames = @(
    "setup-codex-engineering-workflow",
    "diagnose",
    "tdd",
    "grill-with-docs",
    "to-prd",
    "to-issues",
    "handoff",
    "zoom-out",
    "prototype",
    "improve-codebase-architecture"
)

$sourceRoot = Join-Path -Path $PSScriptRoot -ChildPath ".agents\skills"

if (-not (Test-Path -LiteralPath $sourceRoot)) {
    throw "Source skills folder not found: $sourceRoot"
}

if ($Mode -eq "repo") {
    if ([string]::IsNullOrWhiteSpace($Target)) {
        throw "Repo mode requires -Target."
    }

    if (-not (Test-Path -LiteralPath $Target)) {
        throw "Target repo path does not exist: $Target"
    }

    $targetRoot = Join-Path -Path $Target -ChildPath ".agents\skills"
} else {
    $targetRoot = Join-Path -Path $HOME -ChildPath ".agents\skills"
}

New-Item -ItemType Directory -Force -Path $targetRoot | Out-Null

Write-Host "Installing Codex Engineering Workflow Pack v0.1"
Write-Host "Mode: $Mode"
Write-Host "Source: $sourceRoot"
Write-Host "Target: $targetRoot"

$copied = New-Object System.Collections.Generic.List[string]
$skipped = New-Object System.Collections.Generic.List[string]

foreach ($skillName in $skillNames) {
    $sourceSkill = Join-Path -Path $sourceRoot -ChildPath $skillName
    $targetSkill = Join-Path -Path $targetRoot -ChildPath $skillName

    if (-not (Test-Path -LiteralPath $sourceSkill)) {
        Write-Warning "Missing source skill: $skillName"
        continue
    }

    if ((Test-Path -LiteralPath $targetSkill) -and -not $Force) {
        Write-Warning "Skipping existing skill without -Force: $skillName"
        $skipped.Add($skillName) | Out-Null
        continue
    }

    New-Item -ItemType Directory -Force -Path $targetSkill | Out-Null
    Copy-Item -Path (Join-Path -Path $sourceSkill -ChildPath "*") -Destination $targetSkill -Recurse -Force
    $copied.Add($skillName) | Out-Null
    Write-Host "Copied: $skillName"
}

Write-Host ""
Write-Host "Copied skills:"
if ($copied.Count -eq 0) {
    Write-Host "- none"
} else {
    foreach ($skillName in $copied) {
        Write-Host "- $skillName"
    }
}

if ($skipped.Count -gt 0) {
    Write-Host ""
    Write-Host "Skipped existing skills:"
    foreach ($skillName in $skipped) {
        Write-Host "- $skillName"
    }
}

Write-Host ""
Write-Host "Restart or reload Codex so it can discover installed skills."
