# Replaying a scoped source correction

Build the pinned checkout's packages and retain the upstream acquisition record, raw archive and extracted XML member. Verify both archive and member digests. The staging command checks the member bytes; the acquisition record establishes publisher and release provenance.

```bash
pnpm --filter '!@civic-source/web' build
pnpm exec tsx scripts/prepare-source-correction.ts \
  --xml /path/to/retained/usc18.xml \
  --sha256 d7cee2875371e43ada68ec936bc43fe5e8be62b86fa8175cabd8c80c261232c2 \
  --title 18 --sections 19,111,1001 --release 'PL 119-142' \
  --generated-at '2026-11-25T01:20:00.000Z' \
  --output /path/to/fresh/candidate
```

The example source member belongs to PL 119-142's Title 18 ZIP, SHA256 `14d9cf0ecaeb557246546fb837d2fa2e0871ae0d73e27ab8ea954d0f1de57836`. The timestamp is an explicit canonical generation input; it is not an enactment date. For an exact replay, use the original generation timestamp and pinned compiler distribution/dependency versions recorded with that candidate.

Output contains only the selected Markdown files and `candidate-manifest.json`. The manifest records XML bytes/digest, the explicit scope and release label, generation input, producer and built compiler hashes, dependency lock hash, and per-file digests. Absolute source/output paths and unrecorded wall-clock values are excluded. Two cold output directories with identical source, options and compiler produce identical bytes.

Input is bounded at 128 MiB and must decode as UTF-8; DTD/entity declarations are prohibited. Requested release must match exactly one source `meta/docPublicationName` (for example, `Online@119-142`). Missing or ambiguous publication metadata is refused. This document identity check does not replace acquisition provenance. The entire requested scope must exist uniquely before output creation. Output must be a fresh directory whose parent already exists. Capacity includes a 16 MiB reserve. Existing outputs are refused. If filesystem writes fail, retain any partial directory as evidence; absence of the final manifest prevents treating it as a complete candidate.

Staging does not modify an accepted data repository, import checkpoint or Git tag, and `state: candidate` establishes no publication or legal acceptance. Independently check every changed unit using [the XML-to-page verifier](SOURCE-FIDELITY.md), inspect final built pages, and obtain normal protected corpus review. Apply only the checked file scope. Use the existing immutable release revision and supersession helpers after review; preserve original tags and record the correction independently from legislative amendment events.

The remaining source structures, whole-title coverage, static artifact capacity and deployed receipt checks stay in their respective acceptance gates. A regenerated candidate is not a verified public release.
