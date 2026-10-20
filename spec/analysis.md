# Repository analysis
## Input
A **GitHub repository** URL, or a local directory
## Output
Every *real skill*: **name**, **description**, **link**
## Real skills
A skill the repository's agents use **while developing it**
- `<root>/<name>/SKILL.md`, the root an agent's: `.agents/skills`, `.claude/skills`, `.github/skills`, `agent/skills`
- The root at the top, or in a module: `plugins/x/.claude/skills/y/SKILL.md`
- **Not** real: a `SKILL.md` *shipped* or *tested*, not used
  - Outside an agent's root: a plugin's or a marketplace's `skills/x/SKILL.md`, `src/main/resources/…`
  - Under `test`, `tests`, `testData`, `fixture`, `fixtures`, `examples`, `samples`, `templates`, `dist`, `build`, `out`, `node_modules`, `vendor`: anywhere in the path
  - A symbolic link
- Not real → *not listed*, no warning
## Copies
One skill for several agents: listed **once**, `also in` the other paths
- Copies: the same `<name>` in the roots of the *same directory*, with the same name, description and body
- Same `<name>`, a different description or body → *different skills*, one per agent, each listed
- Same `<name>` in different modules → *different skills*
## Architecture
Core: fetch → find → parse. CLI: a *thin client*.
Skill: id = `repo:path`, name, description, commit
## Details
- **GitHub API**, no clone; *under 5 s* for intellij-community
- The name: front matter, else the directory
- The link pins the *scanned commit*
- Malformed front matter → a *warning*, the scan goes on
- Unreachable repository → a clear message, exit code 1
