# Skill Atlas

Every agent skill in a repository: `./skill-atlas scan` finds each `SKILL.md` and prints its name,
description and link.

```console
$ npm ci
$ ./skill-atlas scan https://github.com/JetBrains/kotlin
JetBrains/kotlin · 6 skills
…
build-tools-bump-gradle-api — Bumps the Gradle API version that Kotlin Gradle plugins are compiled against in the Kotlin compiler repository.
  https://github.com/JetBrains/kotlin/blob/5ab6270ab772d113e8ad52ebfcaa0109c522ae00/.claude/skills/build-tools-bump-gradle-api/SKILL.md
…
```

Set `GITHUB_TOKEN`, or pass `--token <token>`, for a higher GitHub rate limit: `./skill-atlas scan --token "$TOKEN" <URL>`. The
option is used instead of `GITHUB_TOKEN`. `npm test` runs the tests.

## Web UI

The same in the browser: a search page, a repository's skills on the left, the selected `SKILL.md` on the
right. Type `owner/repo` or a GitHub URL, press Enter or **Scan**, click a skill, or go through them with ↓ and ↑. The page URL holds the
repository and the skill, so it can be shared. Or type an organization, `owner` or
`https://github.com/owner`: its repositories are listed, each with the number of its skills, as they are scanned; once
the scan is over, click one to see them. The page calls the GitHub API with no token, unless one is saved with the
**Add token** button next to it: like `--token`, for a higher rate limit. The token is kept in the browser's local
storage, so it is still there after a reload; **Remove token** forgets it. It is never put in the page URL.

### Run locally

```console
$ npm ci
$ npm run dev
Skill Atlas: http://127.0.0.1:8000/
```

Open http://127.0.0.1:8000/. `app.js` is rebuilt whenever a source changes: reload the page to see it.
`PORT=8080 npm run dev` serves on another port. Ctrl+C stops the server.

### Prepare the distribution

```console
$ npm ci
$ npm run build
dist/: index.html, app.js, style.css
```

`dist/` holds the whole page: `index.html`, `app.js` (minified, with `app.js.map`) and `style.css`. The
paths are relative, so upload `dist/` to any static host, at its root or under a path, such as GitHub
Pages at `https://<owner>.github.io/<repo>/`. To check the build first, serve `dist/` locally with any
static server, e.g. `python3 -m http.server -d dist 8080`, and open http://127.0.0.1:8080/.

## More

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
