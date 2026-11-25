# Bounded, replayable source-correction audits

Status: accepted source-only engineering contract. Statutory data and publication acceptance are separate.

Stored Markdown can contain defects already corrected in the importer. An import rerun or an operative-text-only check cannot establish that a selected correction preserves headings, continuations, source credits, editorial notes and list parents. Audit against an independently pinned complete source member before selecting a repair cohort.

## Inputs and public boundaries

Provide one offline command with a retained source inventory, local original archive, immutable accepted Git commit, fixed canonical generation timestamp, explicit section scope or full-inventory mode, and fresh output directory. Inventory binds publisher release/title, archive URL, SHA-256 and bytes, and exact member name/SHA-256/bytes. A URL or caller-provided verification flag is not acquisition proof. Verify archive closure and original member bytes; do not substitute a derived section fixture as original publisher provenance. Read accepted content through physical Git objects, never a dirty worktree or mutable replacement view. Disable promisor lazy fetches and optional locks so missing local objects fail offline without changing repository state.

Reuse the existing source-correction staging CLI, actual sanitized subsection-anchor renderer and independent Python fidelity oracle. Add a prepared-source API to that same oracle so a bounded worker hashes/parses the full source once and compares HTML sequentially. Standalone and batch verification share the comparison implementation; there is no second set of acceptance rules. Public tests cover the actual audit CLI and standalone/batch gate, not mocked internal collaborators.

Inputs are explicit: `--inventory`, `--archive`, `--data-repo`, `--accepted-ref`, `--generated-at`, `--output` and exactly one of `--sections` or `--all`. Optional `--resume-from` requires an independently recorded `--resume-sha256`. Resume also writes a fresh directory and never changes the earlier run. Unknown flags, ambiguous identities, malformed source/release context and existing output refuse.

## Bounds and diagnostic states

Compressed archive and full member remain capped at 128 MiB; larger declared members are blocked rather than silently admitted. DTD/entities and unsupported encodings refuse. Use fixed concurrency one, at most 100 explicitly mapped source sections per producer/batch worker, a 2 GiB producer heap and 120-second subprocess bounds. Markdown bodies are capped at 2 MiB, HTML at 16 MiB, individual witnesses at 2 MiB and batch JSON at 32 MiB. Check actual write sizes while maintaining a 2 GiB free-space reserve and 16 GiB run quota. Resource failures are inconclusive and cannot qualify a cohort.

Retain every top-level source identity and locator, separately counting nested quoted section nodes. Do not coerce grouped/ranged identifiers into a single provision. Preserve missing/extra paths, duplicate or unresolved identities, old/new hashes, all three semantic lanes, headings/list-parent/continuation findings and unknown/table/footnote states. A failed or inconclusive selected witness blocks the selected repair scope. A selected cohort denominator cannot establish whole-title coverage.

Difference categories are exact unchanged, generated-timestamp-only, metadata-only, body changed and missing accepted path. Stored-file publisher mismatch is explicit; it is not evidence of a same-edition source correction. A stored failure with a passing current fragment is a candidate repair, not accepted data.

Exit zero means the complete selected current **renderer-fragment** scope passes. Exit one preserves blocked diagnostics; exit two reports invalid input or operational/resource failure. Keep reconstructed candidate, source-qualified fragment, final built page, protected data revision and deployed publication states distinct. The command never writes accepted data, checkpoints, Git tags, selection pointers or publication state.

## Replay and incremental reuse

Canonical outputs bind source bytes/identity, immutable accepted commit and actual per-file bytes, selected scope, fixed generation timestamp, compiler distributions, lockfile, renderer/anchor/oracle/runner code and runtime/Unicode versions. Exclude absolute local paths, wall-clock timing and cache-hit counters from canonical identities. Cold runs with the same inputs reproduce bytes.

Resume checks the pinned earlier manifest and referenced-byte closure. Corrupt, missing or linked transports refuse. Changed source, Git blob, generation, compiler, renderer, oracle, lockfile or runtime invalidates the corresponding staging reuse. Only candidate staging bytes are reusable; render and independently verify fresh. A cached acceptance flag never establishes fidelity. Operational reuse counters remain outside the deterministic manifest.

## Historical recipe integration

The oracle and transformer are historical recipe dependencies. A source change must not repin accepted historical records or reassign their IDs. Preserve earlier reviewed generation products and witnesses; create fresh collection identities from new complete original-member witnesses after recipe bytes freeze. Retained products may be served only under their own exact reviewed hashes and collection closure; active production remains bound to its actual current recipe. Immutable generation readers and explicit active publisher aliases are coordinated with the historical-source integration. Unknown generations remain gaps. This integration and its independent review are mandatory before merging changed recipe inputs.

Full source/title audits and final data application remain separate tracked stages. No automatic repair count, legal amendment or effectivity assertion follows from a compiler or snapshot difference.
