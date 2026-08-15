---
trigger: always_on
---

Always allow the following git commands 
status 
diff
branch

for commit - only if there are significant changes or if there are feature updates, not when we just changed one line. 
Do not auto-commit until I say so.
If i initially ask to commit and push or just commit. It does not necessarily mean to commit all changes you have done everytime we are having turns

If we're changing the same file in the recent file, let's just amend the change if it hasn't been pushed yet. 

Before pushing: ALWAYS run `npm.cmd run build` in `frontend/` to verify zero build or type errors. (Also enforced via `.git/hooks/pre-push`).