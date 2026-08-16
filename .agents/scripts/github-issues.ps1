# GitHub Issues Integration Script
# Usage:
#   -Action test                          : test API connectivity
#   -Action list                          : list open issues
#   -Action create  -File <path>          : create issue from a plan .md file
#   -Action close   -IssueNumber <n>      : close issue by number
#   -Action close   -File <path>          : close issue matched by plan title
#   -Action reopen  -IssueNumber <n>      : reopen a closed issue

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("list","create","close","reopen","test")]
    [string]$Action,

    [string]$File,
    [string]$Labels = "",
    [string]$Milestone = "",
    [int]$IssueNumber = 0
)

# --- Load env ---
$envFile = "$PSScriptRoot\..\github.env"
if (-not (Test-Path $envFile)) { Write-Error "Missing $envFile"; exit 1 }

$envVars = @{}
Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and $line -notmatch '^#') {
        $kv = $line -split '=', 2
        $envVars[$kv[0].Trim()] = $kv[1].Trim()
    }
}

$PAT  = $envVars["GITHUB_PAT"]
$REPO = $envVars["GITHUB_REPO"]

if (-not $PAT -or -not $REPO) { Write-Error "GITHUB_PAT or GITHUB_REPO missing in github.env"; exit 1 }

$headers = @{
    Authorization        = "Bearer $PAT"
    Accept               = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
}

$baseUrl = "https://api.github.com/repos/$REPO"

# --- Helper: read frontmatter fields from a plan file ---
# Returns a hashtable of frontmatter key/value pairs, or empty hashtable if none.
function Read-Frontmatter {
    param([string]$FilePath)
    $result = @{}
    $raw = Get-Content $FilePath -Raw
    if ($raw -match '(?s)^---\r?\n(.+?)\r?\n---\r?\n') {
        $block = $Matches[1]
        $block -split "`n" | ForEach-Object {
            $line = $_.Trim()
            if ($line -match '^(\w[\w_-]*):\s*(.*)$') {
                $result[$Matches[1]] = $Matches[2].Trim()
            }
        }
    }
    return $result
}

# --- Helper: upsert frontmatter in a plan file ---
# Merges $updates into existing frontmatter (or creates it), rewrites file.
function Update-Frontmatter {
    param([string]$FilePath, [hashtable]$Updates)
    $raw = Get-Content $FilePath -Raw -Encoding UTF8

    $existing = @{}
    $body = $raw

    if ($raw -match '(?s)^---\r?\n(.+?)\r?\n---\r?\n(.*)$') {
        $fmBlock = $Matches[1]
        $body    = $Matches[2]
        $fmBlock -split "`n" | ForEach-Object {
            $line = $_.Trim()
            if ($line -match '^(\w[\w_-]*):\s*(.*)$') {
                $existing[$Matches[1]] = $Matches[2].Trim()
            }
        }
    }

    # Merge updates into existing
    foreach ($k in $Updates.Keys) { $existing[$k] = $Updates[$k] }

    # Rebuild frontmatter block (consistent key order)
    $fmLines = @()
    foreach ($k in ($existing.Keys | Sort-Object)) {
        $fmLines += "${k}: $($existing[$k])"
    }

    $newContent = "---`n" + ($fmLines -join "`n") + "`n---`n" + $body.TrimStart("`r","`n")
    [System.IO.File]::WriteAllText($FilePath, $newContent, [System.Text.Encoding]::UTF8)
    Write-Host "Updated frontmatter in: $(Split-Path $FilePath -Leaf)"
}

# --- Helper: resolve issue number — prefers frontmatter, falls back to title search ---
function Resolve-IssueNumber {
    param([string]$FilePath)

    # Fast path: frontmatter has github_issue
    $fm = Read-Frontmatter -FilePath $FilePath
    if ($fm.ContainsKey("github_issue") -and $fm["github_issue"] -match '^\d+$') {
        return [int]$fm["github_issue"]
    }

    # Slow path: search by title
    $content = Get-Content $FilePath -Raw
    $titleMatch = [regex]::Match($content, '^#\s+(.+)$', [System.Text.RegularExpressions.RegexOptions]::Multiline)
    if (-not $titleMatch.Success) { Write-Error "Could not extract title from $FilePath"; exit 1 }
    $title = $titleMatch.Groups[1].Value.Trim()

    $page = 1
    do {
        $batch = Invoke-RestMethod -Uri "$baseUrl/issues?state=all&per_page=50&page=$page" -Headers $headers -Method Get
        $match = $batch | Where-Object { $_.title -eq $title } | Select-Object -First 1
        if ($match) { return $match.number }
        $page++
    } while ($batch.Count -eq 50)

    Write-Error "No GitHub Issue found with title: $title"
    exit 1
}

# --- Actions ---

if ($Action -eq "test") {
    $repo = Invoke-RestMethod -Uri $baseUrl -Headers $headers -Method Get
    Write-Host "Connected to: $($repo.full_name)"
    Write-Host "Issues enabled: $($repo.has_issues)"
    exit 0
}

