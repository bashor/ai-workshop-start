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
};

export type ScanResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/** fetch → find → parse. Nothing is stored: the result is all there is. */
export async function scan(source: Source): Promise<ScanResult> {
  const files = findSkills(source.paths);
  // The files are read at the same time: on GitHub, each one is a request.
  const results = await Promise.all(files.map((file) => readSkill(source, file)));
  return {
    repository: source.repository,
    skills: sortSkills(mergeCopies(results.flatMap((result) => (result.skill ? [result.skill] : [])))),
    warnings: [...source.warnings, ...results.flatMap((result) => (result.warning ? [result.warning] : []))],
  };
}

type Read = { skill?: Skill & { body: string }; warning?: string };

/**
 * One skill for several agents: the same directory name in the roots of the same module, with
 * the same name, description and body. Listed once, at its first path, the others its copies.
 */
function mergeCopies(skills: (Skill & { body: string })[]): Skill[] {
  const merged = new Map<string, Skill>();
  for (const { body, ...skill } of skills) {
    const key = JSON.stringify([moduleOf(skill.path), skill.path.split('/').at(-2), skill.name, skill.description, body]);
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
