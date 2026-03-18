---
description: Create or update a GitHub pull request from the current branch
---

Create or update a pull request for the current branch. Generates a title from the changes and lists commits in the description. Breaking changes are highlighted.

Only run commands listed in `allowed_commands`. Never run commands in `forbidden_commands` or any command that modifies files, branches, or commit history.

## Workflow

### Step 1: Validate branch state

```bash
git rev-parse --abbrev-ref HEAD
gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --json number,url,state --jq '.[] | select(.state == "OPEN")'
```

- If on `main`: stop with an error — PRs should not be created from the default branch.
- Note whether an open PR already exists. If so, you will **update** it instead of creating a new one.

### Step 2: Rebase on latest main

```bash
git fetch origin
git rebase origin/main
```

- If the rebase fails due to conflicts, stop and report the conflicting files. Do **not** continue with the PR.
- If the rebase succeeds with no changes (branch is already up to date), continue normally.

### Step 3: Ensure branch is pushed

```bash
git status --porcelain
git log @{upstream}..HEAD --oneline 2>/dev/null
```

- If there are uncommitted changes, warn the user and ask whether to proceed.
- If the branch has no upstream or has unpushed commits, push it:
  ```bash
  git push --force-with-lease -u origin HEAD
  ```

### Step 4: Collect commits

**Important:** `git log main..HEAD` is unreliable when previous PRs were squash-merged — it will include commits whose changes are already on main. Instead, use `git cherry` to find only commits not yet merged:

```bash
git cherry -v origin/main HEAD
```

This outputs lines prefixed with `+` (unmerged) or `-` (already merged). Only use `+` lines. The format is `+ <sha> <subject>`.

For each unmerged commit, get the full details:

```bash
git log <sha> -1 --format='%s%n%b%n---'
```

Parse each commit:
- **Subject line**: the first line (`%s`)
- **Body**: everything after the first line (`%b`)
- **Breaking**: a commit is breaking if its subject contains `!:` (e.g., `feat!:`, `fix(scope)!:`) OR its body contains `BREAKING CHANGE:` or `BREAKING-CHANGE:`

### Step 5: Generate PR title

Analyze all commit subjects to produce a concise PR title:

- If there is **one commit**: use its subject line as-is (strip any conventional commit prefix like `feat: `, `fix: `, etc.)
- If there are **multiple commits**:
  - Look at the conventional commit types used (feat, fix, refactor, chore, etc.)
  - Summarize the overall theme in a short imperative sentence (e.g., "Add theme support and fix stale session cleanup")
  - If all commits share one type, reflect that (e.g., all `fix:` → "Fix ...")
  - Keep it under ~72 characters

### Step 6: Build PR description

Construct the body using this structure:

```
## Changes

- <commit subject 1>
- <commit subject 2>
- ...
```

If **any commits are breaking**, add a section:

```
## Breaking Changes

- <breaking commit subject>: <explanation from commit body if available>
```

Do NOT include merge commits or fixup commits in the list.

### Step 7: Create or update the PR

**If no open PR exists** (from Step 1):

```bash
gh pr create --base main --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

**If an open PR already exists**:

```bash
gh pr edit <number> --title "<title>" --body "$(cat <<'EOF'
<body>
EOF
)"
```

### Step 8: Report result

Output the PR URL and a brief summary:

```
PR <created|updated>: <url>
Title: <title>
Commits: <count>
Breaking changes: <count or "none">
```

<user-request>
$ARGUMENTS
</user-request>
