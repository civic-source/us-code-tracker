# Specification to delivery traceability

The story numbers below refer to SPEC.md. Ticket IDs are proposed local planning identifiers. This mapping identifies an implementation owner for every product story; it is not evidence that the behavior is complete. Final acceptance is USCT-029 and controlled primary-site cutover is USCT-030.

| Specification story | Principal delivery tickets |
| --- | --- |
| 1. Named-release text | 008, 034 |
| 2. Separate legal/publication/observation dates | 008, 013, 034 |
| 3. Version comparison and correction classification | 008, 018, 026 |
| 4. Correct historical URLs | 011, 026, 030 |
| 5. Preserve rich legal structure | 010 |
| 6. Inspect exact source support | 008, 013–016 |
| 7. Candidate versus verified/reviewed relationships | 003, 004, 014, 015, 017 |
| 8. Distinguish legal document authority | 013–016 |
| 9. Unknown and disputed applicability | 017, 034 |
| 10. Scope public search to a release | 036 |
| 11. Visible coverage and freshness | 002, 012, 027, 028 |
| 12. Download manifests and evidence | 020, 022 |
| 13. Retry failed historical work | 005, 012, 027 |
| 14. Truthful acquisition outcomes | 002, 012 |
| 15. Required partition completeness | 007, 012, 027 |
| 16. Reproducible deterministic exports | 018, 020, 022 |
| 17. Parser changes distinct from law changes | 010, 018, 026 |
| 18. Review competing interpretations | 017, 034 |
| 19. Identify stale derived work | 018, 019 |
| 20. Refresh unresolved targets | 018, 019 |
| 21. Idempotent interruption and retry | 005, 009, 035, 028 |
| 22. Verify exact promoted deployment | 033, 020, 030 |
| 23. Rollback and restore | 028, 029, 030 |
| 24. Preserve third-party licenses | 020, 029, optional 032 |
| 25. Query legal graph separately from DAG | 009, 018, 021 |
| 26. PostgreSQL and DuckDB research | 009, 022 |
| 27. Filtered lexical/optional vector retrieval | 023 |
| 28. Optional local model proposals | Optional 024 |
| 29. Core works without models | 008, 020, 023, 029 |
| 30. Lightweight contributor fixture | 008 |
| 31. Measured resource and worker decisions | 027, 028, optional 031 |
| 32. Optional executor interoperability | Optional 031 |

## Required adverse-case ownership

| Failure or difficult condition | Owning ticket |
| --- | --- |
| Failed middle release followed by later success | 005 |
| Reused mutable tag, excluded/corrected release | 006, 007 |
| Valid syntax but missing legal text | 010, 012 |
| Reused citation / transferred provision | 011 |
| Conditional retroactivity and backfilled observation | 034 |
| Partial regulation/case collection | 002, 014, 015 |
| Previously absent target becomes available | 018, 019 |
| Stale worker attempts acceptance | 035 |
| Wrong data pin or mismatched static artifact | 033, 020 |
| Mixed current/historical search | 036 |
| Restore and publication reversal | 028, 030 |

The complete dependency graph, including optional branches and required cutover closure, is in [backlog.json](../backlog/backlog.json).
