// The filter in spec/web.md, on the real page in jsdom, with ./fixture as JetBrains/fixture.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Recording } from '../src/core/replay.ts';
import { openPage, record, recordFixture } from './web-helpers.ts';

const ALL: Recording = {
  ...recordFixture('JetBrains/fixture'),
  ...record('JetBrains/docs', { '.claude/skills/guide/SKILL.md': '---\nname: guide\ndescription: A guide.\n---\n# Guide\n' }),
  ...record('JetBrains/empty', { 'README.md': '# Nothing here\n' }),
};

async function scanned(query = '?repo=JetBrains/fixture') {
  const page = openPage(query, ALL);
  await page.until(() => page.names().length > 0 || page.$('#summary'));
  return page;
}

const count = (page: Awaited<ReturnType<typeof scanned>>) => page.$('#count')!.textContent;

test('an edit box on top of the skills list, below the summary and the warnings; X of Y', async () => {
  const page = await scanned();
  const filter = page.$('#filter') as HTMLInputElement;
  assert.ok(filter);
  assert.equal(filter.value, '');
  const following = page.window.Node.DOCUMENT_POSITION_FOLLOWING;
  assert.ok(page.$('#summary')!.compareDocumentPosition(filter) & following, 'below the summary');
  assert.ok(page.$('#warnings')!.compareDocumentPosition(filter) & following, 'below the warnings');
  assert.ok(filter.compareDocumentPosition(page.$('#list')!) & following, 'on top of the list');
  assert.equal(count(page), '5 of 5');
  assert.deepEqual(page.marks('name'), []);
});

test('filters while typing: the matched skills, X of Y, the matched parts highlighted', async () => {
  const page = await scanned();
  page.filter('commit');
  assert.deepEqual(page.names(), ['commits', 'commits', 'commits']);
  assert.equal(count(page), '3 of 5');
  assert.deepEqual(page.marks('name'), ['commit', 'commit', 'commit']);
  // Every occurrence, ignoring case.
  assert.deepEqual(page.marks('description'), ['commit', 'Commit', 'commit', 'commit']);
  assert.equal(page.$('#skills li .name')!.textContent, 'commits');
  assert.equal(page.$('#skills li .name')!.innerHTML, '<mark>commit</mark>s');

  page.filter('commits s');
  assert.deepEqual(page.names(), ['commits']);
  assert.equal(count(page), '1 of 5');
  assert.deepEqual(page.marks('description'), ['Commits s']);
});

test('ignoring case and the spaces around; the name or the shown description', async () => {
  const page = await scanned();
  page.filter('  STYLE ');
  assert.deepEqual(page.names(), ['code-style', 'commits']);
  assert.equal(count(page), '2 of 5');
  assert.deepEqual(page.marks('name'), ['style']);
  assert.deepEqual(page.marks('description'), ['style', 'style']);

  // Only in the description: the name not highlighted.
  page.filter('repository');
  assert.deepEqual(page.names(), ['commits', 'commits']);
  assert.deepEqual(page.marks('name'), []);
  assert.deepEqual(page.marks('description'), ['repository', 'repository']);
});

test('the text is matched as it is, not as a pattern', async () => {
  const page = await scanned();
  page.filter('.');
  // release-checklist has no description.
  assert.deepEqual(page.names(), ['code-style', 'commits', 'commits', 'commits']);
  page.filter("project's (");
  assert.equal(count(page), '0 of 5');
});

test('nothing matched → No matching skills; an empty filter → every skill', async () => {
  const page = await scanned();
  page.filter('no such skill');
  assert.deepEqual(page.names(), []);
  assert.equal(count(page), '0 of 5');
  assert.equal(page.$('#list')!.textContent, 'No matching skills');

  page.filter('   ');
  assert.equal(count(page), '5 of 5');
  assert.deepEqual(page.names(), ['code-style', 'commits', 'commits', 'commits', 'release-checklist']);
  assert.deepEqual(page.marks('name'), []);
});

test('selecting a skill keeps the filter; the selected one stays marked while filtering', async () => {
  const page = await scanned();
  page.filter('commits');
  page.pick(1);
  assert.equal(page.$('#skill h1')!.textContent, 'commits');
  assert.equal(page.param('skill'), '.claude/skills/commits/SKILL.md');
  assert.equal((page.$('#filter') as HTMLInputElement).value, 'commits');
  assert.equal(count(page), '3 of 5');

  page.filter('commit');
  const current = page.$$('#skills li button').map((button) => button.getAttribute('aria-current'));
  assert.deepEqual(current, [null, 'true', null]);
  // Filtered out: still shown on the right.
  page.filter('code');
  assert.equal(page.$('#skill h1')!.textContent, 'commits');
});

test('a new repository → the filter empty again', async () => {
  const page = await scanned();
  page.filter('commit');
  page.scan('JetBrains/docs');
  await page.until(() => page.$('#summary')?.textContent === 'JetBrains/docs · 1 skill');
  assert.equal((page.$('#filter') as HTMLInputElement).value, '');
  assert.equal(count(page), '1 of 1');
  assert.deepEqual(page.names(), ['guide']);
});

test('no skills → no filter', async () => {
  const page = await scanned('?repo=JetBrains/empty');
  assert.equal(page.$('#list')!.textContent, 'No skills found');
  assert.equal(page.$('#filter'), null);
});
