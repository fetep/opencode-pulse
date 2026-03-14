---
description: Create or update a GitHub pull request from the current branch
---

Create or update a pull request for the current branch. Generates a title from the changes and lists commits in the description. Breaking changes are highlighted.

## Workflow

### Step 1: Validate branch state

Run these commands to gather context:

```bash
git rev-parse --abbrev-ref HEAD
git remote show origin | grep 'HEAD branch'
gh pr list --head "$(git rev-parse --abbrev-ref HEAD)" --json number,url,state --jq '.[] | select(.state == "OPEN")'
```

- If on the default branch (main/master): stop with an error — PRs should not be created from the default branch.
- Note whether an open PR already exists for this branch. If so, you will **update** it instead of creating a new one.
- Note the default branch name (main or master) — this is the base branch.

### Step 2: Ensure branch is pushed

```bash
git status --porcelain
git log @{upstream}..HEAD --oneline 2>/dev/null
```

- If there are uncommitted changes, warn the user and ask whether to proceed.
- If the branch has no upstream or has unpushed commits, push it:
  ```bash
  git push -u origin HEAD
  ```

### Step 3: Collect commits

Get all commits on this branch that are not on the base branch:

```bash
git log <base>..HEAD --format='%s%n%b%n---'
```

Replace `<base>` with the default branch name from Step 1.

Parse each commit:
- **Subject line**: the first line (`%s`)
- **Body**: everything after the first line (`%b`)
- **Breaking**: a commit is breaking if its subject contains `!:` (e.g., `feat!:`, `fix(scope)!:`) OR its body contains `BREAKING CHANGE:` or `BREAKING-CHANGE:`

### Step 4: Generate PR title

Analyze all commit subjects to produce a concise PR title:

- If there is **one commit**: use its subject line as-is (strip any conventional commit prefix like `feat: `, `fix: `, etc.)
- If there are **multiple commits**:
  - Look at the conventional commit types used (feat, fix, refactor, chore, etc.)
  - Summarize the overall theme in a short imperative sentence (e.g., "Add theme support and fix stale session cleanup")
  - If all commits share one type, reflect that (e.g., all `fix:` → "Fix ...")
  - Keep it under ~72 characters

### Step 5: Build PR description

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

### Step 6: Create or update the PR

**If no open PR exists** (from Step 1):

```bash
gh pr create --base <base> --title "<title>" --body "$(cat <<'EOF'
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

### Step 7: Report result

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
