// The organization cases in spec/web.md, on the real page in jsdom, with GitHub answering from
// recordings: Acme, an organization of small repositories, ./fixture among them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOrganization } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { openPage, record, recordFixture, recordOrganization } from './web-helpers.ts';

const SKILL = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n# ${name}\n`;

const ACME: Recording = {
  ...recordOrganization('Acme', ['empty', 'zeta', 'fixture', 'docs']),
  ...recordFixture('Acme/fixture'),
  ...record('Acme/docs', { '.claude/skills/guide/SKILL.md': SKILL('guide'), 'README.md': '# Docs\n' }),
  ...record('Acme/zeta', { '.agents/skills/zeta/SKILL.md': SKILL('zeta') }),
  ...record('Acme/empty', { 'README.md': '# Nothing here\n' }),
};

const summary = (page: ReturnType<typeof openPage>) => page.$('#summary')?.textContent;

/** Waits until the organization's scan is over: its list, no progress on the left. */
const scanned = (page: ReturnType<typeof openPage>) =>
  page.until(() => page.$('#skills')!.getAttribute('aria-busy') === 'false' && summary(page), 'the scan to be over');

/** GitHub answering from `recording`, each URL containing `part` only once released. */
function holding(recording: Recording, part: string) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const answer = replay(recording);
  const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
    if (url.includes(part)) await held;
    return answer(url, init);
  };
  return { fetch, release };
}

test('an organization: its name or its URL; a repository is not one', () => {
  for (const input of [
    'JetBrains',
    'https://github.com/JetBrains',
    'http://github.com/JetBrains',
    'github.com/JetBrains',
    'https://www.github.com/JetBrains',
    'https://github.com/JetBrains/',
    '  JetBrains  ',
  ]) {
    assert.deepEqual(parseOrganization(input), { owner: 'JetBrains' }, input);
  }
  assert.deepEqual(parseOrganization('my-org-2'), { owner: 'my-org-2' });
  for (const input of ['', 'JetBrains/kotlin', 'https://github.com/JetBrains/kotlin', './fixture', '-a', 'a-', 'a--b', 'a.b', 'a b', 'https://gitlab.com/a', 'github.com']) {
    assert.equal(parseOrganization(input), undefined, input);
  }
});

test('owner → every repository scanned, with a badge of its skills, most first, and ?org= in the page URL', async () => {
  const page = openPage('', ACME);
  page.scan('Acme');
  await scanned(page);
  assert.equal(summary(page), 'Acme · 4 repositories');
  assert.deepEqual(page.names(), ['fixture', 'docs', 'zeta', 'empty']);
  assert.deepEqual(page.badges(), ['5', '1', '1', '0']);
  assert.equal(page.$('#skills li .badge')!.getAttribute('title'), '5 skills');
  assert.equal(page.param('org'), 'Acme');
  assert.equal(page.param('repo'), null);
  assert.equal(page.$('#status')!.textContent, '');
  assert.match(page.$('#skill')!.textContent!, /pick a repository/i);
});

test("an organization's URL is scanned as the organization, with or without the scheme", async () => {
  for (const url of ['https://www.github.com/Acme/', 'github.com/Acme', 'www.github.com/Acme/']) {
    const page = openPage('', ACME);
    page.scan(url);
    await scanned(page);
    assert.equal(summary(page), 'Acme · 4 repositories', url);
    assert.equal(page.param('org'), 'Acme', url);
  }
});

test('opening ?org= scans at once', async () => {
  const page = openPage('?org=Acme', ACME);
  assert.equal((page.$('#repo') as HTMLInputElement).value, 'Acme');
  await scanned(page);
  assert.equal(summary(page), 'Acme · 4 repositories');
});

test('click a repository → its skills, no new request; back → the organization again, no new scan', async () => {
  const page = openPage('', ACME);
  page.scan('Acme');
  await scanned(page);
  const requests = page.requests.length;

  page.pick(0);
  await page.until(() => summary(page) === 'Acme/fixture · 5 skills', 'the repository');
  assert.deepEqual(page.names(), ['code-style', 'commits', 'commits', 'commits', 'release-checklist']);
  assert.equal(page.param('repo'), 'Acme/fixture');
  assert.equal(page.param('org'), null);
  assert.equal((page.$('#repo') as HTMLInputElement).value, 'Acme/fixture');
  assert.equal(page.$$('#warnings li').length, 1, "the repository's warnings");
  page.pick(1);
  assert.equal(page.$('#skill h1')!.textContent, 'commits');

  page.window.history.back();
  await page.until(() => page.param('skill') === null && /pick a skill/i.test(page.$('#skill')!.textContent!), 'no skill');
  page.window.history.back();
  await page.until(() => summary(page) === 'Acme · 4 repositories', 'the organization');
  assert.deepEqual(page.badges(), ['5', '1', '1', '0']);
  assert.equal((page.$('#repo') as HTMLInputElement).value, 'Acme');
  assert.equal(page.requests.length, requests);

  page.window.history.forward();
  await page.until(() => summary(page) === 'Acme/fixture · 5 skills', 'the repository again');
  assert.equal(page.requests.length, requests);
});

