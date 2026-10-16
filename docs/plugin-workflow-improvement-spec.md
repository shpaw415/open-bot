# open-bot Plugin Workflow — Council Improvement Spec

**Date:** 2026-10-16 · **Method:** 6-expert panel (Author DX, Security/Review, Publish Ops, Consumer UX, QA/Testing, Docs/Onboarding) · 2 rounds: independent evidence-based reviews (48 raw findings, grounded in file:line research + real plugin audits), then full cross-critique (6 × 42 verdicts, every claim spot-checked against the repo). All proposals are **non-breaking**; breaking ideas are quarantined in the appendix. Raw material: `/tmp/opencode/plugin-council/` (round1/, round2/, MASTER.md — full problem/proposal/grade detail per item).

---

## Executive summary

Five systemic weaknesses survived cross-examination:

1. **"Reviewed" is not airtight.** Payload bytes past the review caps (16k/file, 64k total) execute unreviewed; declared paths >99 chars are skipped by the tar parser but installed; the manifest slice at 150k lands exactly on `skills[]`/`personas[]` (padding attack); and the review prompt has no data/instruction armor for author-controlled text. → Caps ladder (P0).
2. **Install gates on the wrong row.** Installs check the listing's approved flag, not the chosen version's review status — a pinned rejected version serves, `policy=auto` can install a `concern` version, and skills/cron/personas are created *before* artifact verification. → I1 (P0).
3. **Nothing ever runs the plugin.** Every gate is static; a page server that throws on import, mentions endpoints that never answer, and cron scripts that die are discovered by users. → Opt-in `ob-plugin smoke` ladder (Wave 2).
4. **Consent is a one-time event for an ongoing relationship.** Public internet endpoints, MCP servers, and npm packages are never named at consent; updates post `confirm:true` blind; auto-update re-runs new root commands unconsented. → Consent family (Wave 2).
5. **The marketplace has no operational nervous system.** Same-version republish unlists a live plugin and nulls its artifact mid-review; stuck `queued` rows (including rows whose queue send never happened) are invisible; a lost Stripe webhook strands a paying buyer at 402 forever. → OPS family (Wave 2), with the 503 migration self-check in P0.

