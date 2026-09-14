# gh api graphql exits non-zero on GraphQL errors arrays

When `gh api graphql` receives HTTP 200 with an `errors` array (even alongside valid
`data`), gh prints the JSON to stdout, prints `gh: <first error message>` to stderr,
and exits 1. Code that rejects on non-zero exit and never reads stdout loses good
payloads, and `mapGhFailure` can then mislabel the failure.

Applies to any daemon code shelling out to `gh api` (paseo-github-panel and kin).

Rules learned 2026-09-09 while building the comments thread:

- Ask a GraphQL query for only the fields that can succeed. Querying both
  `issue(number:)` and `pullRequest(number:)` in one document guarantees a NOT_FOUND
  error for whichever type the number is not, breaking every call.
- On `GitHubCommandError`, salvage `error.stdout` and try parsing it before mapping
  the failure; only map when stdout holds nothing usable.
- Keep failure-regexes anchored to real gh phrases (`gh auth login`, `bad credentials`,
  `HTTP 401`, `authenticat`). A bare `auth` substring matches "author", which made a
  GraphQL NOT_FOUND failure report as "GitHub CLI is not authenticated".

Evidence: reproduced from pwsh — `gh api graphql` with an issue+pullRequest lookup
returned valid `pullRequest` data plus an `issue` NOT_FOUND error and exited 1.
Fixed in `server/github.ts` (`GRAPHQL_COMMENTS_QUERY(kind)`, stdout salvage in
`loadComments`) and `server/process.ts` (auth regex); 46/46 tests.

Verified: 2026-09-09
