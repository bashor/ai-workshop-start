// The decisions in spec/web.md, Version: the link to the commit the page was built from, in the
// page's top right corner; the commit and the repository from the checkout, as npm run build finds them.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { build, buildCommit, ROOT, WEB } from '../scripts/build.ts';
import { openPage } from './web-helpers.ts';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const URL_OF_SHA = `https://github.com/bashor/ai-workshop-start/commit/${SHA}`;

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function temporary(t: TestContext, name: string) {
  const directory = mkdtempSync(join(tmpdir(), `skill-atlas-${name}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

/** A git checkout with one commit, and `origin` at `remote` unless undefined. */
function checkout(t: TestContext, remote?: string) {
  const directory = temporary(t, 'version');
  git(directory, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(directory, 'README.md'), '# A repository\n');
  git(directory, 'add', '.');
  git(directory, '-c', 'user.name=Someone', '-c', 'user.email=someone@example.com', 'commit', '--quiet', '-m', 'Start');
  if (remote) git(directory, 'remote', 'add', 'origin', remote);
  return { directory, sha: git(directory, 'rev-parse', 'HEAD') };
}

/** The version link of a built page in `outdir`, its script run as a browser runs it. */
async function builtLink(t: TestContext, outdir: string) {
  const dom = await JSDOM.fromFile(join(outdir, 'index.html'), { runScripts: 'dangerously', resources: 'usable' });
  t.after(() => dom.window.close());
  await new Promise((resolve) => dom.window.addEventListener('load', resolve));
  const link = dom.window.document.querySelector<HTMLAnchorElement>('#version')!;
  return { link, shown: !link.hidden && link.textContent !== '' };
}

test('the version: a link to the commit, its short hash as the text, the full one on hover', () => {
  const page = openPage('', {}, { commit: { sha: SHA, url: URL_OF_SHA } });
  const link = page.$('#version') as HTMLAnchorElement;
  assert.ok(page.shown('#version'));
  assert.equal(link.tagName, 'A');
  assert.equal(link.textContent, '0123456');
  assert.equal(link.getAttribute('href'), URL_OF_SHA);
  assert.match(link.title, new RegExp(SHA));
});

test('the version: in the top right corner, the last thing in the header, pushed to its right end', () => {
  const page = openPage('', {}, { commit: { sha: SHA, url: URL_OF_SHA } });
  const header = page.$('header.top')!;
  assert.equal(header.lastElementChild, page.$('#version'));
  const css = readFileSync(join(WEB, 'style.css'), 'utf8');
  assert.match(css, /#version\s*\{[^}]*margin-left:\s*auto/);
});

test('the version: fixed when the page is built, no request for it', () => {
  const page = openPage('', {}, { commit: { sha: SHA, url: URL_OF_SHA } });
  assert.deepEqual(page.requests, []);
});

test('the version: the same after a scan', async () => {
  const page = openPage('', { 'https://api.github.com/repos/a/b': { status: 404, body: { message: 'Not Found' } } }, {
    commit: { sha: SHA, url: URL_OF_SHA },
  });
  page.scan('a/b');
  await page.until(() => page.$('#status')!.textContent!.includes('not found'), 'the message');
  assert.equal(page.$('#version')!.textContent, '0123456');
});

test('the version: no commit → no link, nothing else changes', () => {
  const page = openPage('', {});
  assert.ok(!page.shown('#version'));
  assert.ok(page.shown('#add-token'));
  assert.match(page.$('#skill')!.textContent!, /pick a skill/i);
});

test('the commit: HEAD of the checkout, the repository from origin, https', (t) => {
  const { directory, sha } = checkout(t, 'https://github.com/owner/repo');
  assert.deepEqual(buildCommit(directory, {}), { sha, url: `https://github.com/owner/repo/commit/${sha}` });
});

test('the commit: origin with .git, or git@github.com:owner/repo.git', (t) => {
  for (const remote of ['https://github.com/owner/repo.git', 'git@github.com:owner/repo.git', 'https://www.github.com/owner/repo/']) {
    const { directory, sha } = checkout(t, remote);
    assert.deepEqual(buildCommit(directory, {}), { sha, url: `https://github.com/owner/repo/commit/${sha}` }, remote);
  }
});

test('the commit: on GitHub Actions, its own repository, not origin', (t) => {
  const { directory, sha } = checkout(t, 'https://github.com/owner/repo');
  assert.deepEqual(buildCommit(directory, { GITHUB_REPOSITORY: 'someone/fork', GITHUB_SERVER_URL: 'https://github.com' }), {
    sha,
    url: `https://github.com/someone/fork/commit/${sha}`,
  });
  // GITHUB_SERVER_URL missing: github.com.
  assert.equal(buildCommit(directory, { GITHUB_REPOSITORY: 'someone/fork' })?.url, `https://github.com/someone/fork/commit/${sha}`);
});

test('the commit: no GitHub repository → none', (t) => {
  assert.equal(buildCommit(checkout(t).directory, {}), undefined);
  assert.equal(buildCommit(checkout(t, 'https://gitlab.com/owner/repo').directory, {}), undefined);
});

test('the commit: not a git checkout, or no commit yet → none', (t) => {
  const plain = temporary(t, 'plain');
  assert.equal(buildCommit(plain, {}), undefined);
  const empty = temporary(t, 'empty');
  git(empty, 'init', '--quiet');
  git(empty, 'remote', 'add', 'origin', 'https://github.com/owner/repo');
  assert.equal(buildCommit(empty, {}), undefined);
});

test('npm run build → the page links to the commit of this checkout', async (t) => {
  const outdir = temporary(t, 'version-build');
  await build(outdir);
  const sha = git(ROOT, 'rev-parse', 'HEAD');
  const { link, shown } = await builtLink(t, outdir);
  assert.ok(shown);
  assert.equal(link.textContent, sha.slice(0, 7));
  assert.match(link.href, new RegExp(`^https://github\\.com/[^/]+/[^/]+/commit/${sha}$`));
});

test('npm run build → another checkout’s commit, or no link without one', async (t) => {
  const { directory, sha } = checkout(t, 'git@github.com:owner/repo.git');
  const outdir = temporary(t, 'version-other');
  await build(outdir, buildCommit(directory, {}) ?? null);
  let { link, shown } = await builtLink(t, outdir);
  assert.ok(shown);
  assert.equal(link.textContent, sha.slice(0, 7));
  assert.equal(link.href, `https://github.com/owner/repo/commit/${sha}`);

  const none = join(temporary(t, 'version-none'), 'dist');
  mkdirSync(none);
  await build(none, null);
  ({ shown } = await builtLink(t, none));
  assert.ok(!shown);
});

test('npm run dev → the page links to the commit of this checkout too', async (t) => {
  const server = spawn(process.execPath, ['scripts/dev.ts'], { cwd: ROOT, env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => server.kill());
  const url = await new Promise<string>((resolve, reject) => {
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const match = /http:\/\/\S+/.exec(output);
      if (match) resolve(match[0]);
    });
    server.on('exit', (code) => reject(new Error(`the dev server exited with ${code}: ${output}`)));
  });
  const app = await (await fetch(new URL('app.js', url))).text();
  assert.ok(app.includes(git(ROOT, 'rev-parse', 'HEAD')));
});
