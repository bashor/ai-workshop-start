// The search page: a repository's skills on the left, the selected one's SKILL.md on the right.
// A thin client over the core, like the CLI. The page URL holds what is shown, so it can be shared.
import { AtlasError } from '../core/errors.ts';
import { openGitHub, parseRepository, type Fetch } from '../core/github.ts';
import { firstSentence, skillLink, type Skill } from '../core/model.ts';
import { scan, type ScanResult } from '../core/scan.ts';
import { renderMarkdown } from './markdown.ts';

export type AppOptions = {
  /** Live GitHub, without a token. */
  fetch: Fetch;
};

/** What the page URL says: `?repo=owner/repo&skill=<path>`. */
type State = { repo?: string; skill?: string };

/** Runs the page in `window`: web/index.html's elements, and its URL. */
export function mountApp(window: Window, { fetch }: AppOptions) {
  const { document, history } = window;
  const find = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const input = find<HTMLInputElement>('#repo');
  const skills = find('#skills');
  const status = find('#status');
  const results = find('#results');
  const panel = find('#skill');

  /** The repository on the left, with its result once scanned. */
  let shown: { repo: string; result?: ScanResult } | undefined;
  /** The skill to select, once the repository is scanned. */
  let wanted: string | undefined;
  /** Counts scans: only the latest one is shown. */
  let scans = 0;

  find('#search').addEventListener('submit', (event) => {
    event.preventDefault();
    const repo = repository(input.value);
    if (!repo) return;
    history.pushState(null, '', query({ repo }));
    show({ repo }, { rescan: true });
  });
  window.addEventListener('popstate', () => show(read(), { rescan: false }));
  show(read(), { rescan: false });

  function read(): State {
    const params = new URL(window.location.href).searchParams;
    return { repo: params.get('repo') ?? undefined, skill: params.get('skill') ?? undefined };
  }

  function query({ repo, skill }: State): string {
    const encode = (value: string) => encodeURIComponent(value).replace(/%2F/g, '/');
    const parts = [repo && `repo=${encode(repo)}`, skill && `skill=${encode(skill)}`].filter(Boolean);
    return parts.length > 0 ? `?${parts.join('&')}` : window.location.pathname;
  }

  /** `owner/repo`, or undefined, with a message, when the text is not a repository. */
  function repository(text: string): string | undefined {
    const name = parseRepository(text);
    if (name) return `${name.owner}/${name.repo}`;
    status.textContent = `Not a GitHub repository: ${text.trim()}. Type owner/repo or a GitHub URL.`;
    return undefined;
  }

  function show(state: State, { rescan }: { rescan: boolean }) {
    wanted = state.skill;
    input.value = state.repo ?? '';
    if (!state.repo) {
      scans++;
      shown = undefined;
      status.textContent = '';
      results.replaceChildren();
      showSkill(undefined);
    } else if (rescan || shown?.repo !== state.repo) {
      const repo = repository(state.repo);
      if (repo) void load(repo);
    } else if (shown.result) {
      select(wanted);
    }
  }

  async function load(repo: string) {
    const scanning = ++scans;
    shown = { repo };
    status.textContent = `Scanning ${repo}…`;
    skills.setAttribute('aria-busy', 'true');
    results.replaceChildren();
    showSkill(undefined);
    try {
      const result = await scan(await openGitHub(repo, { fetch, suggestToken: false }));
      if (scanning !== scans) return;
      shown.result = result;
      status.textContent = '';
      showResult(result);
      select(wanted);
    } catch (error) {
      if (scanning !== scans) return;
      status.textContent =
        error instanceof AtlasError ? error.message : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (scanning === scans) skills.setAttribute('aria-busy', 'false');
    }
  }

  /** `owner/repo · N skills`, the warnings, then the skills as the CLI lists them. */
  function showResult({ repository, skills: found, warnings }: ScanResult) {
    const summary = element('h2', `${repository.id} · ${found.length} ${found.length === 1 ? 'skill' : 'skills'}`);
    summary.id = 'summary';
    const warningList = element('ul');
    warningList.id = 'warnings';
    warningList.append(...warnings.map((warning) => element('li', warning)));
    const list = element('ul');
    list.id = 'list';
    if (found.length === 0) list.append(element('li', 'No skills found', 'empty'));
    for (const skill of found) {
      const button = element('button');
      button.type = 'button';
      button.dataset.path = skill.path;
      button.append(element('span', skill.name, 'name'), element('span', firstSentence(skill.description), 'description'));
      if (skill.copies.length > 0) button.append(element('span', `also in ${skill.copies.join(', ')}`, 'copies'));
      button.addEventListener('click', () => {
        wanted = skill.path;
        history.pushState(null, '', query({ repo: shown?.repo, skill: skill.path }));
        select(skill.path);
      });
      const item = element('li');
      item.append(button);
      list.append(item);
    }
    results.replaceChildren(summary, warningList, list);
  }

  /** The skill at `path`, or the one `path` is a copy of. */
  function select(path: string | undefined) {
    const found = shown?.result?.skills ?? [];
    const skill = path === undefined ? undefined : found.find((skill) => skill.path === path || skill.copies.includes(path));
    for (const button of results.querySelectorAll<HTMLButtonElement>('#list button')) {
      if (button.dataset.path === skill?.path) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    showSkill(skill);
  }

  /** Its name and description, the link to the file, then its body as Markdown; or a hint. */
  function showSkill(skill: Skill | undefined) {
    const repository = shown?.result?.repository;
    if (!skill || !repository) {
      panel.replaceChildren(element('p', 'Pick a skill on the left to read its SKILL.md.', 'hint'));
      return;
    }
    const source = element('a', skill.path, 'source');
    source.href = skillLink(repository, skill);
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    const header = element('header');
    header.append(element('h1', skill.name), element('p', skill.description, 'description'), source);
    const body = element('div', undefined, 'markdown');
    // Safe: renderMarkdown shows raw HTML as text.
    body.innerHTML = renderMarkdown(repository, skill);
    panel.replaceChildren(header, body);
  }

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
    const created = document.createElement(tag);
    if (text !== undefined) created.textContent = text;
    if (className) created.className = className;
    return created;
  }
}
