---
name: record-video-demo
description: Records a short video demo of the current task's change, the web page or the CLI, and attaches it to the PR. Use at the "Attach a demo video" stage of AGENTS.md.
---

# Demo recorder

A demo shows the change from the task working, the way a user sees it: 10–30 seconds, one scenario, no unrelated features.

## When applicable

- **Yes**: a change a user can see, on the web page (`npm run dev`) or in the CLI (`./skill-atlas scan`).
- **No**: specs, tests, refactoring, docs, skills, CI. Skip the stage and say so in the PR description: `No demo: <reason>.`

## Rules

- Everything stays inside the repository, in `.demo/`: the tools, the browser, the npm cache, the recordings.
  Nothing is written to `~`, `/tmp` or other places outside the checkout.
- `.demo/` is never committed.
- Don't change `package.json` or `package-lock.json` for the demo.
- Show real behavior: the real page and real CLI output, no mocks or edited frames.
  Prefer `fixture/` as a repo, so the demo doesn't depend on a rate limit.
  Don't use real repository unless it's required by task or asked explicitly.
  If a real repository is required, but there is no specific one, use a small public repository.

## 1. Tools

Playwright records the video, `ffmpeg` converts it.

```sh
mkdir -p .demo && cd .demo
[ -f package.json ] || npm init -y >/dev/null
npm i --cache ./npm-cache --no-audit --no-fund playwright
PLAYWRIGHT_BROWSERS_PATH=./browsers npx playwright install chromium
cd ..
```

Always set `PLAYWRIGHT_BROWSERS_PATH=.demo/browsers` when running Playwright. `ffmpeg` must be installed already; if it isn't, stop and ask.

## 2. Scenario

Write the scenario to `.demo/demo.mjs`, it imports `playwright` from `.demo/node_modules`.
Slow and readable: type with a delay, pause on every result long enough to read it.

### Web page

Start the server first: `PORT=8123 npm run dev` in the background; stop it when the recording is done.

```js
// .demo/demo.mjs: node .demo/demo.mjs
import { chromium } from 'playwright';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: '.demo/raw', size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.goto('http://127.0.0.1:8123/');
await page.waitForTimeout(1000);

// The task's scenario, for example:
await page.locator('input').first().pressSequentially('JetBrains', { delay: 120 });
await page.keyboard.press('Enter');
await page.waitForTimeout(3000);

await context.close(); // the video is written on close
await browser.close();
```

### CLI

Run the command for real, then let the page "type" it and print its actual output line by line:

```js
// .demo/demo.mjs: node .demo/demo.mjs
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const command = ['./skill-atlas', 'scan', 'fixture'];
const output = execFileSync(command[0], command.slice(1), { encoding: 'utf8' });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  recordVideo: { dir: '.demo/raw', size: { width: 1280, height: 720 } },
});
const page = await context.newPage();
await page.setContent(`<body style="margin:0;background:#1e1e1e;color:#ddd;font:18px/1.4 Menlo,monospace">
  <pre id="t" style="margin:0;padding:24px;white-space:pre-wrap"></pre></body>`);
const write = (text) => page.evaluate((s) => { document.getElementById('t').textContent += s; }, text);

await write('$ ');
for (const c of command.join(' ')) { await write(c); await page.waitForTimeout(60); }
await page.waitForTimeout(500);
await write('\n');
for (const line of output.split('\n')) { await write(line + '\n'); await page.waitForTimeout(80); }
await page.waitForTimeout(3000);

await context.close();
await browser.close();
```

## 3. Record and convert

```sh
rm -rf .demo/raw
PLAYWRIGHT_BROWSERS_PATH=.demo/browsers node .demo/demo.mjs
raw=$(ls .demo/raw/*.webm)
ffmpeg -y -i "$raw" -c:v libx264 -pix_fmt yuv420p -movflags +faststart .demo/demo.mp4
ffmpeg -y -i "$raw" -vf "fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" .demo/demo.gif
```

Watch the result before attaching it: extract a few frames
(`ffmpeg -i .demo/demo.mp4 -vf fps=1 .demo/frame-%02d.png`) and look at them.
If the change isn't clearly visible, or something is cut off, fix the scenario and record again.

## 4. Attach to the PR

Videos don't go to the task's branch. They go to the orphan branch `demos`, a folder per task branch:

```sh
branch=$(git branch --show-current)
git fetch origin demos 2>/dev/null
if git rev-parse -q --verify origin/demos >/dev/null; then
  git worktree add .demo/demos origin/demos --detach
else
  git worktree add --detach .demo/demos && git -C .demo/demos checkout --orphan demos-new && git -C .demo/demos rm -rfq .
fi
mkdir -p ".demo/demos/$branch"
cp .demo/demo.mp4 .demo/demo.gif ".demo/demos/$branch/"
git -C .demo/demos add "$branch"
git -C .demo/demos commit -m "Demo for $branch"
git -C .demo/demos push origin HEAD:demos
git worktree remove .demo/demos
```

Add to the PR description (`gh pr edit --body-file`), with `<owner>/<repo>` from `gh repo view --json nameWithOwner`:

```markdown
## Demo
![Demo](https://github.com/<owner>/<repo>/blob/demos/<branch>/demo.gif?raw=true)

[Video (mp4)](https://github.com/<owner>/<repo>/blob/demos/<branch>/demo.mp4)
```

Open the PR page and check that the GIF shows. A new recording after review changes replaces the files in the same folder.
