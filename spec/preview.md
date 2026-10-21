# Preview
A **temporary staging** of the Web UI for each pull request that changes it: the PR's page, live, *before* the merge.
## When
A pull request that changes **the Web UI**: `web/`, `src/web/`, `src/core/`, `scripts/build.ts`, `package.json`, `package-lock.json`, or the preview's own workflow and script
- Opened, reopened, a new push → the preview **published**, the previous one *replaced*
  - Several pushes at once: one at a time, the last one wins; no push lost
- Closed or merged → the preview **removed**
  - Whatever its files: a PR that changed the Web UI before only
  - No preview → *nothing*, no commit, no comment
- Any other pull request → no preview, no comment
- A pull request from a *fork* → no preview: its workflow has no write access
## Where
**GitHub Pages**, from the `gh-pages` branch
- `npm run build`, the PR's `dist/` → `pr-preview/pr-<N>/` of the branch, `N` the PR's number
  - Only that directory changed: the rest of the branch *kept*, the other previews and whatever is at the root
  - Files gone from `dist/` → gone from the preview
  - No `gh-pages` branch yet → created, with only the preview in it
  - `.nojekyll` at the root: the files served *as they are*
- The URL: `<the Pages site>/pr-preview/pr-<N>/`, the Pages site from the GitHub API, else `https://<owner>.github.io/<repo>/`
  - The page's paths are relative: it works there as at the root
## Comment
**One comment** on the pull request, kept up to date: edited, never a new one each push
- Published → the preview's URL and the commit it shows
- Pages not set up for `gh-pages` → the URL, and how to set it up: *Settings → Pages → Deploy from a branch, `gh-pages`, `/ (root)`*, once
- Removed → `removed`, the URL no longer shown
## Architecture
- `.github/workflows/preview.yml`: when; `scripts/preview.ts`: the branch; `gh`: the comment
- Tests: `scripts/preview.ts` on local git repositories, the workflow's triggers from its YAML
