// The last updated date in spec/web.md: under each skill on the left, next to the link on the
// right, on the real page in jsdom, with GitHub answering from recordings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Recording } from '../src/core/replay.ts';
import { COMMIT, openPage, record, recordOrganization } from './web-helpers.ts';

const SKILL = (name: string) => `---\nname: ${name}\ndescription: The ${name} skill.\n---\n# ${name}\n`;

const TOOLS = record('Acme/tools', {
  '.claude/skills/build/SKILL.md': SKILL('build'),
  '.claude/skills/deploy/SKILL.md': SKILL('deploy'),
  '.claude/skills/never/SKILL.md': SKILL('never'),
}, { '.claude/skills/build': '2026-09-01T08:00:00Z', '.claude/skills/deploy': '2025-12-31T23:30:00-02:00', '.claude/skills/never': null });

const updated = (page: ReturnType<typeof openPage>) => page.$$('#skills li button').map((button) => button.querySelector('.updated')?.textContent);

test('left panel: `updated <date>` under the description, in UTC; no date → nothing', async () => {
  const page = openPage('', TOOLS);
  page.scan('Acme/tools');
  await page.until(() => page.names().length > 0);
  assert.deepEqual(page.names(), ['build', 'deploy', 'never']);
  assert.deepEqual(updated(page), ['updated 2026-09-01', 'updated 2026-01-01', undefined]);
  // Under the description.
  const build = page.$('#skills li button')!;
  const order = build.querySelector('.description')!.compareDocumentPosition(build.querySelector('.updated')!);
  assert.ok(order & page.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.deepEqual(page.$$('#warnings li'), []);
});

test('right panel: `Updated <date>` next to the link, the exact time on hover', async () => {
  const page = openPage('', TOOLS);
  page.scan('Acme/tools');
  await page.until(() => page.names().length > 0);
  page.pick(1);
  const time = page.$('#skill > header time.updated')!;
  assert.equal(time.textContent, 'Updated 2026-01-01');
  assert.equal(time.getAttribute('datetime'), '2026-01-01T01:30:00.000Z');
  assert.equal(time.title, '2026-01-01T01:30:00.000Z');
  // Next to the link to the file.
  assert.equal(time.previousElementSibling, page.$('#skill .source'));
  assert.equal(page.$('#skill .source')!.getAttribute('href'), `https://github.com/Acme/tools/blob/${COMMIT}/.claude/skills/deploy/SKILL.md`);

  page.pick(2);
  assert.equal(page.$('#skill h1')!.textContent, 'never');
  assert.equal(page.$('#skill .updated'), null);
});

test('the filter: the dates stay, not matched', async () => {
  const page = openPage('', TOOLS);
  page.scan('Acme/tools');
  await page.until(() => page.names().length > 0);
  page.filter('2026');
  assert.deepEqual(page.names(), []);
  page.filter('build');
  assert.deepEqual(updated(page), ['updated 2026-09-01']);
});

test('the date request fails → the skill without the date, a warning, the scan goes on', async () => {
  const recording: Recording = {
    ...TOOLS,
    [`https://api.github.com/repos/Acme/tools/commits?sha=${COMMIT}&path=.claude/skills/build&per_page=1`]: {
      status: 403,
      body: { message: 'API rate limit exceeded for 192.0.2.1.' },
    },
  };
  const page = openPage('', recording);
  page.scan('Acme/tools');
  await page.until(() => page.names().length > 0);
  assert.deepEqual(page.names(), ['build', 'deploy', 'never']);
  assert.deepEqual(updated(page), [undefined, 'updated 2026-01-01', undefined]);
  assert.deepEqual(
    page.$$('#warnings li').map((item) => item.textContent),
    ['last updated not known for 1 skill: GitHub rate limit reached; try again later'],
  );
});

const left = (remaining: number) => ({ 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': String(remaining) });

test('the reserve, in the page: no date request once 20 or fewer API requests are left, `try again later`', async () => {
  const recording = { ...TOOLS };
  // 22 left after the commit; the tree is one more: one date.
  recording['https://api.github.com/repos/Acme/tools/commits/main'] = { ...recording['https://api.github.com/repos/Acme/tools/commits/main'], headers: left(22) };
  const page = openPage('', recording);
  page.scan('Acme/tools');
  await page.until(() => page.names().length > 0);
  assert.deepEqual(updated(page), ['updated 2026-09-01', undefined, undefined]);
  assert.equal(page.requests.filter((url) => url.includes('/commits?')).length, 1);
  assert.deepEqual(
    page.$$('#warnings li').map((item) => item.textContent),
    ['last updated not known for 2 skills: GitHub rate limit nearly reached; try again later'],
  );
});

test("the reserve, for an organization: one count for all of its repositories", async () => {
  const names = ['a', 'b', 'c'];
  const recording: Recording = recordOrganization('Acme', names);
  for (const name of names) {
    const files: Record<string, string> = {};
    for (let i = 0; i < 8; i++) files[`.claude/skills/${name}${i}/SKILL.md`] = SKILL(`${name}${i}`);
    Object.assign(recording, record(`Acme/${name}`, files));
  }
  // 40 left after the list: each repository on its own would get all 8 of its dates.
  recording['https://api.github.com/orgs/Acme/repos?per_page=100&page=1'].headers = left(40);
  const page = openPage('', recording);
  page.scan('Acme');
  await page.until(() => page.badges().length === 3);
  // Every API request after the list, in the order sent: a date only while more than 20 are left.
  const sent = page.requests.slice(1).filter((url) => url.startsWith('https://api.github.com/'));
  let remaining = 40;
  for (const url of sent) {
    if (url.includes('/commits?')) assert.ok(remaining > 20, `${url} with ${remaining} left`);
    remaining--;
  }
  const dates = sent.filter((url) => url.includes('/commits?')).length;
  assert.ok(dates > 0 && dates <= 40 - 20 - 6, `${dates} dates`);
  assert.deepEqual(page.badges(), ['8', '8', '8']);
});

test("an organization's repository: its skills with the dates, no new request", async () => {
  const page = openPage('', { ...recordOrganization('Acme', ['tools']), ...TOOLS });
  page.scan('Acme');
  await page.until(() => page.names().length > 0);
  const requests = page.requests.length;
  page.pick(0);
  await page.until(() => page.$('#summary')!.textContent === 'Acme/tools · 3 skills', 'the repository');
  assert.deepEqual(updated(page), ['updated 2026-09-01', 'updated 2026-01-01', undefined]);
  assert.equal(page.requests.length, requests);
});
