// The Add token button in spec/web.md, checked on the real page in jsdom: the token saved in local storage,
// the token every GitHub API request carries, with GitHub answering from recordings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Recording } from '../src/core/replay.ts';
import { COMMIT, openPage, record, recordOrganization, TOKEN_KEY } from './web-helpers.ts';

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

/** The page's local storage: what a reload finds. */
const stored = (page: Page) => {
  const storage = page.window.localStorage;
  return Object.fromEntries(Array.from({ length: storage.length }, (_, index) => [storage.key(index)!, storage.getItem(storage.key(index)!)!]));
};

/** What is shown of the token controls: the buttons by their text, the field as `field`. */
function controls(page: Page) {
  return ['#add-token', '#token', '#save-token', '#cancel-token', '#remove-token']
    .filter((selector) => page.shown(selector))
    .map((selector) => (selector === '#token' ? 'field' : page.$(selector)!.textContent));
}

test('the Add token button: next to the field at the top, no token field, nothing saved', () => {
  const page = openPage('', EXAMPLE);
  const button = page.$('header #add-token');
  assert.ok(button);
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.getAttribute('type'), 'button');
  assert.deepEqual(controls(page), ['Add token']);
  assert.equal(page.window.localStorage.getItem(TOKEN_KEY), null);
  assert.deepEqual(page.requests, []);
});

test('click Add token → the token field in its place, hidden as typed, empty and focused, with Save and Cancel', () => {
  const page = openPage('', EXAMPLE);
  page.$('#add-token')!.click();
  assert.deepEqual(controls(page), ['field', 'Save', 'Cancel']);
  const field = page.$('#token') as HTMLInputElement;
  assert.equal(field.type, 'password');
  assert.equal(field.value, '');
  assert.ok(field.getAttribute('aria-label'));
  assert.equal(page.document.activeElement, field);
});

test('Save → the token saved in local storage, spaces ignored; the field gone, the button reads Change token', () => {
  const page = openPage('', EXAMPLE);
  page.token('  secret  ');
  assert.equal(page.window.localStorage.getItem(TOKEN_KEY), 'secret');
  assert.deepEqual(controls(page), ['Change token', 'Remove token']);
});

test('Enter in the token field → saved, as Save', () => {
  const page = openPage('', EXAMPLE);
  page.$('#add-token')!.click();
  (page.$('#token') as HTMLInputElement).value = 'secret';
  page.press('Enter');
  assert.equal(page.window.localStorage.getItem(TOKEN_KEY), 'secret');
  assert.deepEqual(controls(page), ['Change token', 'Remove token']);
});

test('Cancel or Escape → nothing changed, the field gone', () => {
  for (const close of [(page: Page) => page.$('#cancel-token')!.click(), (page: Page) => page.press('Escape')]) {
    const page = openPage('', EXAMPLE);
    page.$('#add-token')!.click();
    (page.$('#token') as HTMLInputElement).value = 'secret';
    close(page);
    assert.equal(page.window.localStorage.getItem(TOKEN_KEY), null);
    assert.deepEqual(controls(page), ['Add token']);

    page.token('first');
    page.$('#add-token')!.click();
    assert.equal((page.$('#token') as HTMLInputElement).value, '', 'the saved token not shown');
    (page.$('#token') as HTMLInputElement).value = 'second';
    close(page);
    assert.equal(page.window.localStorage.getItem(TOKEN_KEY), 'first');
    assert.deepEqual(controls(page), ['Change token', 'Remove token']);
  }
});

test('an empty token, or only spaces → nothing saved, a saved one forgotten, the skills found through the tree', async () => {
  for (const text of ['', '   ']) {
    const page = openPage('', EXAMPLE);
    page.token(text);
    assert.equal(page.window.localStorage.getItem(TOKEN_KEY), null);
    assert.deepEqual(controls(page), ['Add token']);

    page.token('secret');
    page.token(text);
    assert.equal(page.window.localStorage.getItem(TOKEN_KEY), null);
    assert.deepEqual(controls(page), ['Add token']);

    page.scan('JetBrains/example');
    await page.until(() => page.names().length > 0);
    assert.ok(api(page).some((request) => request.url.includes('/git/trees/')));
    for (const request of page.authorizations) assert.equal(request.authorization, undefined, request.url);
  }
});

