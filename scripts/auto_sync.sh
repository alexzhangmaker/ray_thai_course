#!/usr/bin/env bash
set -euo pipefail

# Ensure standard PATH
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

REPO_DIR="/home/alexszhang/vCourse.ThaiNotes"
BRANCH="main"
REMOTE="origin"

echo "=========================================="
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting auto-sync for $REPO_DIR"

cd "$REPO_DIR"

# Clean up macOS metadata files if any were created
find . -name "._*" -delete 2>/dev/null || true
find . -name ".DS_Store" -delete 2>/dev/null || true

# Check if there are any changes (modified, untracked, deleted)
if [ -n "$(git status --porcelain)" ]; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Changes detected. Staging files..."
    git add -A

    COMMIT_MSG="Auto sync: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Committing: $COMMIT_MSG"
    git commit -m "$COMMIT_MSG"

    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Pushing to $REMOTE $BRANCH..."
    git push "$REMOTE" "$BRANCH"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Push completed successfully."
else
    # Also check if local branch has commits not yet pushed to remote
    git fetch "$REMOTE" "$BRANCH" --quiet 2>/dev/null || true
    UNPUSHED=$(git log "$REMOTE/$BRANCH..$BRANCH" --oneline 2>/dev/null || true)
    if [ -n "$UNPUSHED" ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Found unpushed commits. Pushing to $REMOTE $BRANCH..."
        git push "$REMOTE" "$BRANCH"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Push completed successfully."
    else
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] No changes to commit or push. Working tree clean."
    fi
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Auto-sync finished."
