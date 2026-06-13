#!/usr/bin/env bash
# Pre-commit hook: block commits containing secret patterns.
# Install: cp scripts/pre-commit-secret-scan.sh .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit

set -euo pipefail

PATTERNS=(
  'sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{93}'   # Anthropic
  'sk-(?:proj-)?[A-Za-z0-9_-]{40,}'         # OpenAI
  'AIza[A-Za-z0-9_-]{35}'                   # Google AI
  'github_pat_[A-Za-z0-9_]{82}'             # GitHub fine-grained PAT
  'ghp_[A-Za-z0-9]{36}'                     # GitHub classic PAT
  'gho_[A-Za-z0-9]{36}'                     # GitHub OAuth token
)

STAGED=$(git diff --cached --name-only --diff-filter=ACM)
if [ -z "$STAGED" ]; then
  exit 0
fi

FOUND=0
for PATTERN in "${PATTERNS[@]}"; do
  MATCHES=$(git diff --cached -U0 | grep '^\+' | grep -P "$PATTERN" || true)
  if [ -n "$MATCHES" ]; then
    echo "ERROR: Possible secret detected matching pattern: $PATTERN"
    echo "$MATCHES" | head -5
    FOUND=1
  fi
done

# Also block .env files from being committed
if echo "$STAGED" | grep -qE '(^|/)\.env($|\.)'; then
  echo "ERROR: Refusing to commit .env file. Add it to .gitignore."
  FOUND=1
fi

if [ "$FOUND" -eq 1 ]; then
  echo ""
  echo "Commit blocked. Remove secrets before committing."
  echo "If this is a false positive, use: git commit --no-verify (only if certain)"
  exit 1
fi

exit 0
