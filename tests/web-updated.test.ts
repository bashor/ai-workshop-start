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
