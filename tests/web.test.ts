// The decisions in spec/web.md, checked on the real page in jsdom, with GitHub answering from
// recordings: ./fixture as JetBrains/fixture, and small repositories for the other cases.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from '../scripts/build.ts';
import { openGitHub, parseRepository } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { scan } from '../src/core/scan.ts';
import { COMMIT, openPage, record, recordFixture } from './web-helpers.ts';

const FIXTURE_REPO = recordFixture('JetBrains/fixture');

const GUIDE = `---
name: guide
description: A guide with links. Use it to test the right panel.
allowed-tools: Bash
---
# Guide

See [the reference](reference.md), [the readme](/README.md), [the docs](../../../docs/a.md#usage),
[this section](#guide) and [a site](https://example.com/).

![diagram](images/diagram.png)

<script>window.hacked = true</script>

<img src="x" onerror="window.hacked = true">

[click me](javascript:window.hacked=true)
`;

const DOCS = record('JetBrains/docs', { '.claude/skills/guide/SKILL.md': GUIDE, 'README.md': '# Docs\n' });
const EMPTY = record('JetBrains/empty', { 'README.md': '# Nothing here\n' });
const ALL: Recording = { ...FIXTURE_REPO, ...DOCS, ...EMPTY };

const blob = (id: string, path: string) => `https://github.com/${id}/blob/${COMMIT}/${path}`;

test('owner/repo or a GitHub URL as the CLI takes it; anything else is not a repository', () => {
  for (const input of [
    'JetBrains/kotlin',
    'https://github.com/JetBrains/kotlin',
    'http://github.com/JetBrains/kotlin',
    'github.com/JetBrains/kotlin',
    'https://www.github.com/JetBrains/kotlin',
    'https://github.com/JetBrains/kotlin.git',
    'https://github.com/JetBrains/kotlin/',
    '  JetBrains/kotlin  ',
  ]) {
    assert.deepEqual(parseRepository(input), { owner: 'JetBrains', repo: 'kotlin' }, input);
  }
  for (const input of ['', 'kotlin', './fixture', '../a/b', 'JetBrains/kotlin/tree/master', 'https://gitlab.com/a/b', 'a b/c']) {
    assert.equal(parseRepository(input), undefined, input);
  }
});

test('before a scan: the field at the top, an empty list and a hint to pick a skill', () => {
  const page = openPage('', ALL);
  assert.ok(page.$('header #repo'));
  assert.deepEqual(page.names(), []);
  assert.match(page.$('#skill')!.textContent!, /pick a skill/i);
  assert.deepEqual(page.requests, []);
});

test('owner/repo → the skills on the left, as the CLI lists them, and ?repo= in the page URL', async () => {
  const page = openPage('', ALL);
  page.scan('JetBrains/fixture');
  await page.until(() => page.names().length > 0);
  assert.equal(page.$('#summary')!.textContent, 'JetBrains/fixture · 5 skills');
  assert.deepEqual(page.names(), ['code-style', 'commits', 'commits', 'commits', 'release-checklist']);
  assert.deepEqual(
    page.$$('#skills li .description').map((element) => element.textContent),
    [
      "Follow the project's code style.",
      'Write commit messages in the Conventional Commits style.',
      'Write commit messages the way this repository does.',
      'Write commit messages the way this repository does.',
      '',
    ],
  );
  // Copies: listed once, also in the other paths.
  assert.equal(page.$('#skills li .copies')!.textContent, 'also in .github/skills/code-style/SKILL.md');
  assert.equal(page.$$('#skills li .copies').length, 1);
  // Not real: not listed.
  assert.doesNotMatch(page.$('#skills')!.textContent!, /shipped|tested|linked/);
  assert.equal(page.param('repo'), 'JetBrains/fixture');
  // Nothing selected yet.
  assert.match(page.$('#skill')!.textContent!, /pick a skill/i);
});

test('a GitHub URL is scanned as its owner/repo', async () => {
  const page = openPage('', ALL);
  page.scan('https://www.github.com/JetBrains/fixture.git/');
  await page.until(() => page.names().length > 0);
  assert.equal(page.$('#summary')!.textContent, 'JetBrains/fixture · 5 skills');
  assert.equal(page.param('repo'), 'JetBrains/fixture');
});

test('not a repository → a clear message and no request', async () => {
  const page = openPage('', ALL);
  page.scan('./fixture');
  assert.match(page.$('#status')!.textContent!, /^Not a GitHub repository: \.\/fixture/);
  assert.match(page.$('#status')!.textContent!, /owner\/repo/);
  assert.deepEqual(page.requests, []);
  assert.equal(page.param('repo'), null);
});

test('warnings are shown above the list, and the scan goes on', async () => {
  const page = openPage('', ALL);
  page.scan('JetBrains/fixture');
  await page.until(() => page.names().length > 0);
  const warnings = page.$$('#warnings li').map((element) => element.textContent!);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^\.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
  const order = page.$('#warnings')!.compareDocumentPosition(page.$('#list')!);
  assert.ok(order & page.window.Node.DOCUMENT_POSITION_FOLLOWING, 'the warnings come before the list');
});

