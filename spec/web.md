# Web UI
A **search page**: a repository's skills in the browser. A *static page*, no server.
## Input
A text field **at the top**: `owner/repo`, or a GitHub URL as the CLI takes it
- `https://github.com/owner/repo`, `github.com/owner/repo`, with `www.`, `.git` or a trailing `/`
- Or an **organization**: just its name, `owner`, or its URL, `https://github.com/owner`, the same forms
- Enter or the **Scan** button → the scan
- Neither a repository nor an organization → a clear message, *no request*
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
## Organization
Every repository of the organization scanned, **one after another**, a few at a time
- **Left panel**: `owner · N repositories` on top, then the scanned repositories
  - Each: its name and a **badge**, the number of its skills
  - Sorted by the **number of skills**, most first, then by name; the failed ones last
  - A repository that failed → its message instead of the badge; the others go on
  - An empty repository → 0 skills
  - The rate limit → the rest *not scanned*, a warning above the list
  - No repositories → `No repositories found`
- Click a repository → its skills, as for `owner/repo`; *no new request*, the scan is reused
- Scanning: the progress, `Scanning owner… 3 of 20 repositories`
- Not an organization → `Organization not found: https://github.com/owner`
## Page URL
Shareable: the page URL holds the state
- `?repo=owner/repo` after a scan; opening such a URL scans **at once**
- `&skill=<path>` for the selected skill; opening it selects the skill
- `?org=owner` after an organization's scan; opening such a URL scans it **at once**
- Back and forward: the previous repository, the previous skill
- Back from a repository to its organization: the list again, *no new scan*
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
- The core scans an organization: its repositories from the GitHub API, each one scanned as above
## Build and run
- `npm run build` → static files, for any static host, such as GitHub Pages
- `npm run dev` → the page on a local server, during development
- Tests: the page in *jsdom*, GitHub answering from recordings
