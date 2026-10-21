// The decisions in spec/preview.md: scripts/preview.ts on local git repositories, the GitHub API
// answering from a fake, and the workflows' triggers from their YAML.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { type Dirent, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { parse } from 'yaml';
import { build } from '../scripts/build.ts';
import { collect, comment, commentBody, dispatch, MARKER, pagesSite, publish, remove } from '../scripts/preview.ts';
import { mountApp } from '../src/web/app.ts';
import { replay } from '../src/core/replay.ts';
import { recordFixture } from './web-helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHA = '5ab6270ab772d113e8ad52ebfcaa0109c522ae00';

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A remote, `origin`, and a clone of it with one commit on main, as the workflow checks it out. */
function repositories(t: TestContext) {
  const base = mkdtempSync(join(tmpdir(), 'skill-atlas-preview-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const origin = join(base, 'origin.git');
  const clone = join(base, 'clone');
  git(base, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  git(base, 'clone', '--quiet', origin, clone);
  writeFileSync(join(clone, 'README.md'), '# A repository\n');
  git(clone, 'add', '.');
  git(clone, '-c', 'user.name=Someone', '-c', 'user.email=someone@example.com', 'commit', '--quiet', '-m', 'Start');
  git(clone, 'push', '--quiet', 'origin', 'main');
  return { base, origin, clone };
}

/** A directory with these files, as `npm run build` leaves dist/. */
function directory(base: string, name: string, files: Record<string, string>) {
  const path = join(base, name);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(path, file)), { recursive: true });
    writeFileSync(join(path, file), text);
  }
  return path;
}

/** The files on the remote's gh-pages branch, each with its text; undefined when there is no such branch. */
function pages(origin: string): Record<string, string> | undefined {
  try {
    git(origin, 'rev-parse', '--verify', '--quiet', 'refs/heads/gh-pages');
  } catch {
    return undefined;
  }
  const files: Record<string, string> = {};
  for (const path of git(origin, 'ls-tree', '-r', '--name-only', 'gh-pages').split('\n').filter(Boolean)) {
    files[path] = git(origin, 'show', `gh-pages:${path}`);
  }
  return files;
}

/** Every file under `path`, relative to it, sorted. */
const files = (path: string) =>
  (readdirSync(path, { recursive: true, withFileTypes: true }) as Dirent[])
    .filter((entry) => entry.isFile())
    .map((entry) => relative(path, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .toSorted();

const head = (origin: string) => git(origin, 'rev-parse', 'refs/heads/gh-pages');

/** Puts these files at the root of the remote's gh-pages branch, as another publisher would. */
function pushPages(base: string, origin: string, files: Record<string, string>) {
  const other = join(base, `other-${Math.random().toString(36).slice(2)}`);
  git(base, 'clone', '--quiet', origin, other);
  const exists = git(other, 'ls-remote', '--heads', 'origin', 'gh-pages') !== '';
  if (exists) git(other, 'checkout', '--quiet', 'gh-pages');
  else git(other, 'checkout', '--quiet', '--orphan', 'gh-pages');
  if (!exists) git(other, 'rm', '-r', '--quiet', '--cached', '.');
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(other, file)), { recursive: true });
    writeFileSync(join(other, file), text);
    git(other, 'add', file);
  }
  git(other, '-c', 'user.name=Someone', '-c', 'user.email=someone@example.com', 'commit', '--quiet', '-m', 'Other');
  git(other, 'push', '--quiet', 'origin', 'gh-pages');
}

