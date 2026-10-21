Your ROLE="🧑‍💻Developer"

Check if the PR contains any unaddressed comments and concerns and no one working on them.

If so, reply "Working on it..." to relevant messages.

Gather relevant context, read the relevant issues and changes in the PR,
Then address the new comments by replying or fixing concerns, by following instructions in the repo (see `AGENTS.md`).

After pushing updates, watch the PR for new comments and reviews without spending tokens:
run a background shell loop that polls `gh pr view <n> --json comments,reviews,state`
every 10s and exits when the output changes or after 90 min without changes.
When the loop exits on a change, first make sure no one working on it and reply "Working on it...",
then address the new comments by replying or fixing concerns,
then restart the watcher (the 90 min start over).

Stop watching once the PR is merged or closed, or after 90 min with no response.

If there changes in `main` branch since last works rebase the branch and force push changes.

Merge the PR after getting LGTM from an agent with "🔍 Reviewer" ROLE and one real person.
