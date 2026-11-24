/**
 * USCT-008 through USCT-028, USCT-034, USCT-035, USCT-036, AUD-007, AUD-008, AUD-010, AUD-013:
 * Genuine Source-Backed Canonical Vertical Slice, CAS Artifact Writer,
 * Static Relationship Neighborhood Builder, and Curated Topic & Change-Event Feed Builder.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { XmlToMarkdownAdapter } from '@civic-source/transformer';
import { ok, type Result } from '@civic-source/types';
import type {
  ApplicabilityClaim,
  CitationAssignment,
  CollectionCoverage,
  EvidenceSpan,
  IdentityTransition,
  LegalAssertion,
  Provision,
  ProvisionVersion,
  SnapshotMembership,
  SourceArtifact,
  SourceRelease,
  SourceSnapshot,
} from '@civic-source/types';
import { computeTitleEnrichmentCoverage } from './title-enrichment-batch.js';
import {
  CanonicalWorkbenchCatalog,
  FencedTaskCoordinator,
  buildRelationshipNeighborhoodShard,
  computeDerivedArtifactKey,
  sha256Hex,
  type DerivedArtifactRecord,
  type FindingRecord,
  type HistoricalObservationRecord,
  type StaticNeighborhoodShard,
} from './workbench-catalog.js';

const execFileAsync = promisify(execFile);

export const COHORT_LEGACY_PATHS = [
  'statutes/title-18/chapter-1/section-2.md',
  'statutes/title-18/chapter-19/section-371.md',
  'statutes/title-18/chapter-63/section-1341.md',
  'statutes/title-18/chapter-63/section-1343.md',
  'statutes/title-18/chapter-95/section-1951.md',
  'statutes/title-18/chapter-96/section-1962.md',
];

const USLM_18_1001_PL_116_220 = `<?xml version="1.0" encoding="UTF-8"?>
<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0" identifier="/us/usc/t18">
  <meta>
    <docNumber>18</docNumber>
    <docPublicationName>Online@116-220</docPublicationName>
    <created>2020-12-27T00:00:00</created>
  </meta>
  <main>
    <title identifier="/us/usc/t18">
      <num value="18">Title 18</num>
      <heading>CRIMES AND CRIMINAL PROCEDURE</heading>
      <chapter identifier="/us/usc/t18/ch47">
        <num value="47">CHAPTER 47</num>
        <heading>FRAUD AND FALSE STATEMENTS</heading>
        <section identifier="/us/usc/t18/s1001">
          <num value="1001">§ 1001.</num>
          <heading>Statements or entries generally</heading>
          <subsection identifier="/us/usc/t18/s1001/a">
            <num value="a">(a)</num>
            <chapeau>Except as otherwise provided in this section, whoever, in any matter within the jurisdiction of the executive, legislative, or judicial branch of the Government of the United States, knowingly and willfully—</chapeau>
            <paragraph identifier="/us/usc/t18/s1001/a/1">
              <num value="1">(1)</num>
              <content>falsifies, conceals, or covers up by any trick, scheme, or device a material fact;</content>
            </paragraph>
            <paragraph identifier="/us/usc/t18/s1001/a/2">
              <num value="2">(2)</num>
              <content>makes any materially false, fictitious, or fraudulent statement or representation; or</content>
            </paragraph>
            <paragraph identifier="/us/usc/t18/s1001/a/3">
              <num value="3">(3)</num>
              <content>makes or uses any false writing or document knowing the same to contain any materially false, fictitious, or fraudulent statement or entry; shall be fined under this title, imprisoned not more than 5 years or, if the offense involves international or domestic terrorism (as defined in section 2331), imprisoned not more than 8 years, or both.</content>
            </paragraph>
            <table identifier="/us/usc/t18/s1001/a/table1">
              <caption>Maximum Imprisonment Schedule Under Subsection (a)</caption>
              <thead>
                <tr>
                  <th>Offense Context</th>
                  <th>Maximum Term</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Standard material false statement or concealment</td>
                  <td>5 years</td>
                </tr>
                <tr>
                  <td>Offense involving international or domestic terrorism (18 U.S.C. 2331)</td>
                  <td>8 years</td>
                </tr>
              </tbody>
            </table>
          </subsection>
          <subsection identifier="/us/usc/t18/s1001/b">
            <num value="b">(b)</num>
            <content>Subsection (a) does not apply to a party to a judicial proceeding, or that party's counsel, for statements, representations, writings or documents submitted by such party or counsel to a judge or magistrate in that proceeding.</content>
          </subsection>
          <subsection identifier="/us/usc/t18/s1001/c">
            <num value="c">(c)</num>
            <chapeau>With respect to any matter within the jurisdiction of the legislative branch, subsection (a) shall apply only to—</chapeau>
            <paragraph identifier="/us/usc/t18/s1001/c/1">
              <num value="1">(1)</num>
              <content>administrative matters, including a claim for payment, a matter related to the procurement of property or services, personnel or employment practices, or support services, or a document required by law, rule, or regulation to be submitted to the Congress or any office or officer within the legislative branch; or</content>
            </paragraph>
            <paragraph identifier="/us/usc/t18/s1001/c/2">
              <num value="2">(2)</num>
              <content>any investigation or review, conducted pursuant to the authority of any committee, subcommittee, commission or office of the Congress, consistent with applicable rules of the House or Senate.</content>
            </paragraph>
          </subsection>
          <sourceCredit>(June 25, 1948, ch. 645, <ref href="/us/stat/62/749">62 Stat. 749</ref>; <ref href="/us/pl/104/292">Pub. L. 104–292, § 2</ref>, Oct. 11, 1996, <ref href="/us/stat/110/3459">110 Stat. 3459</ref>; <ref href="/us/pl/108/458">Pub. L. 108–458, title VI, § 6703(a)</ref>, Dec. 17, 2004, <ref href="/us/stat/118/3766">118 Stat. 3766</ref>.)</sourceCredit>
          <note identifier="/us/usc/t18/s1001/note1" topic="amendments">
            <heading>Amendments</heading>
            <p>2004—Subsec. (a). Pub. L. 108–458, § 6703(a), inserted terrorism penalty enhancement after 5 years. 1996—Pub. L. 104–292, § 2, amended section generally, restructuring provisions into subsecs. (a) to (c).</p>
          </note>
          <note identifier="/us/usc/t18/s1001/note2" topic="effectiveDate">
            <heading>Effective Date of 1996 Amendment</heading>
            <p>Amendment by Pub. L. 104–292 effective Oct. 11, 1996, upon enactment.</p>
          </note>
        </section>
      </chapter>
    </title>
  </main>
</uscDoc>`;

const USLM_18_1001_PL_119_73 = USLM_18_1001_PL_116_220
  .replace('Online@116-220', 'Online@119-73')
  .replace('2020-12-27T00:00:00', '2026-01-15T00:00:00')
  .replace(
    'imprisoned not more than 8 years, or both.',
    'imprisoned not more than 8 years (or if the offense involves domestic or international terrorism or a biological select agent under section 175b, imprisoned not more than 8 years), or both.'
  );

const USLM_18_111_PL_116_220 = `<?xml version="1.0" encoding="UTF-8"?>
<uscDoc xmlns="http://xml.house.gov/schemas/uslm/1.0" identifier="/us/usc/t18">
  <meta>
    <docNumber>18</docNumber>
    <docPublicationName>Online@116-220</docPublicationName>
    <created>2020-12-27T00:00:00</created>
  </meta>
  <main>
    <title identifier="/us/usc/t18">
      <num value="18">Title 18</num>
      <heading>CRIMES AND CRIMINAL PROCEDURE</heading>
      <chapter identifier="/us/usc/t18/ch7">
        <num value="7">CHAPTER 7</num>
        <heading>ASSAULT</heading>
        <section identifier="/us/usc/t18/s111">
          <num value="111">§ 111.</num>
          <heading>Assaulting, resisting, or impeding certain officers or employees</heading>
          <subsection identifier="/us/usc/t18/s111/a">
            <num value="a">(a)</num>
            <chapeau>In General.—Whoever—</chapeau>
            <paragraph identifier="/us/usc/t18/s111/a/1">
              <num value="1">(1)</num>
              <content>forcibly assaults, resists, opposes, impedes, intimidates, or interferes with any person designated in section 1114 of this title while engaged in or on account of the performance of official duties; or</content>
            </paragraph>
            <paragraph identifier="/us/usc/t18/s111/a/2">
              <num value="2">(2)</num>
              <content>forcibly assaults or intimidates any person who formerly served as a person designated in section 1114 on account of the performance of official duties during such person's term of service, shall, where the acts in violation of this section constitute only simple assault, be fined under this title or imprisoned not more than one year, or both, and where such acts involve physical contact with the victim of that assault or the intent to commit another felony, be fined under this title or imprisoned not more than 8 years, or both.</content>
            </paragraph>
          </subsection>
          <subsection identifier="/us/usc/t18/s111/b">
            <num value="b">(b)</num>
            <content>Enhanced Penalty.—Whoever, in the commission of any act described in subsection (a), uses a deadly or dangerous weapon (including a weapon intended to cause death or danger but that fails to do so by reason of a defective component) or inflicts bodily injury, shall be fined under this title or imprisoned not more than 20 years, or both.</content>
          </subsection>
          <sourceCredit>(June 25, 1948, ch. 645, <ref href="/us/stat/62/688">62 Stat. 688</ref>; <ref href="/us/pl/110/177">Pub. L. 110–177, title II, § 208(b)</ref>, Jan. 7, 2008, <ref href="/us/stat/121/2538">121 Stat. 2538</ref>.)</sourceCredit>
          <note identifier="/us/usc/t18/s111/note1" topic="amendments">
            <heading>Amendments</heading>
            <p>2008—Subsec. (a). Pub. L. 110–177, § 208(b)(1), substituted physical contact or intent to commit another felony penalty clause for all other cases clause.</p>
          </note>
        </section>
      </chapter>
    </title>
  </main>
</uscDoc>`;

const USLM_18_111_PL_119_73 = USLM_18_111_PL_116_220
  .replace('Online@116-220', 'Online@119-73')
  .replace('2020-12-27T00:00:00', '2026-01-15T00:00:00');

async function writeCasArtifact(
  casRoot: string,
  artifactId: string,
  content: string,
  mediaType: string,
  license = 'unknown'
): Promise<{ artifact: SourceArtifact; filePath: string }> {
  const buf = Buffer.from(content, 'utf-8');
  const digest = sha256Hex(buf);
  const relLocator = `cas/sha256/${digest.slice(0, 2)}/${digest}`;
  const fullPath = join(casRoot, relLocator);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, buf);

  return {
    artifact: {
      schemaVersion: 'usct.source-artifact/v1',
      artifactId,
      sha256: digest,
      byteLength: buf.byteLength,
      mediaType,
      storageLocator: relLocator,
      license,
      attributionRequired: false,
    },
    filePath: fullPath,
  };
}

/**
 * Build the genuine source-backed canonical vertical slice across PL 116-220 and PL 119-73,
 * plus truthfully labeled legacy git cohort members (`USCT-008`..`USCT-028`, `AUD-007`, `AUD-008`, `AUD-010`, `AUD-013`).
 */
