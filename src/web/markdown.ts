// A SKILL.md body as HTML. The file is untrusted: raw HTML is shown as text, and markdown-it
// leaves out javascript: and other unsafe links.
import MarkdownIt from 'markdown-it';
import type { Repository, Skill } from '../core/model.ts';

const markdown = new MarkdownIt({ html: false, linkify: true });

/** The body, its relative links and images resolved from the skill's directory, at the scanned commit. */
export function renderMarkdown(repository: Repository, skill: Skill): string {
  const directory = skill.path.split('/').slice(0, -1).join('/');
  const blob = `${repository.url}/blob/${skill.commit}`;
  const raw = `https://raw.githubusercontent.com/${repository.id}/${skill.commit}`;
  const tokens = markdown.parse(skill.body, {});
  for (const token of tokens.flatMap((token) => [token, ...(token.children ?? [])])) {
    if (token.type === 'link_open') {
      const href = token.attrGet('href')?.toString();
      if (href) token.attrSet('href', resolve(href, blob, directory));
      if (!href?.startsWith('#')) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
      }
    } else if (token.type === 'image') {
      const src = token.attrGet('src')?.toString();
      if (src) token.attrSet('src', resolve(src, raw, directory));
    }
  }
  return markdown.renderer.render(tokens, markdown.options, {});
}

/** An absolute URL or an anchor as it is; a path from the directory, or from the root with a leading `/`. */
function resolve(target: string, root: string, directory: string): string {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(target)) return target;
  // A path in the repository: `..` never leaves it.
  const url = new URL(target, `https://repository.invalid/${target.startsWith('/') || !directory ? '' : `${directory}/`}`);
  return `${root}${url.pathname}${url.search}${url.hash}`;
}
