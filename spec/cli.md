# Command line
`./skill-atlas scan [--token <token>] <GitHub URL | directory>`
Prints the result **at once**; *nothing is stored*.
`GITHUB_TOKEN`, optional: a higher GitHub rate limit.
## Token
`--token <token>` or `--token=<token>`, optional: the token for the **GitHub API requests**, as `GITHUB_TOKEN`
- Before or after the URL; given, it is used *instead of* `GITHUB_TOKEN`
- Not given → `GITHUB_TOKEN`, if set; neither → no token
- No value, an empty one, or given twice → the usage, exit code 1, *no request*
- GitHub rejects it → `GitHub rejected the token given with --token`, exit code 1
- A directory: no request, the token unused
## Output
```
JetBrains/kotlin · 6 skills
build-tools-bump-gradle-api — Bumps the Gradle API…
  https://github.com/JetBrains/kotlin/blob/<commit>/…
```
- Sorted by **name**; the description's *first sentence*
- `also in <paths>` for copies; warnings go to *stderr*
