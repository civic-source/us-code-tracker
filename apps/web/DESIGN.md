# OpenDesign Brand & System Specification: US Code Tracker

## 1. Design Philosophy

US Code Tracker is an open-source, civic-grade legal workbench designed for lawyers, legal scholars, journalists, policy analysts, and citizens seeking verifiable statutory law and legislative diffs.

Our core design principles align with USWDS 3.x and OpenDesign standards:
* **Legibility & Reading Endurance Over Novelty:** Legal text is dense and technical. Typography, contrast ratios, and line measures are calibrated to reduce cognitive load and visual fatigue over hours of continuous reading.
* **Authoritative Civic Aesthetic:** Neutral, dignified, high-contrast, and functional. Avoid ornamental or commercial aesthetics; convey democratic openness, provenance, and legal accuracy.
* **Semantic Token Purity:** UI elements consume semantic surfaces (`--surface-canvas`, `--surface-raised`, `--surface-sunken`) and state tokens. Never hardcode arbitrary hex values or uncalibrated Tailwind dark-mode overrides in templates.
* **Hierarchical Wayfinding:** The statutory hierarchy (Title -> Chapter -> Subchapter -> Section -> Subsection -> Paragraph -> Subparagraph) must be visually clear at every layer using hanging vertical guide rails.
* **Immediate Legal Signals:** Shepard's/KeyCite validity signals (active law, narrowed holding, unconstitutional holding, repealed, reserved) must be immediately visible without obscuring statutory prose.

---

## 2. Typography Contract

| Role | Font Family | Weights | Intended Use |
| :--- | :--- | :--- | :--- |
| **System / UI / Wayfinding** | Public Sans (`sans-serif`) | 400, 500, 600, 700 | Navigation, headings, badges, toolbars, buttons, metadata |
| **Statutory Body Prose** | Source Serif 4 / Charter / Georgia (`serif`) | 400, 400i, 600 | Reading statute sections, subsections, and legislative text |
| **Code / Diffs / Citations** | JetBrains Mono (`monospace`) | 400, 600 | Statutory section keys, word redlines, commit SHAs, citation tags |

### Reading Measure & Scale Constraints
* **Standard Reading Column:** Max `76ch` (ideal measure for legal drafting).
* **Wide Reading Column:** Max `96ch` (reader toolbar toggle).
* **Fluid Line Height:** `1.65` on statutory prose; `1.4` on navigation items.

---

## 3. Semantic Token Architecture

All themes (Light and Dark) are strictly governed by CSS custom properties defined in `apps/web/src/styles/tokens.css`:

### Light Mode (`:root`)
```css
/* Surfaces */
--surface-canvas: #FAF9F6;       /* USWDS warm parchment */
--surface-raised: #FFFFFF;       /* Cards, modals, dropdowns */
--surface-sunken: #F0EDE8;       /* Sidenav, summary box, code panels */
--surface-overlay: #FFFFFF;

/* Borders */
--border-default: #D1CEC8;
--border-subtle: #E5E3DF;
--border-strong: #71767A;

/* Typography */
--text-primary: #112F4E;         /* USWDS blue-warm-80 */
--text-secondary: #3D4551;       /* Gray-warm-70 */
--text-muted: #565C65;           /* Gray-cool-50 */

/* Legal Signals */
--legal-valid: #0F6E56;          /* Mint-70v (Active law) */
--legal-caution: #8B6914;        /* Gold-60 (Narrowed holding) */
--legal-invalid: #B50909;        /* Crimson-60 (Unconstitutional / Struck down) */
--legal-action: #005EA2;         /* State blue */
```

### Dark Mode (`.dark`)
```css
/* Surfaces */
--surface-canvas: #091420;       /* Deep civic navy */
--surface-raised: #0E1E2E;       /* Card surface */
--surface-sunken: #07131F;       /* Sidenav and summary panel */
--surface-overlay: #13273D;

/* Borders */
--border-default: #1E3A5A;
--border-subtle: #152B42;
--border-strong: #3A5F85;

/* Typography */
--text-primary: #E8F0F8;
--text-secondary: #B0C4DE;
--text-muted: #7E97B2;

/* Legal Signals */
--legal-valid: #70E8B1;
--legal-caution: #FFBE2E;
--legal-invalid: #FCA5A5;
--legal-action: #73B3E7;
```

---

## 4. Layout Architecture: 3-Pane Legal Workbench

1. **Left Wayfinding Rail (w-64 / w-72):**
   - Title TOC list with live filtering and status badges.
   - Sidenav hierarchy: active chapter and section selection with persistent scroll position.
2. **Center Statutory Reader (Fluid, flex-1, max-w-4xl):**
   - Sticky subsection subhead showing current section and 1-click pinpoint citation copy.
   - Prose body with vertical hanging guide rails on subsections: `(a)`, `(1)`, `(A)`, `(i)`.
   - Hover permalink anchors with instantaneous URL hash updates.
3. **Right Inspector Rail (w-80 / w-96, collapsible):**
   - Unified multi-tab inspector:
     - **Precedents:** Landmark court holdings with Shepard's/KeyCite validity signals.
     - **Regulations:** Implementing CFR rules from eCFR Parallel Table of Authorities.
     - **Rulemaking:** Live Federal Register notices and public comment deadlines.
     - **Diffs:** Word-level redline intraline diffs across enacted revisions.