test('click a skill → the right panel renders its SKILL.md, and &skill= is in the page URL', async () => {
  const page = openPage('', ALL);
  page.scan('JetBrains/docs');
  await page.until(() => page.names().length > 0);
  page.pick(0);
  const panel = page.$('#skill')!;
  // The name and description on top, from the front matter; the front matter not shown as text.
  assert.equal(panel.querySelector('h1')!.textContent, 'guide');
  assert.equal(panel.querySelector('.description')!.textContent, 'A guide with links. Use it to test the right panel.');
  assert.doesNotMatch(panel.textContent!, /allowed-tools|---/);
  // The link, pinned to the scanned commit.
  const source = panel.querySelector<HTMLAnchorElement>('a.source')!;
  assert.equal(source.href, blob('JetBrains/docs', '.claude/skills/guide/SKILL.md'));
  // Rendered Markdown.
  const markdown = panel.querySelector('.markdown')!;
  assert.equal(markdown.querySelector('h1')!.textContent, 'Guide');
  assert.equal(page.param('skill'), '.claude/skills/guide/SKILL.md');
  assert.equal(page.$('#skills li button')!.getAttribute('aria-current'), 'true');
});

test("relative links and images: from the skill's directory, at the scanned commit", async () => {
  const page = openPage('?repo=JetBrains/docs&skill=.claude/skills/guide/SKILL.md', ALL);
  await page.until(() => page.$('#skill .markdown'));
  const links = [...page.$('#skill .markdown')!.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]);
  assert.deepEqual(links, [
    ['the reference', blob('JetBrains/docs', '.claude/skills/guide/reference.md')],
    ['the readme', blob('JetBrains/docs', 'README.md')],
    ['the docs', `${blob('JetBrains/docs', 'docs/a.md')}#usage`],
    ['this section', '#guide'],
    ['a site', 'https://example.com/'],
  ]);
  const image = page.$('#skill .markdown img')!;
  assert.equal(
    image.getAttribute('src'),
    `https://raw.githubusercontent.com/JetBrains/docs/${COMMIT}/.claude/skills/guide/images/diagram.png`,
  );
  assert.equal(image.getAttribute('alt'), 'diagram');
});

test('SKILL.md is untrusted: no raw HTML, no scripts, no javascript: links', async () => {
  const page = openPage('?repo=JetBrains/docs&skill=.claude/skills/guide/SKILL.md', ALL);
  await page.until(() => page.$('#skill .markdown'));
  const markdown = page.$('#skill .markdown')!;
  assert.equal(markdown.querySelectorAll('script, [onerror]').length, 0);
  assert.equal(markdown.querySelectorAll('img').length, 1, 'only the Markdown image');
  assert.ok(![...markdown.querySelectorAll('a')].some((a) => /^javascript:/i.test(a.getAttribute('href') ?? '')));
  // Shown as text instead.
  assert.match(markdown.textContent!, /<script>window\.hacked = true<\/script>/);
  assert.equal((page.window as unknown as { hacked?: boolean }).hacked, undefined);
});

test('opening ?repo=…&skill=… scans at once and selects the skill', async () => {
  const page = openPage('?repo=JetBrains/fixture&skill=.agents/skills/commits/SKILL.md', ALL);
  assert.equal((page.$('#repo') as HTMLInputElement).value, 'JetBrains/fixture');
  await page.until(() => page.$('#skill h1'));
  assert.equal(page.$('#skill h1')!.textContent, 'commits');
  assert.equal(page.$('#skill .description')!.textContent, 'Write commit messages in the Conventional Commits style.');
  const current = page.$$('#skills li button').map((button) => button.getAttribute('aria-current'));
  assert.deepEqual(current, [null, 'true', null, null, null]);
});

test("a copy's path selects the skill it is a copy of", async () => {
  const page = openPage('?repo=JetBrains/fixture&skill=.github/skills/code-style/SKILL.md', ALL);
  await page.until(() => page.$('#skill h1'));
  assert.equal(page.$('#skill h1')!.textContent, 'code-style');
});

