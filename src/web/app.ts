// The search page: a repository's skills on the left, the selected one's SKILL.md on the right;
// or an organization's repositories on the left, each with the number of its skills.
// A thin client over the core, like the CLI. The page URL holds what is shown, so it can be shared.
import { AtlasError } from '../core/errors.ts';
import { openGitHub, parseOrganization, parseRepository, type Fetch } from '../core/github.ts';
import { firstSentence, skillLink, type Skill } from '../core/model.ts';
import { scanOrganization, type OrganizationResult } from '../core/organization.ts';
import { scan, type ScanResult } from '../core/scan.ts';
import { renderMarkdown } from './markdown.ts';

export type AppOptions = {
  /** Live GitHub; with the token field's token, if any. */
  fetch: Fetch;
};

/** What the page URL says: `?repo=owner/repo&skill=<path>`, or `?org=owner`. */
type State = { repo?: string; org?: string; skill?: string };

/** Runs the page in `window`: web/index.html's elements, and its URL. */
export function mountApp(window: Window, { fetch }: AppOptions) {
  const { document, history } = window;
  const find = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
  const input = find<HTMLInputElement>('#repo');
  const tokenField = find<HTMLInputElement>('#token');
  const skills = find('#skills');
  const status = find('#status');
  const results = find('#results');
  const panel = find('#skill');

  /** The repository or the organization on the left, with its result once scanned. */
  let shown: { repo: string; result?: ScanResult } | { org: string; result?: OrganizationResult } | undefined;
  /** The latest organization scanned: back to it, or to one of its repositories, scans nothing. */
  let organization: OrganizationResult | undefined;
  /** The skill to select, once the repository is scanned. */
  let wanted: string | undefined;
  /** The selected skill's path: marked in the list again when the filter changes. */
  let selected: string | undefined;
  /** Counts scans: only the latest one is shown. */
  let scans = 0;
  /** Stops the running organization scan from starting other repositories. */
  let running: AbortController | undefined;

  find('#search').addEventListener('submit', (event) => {
    event.preventDefault();
    const target = parse(input.value);
    if (!target) return;
    history.pushState(null, '', query(target));
    show(target, { rescan: true });
  });
  window.addEventListener('popstate', () => show(read(), { rescan: false }));
  show(read(), { rescan: false });

  function read(): State {
    const params = new URL(window.location.href).searchParams;
    const repo = params.get('repo') ?? undefined;
    return { repo, org: repo ? undefined : (params.get('org') ?? undefined), skill: params.get('skill') ?? undefined };
  }

  function query({ repo, org, skill }: State): string {
    const encode = (value: string) => encodeURIComponent(value).replace(/%2F/g, '/');
    const parts = [repo && `repo=${encode(repo)}`, org && `org=${encode(org)}`, skill && `skill=${encode(skill)}`].filter(Boolean);
    return parts.length > 0 ? `?${parts.join('&')}` : window.location.pathname;
  }

  /** `owner/repo`, or `owner` for an organization; undefined, with a message, when the text is neither. */
  function parse(text: string, only?: 'repo' | 'org'): State | undefined {
    // The organization first: `github.com/owner` would pass for `owner/repo`.
    const org = only === 'repo' ? undefined : parseOrganization(text);
    if (org) return { org: org.owner };
    const name = only === 'org' ? undefined : parseRepository(text);
    if (name) return { repo: `${name.owner}/${name.repo}` };
    status.textContent = `Not a GitHub repository or organization: ${text.trim()}. Type owner/repo, owner or a GitHub URL.`;
    return undefined;
  }

  /** The token field's token, read at each scan; never in the page URL, never stored. */
  function github() {
    const token = tokenField.value.trim() || undefined;
    return { fetch, token, tokenSource: 'the token in the token field', suggestToken: false };
  }

  function show(state: State, { rescan }: { rescan: boolean }) {
    wanted = state.skill;
    input.value = state.repo ?? state.org ?? '';
    if (state.repo) {
      if (rescan || !shown || !('repo' in shown) || shown.repo !== state.repo) {
        const repo = parse(state.repo, 'repo')?.repo;
        const scanned = organization?.repositories.find((repository) => repository.id === repo)?.result;
        if (repo && scanned && !rescan) {
          begin();
          showRepository(repo, scanned);
        } else if (repo) void load(repo);
      } else if (shown.result) {
        select(wanted);
      }
    } else if (state.org) {
      if (rescan || !shown || !('org' in shown) || shown.org !== state.org) {
        const org = parse(state.org, 'org')?.org;
        if (org && organization?.organization === org && !rescan) {
          begin();
          showOrganization(organization);
        } else if (org) void loadOrganization(org);
      }
    } else {
      begin();
      shown = undefined;
      status.textContent = '';
      results.replaceChildren();
      showSkill(undefined);
    }
  }

  /** A new scan, or a scan reused: the running one is not shown, and starts nothing more. */
  function begin(): number {
    running?.abort();
    running = undefined;
    skills.setAttribute('aria-busy', 'false');
    return ++scans;
  }

  async function load(repo: string) {
    await scanning(repo, { repo }, async () => {
      const result = await scan(await openGitHub(repo, github()));
      return () => showRepository(repo, result);
    });
  }

  async function loadOrganization(org: string) {
    const controller = new AbortController();
    await scanning(org, { org }, async (current) => {
      running = controller;
      try {
        const result = await scanOrganization(org, {
          ...github(),
          signal: controller.signal,
          progress: (done, total) => {
            if (current()) status.textContent = `Scanning ${org}… ${done} of ${total} ${total === 1 ? 'repository' : 'repositories'}`;
          },
        });
        return () => showOrganization(result);
      } finally {
        // After an unexpected error, the other repositories would go on.
        controller.abort();
      }
    });
  }

  /** Shows the progress while `work` runs, then what it gives, or its message; unless another scan began. */
  async function scanning(name: string, state: NonNullable<typeof shown>, work: (current: () => boolean) => Promise<() => void>) {
    const id = begin();
    const current = () => id === scans;
    shown = state;
    status.textContent = `Scanning ${name}…`;
    skills.setAttribute('aria-busy', 'true');
    results.replaceChildren();
    showSkill(undefined, 'org' in state ? 'repository' : 'skill');
    try {
      const done = await work(current);
      if (current()) done();
    } catch (error) {
      if (!current()) return;
      status.textContent =
        error instanceof AtlasError ? error.message : `Unexpected error: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (current()) {
        running = undefined;
        skills.setAttribute('aria-busy', 'false');
      }
    }
  }

  function showRepository(repo: string, result: ScanResult) {
    shown = { repo, result };
    status.textContent = '';
    showResult(result);
    select(wanted);
  }

  /** `owner · N repositories`, the warnings, then each repository with the number of its skills. */
  function showOrganization(result: OrganizationResult) {
    organization = result;
    shown = { org: result.organization, result };
    status.textContent = '';
    const count = result.repositories.length;
    const summary = element('h2', `${result.organization} · ${count} ${count === 1 ? 'repository' : 'repositories'}`);
    summary.id = 'summary';
    const warningList = element('ul');
    warningList.id = 'warnings';
    warningList.append(...result.warnings.map((warning) => element('li', warning)));
    const list = element('ul');
    list.id = 'list';
    if (count === 0) list.append(element('li', 'No repositories found', 'empty'));
    for (const repository of result.repositories) {
      const button = element('button');
      button.type = 'button';
      button.dataset.repo = repository.id;
      button.append(element('span', repository.name, 'name'));
      if (repository.result) {
        const found = repository.result.skills.length;
        const badge = element('span', String(found), 'badge');
        badge.title = `${found} ${found === 1 ? 'skill' : 'skills'}`;
        button.append(badge);
      } else {
        button.append(element('span', repository.error, 'error'));
      }
      button.addEventListener('click', () => {
        history.pushState(null, '', query({ repo: repository.id }));
        show({ repo: repository.id }, { rescan: false });
      });
      const item = element('li');
      item.append(button);
      list.append(item);
    }
    results.replaceChildren(summary, warningList, list);
    showSkill(undefined, 'repository');
  }

  /** `owner/repo · N skills`, the warnings, the filter, then the skills as the CLI lists them. */
  function showResult({ repository, skills: found, warnings }: ScanResult) {
    const summary = element('h2', `${repository.id} · ${found.length} ${found.length === 1 ? 'skill' : 'skills'}`);
    summary.id = 'summary';
    const warningList = element('ul');
    warningList.id = 'warnings';
    warningList.append(...warnings.map((warning) => element('li', warning)));
    const list = element('ul');
    list.id = 'list';
    if (found.length === 0) {
      list.append(element('li', 'No skills found', 'empty'));
      results.replaceChildren(summary, warningList, list);
      return;
    }
    const filter = element('input');
    filter.id = 'filter';
    filter.type = 'search';
    filter.placeholder = 'Filter skills';
    filter.setAttribute('aria-label', 'Filter skills');
    filter.setAttribute('aria-controls', 'list');
    filter.autocomplete = 'off';
    filter.spellcheck = false;
    const count = element('span');
    count.id = 'count';
    count.setAttribute('aria-live', 'polite');
    const bar = element('div', undefined, 'filter');
    bar.append(filter, count);

    /** The skills whose name or shown description contain the filter's text, ignoring case; the matches highlighted. */
    const showMatching = () => {
      const text = filter.value.trim().toLowerCase();
      const items: HTMLLIElement[] = [];
      for (const skill of found) {
        const description = firstSentence(skill.description);
        if (text && !skill.name.toLowerCase().includes(text) && !description.toLowerCase().includes(text)) continue;
        const button = element('button');
        button.type = 'button';
        button.dataset.path = skill.path;
        if (skill.path === selected) button.setAttribute('aria-current', 'true');
        button.append(highlighted(skill.name, text, 'name'), highlighted(description, text, 'description'));
        if (skill.copies.length > 0) button.append(element('span', `also in ${skill.copies.join(', ')}`, 'copies'));
        button.addEventListener('click', () => {
          wanted = skill.path;
          history.pushState(null, '', query({ repo: shown && 'repo' in shown ? shown.repo : undefined, skill: skill.path }));
          select(skill.path);
        });
        const item = element('li');
        item.append(button);
        items.push(item);
      }
      count.textContent = `${items.length} of ${found.length}`;
      if (items.length === 0) items.push(element('li', 'No matching skills', 'empty'));
      list.replaceChildren(...items);
    };
    filter.addEventListener('input', showMatching);
    showMatching();
    results.replaceChildren(summary, warningList, bar, list);
  }

  /** `text` in a span, every occurrence of `match` (lowercase) in a mark. */
  function highlighted(text: string, match: string, className: string) {
    const span = element('span', undefined, className);
    const lower = text.toLowerCase();
    let start = 0;
    // A few letters change length in lowercase: the positions would not fit the text, so no marks.
    for (let at = match && lower.length === text.length ? lower.indexOf(match) : -1; at >= 0; at = lower.indexOf(match, start)) {
      span.append(text.slice(start, at), element('mark', text.slice(at, at + match.length)));
      start = at + match.length;
    }
    span.append(text.slice(start));
    return span;
  }

  /** The skill at `path`, or the one `path` is a copy of. */
  function select(path: string | undefined) {
    const found = shown && 'repo' in shown ? (shown.result?.skills ?? []) : [];
    const skill = path === undefined ? undefined : found.find((skill) => skill.path === path || skill.copies.includes(path));
    selected = skill?.path;
    for (const button of results.querySelectorAll<HTMLButtonElement>('#list button')) {
      if (button.dataset.path === skill?.path) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    showSkill(skill);
  }

  /** Its name and description, the link to the file, then its body as Markdown; or a hint to pick one. */
  function showSkill(skill: Skill | undefined, pick: 'skill' | 'repository' = 'skill') {
    const repository = shown && 'repo' in shown ? shown.result?.repository : undefined;
    if (!skill || !repository) {
      const hint = pick === 'skill' ? 'Pick a skill on the left to read its SKILL.md.' : 'Pick a repository on the left to see its skills.';
      panel.replaceChildren(element('p', hint, 'hint'));
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