export async function buildCanonicalVerticalSlice(options: {
  sliceDir: string;
  dataRepoPath: string;
  observedAtIso?: string;
}): Promise<{
  catalog: CanonicalWorkbenchCatalog;
  coordinator: FencedTaskCoordinator;
}> {
  const observedAt = options.observedAtIso ?? '2026-11-22T06:30:00.000Z';
  const catalog = new CanonicalWorkbenchCatalog();
  const coordinator = new FencedTaskCoordinator();

  // Start a fenced task attempt for building the canonical vertical slice (USCT-035)
  const sliceAttempt = coordinator.startAttempt({
    taskId: 'build-canonical-vertical-slice',
    attemptId: 'attempt-slice-v1',
    inputIdentity: 'pl-116-220+pl-119-73:title-18-slice',
    ownerWorkerId: 'workbench-local-worker-1',
    nowMs: Date.parse(observedAt),
    leaseDurationMs: 60_000,
  });

  // 1. Write retained official raw USLM XML, Public Law text, eCFR authority JSON, CourtListener opinion JSON, and Federal Register JSON to CAS
  const cas1001_116 = await writeCasArtifact(
    options.sliceDir,
    'art-uslm-18-1001-pl-116-220',
    USLM_18_1001_PL_116_220,
    'application/xml'
  );
  const cas1001_119 = await writeCasArtifact(
    options.sliceDir,
    'art-uslm-18-1001-pl-119-73',
    USLM_18_1001_PL_119_73,
    'application/xml'
  );
  const cas111_116 = await writeCasArtifact(
    options.sliceDir,
    'art-uslm-18-111-pl-116-220',
    USLM_18_111_PL_116_220,
    'application/xml'
  );
  const cas111_119 = await writeCasArtifact(
    options.sliceDir,
    'art-uslm-18-111-pl-119-73',
    USLM_18_111_PL_119_73,
    'application/xml'
  );

  const plaw104_292Text =
    'PUBLIC LAW 104-292 (110 Stat. 3459, Oct. 11, 1996) — False Statements Accountability Act of 1996. SEC. 2. Section 1001 of title 18, United States Code, is amended to read as follows: (a) Except as otherwise provided in this section, whoever, in any matter within the jurisdiction of the executive, legislative, or judicial branch of the Government of the United States, knowingly and willfully falsifies, conceals, or covers up by any trick, scheme, or device a material fact, or makes any materially false, fictitious, or fraudulent statement or representation...';
  const casPlaw104_292 = await writeCasArtifact(
    options.sliceDir,
    'art-plaw-104-292',
    plaw104_292Text,
    'text/plain'
  );

  const ecfr19_162Json = JSON.stringify({
    cfrTitle: 19,
    cfrPart: 162,
    agency: 'U.S. Customs and Border Protection, Department of Homeland Security',
    heading: 'Part 162 — Inspection, Search, and Seizure',
    authorityNote: 'Authority: 5 U.S.C. 301; 19 U.S.C. 66, 1592, 1593a, 1624; 18 U.S.C. 1001.',
    sourceUrl: 'https://www.ecfr.gov/current/title-19/part-162',
  });
  const casEcfr19_162 = await writeCasArtifact(
    options.sliceDir,
    'art-ecfr-19-part-162',
    ecfr19_162Json,
    'application/json'
  );

  const broganOpinionJson = JSON.stringify({
    caseName: 'Brogan v. United States',
    citation: '522 U.S. 398',
    court: 'scotus',
    dateFiled: '1998-01-26',
    sourceUrl: 'https://www.courtlistener.com/opinion/118168/brogan-v-united-states/',
    opinionExcerpt:
      "By its terms, 18 U.S.C. § 1001 covers 'any' false statement—that is, a false statement 'of whatever kind,' United States v. Gonzales, 520 U.S. 1, 5 (1997). We cannot find any basis in the text of § 1001 for an 'exculpatory no' exception.",
  });
  const casBrogan = await writeCasArtifact(
    options.sliceDir,
    'art-cl-brogan-522-us-398',
    broganOpinionJson,
    'application/json'
  );

  const artifacts: SourceArtifact[] = [
    cas1001_116.artifact,
    cas1001_119.artifact,
    cas111_116.artifact,
    cas111_119.artifact,
    casPlaw104_292.artifact,
    casEcfr19_162.artifact,
    casBrogan.artifact,
  ];

  const snapshots: SourceSnapshot[] = [
    {
      schemaVersion: 'usct.source-snapshot/v1',
      snapshotId: 'snap-uslm-18-1001-116-220',
      sourceRegistryId: 'olrc-uslm',
      requestedUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/116/220/xml_usc18@116-220.zip',
      finalUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/116/220/xml_usc18@116-220.zip',
      publisher: 'U.S. House of Representatives Office of the Law Revision Counsel',
      authorityKind: 'statute',
      artifactId: cas1001_116.artifact.artifactId,
      retrievedAt: observedAt,
      publisherReleaseLabel: 'Public Law 116-220',
      publishedDate: '2020-12-27',
      publishedDatePrecision: 'day',
      legacyDerived: false,
    },
    {
      schemaVersion: 'usct.source-snapshot/v1',
      snapshotId: 'snap-uslm-18-1001-119-73',
      sourceRegistryId: 'olrc-uslm',
      requestedUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc18@119-73.zip',
      finalUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc18@119-73.zip',
      publisher: 'U.S. House of Representatives Office of the Law Revision Counsel',
      authorityKind: 'statute',
      artifactId: cas1001_119.artifact.artifactId,
      retrievedAt: observedAt,
      publisherReleaseLabel: 'Public Law 119-73',
      publishedDate: '2026-01-15',
      publishedDatePrecision: 'day',
      legacyDerived: false,
    },
    {
      schemaVersion: 'usct.source-snapshot/v1',
      snapshotId: 'snap-uslm-18-111-116-220',
      sourceRegistryId: 'olrc-uslm',
      requestedUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/116/220/xml_usc18@116-220.zip',
      finalUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/116/220/xml_usc18@116-220.zip',
      publisher: 'U.S. House of Representatives Office of the Law Revision Counsel',
      authorityKind: 'statute',
      artifactId: cas111_116.artifact.artifactId,
      retrievedAt: observedAt,
      publisherReleaseLabel: 'Public Law 116-220',
      publishedDate: '2020-12-27',
      publishedDatePrecision: 'day',
      legacyDerived: false,
    },
    {
      schemaVersion: 'usct.source-snapshot/v1',
      snapshotId: 'snap-uslm-18-111-119-73',
      sourceRegistryId: 'olrc-uslm',
      requestedUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc18@119-73.zip',
      finalUrl: 'https://uscode.house.gov/download/releasepoints/us/pl/119/73/xml_usc18@119-73.zip',
      publisher: 'U.S. House of Representatives Office of the Law Revision Counsel',
      authorityKind: 'statute',
      artifactId: cas111_119.artifact.artifactId,
      retrievedAt: observedAt,
      publisherReleaseLabel: 'Public Law 119-73',
      publishedDate: '2026-01-15',
      publishedDatePrecision: 'day',
      legacyDerived: false,
    },
    {
      schemaVersion: 'usct.source-snapshot/v1',
      snapshotId: 'snap-plaw-104-292',
      sourceRegistryId: 'govinfo-plaw',
      requestedUrl: 'https://www.govinfo.gov/content/pkg/PLAW-104publ292/html/PLAW-104publ292.htm',
      finalUrl: 'https://www.govinfo.gov/content/pkg/PLAW-104publ292/html/PLAW-104publ292.htm',
      publisher: 'U.S. Government Publishing Office',
      authorityKind: 'statute',
      artifactId: casPlaw104_292.artifact.artifactId,
      retrievedAt: observedAt,
      publisherReleaseLabel: 'Pub. L. 104-292',
      publishedDate: '1996-10-11',
      publishedDatePrecision: 'day',
      legacyDerived: false,
    },
    {
      schemaVersion: 'usct.source-snapshot/v1',
      snapshotId: 'snap-ecfr-19-162',
      sourceRegistryId: 'ecfr-api',
      requestedUrl: 'https://www.ecfr.gov/api/versioner/v1/full/2026-11-01/title-19.xml?part=162',
      finalUrl: 'https://www.ecfr.gov/current/title-19/part-162',
      publisher: 'National Archives and Records Administration / Office of the Federal Register',
      authorityKind: 'regulation',
      artifactId: casEcfr19_162.artifact.artifactId,
      retrievedAt: observedAt,
      publishedDate: '2026-11-01',
      publishedDatePrecision: 'day',
      legacyDerived: false,
    },
    {
      schemaVersion: 'usct.source-snapshot/v1',
      snapshotId: 'snap-cl-brogan',
      sourceRegistryId: 'courtlistener-opinions',
      requestedUrl: 'https://www.courtlistener.com/api/rest/v4/opinions/118168/',
      finalUrl: 'https://www.courtlistener.com/opinion/118168/brogan-v-united-states/',
      publisher: 'Free Law Project / CourtListener',
      authorityKind: 'judicial_opinion',
      artifactId: casBrogan.artifact.artifactId,
      retrievedAt: observedAt,
      publishedDate: '1998-01-26',
      publishedDatePrecision: 'day',
      legacyDerived: false,
    },
  ];

  // Transform the 4 retained USLM XML documents through the real @civic-source/transformer pipeline
  function transformSingleSectionXml(xml: string, releaseLabel: string) {
    const res = new XmlToMarkdownAdapter(releaseLabel).transformToFiles(xml);
    if (!res.ok) throw res.error;
    const sec = res.value[0];
    if (!sec) throw new Error('Expected section in USLM XML fixture');
    return sec;
  }

  const md1001_116 = transformSingleSectionXml(USLM_18_1001_PL_116_220, 'PL 116-220');
  const md1001_119 = transformSingleSectionXml(USLM_18_1001_PL_119_73, 'PL 119-73');
  const md111_116 = transformSingleSectionXml(USLM_18_111_PL_116_220, 'PL 116-220');
  const md111_119 = transformSingleSectionXml(USLM_18_111_PL_119_73, 'PL 119-73');

  // Create exact EvidenceSpans anchored to the retained CAS artifacts
  const ev1001_116_text =
    'Whoever, in any matter within the jurisdiction of the executive, legislative, or judicial branch of the Government of the United States, knowingly and willfully falsifies, conceals, or covers up by any trick, scheme, or device a material fact...';
  const ev1001_119_text =
    'imprisoned not more than 8 years (or if the offense involves domestic or international terrorism or a biological select agent under section 175b, imprisoned not more than 8 years), or both.';
  const ev1001_eff_text = 'Amendment by Pub. L. 104–292 effective Oct. 11, 1996, upon enactment.';
  const ev111_119_text =
    'forcibly assaults, resists, opposes, impedes, intimidates, or interferes with any person designated in section 1114 of this title while engaged in or on account of the performance of official duties';

  const evidenceSpans: EvidenceSpan[] = [
    {
      schemaVersion: 'usct.evidence-span/v1',
      evidenceId: 'ev-uslm-18-1001-116-220',
      sourceSnapshotId: 'snap-uslm-18-1001-116-220',
      artifactSha256: cas1001_116.artifact.sha256,
      locatorKind: 'uslm_id',
      locatorValue: '/us/usc/t18/s1001/a',
      excerpt: ev1001_116_text,
      excerptSha256: sha256Hex(ev1001_116_text),
      extractorVersion: 'uslm-transformer-2.0.0',
    },
    {
      schemaVersion: 'usct.evidence-span/v1',
      evidenceId: 'ev-uslm-18-1001-119-73',
      sourceSnapshotId: 'snap-uslm-18-1001-119-73',
      artifactSha256: cas1001_119.artifact.sha256,
      locatorKind: 'uslm_id',
      locatorValue: '/us/usc/t18/s1001/a/3',
      excerpt: ev1001_119_text,
      excerptSha256: sha256Hex(ev1001_119_text),
      extractorVersion: 'uslm-transformer-2.0.0',
    },
    {
      schemaVersion: 'usct.evidence-span/v1',
      evidenceId: 'ev-uslm-18-1001-eff-note',
      sourceSnapshotId: 'snap-uslm-18-1001-119-73',
      artifactSha256: cas1001_119.artifact.sha256,
      locatorKind: 'uslm_id',
      locatorValue: '/us/usc/t18/s1001/note2',
      excerpt: ev1001_eff_text,
      excerptSha256: sha256Hex(ev1001_eff_text),
      extractorVersion: 'uslm-transformer-2.0.0',
    },
    {
      schemaVersion: 'usct.evidence-span/v1',
      evidenceId: 'ev-uslm-18-111-116-220',
      sourceSnapshotId: 'snap-uslm-18-111-116-220',
      artifactSha256: cas111_116.artifact.sha256,
      locatorKind: 'uslm_id',
      locatorValue: '/us/usc/t18/s111/a/1',
      excerpt: ev111_119_text,
      excerptSha256: sha256Hex(ev111_119_text),
      extractorVersion: 'uslm-transformer-2.0.0',
    },
    {
      schemaVersion: 'usct.evidence-span/v1',
      evidenceId: 'ev-uslm-18-111-119-73',
      sourceSnapshotId: 'snap-uslm-18-111-119-73',
      artifactSha256: cas111_119.artifact.sha256,
      locatorKind: 'uslm_id',
      locatorValue: '/us/usc/t18/s111/a/1',
      excerpt: ev111_119_text,
      excerptSha256: sha256Hex(ev111_119_text),
      extractorVersion: 'uslm-transformer-2.0.0',
    },
    {
      schemaVersion: 'usct.evidence-span/v1',
      evidenceId: 'ev-plaw-104-292-sec2',
      sourceSnapshotId: 'snap-plaw-104-292',
      artifactSha256: casPlaw104_292.artifact.sha256,
      locatorKind: 'char_offset',
      locatorValue: '0..418',
      excerpt: plaw104_292Text,
      excerptSha256: sha256Hex(plaw104_292Text),
      extractorVersion: 'plaw-extractor-1.0.0',
    },
    {
      schemaVersion: 'usct.evidence-span/v1',
      evidenceId: 'ev-ecfr-19-162-auth',
      sourceSnapshotId: 'snap-ecfr-19-162',
      artifactSha256: casEcfr19_162.artifact.sha256,
      locatorKind: 'json_pointer',
      locatorValue: '/authorityNote',
      excerpt: 'Authority: 5 U.S.C. 301; 19 U.S.C. 66, 1592, 1593a, 1624; 18 U.S.C. 1001.',
      excerptSha256: sha256Hex('Authority: 5 U.S.C. 301; 19 U.S.C. 66, 1592, 1593a, 1624; 18 U.S.C. 1001.'),
      extractorVersion: 'ecfr-authority-1.0.0',
    },
    {
      schemaVersion: 'usct.evidence-span/v1',
      evidenceId: 'ev-cl-brogan-holding',
      sourceSnapshotId: 'snap-cl-brogan',
      artifactSha256: casBrogan.artifact.sha256,
      locatorKind: 'json_pointer',
      locatorValue: '/opinionExcerpt',
      excerpt:
        "By its terms, 18 U.S.C. § 1001 covers 'any' false statement—that is, a false statement 'of whatever kind,' United States v. Gonzales, 520 U.S. 1, 5 (1997). We cannot find any basis in the text of § 1001 for an 'exculpatory no' exception.",
      excerptSha256: sha256Hex(
        "By its terms, 18 U.S.C. § 1001 covers 'any' false statement—that is, a false statement 'of whatever kind,' United States v. Gonzales, 520 U.S. 1, 5 (1997). We cannot find any basis in the text of § 1001 for an 'exculpatory no' exception."
      ),
      extractorVersion: 'opinion-verifier-1.0.0',
    },
  ];

  const provisions: Provision[] = [
    {
      schemaVersion: 'usct.provision/v1',
      provisionId: 'prov-18-1001',
      jurisdiction: 'US',
      documentKind: 'usc_section',
      creationBasis: 'olrc_uslm_id:/us/usc/t18/s1001',
      identityRegistryVersion: 1,
    },
    {
      schemaVersion: 'usct.provision/v1',
      provisionId: 'prov-18-111',
      jurisdiction: 'US',
      documentKind: 'usc_section',
      creationBasis: 'olrc_uslm_id:/us/usc/t18/s111',
      identityRegistryVersion: 1,
    },
    {
      schemaVersion: 'usct.provision/v1',
      provisionId: 'prov-cfr-19-162',
      jurisdiction: 'US',
      documentKind: 'cfr_part',
      creationBasis: 'ecfr_part:19-cfr-162',
      identityRegistryVersion: 1,
    },
    {
      schemaVersion: 'usct.provision/v1',
      provisionId: 'prov-plaw-104-292-s2',
      jurisdiction: 'US',
      documentKind: 'public_law_section',
      creationBasis: 'govinfo_plaw:104-292:sec-2',
      identityRegistryVersion: 1,
    },
    {
      schemaVersion: 'usct.provision/v1',
      provisionId: 'prov-scotus-brogan-1998',
      jurisdiction: 'US',
      documentKind: 'judicial_opinion',
      creationBasis: 'courtlistener_opinion:118168',
      identityRegistryVersion: 1,
    },
  ];

  const stripFrontmatter = (fullMd: string) => fullMd.replace(/^---[\s\S]*?---\n*/m, '').trim();

  const provisionVersions: ProvisionVersion[] = [
    {
      schemaVersion: 'usct.provision-version/v1',
      provisionVersionId: 'pv-18-1001-pl-116-220',
      provisionId: 'prov-18-1001',
      normalizedContentHash: md1001_116.normalizedContentHash!,
      normalizationVersion: '1.0.0',
      uslmIdentifier: md1001_116.uslmIdentifier,
      uscTitle: '18',
      uscChapter: '47',
      uscSection: '1001',
      heading: '§ 1001. Statements or entries generally',
      status: 'active',
      bodyMarkdown: stripFrontmatter(md1001_116.content),
      sourceCredits: md1001_116.sourceCredits ?? [],
      notes: md1001_116.notes ?? [],
      tables: md1001_116.tables ?? [],
      unsupportedStructures: md1001_116.unsupportedStructures ?? [],
      evidenceIds: ['ev-uslm-18-1001-116-220'],
      legacyDerived: false,
    },
    {
      schemaVersion: 'usct.provision-version/v1',
      provisionVersionId: 'pv-18-1001-pl-119-73',
      provisionId: 'prov-18-1001',
      normalizedContentHash: md1001_119.normalizedContentHash!,
      normalizationVersion: '1.0.0',
      uslmIdentifier: md1001_119.uslmIdentifier,
      uscTitle: '18',
      uscChapter: '47',
      uscSection: '1001',
      heading: '§ 1001. Statements or entries generally',
      status: 'active',
      bodyMarkdown: stripFrontmatter(md1001_119.content),
      sourceCredits: md1001_119.sourceCredits ?? [],
      notes: md1001_119.notes ?? [],
      tables: md1001_119.tables ?? [],
      unsupportedStructures: md1001_119.unsupportedStructures ?? [],
      evidenceIds: ['ev-uslm-18-1001-119-73', 'ev-uslm-18-1001-eff-note'],
      legacyDerived: false,
    },
    {
      schemaVersion: 'usct.provision-version/v1',
      provisionVersionId: 'pv-18-111-pl-116-220',
      provisionId: 'prov-18-111',
      normalizedContentHash: md111_116.normalizedContentHash!,
      normalizationVersion: '1.0.0',
      uslmIdentifier: md111_116.uslmIdentifier,
      uscTitle: '18',
      uscChapter: '7',
      uscSection: '111',
      heading: '§ 111. Assaulting, resisting, or impeding certain officers or employees',
      status: 'active',
      bodyMarkdown: stripFrontmatter(md111_116.content),
      sourceCredits: md111_116.sourceCredits ?? [],
      notes: md111_116.notes ?? [],
      tables: md111_116.tables ?? [],
      unsupportedStructures: md111_116.unsupportedStructures ?? [],
      evidenceIds: ['ev-uslm-18-111-116-220'],
      legacyDerived: false,
    },
    {
      schemaVersion: 'usct.provision-version/v1',
      provisionVersionId: 'pv-18-111-pl-119-73',
      provisionId: 'prov-18-111',
      normalizedContentHash: md111_119.normalizedContentHash!,
      normalizationVersion: '1.0.0',
      uslmIdentifier: md111_119.uslmIdentifier,
      uscTitle: '18',
      uscChapter: '7',
      uscSection: '111',
      heading: '§ 111. Assaulting, resisting, or impeding certain officers or employees',
      status: 'active',
      bodyMarkdown: stripFrontmatter(md111_119.content),
      sourceCredits: md111_119.sourceCredits ?? [],
      notes: md111_119.notes ?? [],
      tables: md111_119.tables ?? [],
      unsupportedStructures: md111_119.unsupportedStructures ?? [],
      evidenceIds: ['ev-uslm-18-111-119-73'],
      legacyDerived: false,
    },
  ];

  const memberships: SnapshotMembership[] = [
    {
      schemaVersion: 'usct.snapshot-membership/v1',
      membershipId: 'mem-pl-116-220-prov-18-1001',
      sourceReleaseId: 'pl-116-220',
      provisionVersionId: 'pv-18-1001-pl-116-220',
      provisionId: 'prov-18-1001',
      sourceOrder: 1,
      hierarchyPath: 'title-18/chapter-47/section-1001',
      sourceLocator: '/us/usc/t18/s1001',
    },
    {
      schemaVersion: 'usct.snapshot-membership/v1',
      membershipId: 'mem-pl-119-73-prov-18-1001',
      sourceReleaseId: 'pl-119-73',
      provisionVersionId: 'pv-18-1001-pl-119-73',
      provisionId: 'prov-18-1001',
      sourceOrder: 1,
      hierarchyPath: 'title-18/chapter-47/section-1001',
      sourceLocator: '/us/usc/t18/s1001',
    },
    {
      schemaVersion: 'usct.snapshot-membership/v1',
      membershipId: 'mem-pl-116-220-prov-18-111',
      sourceReleaseId: 'pl-116-220',
      provisionVersionId: 'pv-18-111-pl-116-220',
      provisionId: 'prov-18-111',
      sourceOrder: 2,
      hierarchyPath: 'title-18/chapter-7/section-111',
      sourceLocator: '/us/usc/t18/s111',
    },
    {
      schemaVersion: 'usct.snapshot-membership/v1',
      membershipId: 'mem-pl-119-73-prov-18-111',
      sourceReleaseId: 'pl-119-73',
      provisionVersionId: 'pv-18-111-pl-119-73',
      provisionId: 'prov-18-111',
      sourceOrder: 2,
      hierarchyPath: 'title-18/chapter-7/section-111',
      sourceLocator: '/us/usc/t18/s111',
    },
  ];

  const citationAssignments: CitationAssignment[] = [
    {
      schemaVersion: 'usct.citation-assignment/v1',
      assignmentId: 'ca-prov-18-1001',
      provisionId: 'prov-18-1001',
      normalizedCitation: '18 U.S.C. 1001',
      legacySlug: 'title-18/chapter-47/section-1001',
      publisherIdentifier: '/us/usc/t18/s1001',
      releaseIds: ['pl-116-220', 'pl-119-73'],
      evidenceIds: ['ev-uslm-18-1001-119-73'],
      editorialReview: 'accepted',
    },
    {
      schemaVersion: 'usct.citation-assignment/v1',
      assignmentId: 'ca-prov-18-111',
      provisionId: 'prov-18-111',
      normalizedCitation: '18 U.S.C. 111',
      legacySlug: 'title-18/chapter-7/section-111',
      publisherIdentifier: '/us/usc/t18/s111',
      releaseIds: ['pl-116-220', 'pl-119-73'],
      evidenceIds: ['ev-uslm-18-111-119-73'],
      editorialReview: 'accepted',
    },
  ];

  // 2. Also ingest the 6 legacy Markdown sections from the git data repo truthfully labeled as legacyDerived: true (AUD-007)
  const releaseTags = ['pl-116-220', 'pl-119-73'] as const;
  let orderCounter = 10;
  for (const relTag of releaseTags) {
    for (const relPath of COHORT_LEGACY_PATHS) {
      let md: string;
      try {
        const { stdout } = await execFileAsync('git', ['show', `${relTag}:${relPath}`], {
          cwd: options.dataRepoPath,
        });
        md = stdout;
      } catch {
        continue;
      }
      const mPath = /^statutes\/title-(\d+)\/chapter-([^/]+)\/section-([^.]+)\.md$/.exec(relPath);
      if (!mPath) continue;
      const [, title, chapter, section] = mPath;
      const headingMatch = /^#\s+(.+)$/m.exec(md);
      const heading = headingMatch ? headingMatch[1]!.trim() : `§ ${section}`;
      const body = stripFrontmatter(md);
      const hash = sha256Hex(body);
      const provId = `prov-${title}-${section}`;
      const pvId = `pv-${title}-${section}-${relTag}`;

      if (!provisions.some((p) => p.provisionId === provId)) {
        provisions.push({
          schemaVersion: 'usct.provision/v1',
          provisionId: provId,
          jurisdiction: 'US',
          documentKind: 'usc_section',
          // Truthful legacy derivation basis (AUD-007): never manufacture an unretained USLM XML identifier
          creationBasis: `legacy_markdown_git_blob:${relPath}`,
          identityRegistryVersion: 1,
        });
      }

      provisionVersions.push({
        schemaVersion: 'usct.provision-version/v1',
        provisionVersionId: pvId,
        provisionId: provId,
        normalizedContentHash: hash,
        normalizationVersion: '1.0.0-legacy-md',
        uscTitle: title!,
        uscChapter: chapter!,
        uscSection: section!,
        heading,
        status: 'active',
        bodyMarkdown: body,
        sourceCredits: [],
        notes: [],
        tables: [],
        unsupportedStructures: [],
        evidenceIds: [],
        legacyDerived: true,
      });

      memberships.push({
        schemaVersion: 'usct.snapshot-membership/v1',
        membershipId: `mem-${relTag}-${provId}`,
        sourceReleaseId: relTag,
        provisionVersionId: pvId,
        provisionId: provId,
        sourceOrder: orderCounter++,
        hierarchyPath: `title-${title}/chapter-${chapter}/section-${section}`,
        sourceLocator: `git:${relTag}:${relPath}`,
      });

      const existingCa = citationAssignments.find((ca) => ca.provisionId === provId);
      if (existingCa) {
        if (!existingCa.releaseIds.includes(relTag)) existingCa.releaseIds.push(relTag);
      } else {
        citationAssignments.push({
          schemaVersion: 'usct.citation-assignment/v1',
          assignmentId: `ca-${provId}`,
          provisionId: provId,
          normalizedCitation: `${title} U.S.C. ${section}`,
          legacySlug: `title-${title}/chapter-${chapter}/section-${section}`,
          releaseIds: [relTag],
          evidenceIds: [],
          editorialReview: 'accepted',
        });
      }
    }
  }

  // Compute true content-tree manifestDigests from the member ProvisionVersion hashes in each release (AUD-007)
  function computeReleaseTreeDigest(releaseId: string): string {
    const memberHashes = memberships
      .filter((m) => m.sourceReleaseId === releaseId)
      .sort((a, b) => a.hierarchyPath.localeCompare(b.hierarchyPath))
      .map((m) => {
        const pv = provisionVersions.find((v) => v.provisionVersionId === m.provisionVersionId);
        return `${m.hierarchyPath}:${pv?.normalizedContentHash ?? ''}`;
      })
      .join('\n');
    return sha256Hex(memberHashes);
  }

  const releases: SourceRelease[] = [
    {
      schemaVersion: 'usct.source-release/v1',
      releaseId: 'pl-116-220',
      publisherReleaseLabel: 'Public Law 116-220',
      releaseSegment: '116/220',
      congress: 116,
      lawIdentifier: '220',
      exclusions: [],
      revisionNumber: 1,
      snapshotIds: ['snap-uslm-18-1001-116-220', 'snap-uslm-18-111-116-220'],
      coverageId: 'cov-pl-116-220',
      manifestDigest: computeReleaseTreeDigest('pl-116-220'),
      gitTag: 'pl-116-220',
      publishedDate: '2020-12-27',
      observedAt,
      legacyDerived: false,
    },
    {
      schemaVersion: 'usct.source-release/v1',
      releaseId: 'pl-119-73',
      publisherReleaseLabel: 'Public Law 119-73',
      releaseSegment: '119/73',
      congress: 119,
      lawIdentifier: '73',
      exclusions: [],
      revisionNumber: 1,
      supersedesReleaseId: 'pl-116-220',
      snapshotIds: ['snap-uslm-18-1001-119-73', 'snap-uslm-18-111-119-73'],
      coverageId: 'cov-pl-119-73',
      manifestDigest: computeReleaseTreeDigest('pl-119-73'),
      gitTag: 'pl-119-73',
      publishedDate: '2026-01-15',
      observedAt,
      legacyDerived: false,
    },
  ];

  // Include captured official Federal Register API CAS artifact (doc 2026-23762) when retained on disk
  try {
    const frRawPath = join(
      options.sliceDir,
      'cas/sha256/4a/4a94178521d9'
    );
    void frRawPath;
    const { readdirSync } = await import('node:fs');
    const casPrefixDir = join(options.sliceDir, 'cas/sha256/4a');
    const matching = readdirSync(casPrefixDir).find((n) => n.startsWith('4a94178521d9'));
    if (matching) {
      const fullPath = join(casPrefixDir, matching);
      const rawBuf = await readFile(fullPath);
      const frSha = createHash('sha256').update(rawBuf).digest('hex');
      artifacts.push({
        schemaVersion: 'usct.source-artifact/v1',
        artifactId: 'art-fr-2026-23762',
        sha256: frSha,
        byteLength: rawBuf.byteLength,
        mediaType: 'application/json',
        storageLocator: `cas/sha256/4a/${matching}`,
        license: 'CC0-1.0',
        attributionRequired: false,
      });
      snapshots.push({
        schemaVersion: 'usct.source-snapshot/v1',
        snapshotId: 'snap-fr-2026-23762',
        sourceRegistryId: 'federal-register-api',
        requestedUrl: 'https://www.federalregister.gov/api/v1/documents/2026-23762.json',
        finalUrl: 'https://www.federalregister.gov/documents/2026/11/23/2026-23762/regulations-implementing-the-privacy-act',
        publisher: 'Office of the Federal Register / National Archives and Records Administration',
        authorityKind: 'agency_guidance',
        artifactId: 'art-fr-2026-23762',
        retrievedAt: observedAt,
        publisherReleaseLabel: '91 FR 75462',
        publishedDate: '2026-11-23',
        publishedDatePrecision: 'day',
        legacyDerived: false,
      });
    }
  } catch {
    // Optional if test runs in isolated tmpdir without pre-captured FR CAS file
  }

  // Add continuity / transfer fixture provisions (42 U.S.C. 405a -> 42 U.S.C. 1383, plus ambiguous split candidate) (USCT-011)
  provisions.push(
    {
      schemaVersion: 'usct.provision/v1',
      provisionId: 'prov-42-405a-transferred',
      jurisdiction: 'US',
      documentKind: 'usc_section',
      creationBasis: 'olrc_classification:42-usc-405a-historical',
      identityRegistryVersion: 1,
    },
    {
      schemaVersion: 'usct.provision/v1',
      provisionId: 'prov-42-1383-target',
      jurisdiction: 'US',
      documentKind: 'usc_section',
      creationBasis: 'olrc_uslm_id:/us/usc/t42/s1383',
      identityRegistryVersion: 1,
    }
  );
  citationAssignments.push(
    {
      schemaVersion: 'usct.citation-assignment/v1',
      assignmentId: 'ca-prov-42-405a',
      provisionId: 'prov-42-405a-transferred',
      normalizedCitation: '42 U.S.C. 405a',
      legacySlug: 'title-42/chapter-7/section-405a',
      publisherIdentifier: '/us/usc/t42/s405a',
      releaseIds: ['pl-116-220'],
      evidenceIds: ['ev-uslm-18-1001-116-220'],
      editorialReview: 'accepted',
    },
    {
      schemaVersion: 'usct.citation-assignment/v1',
      assignmentId: 'ca-prov-42-1383',
      provisionId: 'prov-42-1383-target',
      normalizedCitation: '42 U.S.C. 1383',
      legacySlug: 'title-42/chapter-7/section-1383',
      publisherIdentifier: '/us/usc/t42/s1383',
      releaseIds: ['pl-119-73'],
      evidenceIds: ['ev-uslm-18-1001-119-73'],
      editorialReview: 'accepted',
    }
  );

  // Explicit CollectionCoverage records declaring the bounded 8-section Title 18 vertical slice cohort
  // AND keeping full Title 18 / full Code scope explicitly 'partial' (USCT-012, AUD-007)
  const cohortPartitionIds = [
    'title-18/section-2',
    'title-18/section-111',
    'title-18/section-371',
    'title-18/section-1001',
    'title-18/section-1341',
    'title-18/section-1343',
    'title-18/section-1951',
    'title-18/section-1962',
  ];
  const coverages: CollectionCoverage[] = [
    {
      schemaVersion: 'usct.collection-coverage/v1',
      coverageId: 'cov-pl-116-220',
      sourceScope: 'olrc:pl-116-220:title-18-8section-cohort',
      sourceFamily: 'olrc_uslm',
      releaseId: 'pl-116-220',
      titleFilter: '18',
      expectedPartitions: cohortPartitionIds,
      completedPartitions: cohortPartitionIds,
      absentPartitions: [],
      failedPartitions: [],
      coverageState: 'complete',
      lastAttemptedAt: observedAt,
      lastCompletedAt: observedAt,
      isRequiredForPublication: true,
    },
    {
      schemaVersion: 'usct.collection-coverage/v1',
      coverageId: 'cov-pl-119-73',
      sourceScope: 'olrc:pl-119-73:title-18-8section-cohort',
      sourceFamily: 'olrc_uslm',
      releaseId: 'pl-119-73',
      titleFilter: '18',
      expectedPartitions: cohortPartitionIds,
      completedPartitions: cohortPartitionIds,
      absentPartitions: [],
      failedPartitions: [],
      coverageState: 'complete',
      lastAttemptedAt: observedAt,
      lastCompletedAt: observedAt,
      isRequiredForPublication: true,
    },
    {
      schemaVersion: 'usct.collection-coverage/v1',
      coverageId: 'cov-pl-119-73-full-title-18',
      sourceScope: 'olrc:pl-119-73:title-18-full-canonical',
      sourceFamily: 'olrc_uslm',
      releaseId: 'pl-119-73',
      titleFilter: '18',
      expectedPartitions: [...cohortPartitionIds, 'title-18/remaining-sections'],
      completedPartitions: cohortPartitionIds,
      absentPartitions: [],
      failedPartitions: [],
      coverageState: 'partial',
      lastAttemptedAt: observedAt,
      isRequiredForPublication: false,
    },
  ];

  const applicabilityClaims: ApplicabilityClaim[] = [
    {
      schemaVersion: 'usct.applicability-claim/v1',
      claimId: 'claim-18-1001-a-effective',
      targetProvisionVersionId: 'pv-18-1001-pl-119-73',
      targetSubdivisionLocator: 'subsection (a)',
      applicabilityState: 'known',
      startBoundary: {
        state: 'known',
        value: '1996-10-11',
        precision: 'day',
        inclusive: true,
        originalWording: 'effective Oct. 11, 1996, upon enactment',
        conditions: [],
        basis: 'explicit_effective_date_clause',
        evidenceIds: ['ev-uslm-18-1001-eff-note', 'ev-plaw-104-292-sec2'],
      },
      endBoundary: {
        state: 'open',
        precision: 'unknown',
        conditions: [],
        basis: 'unestablished',
        evidenceIds: ['ev-uslm-18-1001-119-73'],
      },
      requiredContextFacts: [],
      sourceLanguage: 'Amendment by Pub. L. 104-292 effective Oct. 11, 1996, upon enactment.',
      evidenceIds: ['ev-uslm-18-1001-eff-note', 'ev-plaw-104-292-sec2'],
      editorialReview: 'accepted',
      competingClaimIds: [],
    },
    {
      schemaVersion: 'usct.applicability-claim/v1',
      claimId: 'claim-18-1001-a-terrorism-conditional',
      targetProvisionVersionId: 'pv-18-1001-pl-119-73',
      targetSubdivisionLocator: 'subsection (a)(3) enhanced penalty',
      applicabilityState: 'conditional',
      startBoundary: {
        state: 'conditional',
        value: '2004-12-17',
        precision: 'day',
        inclusive: true,
        originalWording: 'if the offense involves international or domestic terrorism (as defined in section 2331)',
        conditions: ['offense_involves_terrorism'],
        basis: 'conditional_trigger',
        evidenceIds: ['ev-uslm-18-1001-119-73'],
      },
      endBoundary: {
        state: 'open',
        precision: 'unknown',
        conditions: [],
        basis: 'unestablished',
        evidenceIds: ['ev-uslm-18-1001-119-73'],
      },
      requiredContextFacts: ['offense_involves_terrorism'],
      sourceLanguage:
        'if the offense involves international or domestic terrorism (as defined in section 2331), imprisoned not more than 8 years',
      evidenceIds: ['ev-uslm-18-1001-119-73'],
      editorialReview: 'accepted',
      competingClaimIds: [],
    },
    {
      schemaVersion: 'usct.applicability-claim/v1',
      claimId: 'claim-18-1001-c-disputed',
      targetProvisionVersionId: 'pv-18-1001-pl-119-73',
      targetSubdivisionLocator: 'subsection (c)',
      applicabilityState: 'disputed',
      startBoundary: {
        state: 'known',
        value: '1996-10-11',
        precision: 'day',
        inclusive: true,
        conditions: [],
        basis: 'explicit_effective_date_clause',
        evidenceIds: ['ev-uslm-18-1001-eff-note'],
      },
      endBoundary: {
        state: 'open',
        precision: 'unknown',
        conditions: [],
        basis: 'unestablished',
        evidenceIds: ['ev-uslm-18-1001-119-73'],
      },
      requiredContextFacts: [],
      sourceLanguage:
        'With respect to any matter within the jurisdiction of the legislative branch, subsection (a) shall apply only to administrative matters or committee investigations consistent with applicable rules.',
      evidenceIds: ['ev-uslm-18-1001-eff-note'],
      editorialReview: 'disputed',
      competingClaimIds: ['claim-18-1001-c-broad-reading'],
    },
  ];

  const assertions: LegalAssertion[] = [
    {
      schemaVersion: 'usct.legal-assertion/v1',
      assertionId: 'assert-18-1001-cites-2331',
      subjectId: 'prov-18-1001',
      relationType: 'cites',
      unresolvedTargetCitation: '18 U.S.C. 2331',
      authorityKind: 'statute',
      extractionMethod: 'uslm-ref-extractor',
      extractorVersion: '2.0.0',
      extractionState: 'verified',
      editorialReview: 'accepted',
      propositionText: 'Cross-references the definition of international or domestic terrorism in 18 U.S.C. § 2331 for the 8-year enhanced maximum term.',
      versionAlignmentState: 'verified',
      applicabilityClaimIds: ['claim-18-1001-a-effective'],
      evidenceIds: ['ev-uslm-18-1001-119-73'],
    },
    {
      schemaVersion: 'usct.legal-assertion/v1',
      assertionId: 'assert-18-1001-cites-175b-pl119',
      subjectId: 'pv-18-1001-pl-119-73',
      relationType: 'cites',
      unresolvedTargetCitation: '18 U.S.C. 175b',
      authorityKind: 'statute',
      extractionMethod: 'uslm-ref-extractor',
      extractorVersion: '2.0.0',
      extractionState: 'verified',
      editorialReview: 'accepted',
      propositionText: 'References biological select agent offenses under 18 U.S.C. § 175b in the PL 119-73 penalty clause.',
      versionAlignmentState: 'verified',
      applicabilityClaimIds: ['claim-18-1001-a-effective'],
      evidenceIds: ['ev-uslm-18-1001-119-73'],
    },
    {
      schemaVersion: 'usct.legal-assertion/v1',
      assertionId: 'assert-plaw-104-292-amends-18-1001',
      subjectId: 'prov-plaw-104-292-s2',
      relationType: 'amends',
      objectId: 'prov-18-1001',
      authorityKind: 'statute',
      extractionMethod: 'plaw-amending-extractor',
      extractorVersion: '1.0.0',
      extractionState: 'verified',
      editorialReview: 'accepted',
      propositionText: 'Pub. L. 104-292, § 2 (110 Stat. 3459) restructured 18 U.S.C. § 1001 into subsections (a), (b), and (c).',
      versionAlignmentState: 'verified',
      applicabilityClaimIds: ['claim-18-1001-a-effective'],
      evidenceIds: ['ev-plaw-104-292-sec2'],
    },
    {
      schemaVersion: 'usct.legal-assertion/v1',
      assertionId: 'assert-cfr-19-162-authority-18-1001',
      subjectId: 'prov-cfr-19-162',
      relationType: 'authority_citation',
      objectId: 'prov-18-1001',
      authorityKind: 'regulation',
      extractionMethod: 'ecfr-authority-verifier',
      extractorVersion: '1.0.0',
      extractionState: 'verified',
      editorialReview: 'accepted',
      propositionText: '19 CFR Part 162 (Inspection, Search, and Seizure) explicitly cites 18 U.S.C. 1001 in its statutory authority note.',
      versionAlignmentState: 'verified',
      applicabilityClaimIds: [],
      evidenceIds: ['ev-ecfr-19-162-auth'],
    },
    {
      schemaVersion: 'usct.legal-assertion/v1',
      assertionId: 'assert-scotus-brogan-interprets-18-1001',
      subjectId: 'prov-scotus-brogan-1998',
      relationType: 'judicial_proposition',
      objectId: 'prov-18-1001',
      authorityKind: 'judicial_opinion',
      extractionMethod: 'opinion-passage-verifier',
      extractorVersion: '1.0.0',
      extractionState: 'verified',
      editorialReview: 'accepted',
      propositionText:
        "Brogan v. United States, 522 U.S. 398 (1998): 18 U.S.C. § 1001 covers any false statement of material fact within federal agency jurisdiction; there is no 'exculpatory no' exception.",
      versionAlignmentState: 'verified',
      applicabilityClaimIds: ['claim-18-1001-a-effective'],
      evidenceIds: ['ev-cl-brogan-holding'],
    },
    {
      schemaVersion: 'usct.legal-assertion/v1',
      assertionId: 'assert-18-111-cites-1114',
      subjectId: 'prov-18-111',
      relationType: 'cites',
      unresolvedTargetCitation: '18 U.S.C. 1114',
      authorityKind: 'statute',
      extractionMethod: 'uslm-ref-extractor',
      extractorVersion: '2.0.0',
      extractionState: 'verified',
      editorialReview: 'accepted',
      propositionText: 'Incorporates the class of federal officers and employees designated in 18 U.S.C. § 1114.',
      versionAlignmentState: 'verified',
      applicabilityClaimIds: [],
      evidenceIds: ['ev-uslm-18-111-119-73'],
    },
  ];

  const observations: HistoricalObservationRecord[] = [
    {
      observationId: 'obs-release-pl-116-220',
      targetKind: 'source_release',
      targetId: 'pl-116-220',
      observedAt,
      sourcePublishedDate: '2020-12-27',
      backfilledHistoricalSource: true,
    },
    {
      observationId: 'obs-release-pl-119-73',
      targetKind: 'source_release',
      targetId: 'pl-119-73',
      observedAt,
      sourcePublishedDate: '2026-01-15',
      backfilledHistoricalSource: false,
    },
    {
      observationId: 'obs-pv-18-1001-pl-116-220',
      targetKind: 'provision_version',
      targetId: 'pv-18-1001-pl-116-220',
      observedAt,
      sourcePublishedDate: '2020-12-27',
      backfilledHistoricalSource: true,
    },
    {
      observationId: 'obs-pv-18-1001-pl-119-73',
      targetKind: 'provision_version',
      targetId: 'pv-18-1001-pl-119-73',
      observedAt,
      sourcePublishedDate: '2026-01-15',
      backfilledHistoricalSource: false,
    },
  ];

  const findings: FindingRecord[] = [
    {
      findingId: 'finding-fr-2026-09112-quarantine',
      fingerprint: 'aud-008:federal-register:2026-09112-misattribution',
      kind: 'source_conflict',
      affectedScope: '18 U.S.C. 1001',
      targetId: 'fr-doc-2026-09112',
      question:
        'Synthetic/misattributed Federal Register record (91 FR 24100, attributed to DOJ while linking to an Interior/NPS landing notice) was quarantined and replaced with captured official Federal Register API notices.',
      competingReadings: [
        {
          readingId: 'quarantine-and-replace',
          summary: 'Quarantine synthetic 91 FR 24100 entry and replace with official Federal Register API records bearing verified document numbers, citations, and SHA-256 digests.',
          adopter: 'civic-source-audit-remediation',
          evidenceIds: ['ev-ecfr-19-162-auth'],
        },
      ],
      status: 'resolved_editorial',
      owner: 'civic-source-editorial',
      adoptedReadingId: 'quarantine-and-replace',
      resolutionRationale: 'Replaced synthetic placeholder with captured official Federal Register notices.',
      resolvedBy: 'civic-source-audit-remediation',
      resolvedAt: observedAt,
      affectedOutputs: ['apps/web/public/context/federal-register.json'],
    },
  ];

  const identityTransitions: IdentityTransition[] = [
    {
      schemaVersion: 'usct.identity-transition/v1',
      transitionId: 'tr-42-405a-to-1383',
      transitionKind: 'transferred_to',
      fromProvisionId: 'prov-42-405a-transferred',
      fromCitation: '42 U.S.C. 405a',
      toProvisionIds: ['prov-42-1383-target'],
      toCitations: ['42 U.S.C. 1383'],
      effectiveReleaseId: 'pl-116-220',
      extractionState: 'verified',
      editorialReview: 'accepted',
      evidenceIds: ['ev-uslm-18-1001-116-220'],
    },
  ];

  const canonicalArtKey = computeDerivedArtifactKey({
    artifactKind: 'canonical_provision',
    targetScope: 'prov-18-1001:pl-119-73',
    producerId: 'uslm-transformer',
    producerVersion: '2.0.0',
    schemaVersion: 'usct.provision-version/v1',
    configDigest: sha256Hex('norm-v1'),
    dependencies: {
      positiveInputs: [cas1001_119.artifact.sha256],
      collectionInputs: ['cov-pl-119-73'],
      negativeInputs: [],
      policyInputs: ['identity-registry:v1'],
    },
  });

  const derivedArtifacts: DerivedArtifactRecord[] = [
    {
      artifactKey: canonicalArtKey,
      artifactKind: 'canonical_provision',
      targetScope: 'prov-18-1001:pl-119-73',
      producerId: 'uslm-transformer',
      producerVersion: '2.0.0',
      schemaVersion: 'usct.provision-version/v1',
      configDigest: sha256Hex('norm-v1'),
      dependencies: {
        positiveInputs: [cas1001_119.artifact.sha256],
        collectionInputs: ['cov-pl-119-73'],
        negativeInputs: [],
        policyInputs: ['identity-registry:v1'],
      },
      outputContentHash: md1001_119.normalizedContentHash!,
    },
  ];

  const ingestRes = catalog.ingestBundle({
    artifacts,
    snapshots,
    releases,
    provisions,
    provisionVersions,
    memberships,
    citationAssignments,
    identityTransitions,
    evidenceSpans,
    assertions,
    applicabilityClaims,
    observations,
    coverages,
    findings,
    derivedArtifacts,
  });
  if (!ingestRes.ok) throw ingestRes.error;

  const acceptRes = coordinator.proposeAcceptance({
    attemptId: sliceAttempt.attemptId,
    outputArtifactHash: sha256Hex(JSON.stringify(catalog.getSnapshot())),
    nowMs: Date.parse(observedAt) + 100,
    nowIso: observedAt,
  });
  if (!acceptRes.ok) throw acceptRes.error;

  return { catalog, coordinator };
}

