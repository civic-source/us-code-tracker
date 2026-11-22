# Implementation handoff

Use this packet after implementation is authorized. Creating the plan has not implemented it, posted issues, or granted blanket future permission to deploy or merge.

## Authorized source acquisition

William has explicitly authorized discovering, downloading, re-fetching, and backfilling relevant source data needed for the new schemas, including historical documents, start/end dates, applicability conditions, identifiers, citations, relationships, and provenance. Use relevant public sources and already-authorized APIs; the initial source list is not exhaustive. Ordinary in-scope collection does not require repeated confirmation. Apply [Data acquisition and schema backfill](docs/DATA-ACQUISITION.md), record source/field coverage, and continue other work when one source is unavailable. This authorization carries forward into implementation of the plan.

## First session

1. Read the target repository's current AGENTS.md and contributor instructions. Read this package's PLAN.md, SPEC.md, GLOSSARY.md, docs/DATA-CONTRACTS.md, and the selected ticket. Preserve existing conventions.
2. Complete USCT-001: inspect current commits, working-tree state, relevant open and merged work, deployment/data pins, and tests. Compare with the recorded baseline. Reconcile duplicates and already completed work before editing. Do not assume this plan's source SHAs are still current.
3. Record material changes to scope or evidence in a small reconciliation note. Preserve the user's accepted local-processing/static-publication direction. Resolve ordinary implementation choices using the specification; ask only for a missing consequential decision that cannot be inferred or safely explored.
4. Choose a ready ticket from backlog.json: every blocker must be completed with acceptance evidence or explicitly reconciled as already satisfied. Optional tickets never block required delivery.
5. Work in an isolated branch/worktree when parallel contributors touch the same repository. Give each agent a narrow owned seam or independent review question. Do not let several agents edit the same files without explicit coordination.

## Ticket execution loop

Establish the desired observable outcome, existing public seam, and independent expected result. Write the smallest meaningful failing behavior test where it resolves a real risk; then implement enough to pass, inspect edge cases, and refactor behind the same contract. Reuse relevant existing fixtures. Do not write tests that merely restate internal calls or generate expectations with the function under test.

For source parsers, keep actual source snapshots and manually checked expectations. For temporal/identity behavior, use the adversarial fixtures in docs/VALIDATION.md. For orchestration, inject failures and verify accepted-state behavior. For static publication, inspect the built artifact and exact manifest rather than only mocking deployment calls.

Run focused checks first. Broaden to the required repository gate and affected integrations. Wire orchestration script tests into the real CI test path where the current workspace runner omits them. Stop optional testing once the material risks and required gates are satisfied.

Demonstrate a usable vertical slice: source input to persisted acceptance to relevant reader/operator output. A schema without a consumer or a UI without pinned evidence is not the stated outcome. Keep the patch small enough for independent review. If a ticket no longer fits one coherent slice, split it with explicit updated dependencies instead of hiding a large migration inside it.

## Three review perspectives

| Review | Required question |
| --- | --- |
| Specification | Does the result satisfy the observable story, acceptance criteria, and failure behavior without silently changing scope? |
| Repository standards | Does it follow existing contracts, instructions, security boundaries, migration conventions, maintainability, and required checks? |
| Evidence and time | Do sources support the claims, identities and dates mean what the interface says, and uncertainty/coverage remain truthful? |

Use separate review passes; an independent reviewer or fresh agent context is preferred for the consequential temporal/publication changes. A code-quality pass cannot substitute for evidence review. A model cannot promote its own interpretation to a judicial holding.

## Evidence to close a ticket

Record the implementation revision, tests actually run with outcomes, representative demonstration, relevant source/fixture manifests, remaining limitations, and rollback behavior. Show differences from the initial plan when evidence required them. Mark the ticket complete only after its own criteria pass; dependency completion is not implied by a merged prerequisite.

A PR description should lead with the concrete problem, explain the changed behavior, and include only the evidence reviewers need. Link the proposed ticket ID and specification section. Keep new defects separate from accepted legacy limitations and record owner/review dates for any temporary baseline exception.

Do not claim production verification from local tests or a successful dry run. Do not claim a backfill is complete merely because a loop ended. Do not claim historical legal applicability from release dates, or a court's statutory-version choice from its decision date.

## Guardrails for this project

- Preserve published Git history, legacy URL mappings, and recorded tag-to-commit identities.
- Keep original source bytes and source-location evidence recoverable.
- Do not turn failed requests into authoritative empty results or remove last-good data.
- Keep statutory text, legal assertions, model proposals, and editorial decisions distinguishable.
- Keep the public site static and independent of private runtime services.
- Keep pgvector, Gemma, and HCK optional; measure before adding machines or schedulers.
- Use verified current APIs and supported commands. The plan does not certify hypothetical ACQ/Kit or hosting commands.
- Carry third-party license and attribution metadata into every affected export.
- Use task generation and fencing when more than one worker can accept the same work.
- Follow the actual session's authorization for remote writes, issue creation, merge, deployment, and communications. Do not infer those permissions from a ticket template.

## Suggested first implementation request

“Implement the US Code Tracker plan beginning with USCT-001. Reconcile the current repository and existing work, then implement the earliest ready repair slice in an isolated branch. Preserve current conventions and history. Include independent acceptance evidence and a reviewable PR draft. Continue through authorized reversible work; report material scope changes and any external action that still requires authorization.”

This is a reusable kickoff request, not an instruction executed by creating this package. The exact ready frontier is in backlog.json and may change when current work is reconciled.
