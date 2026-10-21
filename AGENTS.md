# AGENTS.md
## Specs
Read [./spec](spec/) first. Update it with the code.
## Tests
Integration tests for every case in the spec.
## Definition of done
- All tests pass locally

## Workflow
Work on every task in following stages:
1. Update specs.
2. Update tests.
3. Make implementation.
4. Review changes, if you find problems return to previous steps.
5. Attach a demo video to the PR, when applicable.

After each stage make a commit. 

If everything is fine, push the changes to branch with some short name describing the task and create a PR.

## Commands
- `npm ci`: first, in a fresh checkout
- `npm test`: the tests
- `npm run dev`: the web page on a local server; `npm run build`: the page as static files in `dist/`

## Messaging rules on GitHub

Youch message on GitHub should follow this pattern: 
```
<sub>`ROLE` [SHORT_RUN_ID](URL_TO_AIR_RUN):</sub>

MESSAGE
```

Where
* ROLE -- ROLE of the current agent.
* SHORT_RUN_ID -- a short id (first 8 bytes of UUID) of the run in Air Automations.
* URL_TO_AIR_RUN -- a link to the run in Air Automations.
* MESSAGE -- a message to show.

Don't add any other service information to the message, like "Produced by Air Automations ..."