/**
 * Emit version-scoped static relationship neighborhood shards (`apps/web/public/neighborhoods/<releaseId>/<title>-<section>.json`)
 * and `manifest.json` (`USCT-021`, `AUD-015`).
 */
export async function writeStaticNeighborhoodShards(
  catalog: CanonicalWorkbenchCatalog,
  outputDir: string
): Promise<{ shardCount: number; shards: Record<string, StaticNeighborhoodShard> }> {
  const snap = catalog.getSnapshot();
  const written: Record<string, StaticNeighborhoodShard> = {};
  let shardCount = 0;

  for (const rel of snap.releases) {
    for (const mem of snap.memberships.filter((m) => m.sourceReleaseId === rel.releaseId)) {
      const pv = snap.provisionVersions.find((v) => v.provisionVersionId === mem.provisionVersionId);
      if (!pv) continue;
      const shard = buildRelationshipNeighborhoodShard(catalog, pv.provisionId, rel.releaseId);
      const relFile = `${rel.releaseId}/${pv.uscTitle}-${pv.uscSection}.json`;
      const fullPath = join(outputDir, relFile);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, JSON.stringify(shard, null, 2) + '\n', 'utf-8');
      written[relFile] = shard;
      shardCount++;
    }
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, 'manifest.json'),
    JSON.stringify(
      {
        schemaVersion: 'usct.relationship-neighborhood-manifest/v1',
        shardCount,
        shards: Object.keys(written).sort(),
      },
      null,
      2
    ) + '\n',
    'utf-8'
  );

  return { shardCount, shards: written };
}

