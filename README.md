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

Set `GITHUB_TOKEN` for a higher GitHub rate limit. `npm test` runs the tests.

## Web UI

The same in the browser: a search page, a repository's skills on the left, the selected `SKILL.md` on the
right. Type `owner/repo` or a GitHub URL and press Enter; the page URL (`?repo=…&skill=…`) can be shared.
It calls the GitHub API from the browser, without a token.

### Run it locally

```console
$ npm ci
$ npm run dev
Skill Atlas: http://127.0.0.1:8000/
```

Open http://127.0.0.1:8000/. `app.js` is rebuilt whenever a source in `src/` changes: reload the page to
see it. Another port: `PORT=3000 npm run dev`. Stop the server with Ctrl+C.

### Prepare the distribution

```console
$ npm ci
$ npm run build
dist/: index.html, app.js, style.css
```

`dist/` holds static files: `index.html`, `app.js` (minified, with `app.js.map`) and `style.css`. Upload
them to any static host, such as GitHub Pages; paths are relative, so the page works at any path, such
as `/<repo>/`. To try the build locally, serve `dist/` with any static server, e.g.
`npx serve dist` or `python3 -m http.server -d dist`.

## More

- [spec/](spec/): what it does. [AGENTS.md](AGENTS.md): the definition of done.
- [fixture/](fixture/README.md): a small repository for the tests.