test('back and forward: the previous skill, the previous repository', async () => {
  const page = openPage('', ALL);
  const back = async (expect: () => unknown, what: string) => {
    page.window.history.back();
    await page.until(expect, what);
  };
  page.scan('JetBrains/fixture');
  await page.until(() => page.names().length > 0);
  page.pick(1);
  page.pick(0);
  assert.equal(page.param('skill'), '.claude/skills/code-style/SKILL.md');

  await back(() => page.param('skill') === '.agents/skills/commits/SKILL.md' && page.$('#skill h1')?.textContent === 'commits', 'the previous skill');
  await back(() => page.param('skill') === null && /pick a skill/i.test(page.$('#skill')!.textContent!), 'no skill');

  page.scan('JetBrains/docs');
  await page.until(() => page.$('#summary')?.textContent === 'JetBrains/docs · 1 skill');
  await back(() => page.$('#summary')?.textContent === 'JetBrains/fixture · 5 skills', 'the previous repository');
  assert.equal((page.$('#repo') as HTMLInputElement).value, 'JetBrains/fixture');

  page.window.history.forward();
  await page.until(() => page.$('#summary')?.textContent === 'JetBrains/docs · 1 skill', 'the next repository');
  assert.equal((page.$('#repo') as HTMLInputElement).value, 'JetBrains/docs');
});

test('scanning: a progress indicator; a new scan replaces the running one', async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const answer = replay(ALL);
  const page = openPage('', ALL, {
    // JetBrains/fixture answers only once released.
    fetch: async (url, init) => {
      if (url.includes('JetBrains/fixture')) await held;
      return answer(url, init);
    },
  });
  page.scan('JetBrains/fixture');
  assert.match(page.$('#status')!.textContent!, /^Scanning JetBrains\/fixture/);
  assert.equal(page.$('#skills')!.getAttribute('aria-busy'), 'true');

  page.scan('JetBrains/docs');
  await page.until(() => page.names().length > 0);
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(page.$('#summary')!.textContent, 'JetBrains/docs · 1 skill');
  assert.deepEqual(page.names(), ['guide']);
  assert.equal(page.$('#status')!.textContent, '');
  assert.equal(page.$('#skills')!.getAttribute('aria-busy'), 'false');
});

test('no skills → No skills found', async () => {
  const page = openPage('?repo=JetBrains/empty', ALL);
  await page.until(() => page.$('#summary'));
  assert.equal(page.$('#summary')!.textContent, 'JetBrains/empty · 0 skills');
  assert.equal(page.$('#list')!.textContent, 'No skills found');
});

test('unreachable repository → a clear message instead of the list', async () => {
  const notFound: Recording = {
    'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } },
  };
  const page = openPage('?repo=JetBrains/fixture', { ...ALL, ...notFound });
  await page.until(() => page.names().length > 0);
  page.scan('JetBrains/no-such-repository');
  await page.until(() => page.names().length === 0 && page.$('#status')!.textContent);
  assert.equal(page.$('#status')!.textContent, 'Repository not found: https://github.com/JetBrains/no-such-repository');
  assert.equal(page.$('#summary'), null);
  assert.match(page.$('#skill')!.textContent!, /pick a skill/i);
});

test('GitHub rate limit → try again later, no GITHUB_TOKEN in the page', async () => {
  const limited: Recording = {
    'https://api.github.com/repos/JetBrains/MPS': { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } },
  };
  const page = openPage('?repo=JetBrains/MPS', limited);
  await page.until(() => page.$('#status')!.textContent && !/^Scanning/.test(page.$('#status')!.textContent!));
  assert.equal(page.$('#status')!.textContent, 'GitHub rate limit reached; try again later');
  assert.deepEqual(page.names(), []);
});

test('the core gives a skill its body, without the front matter', async () => {
  const result = await scan(await openGitHub('JetBrains/docs', { fetch: replay(DOCS) }));
  assert.equal(result.skills[0].body.split('\n')[0], '# Guide');
  assert.doesNotMatch(result.skills[0].body, /allowed-tools/);
});

test('npm run build → static files that work from any path of a static host', async (t) => {
  const outdir = mkdtempSync(join(tmpdir(), 'skill-atlas-web-'));
  t.after(() => rmSync(outdir, { recursive: true, force: true }));
  await build(outdir);
  for (const file of ['index.html', 'app.js', 'style.css']) assert.ok(existsSync(join(outdir, file)), file);
  const html = readFileSync(join(outdir, 'index.html'), 'utf8');
  // Relative: GitHub Pages serves a project at /<repo>/.
  assert.match(html, /<script src="app\.js"/);
  assert.match(html, /<link rel="stylesheet" href="style\.css">/);
  const app = readFileSync(join(outdir, 'app.js'), 'utf8');
  assert.doesNotMatch(app, /\bnode:|process\.env|GITHUB_TOKEN/);

  // The bundle runs in a page on its own.
  const dom = await JSDOM.fromFile(join(outdir, 'index.html'), { runScripts: 'dangerously', resources: 'usable' });
  t.after(() => dom.window.close());
  await new Promise((resolve) => dom.window.addEventListener('load', resolve));
  assert.match(dom.window.document.querySelector('#skill')!.textContent!, /pick a skill/i);
});

test('npm run dev → the page on a local server', async (t) => {
  const server = spawn(process.execPath, ['scripts/dev.ts'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '0' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
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
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<input[^>]*id="repo"/);
  const app = await fetch(new URL('app.js', url));
  assert.equal(app.status, 200);
  assert.match(await app.text(), /Scanning/);
});