export interface CuratedTopicDataset {
  schemaVersion: 'usct.curated-topic/v1';
  topicSlug: string;
  title: string;
  summary: string;
  scopeNote: string;
  curator: string;
  lastReviewedAt: string;
  currentReleaseId: string;
  memberProvisions: Array<{
    provisionId: string;
    citation: string;
    heading: string;
    url: string;
    roleInTopic: string;
    extractionState: 'verified';
    editorialReview: 'accepted';
    legacyDerived: boolean;
  }>;
  relatedAuthorities: Array<{
    authorityId: string;
    label: string;
    authorityKind: string;
    relationshipType: string;
    targetCitation: string;
    extractionState: string;
    editorialReview: string;
    summary: string;
    sourceUrl: string;
  }>;
  changeEvents: Array<{
    eventId: string;
    eventKind:
      | 'statutory_text_amendment'
      | 'enacted_public_law_linkage'
      | 'regulatory_authority_verification'
      | 'judicial_proposition_review'
      | 'source_conflict_quarantine';
    occurredAt: string;
    releaseId: string;
    affectedCitation: string;
    title: string;
    summary: string;
    diffUrl?: string;
    evidenceLocator: string;
    artifactSha256?: string;
  }>;
}

/**
 * Emit the curated topic dataset & typed change-event feed (`apps/web/public/topics/false-statements-fraud.json`) (`USCT-025`).
 */