test('a repository that failed → its message instead of the badge; the others go on', async () => {
  const broken: Recording = {
    ...ACME,
    ...recordOrganization('Acme', ['docs', 'broken', 'zeta']),
    'https://api.github.com/repos/Acme/broken/commits/main': { status: 500, body: { message: 'Server Error' } },
  };
  const page = openPage('?org=Acme', broken);
  await scanned(page);
  assert.deepEqual(page.names(), ['docs', 'zeta', 'broken']);
  assert.deepEqual(page.badges(), ['1', '1']);
  assert.equal(
    page.$$('#skills li')[2].querySelector('.error')!.textContent,
    'GitHub answered 500 for https://api.github.com/repos/Acme/broken/commits/main: Server Error',
  );
  assert.equal(page.$('#warnings')!.children.length, 0);
});

test('an empty repository → 0 skills', async () => {
  const empty: Recording = {
    ...ACME,
    ...recordOrganization('Acme', ['docs', 'new']),
    'https://api.github.com/repos/Acme/new/commits/main': { status: 409, body: { message: 'Git Repository is empty.' } },
  };
  const page = openPage('?org=Acme', empty);
  await scanned(page);
  assert.deepEqual(page.names(), ['docs', 'new']);
  assert.deepEqual(page.badges(), ['1', '0']);
});

test('the rate limit → the rest not scanned, a warning above the list', async () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  const limited: Recording = {
    ...recordOrganization('Acme', names),
    ...Object.assign({}, ...names.map((name) => record(`Acme/${name}`, { [`.claude/skills/${name}/SKILL.md`]: SKILL(name) }))),
    'https://api.github.com/repos/Acme/a/commits/main': { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } },
  };
  const page = openPage('?org=Acme', limited);
  await scanned(page);
  assert.deepEqual(page.$$('#warnings li').map((element) => element.textContent), [
    'GitHub rate limit reached; try again later. Not scanned: 3 repositories',
  ]);
  // A few at a time: b, c and d were already scanning; e and f never start.
  assert.deepEqual(page.names(), ['b', 'c', 'd', 'a', 'e', 'f']);
  assert.deepEqual(page.badges(), ['1', '1', '1']);
  assert.deepEqual(page.$$('#skills li .error').map((element) => element.textContent), ['not scanned', 'not scanned', 'not scanned']);
  assert.ok(!page.requests.some((url) => /Acme\/[ef]\b/.test(url)), 'no request for e and f');
  const order = page.$('#warnings')!.compareDocumentPosition(page.$('#list')!);
  assert.ok(order & page.window.Node.DOCUMENT_POSITION_FOLLOWING, 'the warning comes before the list');
});

test('every page of repositories, 100 a page', async () => {
  const names = Array.from({ length: 101 }, (_, index) => `r${String(index).padStart(3, '0')}`);
  const many: Recording = {
    ...recordOrganization('Acme', names),
    ...Object.assign({}, ...names.map((name) => record(`Acme/${name}`, {}))),
  };
  const page = openPage('?org=Acme', many);
  await scanned(page);
  assert.equal(summary(page), 'Acme · 101 repositories');
  assert.equal(page.names().at(-1), 'r100');
});

test('no repositories → No repositories found', async () => {
  const page = openPage('?org=Acme', recordOrganization('Acme', []));
  await page.until(() => summary(page));
  assert.equal(summary(page), 'Acme · 0 repositories');
  assert.equal(page.$('#list')!.textContent, 'No repositories found');
});

test('not an organization → a clear message instead of the list', async () => {
  const notFound: Recording = {
    'https://api.github.com/orgs/nobody/repos?per_page=100&page=1': { status: 404, body: { message: 'Not Found' } },
  };
  const page = openPage('?org=nobody', notFound);
  await page.until(() => /^Organization/.test(page.$('#status')!.textContent!));
  assert.equal(page.$('#status')!.textContent, 'Organization not found: https://github.com/nobody');
  assert.equal(page.$('#summary'), null);
});

