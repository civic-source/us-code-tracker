# Offline source-correction audit

The audit command compares an immutable accepted Git commit with freshly reconstructed Markdown and the real sanitized/anchored renderer. The independent full-member Python gate checks all text lanes and list placement. It stages diagnostics only: no corpus worktree, import checkpoint, tag, accepted pointer or publication is modified. See [ADR 0007](../decisions/0007-bounded-source-audits.md) and [the source-to-page gate](SOURCE-FIDELITY.md).

## Retained input

Use the ORIGINAL independently acquired ZIP, not a derived test envelope. The inventory records exact byte identities and the declared publisher context. For the retained PL 119-142 Title 18 source:

```json
{
  "schemaVersion": "usct.retained-source-inventory/v1",
  "title": "18",
  "releaseLabel": "PL 119-142",
  "archive": {
    "url": "https://uscode.house.gov/download/releasepoints/us/pl/119/142/xml_usc18@119-142.zip",
    "sha256": "14d9cf0ecaeb557246546fb837d2fa2e0871ae0d73e27ab8ea954d0f1de57836",
    "byteLength": 1972686
  },
  "member": {
    "name": "usc18.xml",
    "sha256": "d7cee2875371e43ada68ec936bc43fe5e8be62b86fa8175cabd8c80c261232c2",
    "byteLength": 12138748
  }
}
```

Archive/member digests establish byte identity, not acquisition authenticity by themselves. Keep the acquisition record and [durable archive recovery instructions](../../data/olrc-history-pilot/README.md) alongside the inventory. The output deliberately leaves `publisherAcquisitionVerified` false. The extractor admits exactly the declared single safe XML member, verifies original compressed and member bytes, and rejects unexpected/duplicate names, encryption, linked/special transport and oversized input. The legacy extractor default remains `usc18.xml`; an explicitly pinned member name can represent another canonical title. Other titles are not qualified merely because this adapter can name their files.

Both archive and full member are capped at 128MiB. Inventory uncompressed member sizes before extending the cohort. A larger title needs separately specified streaming support; this command does not raise the cap or replace the full publisher member with partial XML. Unknown namespaces, publisher/title mismatches, DTD/entities and unsupported encodings refuse.

## Scoped run and full inventory

Create a private writable parent for the fresh output. Build the workspace compiler with the frozen lockfile before auditing. Replace the example local input paths with retained files; the accepted commit is immutable, not `main` or `HEAD`.

```bash
pnpm --filter '!@civic-source/web' build
pnpm exec tsx scripts/audit-source-correction.ts \
  --inventory /path/to/retained-title18.json \
  --archive /path/to/14d9cf0ecaeb557246546fb837d2fa2e0871ae0d73e27ab8ea954d0f1de57836 \
  --data-repo /path/to/us-code \
  --accepted-ref 7297bf86fe00c0f850e1da9df5af5a03383fea70 \
  --generated-at 2026-11-25T01:39:48.293Z \
  --sections 31 \
  --output .workbench/NEW-source-audit
```

Use `--all` instead of `--sections` for the complete retained source inventory. Every top-level source record is retained; nested quoted section nodes have a separate denominator. Grouped/ranged identities are not coerced into a single section. At most 100 explicitly mapped sections enter each producer/batch worker; concurrency is fixed at one. Missing/extra accepted paths and conflicting same-section paths remain explicit. Extra accepted paths block complete-inventory qualification; an explicit small repair scope does not claim that unrelated paths were repaired.

`audit-manifest.json` binds scope, original pins, accepted commit/bytes, fixed generation input, actual compiler distributions, lockfile, renderer/oracle/runner sources and runtime/Unicode versions. It records unchanged, timestamp-only, metadata-only, substantive-body and missing-path differences; stored/current witness hashes; all three lanes; headings/list parents/continuations; unsupported structures and errors. Raw HTML, gate packets and producer diagnostics remain in the output. Canonical transport hashes exclude timing logs, operation counters and subset producer receipts. They include all source, staging, rendering and witness payloads referenced by the canonical report.

The stdout summary includes the manifest SHA-256 for a later pinned replay. Exit states:

- `0`: the complete selected current renderer-fragment scope and repair context pass.
- `1`: diagnostic mismatch, unresolved identity, unsupported structure or incomplete selected inventory blocks qualification.
- `2`: invalid input, missing/ambiguous source, malformed transport, operationally inconclusive comparison or resource failure. Completed diagnostics may be retained; no successful selected result is implied.

The outputs always distinguish fragment qualification from final built-page, protected data revision and deployed-publication acceptance. Tables and footnotes remain unqualified even when plain text matches. Never drop unsupported records to obtain a passing title summary. A stored failure/current pass can propose a source correction; it is not a legislative-amendment or effectivity claim.

## Pinned resume and incremental updates

Run into another NEW output and supply both the prior directory and its separately recorded manifest digest:

```bash
pnpm exec tsx scripts/audit-source-correction.ts \
  --inventory /path/to/retained-title18.json \
  --archive /path/to/original.zip --data-repo /path/to/us-code \
  --accepted-ref 7297bf86fe00c0f850e1da9df5af5a03383fea70 \
  --generated-at 2026-11-25T01:39:48.293Z --sections 31 \
  --resume-from .workbench/PREVIOUS-source-audit \
  --resume-sha256 PINNED_PREVIOUS_MANIFEST_SHA256 \
  --output .workbench/NEW-resumed-source-audit
```

Resume verifies the previous manifest and complete canonical payload closure. Missing, corrupt, unexpected or linked payloads refuse; prior files are never overwritten. Candidate staging reuse requires matching original source, actual accepted Git blob, generation input and complete producer/renderer/oracle/lock/runtime key. An annotation-only accepted commit can reuse an unchanged statute blob while the report records the NEW commit. Changed generation/source/code/statute bytes invalidate staging reuse.

Only staging bytes are reused. Actual sanitizing/anchoring and independent full-source witnesses run again; cached acceptance flags cannot qualify forged bytes, even if their transport has been self-hashed. `audit-operation.json` records reuse/invalidation counters separately. Same-input cold and resumed canonical manifests reproduce byte-for-byte.

## Resource and lifecycle boundaries

The existing producer's fixed `bounded-audit` purpose enforces a 2 GiB free-space reserve and 2 MiB candidate-file/manifest bounds inside the worker; the ordinary staging CLI retains its prior defaults. The parent reserves each worker's maximum, adopts actual child bytes into a 16 GiB run quota and checks space before every owned write. Worker heap is 2 GiB, subprocess timeouts 120s, Markdown 2 MiB, HTML 16 MiB, individual witnesses 2 MiB, batch/canonical JSON 32 MiB. Canonical transport scans also cap 200,000 files. Exhaustion is inconclusive, not a reason to lower bounds or accept a partial scope. Preserve owned partial receipts and reconcile the failure; do not retry into an existing directory.

Prepare a protected data PR only from explicitly selected complete witnesses. Every affected provision still needs an independent source-to-final-built-page witness, actual-diff review and publication-pin/deployment checks. Broader cohort repair and unsupported serializers remain tracked separately under civic-source/us-code-tracker#357 and civic-source/us-code-tracker#378. Existing historical recipe generations require their own retained identity and requalification rules; an audit run cannot admit a historical product or repin its original proof.
