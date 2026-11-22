# USCT-031: Optionally execute a bounded job through an HCK or ACQ adapter

**Status:** proposed  
**Readiness:** blocked  
**Type:** optional  
**Milestone:** M6 — Evaluate optional compute and RuleSpec interoperability

## What it delivers

An operator can run one existing accepted workload through a selected HCK or ACQ executor adapter while preserving the ordinary local execution path and evidence.

## Blocked by

- [USCT-022](USCT-022.md)
- [USCT-028](USCT-028.md)

## Acceptance criteria

- [ ] Verify and pin the current selected HCK or ACQ executor interface and any kit contract it actually requires before adapting one representative job.
- [ ] Declare existing tools, capabilities, immutable inputs/outputs and resource limits; reuse available execution/scheduling mechanisms rather than building a scheduler.
- [ ] The optional path emits the same accepted artifact, dependency and provenance contract and remains replaceable with the ordinary local runner.
- [ ] Keep credentials outside artifacts, restrict source access to task needs and prevent optional executor availability from blocking core refresh or publication.

## Independent validation

Run the same immutable fixture through local and selected existing-tool execution paths; compare accepted output hashes, provenance and failure/cancellation behavior.

## Demo

Execute one bounded export/rebuild job through the selected optional adapter and fall back locally after an injected runner failure.

## Evidence needed to close

- Verified and pinned executor/kit interface
- Task capability manifest
- Local/adapter parity
- Resource/cancellation results

## Rollback notes

Disable the optional executor adapter and replay the job locally from the same immutable inputs.

## Existing work

Reconcile with current code, open/closed issues and PRs before implementation; reuse or amend matching work instead of opening a duplicate.

## Implementation notes

Optional interoperability after core operability, not a new orchestration platform or scheduler. Kit v3 or HyperQueue are evaluated only if the selected existing tool actually requires them; verify their current interfaces at that time. No infrastructure purchase, credential provisioning or skill installation is implied.