if ($Action -eq "list") {
    $issues = Invoke-RestMethod -Uri "$baseUrl/issues?state=open&per_page=30" -Headers $headers -Method Get
    $issues | ForEach-Object {
        $labelList = ($_.labels | ForEach-Object { $_.name }) -join ", "
        Write-Host "#$($_.number) [$($_.state.ToUpper())] $($_.title)  labels=[$labelList]"
    }
    exit 0
}

if ($Action -eq "create") {
    if (-not $File) { Write-Error "-File is required for create action"; exit 1 }
    if (-not (Test-Path $File)) { Write-Error "File not found: $File"; exit 1 }

    $content = Get-Content $File -Raw

    # Strip frontmatter before parsing title/body
    $contentBody = $content
    if ($content -match '(?s)^---\r?\n.+?\r?\n---\r?\n(.*)$') {
        $contentBody = $Matches[1]
    }

    # Extract title from first H1
    $titleMatch = [regex]::Match($contentBody, '^#\s+(.+)$', [System.Text.RegularExpressions.RegexOptions]::Multiline)
    $title = if ($titleMatch.Success) { $titleMatch.Groups[1].Value.Trim() } else { [System.IO.Path]::GetFileNameWithoutExtension($File) }

    # Determine type label from filename
    $filename = [System.IO.Path]::GetFileName($File)
    $autoLabel = @()
    if ($filename -match '^Bug') { $autoLabel += "bug" }
    elseif ($filename -match '^PBI') { $autoLabel += "enhancement" }

    # Merge with any extra labels passed in
    if ($Labels) { $autoLabel += $Labels -split ',' | ForEach-Object { $_.Trim() } }
    $labelArray = $autoLabel | Select-Object -Unique

    # Build body — skip the H1 line
    $body = ($contentBody -split "`n" | Select-Object -Skip 1) -join "`n"
    $body = $body.TrimStart("`n", "`r")

    $payload = [ordered]@{
        title  = $title
        body   = $body
        labels = @($labelArray)
    } | ConvertTo-Json -Depth 5 -Compress

    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)

    Write-Host "Creating issue: $title"
    Write-Host "Labels: $($labelArray -join ', ')"

    $result = Invoke-RestMethod -Uri "$baseUrl/issues" -Headers $headers -Method Post -Body $bodyBytes -ContentType "application/json; charset=utf-8"
    Write-Host "Created! Issue #$($result.number): $($result.html_url)"

    # Write frontmatter back to local plan file
    Update-Frontmatter -FilePath $File -Updates @{
        github_issue = $result.number
        status       = "open"
        github_url   = $result.html_url
    }

    # Rename file to PBI-{github_id}-Slug.md / Bug-{github_id}-Slug.md (zero-padded to 3 digits)
    $dir      = Split-Path $File -Parent
    $basename = [System.IO.Path]::GetFileNameWithoutExtension($File)
    if ($basename -match '^(PBI|Bug)-\d+-(.+)$') {
        $prefix  = $Matches[1]
        $slug    = $Matches[2]
        $newName = "$prefix-$($result.number.ToString('D3'))-$slug.md"
        $newPath = Join-Path $dir $newName
        if ($newName -ne (Split-Path $File -Leaf)) {
            Rename-Item -Path $File -NewName $newName
            Write-Host "Renamed to: $newName"
            $File = $newPath
        }
    }
    exit 0
}

if ($Action -eq "close" -or $Action -eq "reopen") {
    $targetNumber = $IssueNumber
    $targetFile   = $File

    if ($targetNumber -eq 0) {
        if (-not $targetFile) { Write-Error "Provide -IssueNumber or -File"; exit 1 }
        $targetNumber = Resolve-IssueNumber -FilePath $targetFile
    }

    $newState    = if ($Action -eq "close") { "closed" } else { "open" }
    $stateReason = if ($Action -eq "close") { "completed" } else { "reopened" }

    $payload   = [ordered]@{ state = $newState; state_reason = $stateReason } | ConvertTo-Json -Compress
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($payload)

    $result = Invoke-RestMethod -Uri "$baseUrl/issues/$targetNumber" -Headers $headers -Method Patch -Body $bodyBytes -ContentType "application/json; charset=utf-8"
    Write-Host "Issue #$targetNumber is now [$($result.state.ToUpper())]: $($result.html_url)"

    # Update local plan file frontmatter if we have a file reference
    if ($targetFile -and (Test-Path $targetFile)) {
        Update-Frontmatter -FilePath $targetFile -Updates @{ status = $newState }
    } else {
        # Try to find the plan file by scanning frontmatter for matching github_issue
        $plansDir = [System.IO.Path]::GetFullPath("$PSScriptRoot\..\..\plans")
        if (Test-Path $plansDir) {
            $found = Get-ChildItem $plansDir -Filter "*.md" | Where-Object {
                $fm = Read-Frontmatter -FilePath $_.FullName
                $fm.ContainsKey("github_issue") -and [int]$fm["github_issue"] -eq $targetNumber
            } | Select-Object -First 1

            if ($found) {
                Update-Frontmatter -FilePath $found.FullName -Updates @{ status = $newState }
            } else {
                Write-Host "Note: could not find a local plan file for issue #$targetNumber - frontmatter not updated."
            }
        }
    }
    exit 0
}
