// The skills list in spec/web.md: the cards, the copies' chips, the selected one, the keyboard;
// on the real page in jsdom, with ./fixture as JetBrains/fixture.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Recording } from '../src/core/replay.ts';
import { openPage, record, recordFixture } from './web-helpers.ts';

const LONG = 'Write release notes from the merged pull requests, grouped by area, with a line for every user-visible change and a link to each one.';

const ALL: Recording = {
  ...recordFixture('JetBrains/fixture'),
  ...record('JetBrains/copies', Object.fromEntries(
    ['.claude', '.agents', '.github'].map((root) => [`${root}/skills/style/SKILL.md`, '---\nname: style\ndescription: Style.\n---\n# Style\n']),
  )),
  ...record('JetBrains/docs', { '.claude/skills/guide/SKILL.md': `---\nname: guide\ndescription: ${LONG} Then post them.\n---\n# Guide\n` }),
};

async function scanned(query = '?repo=JetBrains/fixture') {
  const page = openPage(query, ALL);
  await page.until(() => page.names().length > 0);
  return page;
}

type Page = Awaited<ReturnType<typeof scanned>>;

const buttons = (page: Page) => page.$$('#list button');
const current = (page: Page) => buttons(page).map((button) => button.getAttribute('aria-current'));
const press = (page: Page, key: string) => {
  const target = page.document.activeElement!;
  target.dispatchEvent(new page.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

test('the summary: the repository, then N skills as a badge; the same text', async () => {
  const page = await scanned();
  const summary = page.$('#summary')!;
  assert.equal(summary.textContent, 'JetBrains/fixture · 5 skills');
  assert.equal(summary.querySelector('.repository')!.textContent, 'JetBrains/fixture');
  assert.equal(summary.querySelector('.badge')!.textContent, '5 skills');
  // `·` in the text, not shown.
  assert.equal(summary.querySelector('.separator')!.textContent, ' · ');

  const one = await scanned('?repo=JetBrains/docs');
  assert.equal(one.$('#summary .badge')!.textContent, '1 skill');
});

test("each skill a card: its name, its folder as a tag, the full path on hover", async () => {
  const page = await scanned();
  const folders = page.$$('#list li .folder');
  assert.deepEqual(
    folders.map((folder) => folder.textContent),
    ['.claude/skills', '.agents/skills', '.claude/skills', 'plugins/editor/.claude/skills', '.agents/skills'],
  );
  assert.deepEqual(
    folders.map((folder) => folder.title),
    [
      '.claude/skills/code-style/SKILL.md',
      '.agents/skills/commits/SKILL.md',
      '.claude/skills/commits/SKILL.md',
      'plugins/editor/.claude/skills/commits/SKILL.md',
      '.agents/skills/release-checklist/SKILL.md',
    ],
  );
  // The folder is next to the name, not part of it: the names are as before.
  assert.deepEqual(page.names(), ['code-style', 'commits', 'commits', 'commits', 'release-checklist']);
  for (const button of buttons(page)) {
    assert.equal(button.querySelector('.name')!.nextElementSibling, button.querySelector('.folder'));
  }
});

test('the description: the first sentence, all of it on hover', async () => {
  const page = await scanned('?repo=JetBrains/docs');
  const description = page.$('#list li .description')!;
  // At most 2 lines, then `…`, is the style's: the text is the whole first sentence.
  assert.equal(description.textContent, LONG);
  assert.equal(description.title, LONG);

  const fixture = await scanned();
  assert.deepEqual(
    fixture.$$('#list li .description').map((element) => element.title),
    [
      "Follow the project's code style.",
      'Write commit messages in the Conventional Commits style.',
      'Write commit messages the way this repository does.',
      'Write commit messages the way this repository does.',
      '',
    ],
  );
});

test('copies: also in, then a chip for each, its folder; its full path on hover', async () => {
  const page = await scanned();
  const copies = page.$$('#list li .copies');
  assert.equal(copies.length, 1);
  assert.equal(copies[0].closest('button')!.dataset.path, '.claude/skills/code-style/SKILL.md');
  const chips = [...copies[0].querySelectorAll<HTMLElement>('.chip')];
  assert.deepEqual(chips.map((chip) => chip.textContent), ['.github/skills']);
  assert.deepEqual(chips.map((chip) => chip.title), ['.github/skills/code-style/SKILL.md']);
});

test('↓ and ↑ on a skill: the next and the previous one selected and focused, the page URL replaced', async () => {
  const page = await scanned();
  page.pick(0);
  const entries = page.window.history.length;
  assert.equal(page.param('skill'), '.claude/skills/code-style/SKILL.md');
  buttons(page)[0].focus();

  press(page, 'ArrowDown');
  assert.equal(page.document.activeElement, buttons(page)[1]);
  assert.deepEqual(current(page), [null, 'true', null, null, null]);
  assert.equal(page.param('skill'), '.agents/skills/commits/SKILL.md');
  assert.equal(page.$('#skill .description')!.textContent, 'Write commit messages in the Conventional Commits style.');

  press(page, 'ArrowDown');
  press(page, 'ArrowDown');
  assert.equal(page.param('skill'), 'plugins/editor/.claude/skills/commits/SKILL.md');
  press(page, 'ArrowUp');
  assert.equal(page.document.activeElement, buttons(page)[2]);
  assert.deepEqual(current(page), [null, null, 'true', null, null]);
  assert.equal(page.param('skill'), '.claude/skills/commits/SKILL.md');
  assert.equal(page.$('#skill h1')!.textContent, 'commits');
  // No new history entry for each one.
  assert.equal(page.window.history.length, entries);
});

test('↓ on the last skill → nothing; ↑ on the first → the filter; ↓ in the filter → the first skill', async () => {
  const page = await scanned();
  const last = buttons(page).at(-1)!;
  last.focus();
  press(page, 'ArrowDown');
  assert.equal(page.document.activeElement, last);
  assert.equal(page.param('skill'), null, 'nothing selected');

  buttons(page)[0].focus();
  press(page, 'ArrowUp');
  assert.equal(page.document.activeElement, page.$('#filter'));

  press(page, 'ArrowDown');
  assert.equal(page.document.activeElement, buttons(page)[0]);
  assert.deepEqual(current(page), ['true', null, null, null, null]);
  assert.equal(page.param('skill'), '.claude/skills/code-style/SKILL.md');
});

test('the keyboard goes through the matching skills only', async () => {
  const page = await scanned();
  page.filter('commit');
  (page.$('#filter') as HTMLInputElement).focus();
  press(page, 'ArrowDown');
  press(page, 'ArrowDown');
  assert.equal(page.param('skill'), '.claude/skills/commits/SKILL.md');
  assert.deepEqual(current(page), [null, 'true', null]);
  // The filter is kept.
  assert.equal((page.$('#filter') as HTMLInputElement).value, 'commit');
});

test('other keys do nothing', async () => {
  const page = await scanned();
  buttons(page)[1].focus();
  press(page, 'ArrowRight');
  press(page, 'a');
  assert.equal(page.document.activeElement, buttons(page)[1]);
  assert.equal(page.param('skill'), null);
});

test('several copies: a chip for each; the text separated by `, `, not shown', async () => {
  const page = await scanned('?repo=JetBrains/copies');
  assert.deepEqual(page.names(), ['style']);
  const copies = page.$('#list li .copies')!;
  assert.deepEqual([...copies.querySelectorAll('.chip')].map((chip) => chip.textContent), ['.claude/skills', '.github/skills']);
  assert.deepEqual([...copies.querySelectorAll('.separator')].map((separator) => separator.textContent), [', ']);
  assert.equal(copies.textContent, 'also in .claude/skills, .github/skills');
});