test('a preview: dist/ in .pr-preview/<N>/ of a new gh-pages branch', (t) => {
  const { base, origin, clone } = repositories(t);
  const dist = directory(base, 'dist', { 'index.html': '<p>page</p>', 'app.js': 'app()', 'assets/a.css': 'a{}' });
  assert.equal(publish({ cwd: clone, pr: 7, dist, sha: SHA }), 'published');
  assert.deepEqual(pages(origin), {
    '.pr-preview/7/index.html': '<p>page</p>',
    '.pr-preview/7/app.js': 'app()',
    '.pr-preview/7/assets/a.css': 'a{}',
  });
  // Only the preview: none of main's files.
  assert.match(git(origin, 'log', '-1', '--format=%s', 'gh-pages'), /\.pr-preview\/7.*5ab6270/);
  assert.equal(git(origin, 'rev-list', '--count', 'gh-pages'), '1');
  // The checkout is left as it was.
  assert.equal(git(clone, 'status', '--porcelain'), '');
  assert.equal(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
});

test('a new push: the preview replaced, the files gone from dist/ gone; the rest of gh-pages kept', (t) => {
  const { base, origin, clone } = repositories(t);
  pushPages(base, origin, { 'index.html': 'main', '.pr-preview/3/index.html': 'three' });
  publish({ cwd: clone, pr: 7, dist: directory(base, 'first', { 'index.html': 'one', 'old.js': 'old' }), sha: SHA });
  assert.equal(publish({ cwd: clone, pr: 7, dist: directory(base, 'second', { 'index.html': 'two' }), sha: SHA }), 'published');
  assert.deepEqual(pages(origin), {
    'index.html': 'main',
    '.pr-preview/3/index.html': 'three',
    '.pr-preview/7/index.html': 'two',
  });
});

test('the same files again: unchanged, no commit', (t) => {
  const { base, origin, clone } = repositories(t);
  const dist = directory(base, 'dist', { 'index.html': 'one' });
  publish({ cwd: clone, pr: 7, dist, sha: SHA });
  const before = head(origin);
  assert.equal(publish({ cwd: clone, pr: 7, dist, sha: SHA }), 'unchanged');
  assert.equal(head(origin), before);
});

test('someone else pushes to gh-pages meanwhile: published again on top, no push lost', (t) => {
  const { base, origin, clone } = repositories(t);
  pushPages(base, origin, { 'index.html': 'main' });
  let raced = 0;
  const result = publish({
    cwd: clone,
    pr: 7,
    dist: directory(base, 'dist', { 'index.html': 'seven' }),
    sha: SHA,
    beforePush: () => {
      if (raced++ === 0) pushPages(base, origin, { '.pr-preview/8/index.html': 'eight' });
    },
  });
  assert.equal(result, 'published');
  assert.equal(raced, 2);
  assert.deepEqual(pages(origin), {
    'index.html': 'main',
    '.pr-preview/7/index.html': 'seven',
    '.pr-preview/8/index.html': 'eight',
  });
});

test('closed or merged: the preview removed, the rest of gh-pages kept', (t) => {
  const { base, origin, clone } = repositories(t);
  pushPages(base, origin, { 'index.html': 'main', '.pr-preview/3/index.html': 'three' });
  publish({ cwd: clone, pr: 7, dist: directory(base, 'dist', { 'index.html': 'seven', 'a/b.js': 'b' }), sha: SHA });
  assert.equal(remove({ cwd: clone, pr: 7 }), 'removed');
  assert.deepEqual(pages(origin), { 'index.html': 'main', '.pr-preview/3/index.html': 'three' });
});

test('closed with no preview: nothing, no commit; no gh-pages branch → none created', (t) => {
  const { base, origin, clone } = repositories(t);
  assert.equal(remove({ cwd: clone, pr: 7 }), 'absent');
  assert.equal(pages(origin), undefined);
  pushPages(base, origin, { '.pr-preview/70/index.html': 'seventy' });
  const before = head(origin);
  assert.equal(remove({ cwd: clone, pr: 7 }), 'absent');
  assert.equal(head(origin), before);
});

test('the Pages workflow: every preview of gh-pages into dist/.pr-preview/, nothing else of the branch', (t) => {
  const { base, origin, clone } = repositories(t);
  pushPages(base, origin, { 'index.html': 'old main', '.pr-preview/3/index.html': 'three', '.pr-preview/7/a/b.js': 'b' });
  const dist = directory(base, 'dist', { 'index.html': 'main', 'app.js': 'app()' });
  assert.deepEqual(collect({ cwd: clone, into: dist }), [3, 7]);
  assert.deepEqual(files(dist), ['.pr-preview/3/index.html', '.pr-preview/7/a/b.js', 'app.js', 'index.html']);
  assert.equal(readFileSync(join(dist, 'index.html'), 'utf8'), 'main');
  assert.equal(readFileSync(join(dist, '.pr-preview/7/a/b.js'), 'utf8'), 'b');
});

test('the Pages workflow: no gh-pages branch, or no previews on it → dist/ as it is', (t) => {
  const { base, origin, clone } = repositories(t);
  const dist = directory(base, 'dist', { 'index.html': 'main' });
  assert.deepEqual(collect({ cwd: clone, into: dist }), []);
  pushPages(base, origin, { 'other.txt': 'other' });
  assert.deepEqual(collect({ cwd: clone, into: dist }), []);
  assert.deepEqual(files(dist), ['index.html']);
});

/** A GitHub API that answers `routes` by `METHOD url`; every request is in `requests`. */
function fakeGitHub(routes: Record<string, (body: unknown) => { status: number; body?: unknown }>) {
  const requests: { method: string; url: string; body?: unknown; authorization?: string }[] = [];
  const fetch = async (url: string | URL, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const body = init.body === undefined ? undefined : JSON.parse(String(init.body));
    const headers = new Headers(init.headers);
    requests.push({ method, url: String(url), body, authorization: headers.get('Authorization') ?? undefined });
    const route = routes[`${method} ${url}`];
    const answer = route ? route(body) : { status: 404, body: { message: 'Not Found' } };
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
  };
  return { fetch, requests };
}

const API = 'https://api.github.com/repos/bashor/ai-workshop-start';

test('the URL: the Pages site from the GitHub API, ready when it is published by GitHub Actions', async () => {
  const site = (build_type: string, html_url = 'https://atlas.example.com/') =>
    fakeGitHub({ [`GET ${API}/pages`]: () => ({ status: 200, body: { html_url, build_type, source: { branch: 'main', path: '/' } } }) });
  const ready = site('workflow');
  assert.deepEqual(await pagesSite('bashor/ai-workshop-start', { fetch: ready.fetch, token: 'secret' }), {
    url: 'https://atlas.example.com/',
    ready: true,
  });
  assert.equal(ready.requests[0].authorization, 'Bearer secret');
  assert.deepEqual(await pagesSite('bashor/ai-workshop-start', { fetch: site('legacy').fetch }), { url: 'https://atlas.example.com/', ready: false });
  // A custom domain, without the trailing slash.
  assert.deepEqual(await pagesSite('bashor/ai-workshop-start', { fetch: site('workflow', 'http://zal.im/ai-workshop-start').fetch }), {
    url: 'http://zal.im/ai-workshop-start/',
    ready: true,
  });
});

test('the URL: no Pages site → https://<owner>.github.io/<repo>/, not ready', async () => {
  const none = fakeGitHub({});
  assert.deepEqual(await pagesSite('Bashor/ai-workshop-start', { fetch: none.fetch }), {
    url: 'https://bashor.github.io/ai-workshop-start/',
    ready: false,
  });
  assert.deepEqual(await pagesSite('bashor/bashor.github.io', { fetch: none.fetch }), { url: 'https://bashor.github.io/', ready: false });
});

test('the comment: the URL and the commit; how to set up Pages when it is not; removed', () => {
  const url = 'https://bashor.github.io/ai-workshop-start/';
  const published = commentBody({ state: 'published', pr: 7, site: { url, ready: true }, sha: SHA });
  assert.ok(published.startsWith(MARKER));
  assert.match(published, /https:\/\/bashor\.github\.io\/ai-workshop-start\/\.pr-preview\/7\//);
  assert.match(published, /5ab6270/);
  assert.match(published, /once the Pages workflow has run/);
  assert.doesNotMatch(published, /Settings/);

  const notReady = commentBody({ state: 'published', pr: 7, site: { url, ready: false }, sha: SHA });
  assert.match(notReady, /\.pr-preview\/7\//);
  assert.match(notReady, /Settings → Pages → Source: GitHub Actions/);

  const removed = commentBody({ state: 'removed', pr: 7, site: { url, ready: true }, sha: SHA });
  assert.ok(removed.startsWith(MARKER));
  assert.match(removed, /removed/i);
  assert.doesNotMatch(removed, /\.pr-preview\/7/);
});

test('one comment, kept up to date: created the first time, then the same one edited', async () => {
  const comments: { id: number; body: string }[] = [];
  const github = fakeGitHub({
    [`GET ${API}/issues/7/comments?per_page=100&page=1`]: () => ({ status: 200, body: comments }),
    [`POST ${API}/issues/7/comments`]: (body) => {
      comments.push({ id: 42, body: (body as { body: string }).body });
      return { status: 201, body: comments[0] };
    },
    [`PATCH ${API}/issues/comments/42`]: (body) => {
      comments[0].body = (body as { body: string }).body;
      return { status: 200, body: comments[0] };
    },
  });
  await comment('bashor/ai-workshop-start', 7, `${MARKER}\nfirst`, { fetch: github.fetch, token: 'secret' });
  await comment('bashor/ai-workshop-start', 7, `${MARKER}\nsecond`, { fetch: github.fetch, token: 'secret' });
  assert.deepEqual(comments, [{ id: 42, body: `${MARKER}\nsecond` }]);
  assert.deepEqual(
    github.requests.map(({ method, url }) => `${method} ${url.replace(API, '')}`),
    ['GET /issues/7/comments?per_page=100&page=1', 'POST /issues/7/comments', 'GET /issues/7/comments?per_page=100&page=1', 'PATCH /issues/comments/42'],
  );
  assert.ok(github.requests.every((request) => request.authorization === 'Bearer secret'));
});

test('the comment found among many: every page of comments looked at', async () => {
  const others = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, body: `comment ${i}` }));
  const github = fakeGitHub({
    [`GET ${API}/issues/7/comments?per_page=100&page=1`]: () => ({ status: 200, body: others }),
    [`GET ${API}/issues/7/comments?per_page=100&page=2`]: () => ({ status: 200, body: [{ id: 500, body: `${MARKER}\nold` }] }),
    [`PATCH ${API}/issues/comments/500`]: () => ({ status: 200 }),
  });
  await comment('bashor/ai-workshop-start', 7, `${MARKER}\nnew`, { fetch: github.fetch });
  assert.deepEqual(github.requests.at(-1), { method: 'PATCH', url: `${API}/issues/comments/500`, body: { body: `${MARKER}\nnew` }, authorization: undefined });
});

