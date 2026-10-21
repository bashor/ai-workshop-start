# Web UI
A **search page**: a repository's skills in the browser. A *static page*, no server.
## Input
A text field **at the top**: `owner/repo`, or a GitHub URL as the CLI takes it
- `https://github.com/owner/repo`, `github.com/owner/repo`, with `www.`, `.git` or a trailing `/`
- Or an **organization**: just its name, `owner`, or its URL, `https://github.com/owner`, the same forms
- Enter or the **Scan** button → the scan
- Neither a repository nor an organization → a clear message, *no request*
- No local directories: GitHub only
## Token
An **Add token** button next to the text field: a GitHub token, as the CLI's `--token`, **saved** in the browser
- Click → a **token field** in its place, *hidden* as typed, empty and focused, with **Save** and **Cancel**
  - Save or Enter → the token saved in the browser's *local storage*; the field gone, the button back
  - Leading and trailing spaces ignored; empty → no token saved, a saved one forgotten, as Remove token
  - Cancel or Escape → nothing changed, the field gone
  - A **Create a token** link next to them: GitHub's page for a new *fine-grained* token, in a new tab
    - `https://github.com/settings/personal-access-tokens/new`, the name `Skill Atlas` and a description filled in
    - The token *read-only*, for **public repositories** only, GitHub's default there: no permission to pick, nothing else to change
    - Leaves the page as it is: the field still shown, nothing saved
- A token saved → the button reads **Change token**, with a **Remove token** button next to it
  - Remove token → the saved token forgotten: no token, the button `Add token` again
- Kept across reloads and new tabs: a reload → the saved token used, the button `Change token`
- The saved token → the token for the **GitHub API requests** of the scans, a repository's or an organization's
  - Read at each scan: a changed token → used from the next scan on
  - An organization's repositories: their files *through the tree*, as without a token, **not** code search, whose limit is about 10 requests a minute
- *Never* in the page URL: a shared URL holds no token
  - Not even before the page's script runs: the token field is *not in the search form*
- Local storage not available → the token kept for the page only, until a reload
- GitHub rejects it → `GitHub rejected the saved token`
- The rate limit with a token → `GitHub rate limit reached; try again in a minute`
## Layout
- **Left panel**: the skills, as the CLI lists them
  - `owner/repo · N skills` on top: the repository, then `N skills` as a **badge**; the text the same, `·` not shown
  - Sorted by **name**; the description's *first sentence*
  - Each skill a **card**: its name, with its *folder* next to it as a tag
    - The folder: the agent's root it is in, `.claude/skills`, or `plugins/x/.claude/skills` in a module; the full path on hover
    - The description: at most **2 lines**, then `…`; the whole first sentence on hover
    - `updated <YYYY-MM-DD>` under the description: the skill's *last updated* date, in **italics**, told apart from the description; no date → nothing
  - `also in` for copies, then a **chip** for each copy: its folder; its full path on hover
    - The text: the chips separated by `, `, not shown: `also in .agents/skills, .github/skills`
  - The selected skill: an **accent bar** on its left
- **Right panel**: the selected skill's `SKILL.md`, **rendered Markdown**
  - Its name and description on top, from the front matter; the front matter *not shown* as text
  - The link to the file, pinned to the *scanned commit*
  - `Updated <YYYY-MM-DD>` next to the link, in **italics**; the exact time on hover
  - Relative links and images: from the skill's directory, at the scanned commit
  - Nothing selected → a hint to pick a skill
- Click a skill → it is selected, the right panel shows it
- **Keyboard**: on a skill, `↓` and `↑` → the next and the previous one selected and focused, as a click
  - The page URL *replaced*, not a new history entry: back does not step through each one
  - `↓` in the filter → the first skill; on the first skill, `↑` → the filter; on the last one, `↓` → nothing
## Filter
An **edit box on top of the skills list**, below the summary and the warnings
- Filters **while typing**: the skills whose name or shown description contain the text, *ignoring case*
  - Leading and trailing spaces ignored; an empty filter → every skill
- The count next to it: `X of Y`, X skills matched, Y in total
- The matched parts **highlighted** in the name and the description, every occurrence
- Nothing matched → `No matching skills`
- A new repository → the filter empty again; selecting a skill keeps it
- No skills → no filter
## Organization
Every repository of the organization scanned, **one after another**, a few at a time
- **Left panel**: `owner · N repositories` on top, then the scanned repositories
  - Each: its name and a **badge**, the number of its skills
  - Sorted by the **number of skills**, most first, then by name; the failed ones last
  - A repository that failed → its message instead of the badge; the others go on
  - An empty repository → 0 skills
  - The rate limit → the rest *not scanned*, a warning above the list
  - No repositories → `No repositories found`
- Click a repository → its skills, as for `owner/repo`, with the dates; *no new request*, the scan is reused
- Scanning: the progress, `Scanning owner… 3 of 20 repositories · 12 skills`, the skills found so far
- **As they come**, while scanning: the list shown before the scan is over
  - The repositories listed as soon as GitHub lists them, each page of them; `owner · N repositories`, the ones listed so far
  - One not scanned yet → `…` instead of the badge; its badge as soon as it is scanned, its message if it failed
  - Sorted as above, the ones not scanned yet after the scanned ones, before the failed ones
  - Not clickable until the scan is over
  - An unexpected error → its message instead of the list; the repositories still scanning change *nothing* when they finish
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
  - The rate limit: *try again later*; no `GITHUB_TOKEN` in the page, only the saved token
## Safety
`SKILL.md` is *untrusted*: rendered **without** raw HTML or scripts
## Architecture
Core: fetch → find → parse, the same as the CLI's. Web UI: a *thin client*.
- GitHub API from the browser, **no token** unless one is saved with Add token
- The core gives a skill's body and its last updated date, for the panels
- The core scans an organization: its repositories from the GitHub API, each one scanned as above
## Build and run
- `npm run build` → static files, for any static host, such as GitHub Pages
- `npm run dev` → the page on a local server, during development
- Tests: the page in *jsdom*, GitHub answering from recordings
## Publishing
The page on **GitHub Pages**, at `https://<owner>.github.io/<repo>/`
- **Republished after each push to `main`**: the GitHub Actions workflow `.github/workflows/pages.yml`
  - Also by hand, from the Actions tab, and after a pull request's preview changes (spec/preview.md); *no other* branch, no pull request's own run
- Published only when **green**: `npm ci`, the typecheck and the tests pass, then `npm run build`; *nothing* published otherwise
- What is published: `dist/`, the output of `npm run build`, nothing else
  - With the pull requests' previews in `dist/.pr-preview/`, from the `gh-pages` branch: spec/preview.md
- One publication at a time: a newer push waits, the running one is *not* cancelled halfway
- Only the permissions it needs: reading the repository, writing Pages, the ID token Pages checks the deployment with
- Once, in the repository's settings: *Pages → Source: GitHub Actions*
