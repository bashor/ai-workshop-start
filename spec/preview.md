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
**GitHub Pages**, next to the page of `main`: `<the Pages site>/.pr-preview/<N>/`, `N` the PR's number
- Kept on the `gh-pages` branch: `npm run build`, the PR's `dist/` → `.pr-preview/<N>/` of the branch
  - Only that directory changed: the rest of the branch *kept*, the other previews
  - Files gone from `dist/` → gone from the preview
  - No `gh-pages` branch yet → created, with only the preview in it
- Published by the Pages workflow, `.github/workflows/pages.yml`, as the page of `main` (spec/web.md, *Publishing*)
  - Each publication: `dist/` of `main`, with every preview of the branch in `.pr-preview/`, *hidden* files included
    - Whatever their size: previews of *more than a megabyte* together collected as the small ones, never held in memory at once
  - A preview published or removed → the Pages workflow run again, on the default branch; unchanged → not run
- The Pages site from the GitHub API, else `https://<owner>.github.io/<repo>/`
  - The page's paths are relative: it works there as at the root
- `.pr-preview/` in the repository's `.gitignore`: previews put into a checkout are never committed
## Comment
**One comment** on the pull request, kept up to date: edited, never a new one each push
- Published → the preview's URL and the commit it shows; live once the Pages workflow has run
- Pages not set up for GitHub Actions → the URL, and how to set it up: *Settings → Pages → Source: GitHub Actions*, once
- Removed → `removed`, the URL no longer shown
## Architecture
- `.github/workflows/preview.yml`, `preview-remove.yml`: when; `scripts/preview.ts`: the branch, the comment, the Pages workflow run
- `scripts/preview.ts collect dist`: the previews into `dist/.pr-preview/`, for the Pages workflow
- Tests: `scripts/preview.ts` on local git repositories, the GitHub API from a fake, the workflows from their YAML
