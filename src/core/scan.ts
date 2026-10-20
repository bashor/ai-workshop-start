import { AtlasError } from './errors.ts';
import { findSkills, moduleOf, type SkillFile } from './find.ts';
import { sortSkills, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';

/** A repository to scan: its files, and how to read them. */
export type Source = {
  repository: Repository;
  /** Every file path, relative to the repository root. */
  paths: string[];
  /** What listing the files had to leave out. */
  warnings: string[];
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
  /** When the directory last changed, up to the scanned commit, as an ISO date; undefined if never. */
  updated(directory: string): Promise<string | undefined>;
};

export type ScanResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/** fetch → find → parse. Nothing is stored: the result is all there is. */
export async function scan(source: Source): Promise<ScanResult> {
  const files = findSkills(source.paths);
  // The files are read at the same time: on GitHub, each one is a request.
  const results = await Promise.all(files.map((file) => readSkill(source, file)));
  const skills = sortSkills(mergeCopies(results.flatMap((result) => (result.skill ? [result.skill] : []))));
  return {
    repository: source.repository,
    skills,
    warnings: [
      ...source.warnings,
      ...results.flatMap((result) => (result.warning ? [result.warning] : [])),
      ...(await addDates(source, skills)),
    ],
  };
}

/**
 * Each skill's last update, at the same time; once the copies are merged, so a copy costs no request.
 * A date that cannot be had is not fatal: the skill goes without it, with one warning per reason.
 */
async function addDates(source: Source, skills: Skill[]): Promise<string[]> {
  const failures = await Promise.all(skills.map(async (skill) => {
    try {
      const updated = await source.updated(skill.path.split('/').slice(0, -1).join('/'));
      const date = updated === undefined ? undefined : new Date(updated);
      if (date && !Number.isNaN(date.getTime())) skill.updated = date.toISOString();
      return undefined;
    } catch (error) {
      if (!(error instanceof AtlasError)) throw error;
      return error.message;
    }
  }));
  // In the order of the skills, not of the answers.
  const counts = new Map<string, number>();
  for (const message of failures) if (message !== undefined) counts.set(message, (counts.get(message) ?? 0) + 1);
  return [...counts].map(([message, count]) => `last updated not known for ${count} ${count === 1 ? 'skill' : 'skills'}: ${message}`);
}

type Read = { skill?: Skill; warning?: string };

/**
 * One skill for several agents: the same directory name in the roots of the same module, with
 * the same name, description and body. Listed once, at its first path, the others its copies.
 */
function mergeCopies(skills: Skill[]): Skill[] {
  const merged = new Map<string, Skill>();
  for (const skill of skills) {
    const key = JSON.stringify([moduleOf(skill.path), skill.path.split('/').at(-2), skill.name, skill.description, skill.body]);
    const first = merged.get(key);
    if (first) first.copies.push(skill.path);
    else merged.set(key, { ...skill, copies: [] });
  }
  return [...merged.values()];
}

async function readSkill(source: Source, file: SkillFile): Promise<Read> {
  const bytes = await source.read(file.path);
  if (!bytes) return { warning: `${file.path}: listed, but not found at the scanned commit; skipped` };
  const parsed = parseSkill(new TextDecoder().decode(bytes));
  const skill = {
    id: `${source.repository.id}:${file.path}`,
    repository: source.repository.id,
    path: file.path,
    name: parsed.name ?? file.name,
    description: parsed.description,
    commit: source.repository.commit,
    copies: file.copies,
    body: parsed.body,
  };
  return { skill, warning: parsed.warning && `${file.path}: ${parsed.warning}` };
}