test('a preview published or removed: the Pages workflow run again, on the default branch', async () => {
  const github = fakeGitHub({ [`POST ${API}/actions/workflows/pages.yml/dispatches`]: () => ({ status: 204 }) });
  await dispatch('bashor/ai-workshop-start', 'main', { fetch: github.fetch, token: 'secret' });
  assert.deepEqual(github.requests, [
    { method: 'POST', url: `${API}/actions/workflows/pages.yml/dispatches`, body: { ref: 'main' }, authorization: 'Bearer secret' },
  ]);
  await assert.rejects(dispatch('bashor/ai-workshop-start', 'main', { fetch: fakeGitHub({}).fetch }), /404/);
});

type Workflow = {
  on: { pull_request: { types: string[]; paths?: string[] } };
  permissions: Record<string, string>;
  concurrency: { group: string; 'cancel-in-progress': boolean };
  jobs: Record<string, { if?: string; steps: { uses?: string; with?: Record<string, unknown>; run?: string; env?: Record<string, string> }[] }>;
};
const workflow = (name: string) => parse(readFileSync(join(ROOT, '.github/workflows', name), 'utf8')) as Workflow;

test('published for a pull request that changes the Web UI: opened, reopened, a new push', () => {
  const preview = workflow('preview.yml');
  assert.deepEqual(preview.on.pull_request.types.toSorted(), ['opened', 'reopened', 'synchronize']);
  assert.deepEqual(preview.on.pull_request.paths!.toSorted(), [
    '.github/workflows/preview.yml',
    'package-lock.json',
    'package.json',
    'scripts/build.ts',
    'scripts/preview.ts',
    'src/core/**',
    'src/web/**',
    'web/**',
  ]);
  const [job] = Object.values(preview.jobs);
  // Forks: no preview.
  assert.match(job.if!, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  const runs = job.steps.map((step) => step.run ?? '').join('\n');
  assert.match(runs, /npm ci/);
  assert.match(runs, /npm run build/);
  assert.match(runs, /node scripts\/preview\.ts publish/);
  const script = job.steps.find((step) => step.run?.includes('preview.ts publish'))!;
  assert.equal(script.env?.DEFAULT_BRANCH, '${{ github.event.repository.default_branch }}');
  assert.deepEqual(preview.permissions, { contents: 'write', 'pull-requests': 'write', pages: 'read', actions: 'write' });
});

test('removed when closed or merged, whatever its files; one run at a time for a pull request, the last one wins', () => {
  const preview = workflow('preview.yml');
  const removal = workflow('preview-remove.yml');
  assert.deepEqual(removal.on.pull_request.types, ['closed']);
  assert.equal(removal.on.pull_request.paths, undefined);
  const [job] = Object.values(removal.jobs);
  assert.match(job.if!, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  // The script of the default branch: a closed pull request's own may be gone.
  const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout'))!;
  assert.equal(checkout.with?.ref, '${{ github.event.repository.default_branch }}');
  const script = job.steps.find((step) => step.run?.includes('preview.ts remove'))!;
  assert.equal(script.env?.DEFAULT_BRANCH, '${{ github.event.repository.default_branch }}');
  assert.deepEqual(removal.permissions, preview.permissions);
  // The same group: closing cancels a preview still being published.
  assert.equal(preview.concurrency.group, removal.concurrency.group);
  assert.match(preview.concurrency.group, /github\.event\.pull_request\.number/);
  assert.equal(preview.concurrency['cancel-in-progress'], true);
  assert.equal(removal.concurrency['cancel-in-progress'], true);
});

test('the built page works in .pr-preview/<N>/: the page URL keeps its path', async (t) => {
  const outdir = mkdtempSync(join(tmpdir(), 'skill-atlas-preview-page-'));
  t.after(() => rmSync(outdir, { recursive: true, force: true }));
  await build(outdir);
  const html = readFileSync(join(outdir, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /(?:src|href)="\//);
  const url = 'https://bashor.github.io/ai-workshop-start/.pr-preview/7/';
  const dom = new JSDOM(html, { url: `${url}?repo=JetBrains/fixture` });
  t.after(() => dom.window.close());
  mountApp(dom.window as unknown as Window, { fetch: replay(recordFixture('JetBrains/fixture')) });
  const document = dom.window.document;
  for (let waited = 0; !document.querySelector('#skills li button') && waited < 2000; waited += 5) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  document.querySelector<HTMLElement>('#skills li button')!.click();
  const location = new URL(dom.window.location.href);
  assert.equal(`${location.origin}${location.pathname}`, url);
  assert.equal(location.searchParams.get('repo'), 'JetBrains/fixture');
  assert.ok(location.searchParams.get('skill'));
  assert.equal(new URL('app.js', location).href, `${url}app.js`);
});

test('.pr-preview/ in .gitignore: a preview put into a checkout by hand is never committed', () => {
  assert.equal(git(ROOT, 'check-ignore', '--no-index', '.pr-preview/7/index.html'), '.pr-preview/7/index.html');
});

test('the Pages workflow: the previews into dist/ after the build, hidden files uploaded too', () => {
  const pagesWorkflow = workflow('pages.yml');
  const list = Object.values(pagesWorkflow.jobs).flatMap((job) => job.steps);
  const build = list.findIndex((step) => step.run === 'npm run build');
  const collecting = list.findIndex((step) => step.run === 'node scripts/preview.ts collect dist');
  const upload = list.findIndex((step) => step.uses?.startsWith('actions/upload-pages-artifact'));
  assert.ok(build !== -1 && build < collecting && collecting < upload, `${build} < ${collecting} < ${upload}`);
  // .pr-preview/ starts with a `.`: left out of the artifact otherwise.
  assert.equal(list[upload].with?.['include-hidden-files'], true);
  // The workflow the preview runs again.
  assert.ok(Object.hasOwn(pagesWorkflow.on, 'workflow_dispatch'));
});