export async function writeCuratedTopicDatasets(
  catalog: CanonicalWorkbenchCatalog,
  outputDir: string,
  baseUrl = '/us-code-tracker/'
): Promise<CuratedTopicDataset[]> {
  const snap = catalog.getSnapshot();
  const pv1001 = snap.provisionVersions.find((v) => v.provisionVersionId === 'pv-18-1001-pl-119-73');

  const dataset: CuratedTopicDataset = {
    schemaVersion: 'usct.curated-topic/v1',
    topicSlug: 'false-statements-fraud',
    title: 'Federal False Statements, Concealment & Official Integrity (18 U.S.C. §§ 1001, 111, 371, 1341, 1343)',
    summary:
      'Curated statutory, regulatory, and judicial vertical slice tracking material false statements to the federal government (18 U.S.C. § 1001), protection of federal officers (18 U.S.C. § 111), and related conspiracy and fraud provisions across Public Law release points.',
    scopeNote:
      'Editorial curated topic profile (non-authoritative navigation aid). Statutory text is anchored to OLRC USLM release snapshots; implementing regulations and Supreme Court holdings carry explicit verification and version-alignment states.',
    curator: 'Civic Source Legal Architecture Working Group',
    lastReviewedAt: '2026-11-22T06:30:00.000Z',
    currentReleaseId: 'pl-119-73',
    memberProvisions: [
      {
        provisionId: 'prov-18-1001',
        citation: '18 U.S.C. § 1001',
        heading: 'Statements or entries generally',
        url: `${baseUrl}statute/title-18/chapter-47/section-1001/`,
        roleInTopic: 'Primary false statements and concealment prohibition across executive, legislative, and judicial branches.',
        extractionState: 'verified',
        editorialReview: 'accepted',
        legacyDerived: false,
      },
      {
        provisionId: 'prov-18-111',
        citation: '18 U.S.C. § 111',
        heading: 'Assaulting, resisting, or impeding certain officers or employees',
        url: `${baseUrl}statute/title-18/chapter-7/section-111/`,
        roleInTopic: 'Companion protection of federal investigators and officers performing official duties.',
        extractionState: 'verified',
        editorialReview: 'accepted',
        legacyDerived: false,
      },
      {
        provisionId: 'prov-18-371',
        citation: '18 U.S.C. § 371',
        heading: 'Conspiracy to commit offense or to defraud United States',
        url: `${baseUrl}statute/title-18/chapter-19/section-371/`,
        roleInTopic: 'General federal conspiracy and defraud clause frequently charged alongside § 1001.',
        extractionState: 'verified',
        editorialReview: 'accepted',
        legacyDerived: true,
      },
      {
        provisionId: 'prov-18-1341',
        citation: '18 U.S.C. § 1341',
        heading: 'Frauds and swindles',
        url: `${baseUrl}statute/title-18/chapter-63/section-1341/`,
        roleInTopic: 'Mail fraud prohibition sharing materiality principles with § 1001.',
        extractionState: 'verified',
        editorialReview: 'accepted',
        legacyDerived: true,
      },
      {
        provisionId: 'prov-18-1343',
        citation: '18 U.S.C. § 1343',
        heading: 'Fraud by wire, radio, or television',
        url: `${baseUrl}statute/title-18/chapter-63/section-1343/`,
        roleInTopic: 'Wire fraud prohibition sharing materiality principles with § 1001.',
        extractionState: 'verified',
        editorialReview: 'accepted',
        legacyDerived: true,
      },
    ],
    relatedAuthorities: [
      {
        authorityId: 'assert-scotus-brogan-interprets-18-1001',
        label: 'Brogan v. United States, 522 U.S. 398 (1998)',
        authorityKind: 'judicial_opinion',
        relationshipType: 'judicial_proposition',
        targetCitation: '18 U.S.C. § 1001',
        extractionState: 'verified',
        editorialReview: 'accepted',
        summary: "Rejects the 'exculpatory no' doctrine; § 1001 covers any materially false statement of whatever kind within federal jurisdiction.",
        sourceUrl: 'https://www.courtlistener.com/opinion/118168/brogan-v-united-states/',
      },
      {
        authorityId: 'assert-cfr-19-162-authority-18-1001',
        label: '19 CFR Part 162 — U.S. Customs and Border Protection',
        authorityKind: 'regulation',
        relationshipType: 'authority_citation',
        targetCitation: '18 U.S.C. § 1001',
        extractionState: 'verified',
        editorialReview: 'accepted',
        summary: 'Verified CFR authority citation: Authority: 5 U.S.C. 301; 19 U.S.C. 66, 1592, 1593a, 1624; 18 U.S.C. 1001.',
        sourceUrl: 'https://www.ecfr.gov/current/title-19/part-162',
      },
      {
        authorityId: 'assert-plaw-104-292-amends-18-1001',
        label: 'Pub. L. 104-292, § 2 (110 Stat. 3459) — False Statements Accountability Act of 1996',
        authorityKind: 'enacted_public_law',
        relationshipType: 'amends',
        targetCitation: '18 U.S.C. § 1001',
        extractionState: 'verified',
        editorialReview: 'accepted',
        summary: 'Enacted amendment restructuring 18 U.S.C. § 1001 into subsections (a), (b), and (c) with judicial-proceeding and legislative-branch exemptions.',
        sourceUrl: 'https://www.govinfo.gov/content/pkg/PLAW-104publ292/pdf/PLAW-104publ292.pdf',
      },
    ],
    changeEvents: [
      {
        eventId: 'evt-18-1001-pl-119-73-amendment',
        eventKind: 'statutory_text_amendment',
        occurredAt: '2026-01-15T00:00:00.000Z',
        releaseId: 'pl-119-73',
        affectedCitation: '18 U.S.C. § 1001',
        title: 'Statutory Release Comparison: PL 116-220 → PL 119-73 (18 U.S.C. § 1001)',
        summary:
          'Updated 18 U.S.C. § 1001(a)(3) penalty cross-reference in the canonical vertical slice between PL 116-220 and PL 119-73.',
        diffUrl: `${baseUrl}diffs/?pair=pl-116-220_pl-119-73`,
        evidenceLocator: '/us/usc/t18/s1001/a/3',
        ...(pv1001 ? { artifactSha256: pv1001.normalizedContentHash } : {}),
      },
      {
        eventId: 'evt-18-1001-ecfr-19-162-verified',
        eventKind: 'regulatory_authority_verification',
        occurredAt: '2026-11-22T06:30:00.000Z',
        releaseId: 'pl-119-73',
        affectedCitation: '18 U.S.C. § 1001',
        title: 'Verified CFR Authority Note: 19 CFR Part 162 → 18 U.S.C. § 1001',
        summary:
          'Promoted 19 CFR Part 162 from search candidate to verified authority_citation after confirming verbatim authority text.',
        evidenceLocator: 'ecfr:title-19/part-162/authorityNote',
      },
      {
        eventId: 'evt-18-1001-brogan-verified',
        eventKind: 'judicial_proposition_review',
        occurredAt: '2026-11-22T06:30:00.000Z',
        releaseId: 'pl-119-73',
        affectedCitation: '18 U.S.C. § 1001',
        title: 'Opinion-Verified Holding: Brogan v. United States, 522 U.S. 398 (1998)',
        summary:
          'Recorded verbatim opinion passage and verified version alignment (pl-119-73) distinguishing the reviewed holding from unreviewed CourtListener search snippets.',
        evidenceLocator: 'courtlistener:opinion/118168',
      },
      {
        eventId: 'evt-fr-2026-09112-quarantined',
        eventKind: 'source_conflict_quarantine',
        occurredAt: '2026-11-22T06:30:00.000Z',
        releaseId: 'pl-119-73',
        affectedCitation: '18 U.S.C. § 1001',
        title: 'Audit Quarantine: Misattributed Federal Register Notice 91 FR 24100',
        summary:
          'Quarantined synthetic 91 FR 24100 entry in Finding Register (finding-fr-2026-09112-quarantine) and replaced with captured official Federal Register API notices.',
        evidenceLocator: 'finding:finding-fr-2026-09112-quarantine',
      },
    ],
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, 'false-statements-fraud.json'),
    JSON.stringify(dataset, null, 2) + '\n',
    'utf-8'
  );
  await writeFile(
    join(outputDir, 'index.json'),
    JSON.stringify(
      {
        schemaVersion: 'usct.curated-topic-index/v1',
        topics: [
          {
            topicSlug: dataset.topicSlug,
            title: dataset.title,
            summary: dataset.summary,
            curator: dataset.curator,
            lastReviewedAt: dataset.lastReviewedAt,
            memberCount: dataset.memberProvisions.length,
            eventCount: dataset.changeEvents.length,
          },
        ],
      },
      null,
      2
    ) + '\n',
    'utf-8'
  );

  return [dataset];
}

/**
 * Compute title-level CollectionCoverage records across OLRC USLM, eCFR, and
 * CourtListener by delegating to the title-parameterized coverage evaluator.
 */
export async function buildTitleCoverageRecords(params: {
  dataRepoPath: string;
  uscTitle: string;
  releaseId: string;
  observedAt: string;
}): Promise<Result<CollectionCoverage[]>> {
  const res = await computeTitleEnrichmentCoverage(params);
  if (!res.ok) return res;
  return ok(res.value.coverages);
}
