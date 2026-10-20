import { AtlasError, RateLimitError } from './errors.ts';
import { listRepositories, openGitHubRepository, parseOrganization, type GitHubOptions } from './github.ts';
import { scan, type ScanResult } from './scan.ts';

/** One of an organization's repositories: its scan, or why there is none. */
export type RepositoryScan = {
  /** `owner/name`. */
  id: string;
  name: string;
  url: string;
  result?: ScanResult;
  error?: string;
};

export type OrganizationResult = {
  organization: string;
  /** `https://github.com/<owner>`. */
  url: string;
  repositories: RepositoryScan[];
  warnings: string[];
};

export type OrganizationOptions = GitHubOptions & {
  /** After each repository: how many are scanned, of how many. */
  progress?(scanned: number, total: number): void;
  /** Once aborted, no other repository is started. */
  signal?: AbortSignal;
};

/** Repositories scanned at the same time: each one is a few requests. */
const AT_ONCE = 4;

/**
 * Every repository of the organization, scanned as one repository is. A repository that fails
 * does not stop the others; the rate limit does, as every request after it would fail too.
 */
export async function scanOrganization(input: string, options: OrganizationOptions): Promise<OrganizationResult> {
  const name = parseOrganization(input);
  if (!name) throw new AtlasError(`Not a GitHub organization: ${input}`);
  const listed = await listRepositories(name.owner, options);
  const repositories: RepositoryScan[] = listed.map((info) => ({
    id: info.full_name,
    name: info.name,
    url: `https://github.com/${info.full_name}`,
  }));
  let next = 0;
  let scanned = 0;
  let limited: RateLimitError | undefined;
  options.progress?.(0, listed.length);

  async function worker() {
    while (next < listed.length && !limited && !options.signal?.aborted) {
      const index = next++;
      try {
        // Through the tree: code search's limit would stop the scan after about ten repositories.
        repositories[index].result = await scan(await openGitHubRepository(listed[index], { ...options, search: false }));
      } catch (error) {
        if (error instanceof RateLimitError) limited = error;
        else if (error instanceof AtlasError) repositories[index].error = error.message;
        else throw error;
      }
      options.progress?.(++scanned, listed.length);
    }
  }
  await Promise.all(Array.from({ length: AT_ONCE }, worker));

  const notScanned = repositories.filter((repository) => !repository.result && !repository.error);
  for (const repository of notScanned) repository.error = 'not scanned';
  return {
    organization: name.owner,
    url: `https://github.com/${name.owner}`,
    repositories: sortRepositories(repositories),
    warnings: limited ? [`${limited.message}. Not scanned: ${notScanned.length} ${notScanned.length === 1 ? 'repository' : 'repositories'}`] : [],
  };
}

/** The most skills first, then by name; the failed ones last, by name. */
function sortRepositories(repositories: RepositoryScan[]): RepositoryScan[] {
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const skills = (repository: RepositoryScan) => repository.result?.skills.length ?? -1;
  return [...repositories].sort((a, b) => skills(b) - skills(a) || compare(a.name, b.name));
}