test('Remove token → the saved token forgotten, the button Add token again, no token from the next scan on', async () => {
  const page = openPage('', EXAMPLE);
  page.token('secret');
  page.$('#remove-token')!.click();
  assert.equal(page.window.localStorage.getItem(TOKEN_KEY), null);
  assert.deepEqual(controls(page), ['Add token']);
  page.scan('JetBrains/example');
  await page.until(() => page.names().length > 0);
  for (const request of page.authorizations) assert.equal(request.authorization, undefined, request.url);
});

test('a saved token → every GitHub API request of a repository scan carries it, the skills found through code search', async () => {
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
      // The skill's last update.
      `https://api.github.com/repos/JetBrains/example/commits?sha=${COMMIT}&path=.claude/skills/commits&per_page=1`,
    ],
  );
  for (const request of api(page)) assert.equal(request.authorization, 'Bearer secret', request.url);
});

test("a saved token → every GitHub API request of an organization's scan carries it, the files through the tree, not code search", async () => {
  const page = openPage('', ORGANIZATION);
  page.token('secret');
  page.scan('JetBrains');
  await page.until(() => page.badges().length === 2);
  assert.deepEqual(page.badges(), ['1', '1']);
  assert.ok(api(page).some((request) => request.url.startsWith('https://api.github.com/orgs/JetBrains/repos')));
  assert.ok(api(page).some((request) => request.url.includes('/git/trees/')));
  assert.ok(!api(page).some((request) => request.url.startsWith('https://api.github.com/search/code')));
  for (const request of api(page)) assert.equal(request.authorization, 'Bearer secret', request.url);
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
  for (const request of api(page).slice(0, first)) assert.equal(request.authorization, 'Bearer first', request.url);
  for (const request of api(page).slice(first)) assert.equal(request.authorization, 'Bearer second', request.url);
});

test('kept across reloads: a reload → the saved token used, the button Change token; never in the page URL', async () => {
  const page = openPage('', EXAMPLE);
  page.token('secret');
  page.scan('JetBrains/example');
  await page.until(() => page.names().length > 0);
  page.pick(0);
  await page.until(() => page.param('skill'));
  assert.doesNotMatch(page.window.location.href, /secret/);
  assert.equal(page.window.sessionStorage.length, 0);
  assert.doesNotMatch(page.document.cookie, /secret/);

  const reloaded = openPage(new URL(page.window.location.href).search, EXAMPLE, { storage: stored(page) });
  assert.deepEqual(controls(reloaded), ['Change token', 'Remove token']);
  await reloaded.until(() => reloaded.names().length > 0);
  assert.ok(api(reloaded).length > 0);
  for (const request of api(reloaded)) assert.equal(request.authorization, 'Bearer secret', request.url);
  assert.doesNotMatch(reloaded.window.location.href, /secret/);
});

test("the token is not in the search form: no token in the URL even before the script runs", () => {
  const page = openPage('', EXAMPLE);
  page.$('#add-token')!.click();
  (page.$('#token') as HTMLInputElement).value = 'secret';
  assert.equal(page.$('#search #token'), null);
  (page.$('#repo') as HTMLInputElement).value = 'JetBrains/example';
  // What the browser would put in the URL on Enter or Scan, without the page's script.
  const submitted = new page.window.FormData(page.$('#search') as HTMLFormElement);
  assert.deepEqual([...submitted.entries()], [['repo', 'JetBrains/example']]);
});

test('local storage not available → the token kept for the page only, until a reload', async () => {
  const page = openPage('', EXAMPLE, { storage: 'unavailable' });
  assert.deepEqual(controls(page), ['Add token']);
  page.token('secret');
  assert.deepEqual(controls(page), ['Change token', 'Remove token']);
  page.scan('JetBrains/example');
  await page.until(() => page.names().length > 0);
  for (const request of api(page)) assert.equal(request.authorization, 'Bearer secret', request.url);

  const reloaded = openPage('?repo=JetBrains/example', EXAMPLE, { storage: 'unavailable' });
  assert.deepEqual(controls(reloaded), ['Add token']);
  await reloaded.until(() => reloaded.names().length > 0);
  for (const request of reloaded.authorizations) assert.equal(request.authorization, undefined, request.url);
});

test('GitHub rejects the token → a message naming the saved token', async () => {
  const rejected: Recording = {
    'https://api.github.com/repos/JetBrains/example': { status: 401, body: { message: 'Bad credentials' } },
  };
  const page = openPage('', rejected);
  page.token('wrong');
  page.scan('JetBrains/example');
  await scanned(page);
  assert.equal(page.$('#status')!.textContent, 'GitHub rejected the saved token');
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
