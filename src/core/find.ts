/** A skill found in a repository: its SKILL.md, its name and its copies. */
export type SkillFile = { path: string; name: string; copies: string[] };

/** Where agents keep a repository's own skills. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills'];

/** Directories of what a repository ships or tests, not what its agents use. */
const NOT_USED = new Set([
  'test', 'tests', 'testData', 'fixture', 'fixtures', 'examples', 'samples', 'templates',
  'dist', 'build', 'out', 'node_modules', 'vendor',
]);

/**
 * The real skills: `<root>/<name>/SKILL.md` in an agent's root, at the top or in a module,
 * and not under a directory of shipped or tested files. The paths are regular files only:
 * a symbolic link is never listed. Copies are told apart later, once the files are read.
 */
export function findSkills(paths: string[]): SkillFile[] {
  return paths
    .filter(isRealSkill)
    .sort()
    .map((path) => ({ path, name: path.split('/').at(-2)!, copies: [] }));
}

/** The directory the skill's root is in: '' at the top, or the module's path. */
export function moduleOf(path: string): string {
  return path.split('/').slice(0, -4).join('/');
}

function isRealSkill(path: string): boolean {
  const segments = path.split('/');
  if (segments.length < 4 || segments.at(-1) !== 'SKILL.md') return false;
  if (!SKILL_ROOTS.includes(segments.slice(-4, -2).join('/'))) return false;
  // The skill's own directory may be called `build`; the module it is in may not.
  return segments.slice(0, -4).every((segment) => !NOT_USED.has(segment));
}
