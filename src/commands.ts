// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { firstSentence, formatDate, skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan; `token`, from --token, for GitHub. */
  open(input: string, options?: { token?: string }): Promise<Source>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
};

const usage = `Usage: skill-atlas <command>

  scan [--token <token>] <GitHub URL | directory>
                 find every SKILL.md in a repository and print it;
                 --token: the GitHub token, instead of GITHUB_TOKEN
  help           show this help`;

const scanUsage = 'Usage: skill-atlas scan [--token <token>] <GitHub URL | directory>';

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
    else if (command === 'help') context.print(usage);
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(error.message);
    return 1;
  }
}

async function scanCommand(args: string[], context: Context) {
  const { inputs, token } = scanArguments(args);
  if (inputs.length !== 1) throw new AtlasError(scanUsage);
  const result = await scan(await context.open(inputs[0], { token }));
  printRepository(result.repository, result.skills, context);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
}

/** `--token <token>` or `--token=<token>`, once, anywhere; the rest are inputs. */
function scanArguments(args: string[]): { inputs: string[]; token?: string } {
  const inputs: string[] = [];
  let token: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let value: string | undefined;
    if (arg === '--token') value = args[++i];
    else if (arg.startsWith('--token=')) value = arg.slice('--token='.length);
    else {
      inputs.push(arg);
      continue;
    }
    if (!value || token !== undefined) throw new AtlasError(scanUsage);
    token = value;
  }
  return { inputs, token };
}

/** `<owner>/<repo> · N skills`, then each skill's name, first sentence, link and last update. */
function printRepository(repository: Repository, skills: Skill[], { print }: Context) {
  print(`${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.updated) print(`  updated ${formatDate(skill.updated)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}
