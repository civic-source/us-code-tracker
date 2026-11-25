# Scoped, replayable source correction candidates

Status: accepted engineering design; data and publication acceptance remain separate.

Corrections to a few witnessed provisions must preserve unrelated corpus files, original release tags and import checkpoints. Rebuilding a whole title would also change units whose structures have not passed fidelity checks. Generation timestamps must be recorded inputs so cold replays can reproduce file bytes.

Add a staging-only command taking retained UTF-8 XML, its expected SHA-256, a title/section scope, the publisher release label and a fixed canonical generation timestamp. Validate the complete requested scope before creating a fresh output directory. Emit only the selected Markdown files and a deterministic candidate manifest with source bytes, compiler distribution hashes and per-file hashes. No accepted repository, checkpoint or Git tag is modified by this command. Input bytes and available output capacity are bounded.

The manifest is an operational candidate record. Its `candidate` state cannot establish source authenticity, independent text fidelity, legal/editorial review, a completed build or deployment. Retain the upstream archive acquisition and member provenance separately. Verify every changed unit against pinned XML using the independent page gate, then inspect final built pages and protected publication receipts.

After protected corpus review, reuse the existing immutable revision-tag and supersession mechanism. A source correction is distinct from a legislative amendment. Preserve the original tag and its data; record the corrected generation as a revision and retain the explicit checked scope. The broader title inventory and unqualified structures remain visible in coverage records.

Verification covers two cold outputs with identical inputs, digest mismatch, absent/duplicate scope, invalid timestamps, and refusal to overwrite an existing output. The deterministic manifest excludes absolute cache/output paths and wall-clock values outside the recorded generation input.
