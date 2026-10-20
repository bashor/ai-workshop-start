Remove `Delegated to AI` tag from the issue and add `AIRing it` tag to the issue.

Fix the issue by following instructions in the repo (see `AGENTS.md`).
After the PR is created, watch it for new comments and reviews without spending tokens:
run a background shell loop that polls `gh pr view <n> --json comments,reviews,state`
and exits only when the output changes. Poll every 20s for the first 5 polls, then back off
(1 → 2 → 5 → 10 min). When the loop exits, address the new comments by replying or fixing
concerns, then restart the watcher from the beginning (5 polls at 20s again).
Stop watching once the PR is merged or closed.

Merge the PR after getting LGTM from two different persons.