# fixture

A small repository for the tests.

| Path | Case |
| --- | --- |
| `.claude/skills/commits` | a skill |
| `.github/skills/code-style` | a skill in another agent's folder |
| `.claude/skills/code-style` | its copy: listed once, `also in` |
| `.agents/skills/commits` | the same name, a different description: a different skill |
| `.agents/skills/release-checklist` | malformed front matter |
| `plugins/editor/.claude/skills/commits` | a skill in a module: a different skill from the top one |
| `plugins/editor/skills/shipped` | shipped by a plugin, outside an agent's root: not listed |
| `tests/.claude/skills/tested` | under `tests`: not listed |
| `.claude/skills/linked` | a symbolic link: not listed |
