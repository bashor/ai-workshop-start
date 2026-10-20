# Web UI
A **search page**: a repository's skills in the browser. A *static page*, no server.
## Input
A text field **at the top**: `owner/repo`, or a GitHub URL as the CLI takes it
- `https://github.com/owner/repo`, `github.com/owner/repo`, with `www.`, `.git` or a trailing `/`
- Enter or the **Scan** button → the scan
- Not a repository → a clear message, *no request*
- No local directories: GitHub only
## Layout
- **Left panel**: the skills, as the CLI lists them
  - `owner/repo · N skills` on top; sorted by **name**; the description's *first sentence*
  - `also in <paths>` for copies
- **Right panel**: the selected skill's `SKILL.md`, **rendered Markdown**
  - Its name and description on top, from the front matter; the front matter *not shown* as text
  - The link to the file, pinned to the *scanned commit*
  - Relative links and images: from the skill's directory, at the scanned commit
  - Nothing selected → a hint to pick a skill
- Click a skill → it is selected, the right panel shows it
## Filter
A text field **on top of the list**, once a repository has skills
- Filters *while typing*: the skills whose **name** or shown **description** contain the text, case-insensitive
  - Leading and trailing spaces ignored; empty → every skill
- `X of Y` next to it: X skills match, Y in total
- The matched parts **highlighted** in the names and descriptions
- Nothing matches → `No skills match`
- A new scan clears it; the selected skill stays selected, even when filtered out
- Not in the page URL
## Page URL
Shareable: the page URL holds the state
- `?repo=owner/repo` after a scan; opening such a URL scans **at once**
- `&skill=<path>` for the selected skill; opening it selects the skill
- Back and forward: the previous repository, the previous skill
## States
- Scanning: a progress indicator; a new scan replaces the running one
- No skills → `No skills found`
- Warnings → shown above the list, the scan goes on
- Unreachable repository, GitHub rate limit → a clear message instead of the list
  - The rate limit: *try again later*; no `GITHUB_TOKEN` in the page
## Safety
`SKILL.md` is *untrusted*: rendered **without** raw HTML or scripts
## Architecture
Core: fetch → find → parse, the same as the CLI's. Web UI: a *thin client*.
- GitHub API from the browser, **no token**
- The core gives a skill's body, for the right panel
## Build and run
- `npm run build` → static files, for any static host, such as GitHub Pages
- `npm run dev` → the page on a local server, during development
- Tests: the page in *jsdom*, GitHub answering from recordings
