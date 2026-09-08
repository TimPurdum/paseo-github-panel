# Use a function default export for Paseo server entries

For Paseo 0.8 plugin server entries, export the contribution as a default function declaration. A typed constant exported as default passed TypeScript but the daemon rejected the bundle because its default export was not recognized as a function.

Evidence: `index.server.ts` in this repository passed `tsc --noEmit` as a `PluginServerContribution` constant, but `paseo plugin install` failed with `Plugin server bundle must default export a function`. Rewriting it as `export default function contribute(server: PluginServerContext)` made `paseo plugin reload paseo-github-panel` report `running` and `Plugin ready`.

Verified: 2026-09-08
