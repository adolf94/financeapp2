---
name: github-issues
description: >
  Use this skill whenever the user asks to create, close, reopen, or list GitHub Issues
  for this project — including when they say a PBI or Bug is "done", "complete", or "finished",
  or when they ask to push a plan to GitHub.
---

# GitHub Issues Integration

## Overview

This project syncs local plan files (`plans/*.md`) with GitHub Issues on `adolf94/financeapp2`.

All GitHub operations go through a single PowerShell script. Never call the GitHub API directly — always use the script.

## Key Paths

| Resource | Path |
|---|---|
| Script | `.agents/scripts/github-issues.ps1` |
| PAT + repo config | `.agents/github.env` (gitignored, never commit) |
| Plan files | `plans/` |

## Plan File Frontmatter

Every plan file that has been pushed to GitHub will have a YAML frontmatter block at the top:

```markdown
---
github_issue: 3
github_url: https://github.com/adolf94/financeapp2/issues/3
status: open
---
# PBI 003: Short Title
...
```

**`status`** reflects the current GitHub state: `open` or `closed`.

The script maintains this automatically — you do not need to edit it manually.

### Reading local status
Before hitting the GitHub API, always check the frontmatter `status` field to know if a PBI/Bug is open or closed without needing a network call. Only call the API if the local file has no frontmatter yet.

## Script Usage

Always run from the repo root (`D:\Users\adolf\source\repos\finance3`):

```powershell
# Test connection
powershell -NoProfile -ExecutionPolicy Bypass -File ".agents\scripts\github-issues.ps1" -Action test

# List open issues
powershell -NoProfile -ExecutionPolicy Bypass -File ".agents\scripts\github-issues.ps1" -Action list

# Create issue from a plan file (also writes frontmatter back to the file)
powershell -NoProfile -ExecutionPolicy Bypass -File ".agents\scripts\github-issues.ps1" -Action create -File "plans\PBI-003-Manual-RUNBOOK-Editing-in-Review-Chat.md"

# Close by issue number (also updates status in any matching local plan file)
powershell -NoProfile -ExecutionPolicy Bypass -File ".agents\scripts\github-issues.ps1" -Action close -IssueNumber 3

# Close by plan file (reads github_issue from frontmatter, falls back to title search)
powershell -NoProfile -ExecutionPolicy Bypass -File ".agents\scripts\github-issues.ps1" -Action close -File "plans\PBI-003-Manual-RUNBOOK-Editing-in-Review-Chat.md"

# Reopen an issue
powershell -NoProfile -ExecutionPolicy Bypass -File ".agents\scripts\github-issues.ps1" -Action reopen -IssueNumber 3
```

## Plan File Conventions

### Naming
Files are named using the **GitHub Issue number** (not a local sequence):
- `PBI-{github_issue}-Short-Title.md` → label: `enhancement`
- `Bug-{github_issue}-Short-Title.md` → label: `bug`

Example: a new PBI that becomes GitHub Issue #14 → `PBI-014-My-Feature.md`

When **creating** a new plan, write it with a temporary placeholder (e.g. `PBI-000-My-Feature.md`). The script will automatically rename it to `PBI-014-My-Feature.md` after the issue is created.

### Structure
```markdown
---
github_issue: <number>      ← added automatically after first push
github_url: <url>           ← added automatically after first push
status: open                ← updated by close/reopen actions
---
# PBI : Short Human-Readable Title

## Description
...rest of the plan...
```

The first `# H1` line becomes the GitHub Issue **title**. Everything after it becomes the **body**.

## Agent Workflow

### When user asks to "create a PBI/Bug":
1. Determine next sequence number by scanning `plans/` filenames
2. Write the plan file to `plans/` following naming convention above (no frontmatter yet)
3. Run the `create` action — it will push to GitHub and write frontmatter automatically
4. Report the issue number and URL

### When user says a PBI/Bug is "done", "complete", "finished", or "close it":
1. Identify the plan file from context (check frontmatter `github_issue` for the number)
2. Run the `close` action with `-File` pointing to the plan
3. Script updates GitHub + local frontmatter `status: closed`
4. **Update `spec.md`**: Read the closed plan file, then apply the `spec-updater` skill to reflect the completed feature/change in `spec.md`. Focus on:
   - New API endpoints → Section 4.4
   - New DB models / containers / fields → Section 4.2
   - New frontend components or hooks → Section 4.3
   - New architectural patterns → Section 4.1
5. Report confirmation (issue URL + which spec.md sections were updated)

### When user says "reopen" or "it's not done yet":
1. Run the `reopen` action
2. Script updates GitHub + local frontmatter `status: open`
3. Report confirmation

### Checking local status without API:
Read the frontmatter of any plan file. If `status: closed`, it's done. If `status: open` or no frontmatter, it's open/not yet pushed.

### Determining next PBI/Bug number:
- Scan filenames in `plans/` and use the next sequence number

## Label Mapping

| File prefix | GitHub label applied |
|---|---|
| `Bug-*` | `bug` |
| `PBI-*` | `enhancement` |

Extra labels can be added via `-Labels "label1,label2"`.
