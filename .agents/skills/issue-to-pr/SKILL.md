First remove `Delegated to AI` tag from the issue, then add `AIRing it` tag to the issue.

Fix the issue by following instructions in the repo (see `AGENTS.md`).

When the issue leaves a decision open, ask in #bot31 channel (ID: C0CAVA7BBEJ), use `SLACK_BOT_TOKEN` for that, wait, go on.

After the PR is created, watch it for new comments and reviews without spending tokens:
run a background shell loop that polls `gh pr view <n> --json comments,reviews,state`
and exits only when the output changes. Back off the wait between polls as
20s → 40s → 1 min → 2 min → 4 min → 8 min, doing 5 polls at each interval, then keep polling
every 8 min. When the loop exits, address the new comments by replying or fixing
concerns, then restart the watcher from the beginning (5 polls at 20s again).
Stop watching once the PR is merged or closed.

Merge the PR after getting LGTM from two different persons.