// The Node context: a GitHub repository through the GitHub API, or a local directory. The token
// comes from --token, else from GITHUB_TOKEN.
import type { Context } from './commands.ts';
import { openGitHub, parseGitHubUrl, type Fetch } from './core/github.ts';
import { openDirectory } from './local.ts';

export type NodeOptions = {
  fetch: Fetch;
  env: Record<string, string | undefined>;
  print(text: string): void;
  error(text: string): void;
};

export function nodeContext({ fetch, env, print, error }: NodeOptions): Context {
  return {
    open(input, { token } = {}) {
      if (!parseGitHubUrl(input)) return openDirectory(input);
      if (token) return openGitHub(input, { fetch, token, tokenSource: 'the token given with --token' });
      return openGitHub(input, { fetch, token: env.GITHUB_TOKEN || undefined });
    },
    print,
    error,
  };
}