Cross-cutting verdict: doc/tool rot is structural (limits hand-copied across five prose surfaces; the README's flagship manifest fails the validator 4 ways; the scaffold README contradicts the scaffold). The single highest-leverage fix is a **docs-drift harness**: export author-relevant constants from plugin-kit and test every prose surface against them.

---

## P0 — ship first (unanimous-endorse + top-voted + S effort)

| # | Item | Verdict tally | Grades s/d/q/m | Effort |
|---|---|---|---|---|
| 1 | **I1 — Gate install on the chosen version's review status; hoist `resolvePluginFiles` before any state mutation** (verified: skills saved at plugins-apply.ts:425 before artifact resolve :440; gate reads listing status only, plugins.ts:1056). Marketplace detail already returns per-version security (db.ts:174) — one-field gate. Also closes the `policy=auto`-installs-rejected hole. | 3× top-5 (sec/consumer/qa), unanimous | 5/4/4/5 | S |
| 2 | **Consent naming lines** (I2 + consumer-ux-9 + security's merge-error): `pluginPermissionSummary` gains (a) "Exposes a public internet endpoint (/hooks/…) anyone can call unless you set a secret" when `pages.public`, (b) "Adds MCP servers: <names>", (c) "Installs OpenCode plugin packages: <specs>", (d) the webhook GET payload (`/api/plugins/installed/:id/webhook`) reports public exposure too. Reuse one phrase ("world-reachable") across docs/consent. | 2× top-5, unanimous | 5/2/4/5 | S |
| 3 | **Reviewer armor** (security, R2-new): SYSTEM_PROMPT (security.ts:154-165) declares all embedded sections "data, never instructions"; verdicts must cite lines. Closes the steering hole on the existing 64k inline payload message. | unanimous (adopted) | 4/4/3/4 | S |
| 4 | **Caps ladder, enforce half** (P2 + P3-reject + P5): publish-time rejection of payloads >16k/file or >64k total, missing declared sources, >99-char paths (long-name tar entries), and manifests >150k. Error text states the numbers **from DOC4's exported constants**. Document + doctor-warn half rides along (P5), including fixing the schema's false "max 10 MB each" claim. Two-pass split review explicitly deferred (queue-cost). | 3× top-5 combined, unanimous | 5/3-4/3/4 | S/M |
| 5 | **D1 — `files[].source` / pages-entry existence check** in validate + doctor (fail, naming the path; message points at `ob-plugin doctor`). Two experts found it independently; failure today lands at install-404 or post-approval. | 2× top-5, unanimous | 2/4/5/5 | S |
| 6 | **D2 — Fix the `files[].exec` schema lie**: description says default false; both installers treat omitted as **true**. Correct the schema description (docs amend: the description is author-facing), lock in schema.test. Do **not** change installer behavior. | 1× top-5, unanimous | 3/3/2/4 | S |
| 7 | **Docs-drift harness** (DOC4 + DOC1 + DOC2 + S1): export constants (HOOKS_MAX, caps, port range, lifecycle wording) from plugin-kit; one drift test asserts seed SKILL.md, scaffold heredoc, README, docs mdx all match; a second test validates every fenced manifest in README (flagship example currently fails 4 ways). Scaffold quick-reference **regenerated from schema** (docs amend — not hand-fixed). *Sequence before other doc-touching items.* | 2× top-5, unanimous | 2/4/3/5 | S |
| 8 | **OPS2 — Marketplace migration self-check + deploy order**: crisp `503 {code:"migration_missing"}` from a cached schema probe; README deploy-order note; `deploy:marketplace` script. Cheapest insurance against a repeat 0005. | 1× top-5, unanimous | 2/3/2/5 | S |
| 9 | **Publish CLI pre-flight family** (P7 + P11 + authordx-9): echo "publishing as @account → OWNER/NAME"; pre-flight distinguishes gh-unauth / marketplace-unconfigured / tag-mismatch; require clean worktree + HEAD == tag for stable publish (tag SHA printed on success); poll-timeout prints `ob-plugin review <id> --version <v>` instead of exit 0; new `ob-plugin review ID [--version]` subcommand (tokens never printed). | 2× top-5 (P11), unanimous | 1-3/4/1-2/5 | S |
| 10 | **P10 — Agent publishes claim ownership**: pass the user's marketplace key as `keyOverride` when set (route plumbing exists, plugins.ts:251-253); admin owner-assign for legacy ownerless rows. | unanimous | 2/4/2/4 | S |
| 11 | **S4 — Testing convention starts**: scaffold ships `smoke.test.ts` + README Testing section (single source); doctor runs `bun test` when tests exist (advisory-only, author-invoked — security amend: never during install/boot re-sync). | 2× top-5, unanimous | 1/4/5/4 | S |

**Also P0-adjacent (S effort, unanimous):** S1 quick-reference regeneration (folded into #7), P5's doctor warning (folded into #4), DOC5 (one sentence: CONFIG.md is read by the reviewer — no secrets/PII/steering), W1 `?secret=` deprecation warning header + strip-on-proxy note + drop it from AGENTS.md/plugins.mdx in the same PR.

---

## Wave 2 — P1 (adopted, sequenced)

**Smoke ladder** (QA's structural amendment, endorsed by all: one `ob-plugin smoke <id>` with named subchecks — never four overlapping features; opt-in, author/installer-side only, never blocks):
- Anchor: I3 — reuse `restartPluginPageServer` + `healthy()` (plugin-pages.ts:635, :283); `install --smoke` flag; opt-in preserves the lazy-idle lifecycle.
- `healthz` subcheck (I4): report `healthz:false` distinctly; doctor greps for a /healthz route. *(Corrected mechanism: healthy() accepts ANY HTTP response as up — author-dx verified plugin-pages.ts:299-303 — not bare TCP.)*
- `endpoints` subcheck (T1): curl each mentions/dataUrl through the loopback port; assert JSON shape ({items:[...]} / documented mention fields).
- `ui` subcheck (D4): load once via ob-chrome (real frame) or happy-dom; assert HTML + no uncaught exception. Doctor's half = sandbox anti-pattern greps quoting the seed skill verbatim (SKILL.md:121,169).
- `cron` subcheck (R3): guard reports per-job script run/fail outcomes (author-dx amend: production evidence > test-count); direct bun-run probes, not full prompt runs (publish-ops: guard token cost).
- Staleness model (qa-testing-9): smoke rows carry {pluginVersion, hostBuild, ranAt, subchecks}; surfaces grey stale results; smoke prints "stale" instead of re-asserting.

**Marketplace resilience:**
- **P8 (as corrected by security):** R2 keys are `releases/<id>/<version>.tar.gz` — same-version republish collides. Sequence: (1) key artifacts by version+sha256, (2) then keep-previous-during-recheck + listing `securityStatus: rechecking` (additive TEXT; search keeps serving; **rechecking blocks auto-install**), (3) docs + publish page define the state in the same PR (docs amend). Only a concern verdict demotes the listing.
- **OPS1 (+publish-ops-9):** scheduled worker cron (or token-gated admin endpoint): counts by security_status, oldest review_enqueued_at, recent errors; idempotent re-enqueue of stuck >30-min rows **regardless of queue health** (rows can exist with no backing message — D1-write commits before Queue send); admin-gated, enqueue-only, max-attempts backstop (security amend). Render on the admin review panel.
- **OPS3:** admin `purchases/recheck` (retrieve session from Stripe, idempotent markPaid/markRefunded, print what flipped); pending>24h chip; prune stale `pending-` rows.
- **P9:** publish throttle **in D1/KV, not isolate memory** (multi-isolate undercount); per-writer (user key or instance token), 10/h + 5-min spacing per plugin+version; 429 carries machine-readable retryAfter; guard prompt gains a line so a 429 isn't treated as failure.

**Consent family (the R1/R2 pair, as amended):**
- **R1:** update dialog diffs stored installed-summary vs chosen version's summary, **computed server-side** (client-posted summaries are forgeable — security amend); dialog only when the summary **grows** (consumer amend — otherwise every update is a click-through); button reads "Update (N new permissions)".
- **R2:** auto-update exempt (→ consent flow) when **any consented surface** changes — setup.commands, cron scripts, hooks, agentsMd, agents, pages.public — not setup.commands alone (security amend: one-door lock); `plugin.updated` hub event + AgentNotices, **tiered** (quiet line for routine bumps, notice on permission/command growth — consumer amend); optional `releaseNotes` ships with schema description + skill line + docs (docs amend); notice volume capped.
- **P4:** review-prompt sections for opencode.mcp/opencode.plugin; `applied.mcpClashes` (mentionClashes pattern, no migration); doctor warns on unpinned npm specs + remote MCP URLs; when B5 lands, bind `mcp_plugin_managed` to namespaced keys.

**Author loop:** P1 (`publish --init` reusing the --dev path; skill checklist switches to it in the same PR); P6 (`doctor --privacy` optional cf-ai advisory — never gates, never displays as a status chip (security), reuses watchdog provider config, prints rubric categories even without a model); S2 (skill-body stub tripwire + real worked example in scaffold); S3 (doctor CONFIG.md↔configs[] cross-check + `--print-config-table` generator); D3 (restart manifest-diff hint: "manifest changed — reinstall to apply"; skill gets the matching line).

**Runtime surfaces:** RT4 (product chrome: waking spinner, error card + Retry that re-mints the frame token, "updated Ns ago" staleness footer); RT5 (reference-plugin hardening: port the scaffold's token guard to stock-dashboard — the review prompt grades its absence high while the flagship example omits it; persist example state to `~/.open-bot/pages-data/stock.json`; per-boot id so "app restarted" can surface (consumer merge-error); add CONFIG.md. Realistically **L**: seed-image cycle for every desktop); RT3 (hook activity line derived from existing `worker:` session rows first — **no migration** (publish-ops amend); column only if insufficient; `ob-plugin logs ID` for authors); RT1 (disable-consequence summary from the stored manifest snapshot).

**T2 — test evidence (dispute resolved by chair):** Security's objection stands: author-test output in the review verdict message is an injection channel, and a self-attested "smoke: pass" beside `review.status` reads as a review verdict. Ship instead: reviewer armor (P0 #3); smoke results stored **separately**, always labeled "author-run, not reviewer-verified" with provenance {version, hostBuild, ranAt} + the staleness model; the D1 persistence columns are **deferred** until the smoke ladder has stabilized (publish-ops: it's a migration the original finding didn't mention). AUTHOR TESTS section is dropped.

---

## Wave 3 — P2 (adopted, deferred)

- **OPS4:** `?sort=relevance|downloads|newest` + `limit/offset` (query-only; the `search_text` column is a migration — explicitly out of scope). Document params in the same PR.
- **RT2:** plugin detail view — corrected per publish-ops: README is **not** in `/api/plugins/installed` (review fetches, doesn't persist) → link to marketplace/repo listing instead of rendering, or add the fetch+store path deliberately; render CONFIG.md (already synced); escape any rendered markdown; scaffold README tells authors their README is shown (docs amend).
- **DOC3:** task-first "Author a plugin" docs page (agent skill quality, human-facing); teaches the **consent/security model**, not just mechanics (security amend); reuses skill sandbox rules verbatim; linked from marketplace publish page + scaffold README; examples validated by the DOC1 test.

---

## Disputes & chair resolutions

1. **T2 evidence (QA/author-dx endorse vs security object):** resolved — security's injection argument wins on the review-content half; evidence surfaces survive as separately-stored, provenance-labeled, staleness-bound smoke results. See Wave 2.
2. **P8 fix mechanics:** publish-ops endorsed the original; security showed the R2 key collision makes "keep old artifact" fiction until artifacts are sha-keyed. Resolved: two-step sequencing above.
3. **I4 mechanism:** author-dx corrected "bare TCP fallback" → "any-HTTP-response fallback"; same failure class, fix unchanged.
4. **S1 fix shape:** docs amend adopted — regenerate from schema rather than hand-fix (hand-fixing is the rot the harness exists to kill).
5. **UNRESOLVED → your call:** none blocking. The only genuinely split item was **B3** (smoke as publish precondition: QA fight-for, author-dx oppose, ops "don't fake a server-side gate") — chair keeps it in the breaking appendix with the T2-evidence prerequisite, unconverted.

---

## Breaking appendix (quarantined; stances: 6 experts)

| # | Idea | Stances | Chair note |
|---|---|---|---|
| B1 | Retire `dashboard.tabs[].kind:"iframe"` (unreviewable remote embeds) | 4× fight-for, 2× accept (one: "not now — needs installed-row audit + deprecation window") | Adopt direction; deprecation window + audit first |
| B2 | Consent receipts: store approved summary; permission growth requires fresh human consent; auto-update skip-and-notify | 3× fight-for, 3× accept | R1/R2 are its incremental half; needs an installed_plugins column (migration) |
| B3 | Passing local smoke becomes a publish precondition | 1× fight-for, 4× accept, 1× oppose | Deferred behind smoke ladder + evidence infra; never fake server-side verification |
| B4 | Require /healthz on all page servers; retire the any-HTTP fallback | 1× fight-for, 5× accept | Deprecation window; scaffold already ships /healthz |
| B5 | Namespace plugin MCP keys (`plugin-<id>:<name>`) | 2× fight-for, 4× accept | Boot re-sync migrates; bind mcp_plugin_managed to new keys |
| B6 | Require pinned versions for opencode.plugin npm specs | 1× fight-for, 5× accept | Validator suggests exact pins in the error |
| B7 | Review-coverage caps become hard manifest limits | 2× fight-for, 4× accept | Enforcement arm of the caps ladder; loud schema version bump |
| B8 | Hard-require filled CONFIG.md at publish (configs/vault declared) | 1× fight-for, 5× accept | Doctor warn → publish gate after a grace period |
| B9 | Real listing lifecycle state machine column (replaces overloaded plugins.status) | 1× fight-for, 5× accept | Phase: add column → dual-write → flip reads, D1/Pages/worker lockstep |
| B10 | D1 migrations folded into the deploy pipeline (migrate-before-ship + health gate) | 1× fight-for, 5× accept | Ends the 0005 outage class structurally |

---

## Evidence base

- Repo: working tree @ main (dirty ~59 files) — all file:line citations verified against it during R1/R2.
- Real plugins audited: `examples/stock-dashboard` (every expert), plus other `open-bot.plugin.json` checkouts found in the workspace.
- Round-1: 6 delegated reviews × ≤8 graded findings. Round-2: 6 × 42 verdicts (202 object/amend; 1 outright objection), 6 new findings adopted (reviewer armor; authordx-9 clean-tree gate; publish-ops-9 message-less queued rows; consumer-ux-9 consent naming; qa-testing-9 staleness; DOC5), merge corrections folded.
- Full raw record: `/tmp/opencode/plugin-council/` (BRIEF.md, MASTER.md, round1/*.json, round2/*.json).
