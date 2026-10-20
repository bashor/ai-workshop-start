// The token field in spec/web.md, checked on the real page in jsdom: the token every GitHub API
// request carries, with GitHub answering from recordings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Recording } from '../src/core/replay.ts';
import { openPage, record, recordOrganization } from './web-helpers.ts';

const SKILL = '.claude/skills/commits/SKILL.md';
const TEXT = '---\nname: commits\ndescription: Write commit messages the way this repository does.\n---\n# Commits\n';

/** A repository with one skill, as GitHub answers it with a token, through code search, and without one. */
function recordWithSearch(id: string): Recording {
  return {
    ...record(id, { [SKILL]: TEXT, 'README.md': '# Readme\n' }),
    [`https://api.github.com/search/code?q=filename:SKILL.md+repo:${id}&per_page=100&page=1`]: {
      status: 200,
      body: { total_count: 1, items: [{ path: SKILL }] },
    },
  };
}

const EXAMPLE = recordWithSearch('JetBrains/example');
const OTHER = recordWithSearch('JetBrains/other');
const ORGANIZATION: Recording = { ...recordOrganization('JetBrains', ['example', 'other']), ...EXAMPLE, ...OTHER };

type Page = ReturnType<typeof openPage>;

const api = (page: Page) => page.authorizations.filter((request) => request.url.startsWith('https://api.github.com/'));

/** Waits until the scan is over: no progress on the left. */
const scanned = (page: Page) => page.until(() => page.$('#skills')!.getAttribute('aria-busy') === 'false' && !/^Scanning/.test(page.$('#status')!.textContent!));

test('the token field: next to the field at the top, hidden as typed, empty', () => {
  const page = openPage('', EXAMPLE);
  const token = page.$('header #search #token') as HTMLInputElement | null;
  assert.ok(token);
  assert.equal(token.type, 'password');
  assert.equal(token.value, '');
  assert.ok(token.getAttribute('aria-label'));
  assert.deepEqual(page.requests, []);
});

test('a token → every GitHub API request of a repository scan carries it, the skills found through code search', async () => {
  const page = openPage('', EXAMPLE);
  page.token('  secret  ');
  page.scan('JetBrains/example');
  await page.until(() => page.names().length > 0);
  assert.equal(page.$('#summary')!.textContent, 'JetBrains/example · 1 skill');
  assert.deepEqual(
    api(page).map((request) => request.url),
    [
      'https://api.github.com/repos/JetBrains/example',
      'https://api.github.com/repos/JetBrains/example/commits/main',
      'https://api.github.com/search/code?q=filename:SKILL.md+repo:JetBrains/example&per_page=100&page=1',
    ],
  );
  for (const request of api(page)) assert.equal(request.authorization, 'Bearer secret', request.url);
});

test("a token → every GitHub API request of an organization's scan carries it", async () => {
  const page = openPage('', ORGANIZATION);
  page.token('secret');
  page.scan('JetBrains');
  await page.until(() => page.badges().length === 2);
  assert.deepEqual(page.badges(), ['1', '1']);
  assert.ok(api(page).some((request) => request.url.startsWith('https://api.github.com/orgs/JetBrains/repos')));
  assert.ok(api(page).some((request) => request.url.startsWith('https://api.github.com/search/code')));
  for (const request of api(page)) assert.equal(request.authorization, 'Bearer secret', request.url);
});

test('an empty token field, or only spaces → no token, the skills found through the tree', async () => {
  for (const text of ['', '   ']) {
    const page = openPage('', EXAMPLE);
    page.token(text);
    page.scan('JetBrains/example');
    await page.until(() => page.names().length > 0);
    assert.ok(api(page).some((request) => request.url.includes('/git/trees/')));
    for (const request of page.authorizations) assert.equal(request.authorization, undefined, request.url);
  }
});

test('the token is read at each scan: a changed token → used from the next scan on', async () => {
  const page = openPage('', { ...EXAMPLE, ...OTHER });
  page.token('first');
  page.scan('JetBrains/example');
  await page.until(() => page.$('#summary')?.textContent === 'JetBrains/example · 1 skill');
  const first = api(page).length;

  page.token('second');
  page.scan('JetBrains/other');
  await page.until(() => page.$('#summary')?.textContent === 'JetBrains/other · 1 skill');
  const second = api(page).length;
  for (const request of api(page).slice(0, first)) assert.equal(request.authorization, 'Bearer first', request.url);
  for (const request of api(page).slice(first)) assert.equal(request.authorization, 'Bearer second', request.url);

  page.token('');
  page.scan('JetBrains/example');
  await scanned(page);
  await page.until(() => page.names().length > 0);
  assert.ok(api(page).length > second);
  for (const request of api(page).slice(second)) assert.equal(request.authorization, undefined, request.url);
});

test('the token is never in the page URL, never stored: a reload → the field empty, no token', async () => {
  const page = openPage('', EXAMPLE);
  page.token('secret');
  page.scan('JetBrains/example');
  await page.until(() => page.names().length > 0);
  page.pick(0);
  await page.until(() => page.param('skill'));
  assert.doesNotMatch(page.window.location.href, /secret/);
  assert.equal(page.window.localStorage.length, 0);
  assert.equal(page.window.sessionStorage.length, 0);
  assert.doesNotMatch(page.document.cookie, /secret/);

  const reloaded = openPage(new URL(page.window.location.href).search, EXAMPLE);
  assert.equal((reloaded.$('#token') as HTMLInputElement).value, '');
  await reloaded.until(() => reloaded.names().length > 0);
  for (const request of reloaded.authorizations) assert.equal(request.authorization, undefined, request.url);
});

test('GitHub rejects the token → a message naming the token field', async () => {
  const rejected: Recording = {
    'https://api.github.com/repos/JetBrains/example': { status: 401, body: { message: 'Bad credentials' } },
  };
  const page = openPage('', rejected);
  page.token('wrong');
  page.scan('JetBrains/example');
  await scanned(page);
  assert.equal(page.$('#status')!.textContent, 'GitHub rejected the token in the token field');
  assert.deepEqual(page.names(), []);
});

test('the rate limit with a token → try again in a minute', async () => {
  const limited: Recording = {
    'https://api.github.com/repos/JetBrains/MPS': { status: 403, body: { message: 'API rate limit exceeded for user ID 1.' } },
  };
  const page = openPage('', limited);
  page.token('secret');
  page.scan('JetBrains/MPS');
  await scanned(page);
  assert.equal(page.$('#status')!.textContent, 'GitHub rate limit reached; try again in a minute');
});