test('scanning: the progress; a new scan replaces the running one, and its repositories stop', async () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  const recording: Recording = {
    ...recordOrganization('Acme', names),
    ...Object.assign({}, ...names.map((name) => record(`Acme/${name}`, { [`.claude/skills/${name}/SKILL.md`]: SKILL(name) }))),
    ...record('Acme/docs', { '.claude/skills/guide/SKILL.md': SKILL('guide') }),
  };
  // Acme/a answers only once released.
  const { fetch, release } = holding(recording, 'Acme/a/');
  const page = openPage('', recording, { fetch });
  page.scan('Acme');
  assert.match(page.$('#status')!.textContent!, /^Scanning Acme/);
  assert.equal(page.$('#skills')!.getAttribute('aria-busy'), 'true');
  await page.until(() => page.$('#status')!.textContent === 'Scanning Acme… 5 of 6 repositories · 5 skills', 'the progress');

  page.scan('Acme/docs');
  await page.until(() => summary(page) === 'Acme/docs · 1 skill');
  const requests = page.requests.length;
  release();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(summary(page), 'Acme/docs · 1 skill');
  assert.equal(page.$('#status')!.textContent, '');
  assert.equal(page.$('#skills')!.getAttribute('aria-busy'), 'false');
  // a's own requests finish; nothing new starts.
  assert.ok(page.requests.slice(requests).every((url) => url.includes('Acme/a/')), page.requests.slice(requests).join('\n'));
});

test('the GitHub rate limit on the list of repositories → try again later', async () => {
  const limited: Recording = {
    'https://api.github.com/orgs/Acme/repos?per_page=100&page=1': { status: 403, body: { message: 'API rate limit exceeded for 192.0.2.1.' } },
  };
  const page = openPage('?org=Acme', limited);
  await page.until(() => page.$('#status')!.textContent && !/^Scanning/.test(page.$('#status')!.textContent!));
  assert.equal(page.$('#status')!.textContent, 'GitHub rate limit reached; try again later');
});

test('as they come: the repositories before the scan is over, their badges as soon as they are scanned', async () => {
  const recording: Recording = {
    ...recordOrganization('Acme', ['a', 'broken', 'docs', 'empty', 'fixture']),
    ...record('Acme/a', { '.claude/skills/a/SKILL.md': SKILL('a') }),
    ...record('Acme/docs', { '.claude/skills/guide/SKILL.md': SKILL('guide'), 'README.md': '# Docs\n' }),
    ...record('Acme/empty', { 'README.md': '# Nothing here\n' }),
    ...recordFixture('Acme/fixture'),
    'https://api.github.com/repos/Acme/broken/commits/main': { status: 500, body: { message: 'Server Error' } },
  };
  // Acme/a answers only once released.
  const { fetch, release } = holding(recording, 'Acme/a/');
  const page = openPage('?org=Acme', recording, { fetch });
  await page.until(() => page.$('#status')!.textContent === 'Scanning Acme… 4 of 5 repositories · 6 skills', 'the progress');
  assert.equal(summary(page), 'Acme · 5 repositories');
  // The scanned ones by their skills, then the one not scanned yet, then the failed one.
  assert.deepEqual(page.names(), ['fixture', 'docs', 'empty', 'a', 'broken']);
  assert.deepEqual(page.badges(), ['5', '1', '0']);
  assert.deepEqual(page.$$('#skills li .pending').map((element) => element.textContent), ['…']);
  assert.equal(page.$$('#skills li')[3].querySelector('.pending')!.getAttribute('title'), 'Scanning…');
  assert.match(page.$$('#skills li')[4].querySelector('.error')!.textContent!, /^GitHub answered 500/);
  assert.equal(page.$('#skills')!.getAttribute('aria-busy'), 'true');

  // Not clickable until the scan is over.
  assert.ok(page.$$('#skills li button').every((button) => (button as HTMLButtonElement).disabled));
  page.pick(0);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(page.param('org'), 'Acme');
  assert.equal(summary(page), 'Acme · 5 repositories');

  release();
  await scanned(page);
  assert.equal(page.$('#status')!.textContent, '');
  assert.deepEqual(page.names(), ['fixture', 'a', 'docs', 'empty', 'broken']);
  assert.deepEqual(page.badges(), ['5', '1', '1', '0']);
  assert.equal(page.$$('#skills li .pending').length, 0);
  assert.ok(page.$$('#skills li button').every((button) => !(button as HTMLButtonElement).disabled));
  page.pick(1);
  await page.until(() => summary(page) === 'Acme/a · 1 skill', 'the repository');
});

test('as they come: each page of repositories listed before the next one', async () => {
  const names = Array.from({ length: 101 }, (_, index) => `r${String(index).padStart(3, '0')}`);
  const many: Recording = {
    ...recordOrganization('Acme', names),
    ...Object.assign({}, ...names.map((name) => record(`Acme/${name}`, {}))),
  };
  // The second page answers only once released.
  const { fetch, release } = holding(many, 'page=2');
  const page = openPage('?org=Acme', many, { fetch });
  await page.until(() => summary(page) === 'Acme · 100 repositories', 'the first page');
  assert.equal(page.names().length, 100);
  assert.equal(page.$$('#skills li .pending').length, 100);
  assert.equal(page.$('#status')!.textContent, 'Scanning Acme…');
  assert.ok(!page.requests.some((url) => url.includes('/repos/Acme/r')), 'no repository scanned before every one is listed');

  release();
  await scanned(page);
  assert.equal(summary(page), 'Acme · 101 repositories');
  assert.equal(page.badges().length, 101);
});
