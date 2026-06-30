## [0.6.0](https://github.com/civic-source/us-code-tracker/compare/v0.5.7...v0.6.0) (2026-05-13)


### Features

* add RSS feed for recent US Code updates ([#132](https://github.com/civic-source/us-code-tracker/issues/132)) ([#134](https://github.com/civic-source/us-code-tracker/issues/134)) ([50fb615](https://github.com/civic-source/us-code-tracker/commit/50fb615438fea5743eef83b79946fe969986528b))
* **ci:** migrate release flow to release-please ([#185](https://github.com/civic-source/us-code-tracker/issues/185)) ([a35f589](https://github.com/civic-source/us-code-tracker/commit/a35f589a358c453dff5b3f328d4b8aa5d0d76e26))
* cross-chapter navigation at section boundaries ([#130](https://github.com/civic-source/us-code-tracker/issues/130)) ([#133](https://github.com/civic-source/us-code-tracker/issues/133)) ([c9c2511](https://github.com/civic-source/us-code-tracker/commit/c9c2511b04425f45a38d39b1f50165a9f16198a4))
* **fetcher:** add CLI entry point and observability metrics ([#151](https://github.com/civic-source/us-code-tracker/issues/151), [#152](https://github.com/civic-source/us-code-tracker/issues/152)) ([#157](https://github.com/civic-source/us-code-tracker/issues/157)) ([7c2575e](https://github.com/civic-source/us-code-tracker/commit/7c2575eff8c699770b2217d678f6c95858ea13b0))
* **fetcher:** add historical release point enumeration and UX fixes ([#154](https://github.com/civic-source/us-code-tracker/issues/154)) ([0868c9b](https://github.com/civic-source/us-code-tracker/commit/0868c9b7f34d58acf0d9e5d96b6fbe72de89895a))
* Public Sans font + homepage hero redesign ([#137](https://github.com/civic-source/us-code-tracker/issues/137)) ([a62334d](https://github.com/civic-source/us-code-tracker/commit/a62334d5079ab24ac3961632f3adebad5ef1e178))
* QA fixes batch — copy cite, 404, Schema.org, keyboard nav, empty state ([#129](https://github.com/civic-source/us-code-tracker/issues/129)) ([7e2a834](https://github.com/civic-source/us-code-tracker/commit/7e2a8344991f6460e546f9a912379f3e8a9d42c4))
* subsection anchor links with :target highlighting ([#131](https://github.com/civic-source/us-code-tracker/issues/131)) ([#135](https://github.com/civic-source/us-code-tracker/issues/135)) ([3607e15](https://github.com/civic-source/us-code-tracker/commit/3607e15d463ea8812d9cbce8e7703c081cc36ad8))
* **transformer:** add 'status' frontmatter field for section state ([#90](https://github.com/civic-source/us-code-tracker/issues/90)) ([#91](https://github.com/civic-source/us-code-tracker/issues/91)) ([686e1de](https://github.com/civic-source/us-code-tracker/commit/686e1deaa3eb764a8a5fda5fdd25ea7a91662595))
* upgrade to Astro 6, Zod 4, @astrojs/svelte 8 ([#61](https://github.com/civic-source/us-code-tracker/issues/61), [#85](https://github.com/civic-source/us-code-tracker/issues/85)) ([#113](https://github.com/civic-source/us-code-tracker/issues/113)) ([3a1caa5](https://github.com/civic-source/us-code-tracker/commit/3a1caa515e8b96be44d87ef12c5f9b472dd9f043))
* Version timeline redesign + dependency fixes + import observability ([#62](https://github.com/civic-source/us-code-tracker/issues/62)) ([d6fff07](https://github.com/civic-source/us-code-tracker/commit/d6fff074ad2bb4350b92ccf60461ff480f4a275e))
* **web:** add auto-generated article table of contents ([#71](https://github.com/civic-source/us-code-tracker/issues/71)) ([#74](https://github.com/civic-source/us-code-tracker/issues/74)) ([06476b1](https://github.com/civic-source/us-code-tracker/commit/06476b1c0d2a2b53ac8c652ee31493bd9ea54079))
* **web:** add desktop focus mode for distraction-free reading ([#109](https://github.com/civic-source/us-code-tracker/issues/109)) ([#112](https://github.com/civic-source/us-code-tracker/issues/112)) ([8b86bab](https://github.com/civic-source/us-code-tracker/commit/8b86babc4394e2f7c96a2c259214998f6f873a03))
* **web:** add historical versions count and sync frequency to landing page ([#79](https://github.com/civic-source/us-code-tracker/issues/79)) ([#84](https://github.com/civic-source/us-code-tracker/issues/84)) ([a96ce75](https://github.com/civic-source/us-code-tracker/commit/a96ce75f6224c70ca303e94faf1d83748dcfabaa))
* **web:** add in-title section search filter to expandable TOC ([#92](https://github.com/civic-source/us-code-tracker/issues/92)) ([#94](https://github.com/civic-source/us-code-tracker/issues/94)) ([85da5fa](https://github.com/civic-source/us-code-tracker/commit/85da5fa7e35a313f2a0d96a195d62f238f5e4c26))
* **web:** add per-section change indicators to title TOC ([#95](https://github.com/civic-source/us-code-tracker/issues/95)) ([#97](https://github.com/civic-source/us-code-tracker/issues/97)) ([551d748](https://github.com/civic-source/us-code-tracker/commit/551d7484b275b31214fc88db9da4e921b983fd2c))
* **web:** add Recently Changed Sections to landing page ([#78](https://github.com/civic-source/us-code-tracker/issues/78)) ([#96](https://github.com/civic-source/us-code-tracker/issues/96)) ([561414f](https://github.com/civic-source/us-code-tracker/commit/561414f565449148e0a526eadb263f2a636ec1e8))
* **web:** add URL hash deep-linking for title TOC chapters ([#92](https://github.com/civic-source/us-code-tracker/issues/92)) ([#98](https://github.com/civic-source/us-code-tracker/issues/98)) ([6315b40](https://github.com/civic-source/us-code-tracker/commit/6315b40c4c2e8bc10a8a891be1211342f4a9bd2e))
* **web:** adopt Gov.uk design patterns — typography + print button ([#122](https://github.com/civic-source/us-code-tracker/issues/122)) ([ad946ee](https://github.com/civic-source/us-code-tracker/commit/ad946eefed7f0f2a2ac35d2a9cb9dda70a9d131d))
* **web:** auto-link cross-references in statute text ([#121](https://github.com/civic-source/us-code-tracker/issues/121)) ([#125](https://github.com/civic-source/us-code-tracker/issues/125)) ([e94d629](https://github.com/civic-source/us-code-tracker/commit/e94d629a6faf3e481fa23391437cd3ba515c01b0))
* **web:** chapter pages show full statute text inline ([#99](https://github.com/civic-source/us-code-tracker/issues/99)) ([#100](https://github.com/civic-source/us-code-tracker/issues/100)) ([9162c59](https://github.com/civic-source/us-code-tracker/commit/9162c59328eceac01d6bc4bfc0a134206d944298))
* **web:** desktop/mobile reading experience optimization ([#109](https://github.com/civic-source/us-code-tracker/issues/109)) ([#110](https://github.com/civic-source/us-code-tracker/issues/110)) ([29b2263](https://github.com/civic-source/us-code-tracker/commit/29b2263b9320905b981c396c6d9f2722ae950f3e))
* **web:** persistent 3-column layout at 2xl viewport ([#148](https://github.com/civic-source/us-code-tracker/issues/148)) ([#156](https://github.com/civic-source/us-code-tracker/issues/156)) ([bb7b0aa](https://github.com/civic-source/us-code-tracker/commit/bb7b0aa515863a5fc2d1ce19c9850b48785638cf))
* **web:** readability improvements — line-height tuning + reading time ([#119](https://github.com/civic-source/us-code-tracker/issues/119)) ([#120](https://github.com/civic-source/us-code-tracker/issues/120)) ([d174bdc](https://github.com/civic-source/us-code-tracker/commit/d174bdc0304c4943d8ea0f62e37a755748a14337))
* **web:** redesign title page as expandable full-title TOC ([#92](https://github.com/civic-source/us-code-tracker/issues/92)) ([#93](https://github.com/civic-source/us-code-tracker/issues/93)) ([f83b679](https://github.com/civic-source/us-code-tracker/commit/f83b6791d2d73fefc57853e5c5de24eddf2600c1))
* **web:** replace PrecedentDrawer with inline case law display ([#118](https://github.com/civic-source/us-code-tracker/issues/118)) ([5125d19](https://github.com/civic-source/us-code-tracker/commit/5125d195103ecf30726ce558e6fe32eccf7f332f))
* **web:** USWDS-inspired civic palette + nav titles + breadcrumb polish ([#128](https://github.com/civic-source/us-code-tracker/issues/128)) ([9fd167e](https://github.com/civic-source/us-code-tracker/commit/9fd167ee735ea03fc3816eeb9e65f08704b6b038))
* wire PrecedentDrawer to real case law data from CourtListener ([#43](https://github.com/civic-source/us-code-tracker/issues/43)) ([#116](https://github.com/civic-source/us-code-tracker/issues/116)) ([e270f21](https://github.com/civic-source/us-code-tracker/commit/e270f2169ee7444a4d55ee86dac2257c4b19b4fa))


### Bug Fixes

* **a11y:** add status icons and text labels for colorblind accessibility ([#70](https://github.com/civic-source/us-code-tracker/issues/70)) ([#75](https://github.com/civic-source/us-code-tracker/issues/75)) ([198fa84](https://github.com/civic-source/us-code-tracker/commit/198fa845fa4006c0bd928166ca461ed8a56e1122))
* **a11y:** address Lighthouse audit findings — contrast, touch targets, labels ([#123](https://github.com/civic-source/us-code-tracker/issues/123)) ([362874d](https://github.com/civic-source/us-code-tracker/commit/362874dc9cbf9facc85f9125f7a47c33aa4c71c8))
* **a11y:** fix dark mode contrast on chapter page sticky headers ([#141](https://github.com/civic-source/us-code-tracker/issues/141)) ([8ec9b28](https://github.com/civic-source/us-code-tracker/commit/8ec9b28b316c819217141017012453c3981d5fb4))
* **a11y:** improve chapter description text contrast to meet WCAG AA ([#136](https://github.com/civic-source/us-code-tracker/issues/136)) ([4f6a0d2](https://github.com/civic-source/us-code-tracker/commit/4f6a0d2ab023ee6ec8e96d3040af72b937f8a651))
* Accessibility, typography, and error logging improvements ([#73](https://github.com/civic-source/us-code-tracker/issues/73)) ([9bcb60f](https://github.com/civic-source/us-code-tracker/commit/9bcb60f74a19862fc358fb2c999fa181dcb0211b))
* add explicit read-all permissions to CI workflow (Scorecard finding) ([9ad9914](https://github.com/civic-source/us-code-tracker/commit/9ad9914206361f256fbeadc00432950613f1bcb6))
* address CodeQL real-bug findings (6 surgical changes) ([#170](https://github.com/civic-source/us-code-tracker/issues/170)) ([5395114](https://github.com/civic-source/us-code-tracker/commit/53951146493bca58a2364459129ed1d9304d67a7))
* **ci:** fetch PR base SHA before commitlint validation ([#86](https://github.com/civic-source/us-code-tracker/issues/86)) ([b9adc61](https://github.com/civic-source/us-code-tracker/commit/b9adc611e7fd118bbb4471c658d4b7f43343fda0))
* **ci:** make commitlint non-blocking with continue-on-error ([#140](https://github.com/civic-source/us-code-tracker/issues/140)) ([f076ff7](https://github.com/civic-source/us-code-tracker/commit/f076ff7c917835ee2226992f86feab84e300ead4))
* **ci:** tighten token permissions + add CodeQL SAST workflow ([#166](https://github.com/civic-source/us-code-tracker/issues/166)) ([be07a2e](https://github.com/civic-source/us-code-tracker/commit/be07a2ecb479a108183501680ed109de1b5292ff))
* **ci:** use --force on git fetch --tags in deploy workflow ([#104](https://github.com/civic-source/us-code-tracker/issues/104)) ([619459c](https://github.com/civic-source/us-code-tracker/commit/619459c7d3925b153b2765c62c2cbb1d91b2e720))
* **ci:** use submodule commit SHA for diff cache key ([#81](https://github.com/civic-source/us-code-tracker/issues/81)) ([eb90f92](https://github.com/civic-source/us-code-tracker/commit/eb90f92d9465c6579dee638a653da222b9c0e0da))
* **deps:** patch 7 open Dependabot security alerts ([#165](https://github.com/civic-source/us-code-tracker/issues/165)) ([692a0bc](https://github.com/civic-source/us-code-tracker/commit/692a0bce8a16eabed3320181385dec475348ac24))
* **mobile:** critical mobile fixes — overflow, indentation, sticky headers ([#142](https://github.com/civic-source/us-code-tracker/issues/142)) ([af5ef47](https://github.com/civic-source/us-code-tracker/commit/af5ef4719d12c3bd893f0817516ad1057d74f04f))
* **mobile:** heading sizes, TOC scroll, prev/next truncation ([#143](https://github.com/civic-source/us-code-tracker/issues/143)) ([39d4ee6](https://github.com/civic-source/us-code-tracker/commit/39d4ee6aa51c8f48eeae7249e16f5051829b2829))
* **mobile:** responsiveness for chapter pages and statutory text ([#138](https://github.com/civic-source/us-code-tracker/issues/138)) ([a6607b8](https://github.com/civic-source/us-code-tracker/commit/a6607b8b4605d3d9572bde21885073c33706eedf))
* pin Scorecard workflow actions to SHA (Scorecard finding) ([4da6669](https://github.com/civic-source/us-code-tracker/commit/4da666938e13d180bbe9f2dcd5ef1ffa4abce8c9))
* pin Tailwind CSS to 4.1.18 to fix ESM chunk resolution ([#153](https://github.com/civic-source/us-code-tracker/issues/153)) ([#155](https://github.com/civic-source/us-code-tracker/issues/155)) ([4fff6e8](https://github.com/civic-source/us-code-tracker/commit/4fff6e83e27c56c4231c49e8528528e864db2c94))
* **scorecard:** pin codeql-action/upload-sarif to commit SHA ([#164](https://github.com/civic-source/us-code-tracker/issues/164)) ([21d22d0](https://github.com/civic-source/us-code-tracker/commit/21d22d06820bd0e748e50b99bd5f7a0ee5f0baa4))
* Security hardening + OG meta tags + CSP ([#67](https://github.com/civic-source/us-code-tracker/issues/67)) ([a30f0d7](https://github.com/civic-source/us-code-tracker/commit/a30f0d77234a8fe8067d3223bb45c03df4abb63f))
* **test:** add status field to generateFrontmatter test fixture ([#101](https://github.com/civic-source/us-code-tracker/issues/101)) ([9a8a781](https://github.com/civic-source/us-code-tracker/commit/9a8a781d9190f52464735e5f72ef1b3218d8be53))
* update Scorecard actions to latest SHA (checkout v6.0.2, scorecard v2.4.3, upload-artifact v7) ([137f8d8](https://github.com/civic-source/us-code-tracker/commit/137f8d89ac05391a9a0c070103f495a176c84b16))
* **web:** add chapter topic hints and section title tooltips ([#102](https://github.com/civic-source/us-code-tracker/issues/102)) ([#103](https://github.com/civic-source/us-code-tracker/issues/103)) ([effa60e](https://github.com/civic-source/us-code-tracker/commit/effa60efff3b69f467056ead1549409a891263ea))
* **web:** add diff generation to deploy workflow + fix base URL in DiffViewer ([b73a69d](https://github.com/civic-source/us-code-tracker/commit/b73a69db78547d98b925cd390b044996653c09ab))
* **web:** add floating Exit Focus button visible in focus mode ([#114](https://github.com/civic-source/us-code-tracker/issues/114)) ([e834073](https://github.com/civic-source/us-code-tracker/commit/e834073c22f54830add35aca34d7cdc936bd39d2))
* **web:** add Renumbered badge to browse listings, cap Change History at 10 ([#89](https://github.com/civic-source/us-code-tracker/issues/89)) ([0f59aae](https://github.com/civic-source/us-code-tracker/commit/0f59aaef752ffd7354bcbce2115e72bff55c75d7)), closes [#88](https://github.com/civic-source/us-code-tracker/issues/88)
* **web:** hide duplicate h1 heading in chapter inline content ([#105](https://github.com/civic-source/us-code-tracker/issues/105)) ([dce2445](https://github.com/civic-source/us-code-tracker/commit/dce24457f515fda6b7d268acd51797747eb3b83c))
* **web:** move all template computation to frontmatter to fix esbuild ([#106](https://github.com/civic-source/us-code-tracker/issues/106)) ([828df70](https://github.com/civic-source/us-code-tracker/commit/828df706eda05a21273ad7e668cf00a708aba2db))
* **web:** multipage design review — 4 fixes from consensus vote ([#111](https://github.com/civic-source/us-code-tracker/issues/111)) ([404f7ae](https://github.com/civic-source/us-code-tracker/commit/404f7aeba308da064fe867afca8b7c489dc11eb4))
* **web:** replace regex HTML sanitization with sanitize-html ([#171](https://github.com/civic-source/us-code-tracker/issues/171)) ([23297e9](https://github.com/civic-source/us-code-tracker/commit/23297e9446d04adf0b7c3da913fb8f0562759c37))
* **web:** resolve 404s on Recently Changed Sections links ([#108](https://github.com/civic-source/us-code-tracker/issues/108)) ([ba8451e](https://github.com/civic-source/us-code-tracker/commit/ba8451ea123dbc34cf91d8f7e5488b4195502073))

## [0.6.1](https://github.com/civic-source/us-code-tracker/compare/v0.6.0...v0.6.1) (2026-06-30)


### Bug Fixes

* **annotator,types:** bound untrusted strings flowing into the YAML sidecar ([#232](https://github.com/civic-source/us-code-tracker/issues/232)) ([#243](https://github.com/civic-source/us-code-tracker/issues/243)) ([66b7e3b](https://github.com/civic-source/us-code-tracker/commit/66b7e3b13a268015ead01da577d24a723c93dbdb))
* **annotator:** correct rate-limiter to 5000/hr and drop redundant bucket ([#230](https://github.com/civic-source/us-code-tracker/issues/230)) ([#248](https://github.com/civic-source/us-code-tracker/issues/248)) ([8d21c41](https://github.com/civic-source/us-code-tracker/commit/8d21c412d4c53d8553a3715b22c698b84ff53226))
* **annotator:** escape all string fields in sidecar YAML serialization ([#224](https://github.com/civic-source/us-code-tracker/issues/224)) ([765340c](https://github.com/civic-source/us-code-tracker/commit/765340c4e1760c3ee159bc539455adf6477c30a1))
* **annotator:** pin sourceUrl to CourtListener origin ([#223](https://github.com/civic-source/us-code-tracker/issues/223), finding 1) ([#225](https://github.com/civic-source/us-code-tracker/issues/225)) ([1b99e32](https://github.com/civic-source/us-code-tracker/commit/1b99e32760cb399f1f5c5e414c573496a1161039))
* **annotator:** validate CourtListener result elements before use ([#237](https://github.com/civic-source/us-code-tracker/issues/237)) ([#244](https://github.com/civic-source/us-code-tracker/issues/244)) ([b9dbaa2](https://github.com/civic-source/us-code-tracker/commit/b9dbaa2558841d4f5b7b0a8b4fc3cbb9ca8976b7))
* **ci:** decode+unzip OLRC archive before transforming in sync ([#204](https://github.com/civic-source/us-code-tracker/issues/204)) ([e7712cd](https://github.com/civic-source/us-code-tracker/commit/e7712cdde5bced13e205c66b0d4d916be730b095)), closes [#199](https://github.com/civic-source/us-code-tracker/issues/199)
* **ci:** make @civic-source/* resolvable for sync-law.yml inline scripts ([#198](https://github.com/civic-source/us-code-tracker/issues/198)) ([c3e1938](https://github.com/civic-source/us-code-tracker/commit/c3e1938003ead365fc77043e31e5e765fc340027)), closes [#194](https://github.com/civic-source/us-code-tracker/issues/194)
* **ci:** pass OLRC-derived values via env to prevent shell injection in sync-law ([#229](https://github.com/civic-source/us-code-tracker/issues/229)) ([#240](https://github.com/civic-source/us-code-tracker/issues/240)) ([bfe2a25](https://github.com/civic-source/us-code-tracker/commit/bfe2a25090bafb0a50eb9a28f70e13c4969fa661))
* **fetcher:** decouple decompressed-size cap from download cap ([#226](https://github.com/civic-source/us-code-tracker/issues/226)) ([#227](https://github.com/civic-source/us-code-tracker/issues/227)) ([1d21fb3](https://github.com/civic-source/us-code-tracker/commit/1d21fb3385ee9304553b2fff5a0356ee16fc7fbc))
* **fetcher:** guard HashStore.load against non-object stores ([#238](https://github.com/civic-source/us-code-tracker/issues/238)) ([#247](https://github.com/civic-source/us-code-tracker/issues/247)) ([75c727d](https://github.com/civic-source/us-code-tracker/commit/75c727d2c6544b6ac78a10eb41be98c22a535093))
* **fetcher:** harden against SSRF and oversized downloads ([#205](https://github.com/civic-source/us-code-tracker/issues/205)) ([f4fbd50](https://github.com/civic-source/us-code-tracker/commit/f4fbd50018c97f3b0317ce988d124b3cdaf5975c)), closes [#201](https://github.com/civic-source/us-code-tracker/issues/201)
* **fetcher:** harden ZIP extraction, title padding, and HTML body cap ([#220](https://github.com/civic-source/us-code-tracker/issues/220)) ([cea57b7](https://github.com/civic-source/us-code-tracker/commit/cea57b724b348a11c99dfed0ba677de040bf3a68))
* **fetcher:** parse redesigned OLRC page (relative releasepoints hrefs) ([#217](https://github.com/civic-source/us-code-tracker/issues/217)) ([c0f523f](https://github.com/civic-source/us-code-tracker/commit/c0f523ff9f702f12479a81f49c787cadcfed9b04)), closes [#216](https://github.com/civic-source/us-code-tracker/issues/216)
* **fetcher:** stream-cap fetchXml body instead of buffering the whole ZIP ([#231](https://github.com/civic-source/us-code-tracker/issues/231)) ([#245](https://github.com/civic-source/us-code-tracker/issues/245)) ([c450e50](https://github.com/civic-source/us-code-tracker/commit/c450e5087be06fc7fbbafcf3cecf7e1a6c89fb9e))
* **scripts:** distinguish absent vs failed title fetches; gate resume cursor ([#236](https://github.com/civic-source/us-code-tracker/issues/236)) ([#246](https://github.com/civic-source/us-code-tracker/issues/246)) ([73c87c9](https://github.com/civic-source/us-code-tracker/commit/73c87c93a829d704cf0d97fbbc9a7f5be7d59133))
* **scripts:** drop shell from generate-diffs git calls + anchor tag validation ([#235](https://github.com/civic-source/us-code-tracker/issues/235)) ([#241](https://github.com/civic-source/us-code-tracker/issues/241)) ([6d30b77](https://github.com/civic-source/us-code-tracker/commit/6d30b7718d405cc317107b7d3960f678ce1473de))
* **shared:** harden fetchWithRetry (backoff cap, 429, Retry-After, aborts) ([#212](https://github.com/civic-source/us-code-tracker/issues/212)) ([6e632a1](https://github.com/civic-source/us-code-tracker/commit/6e632a1a87b9c8c6fc8ddf75d1fee324f792ab6c))
* **shared:** serialize TokenBucket.waitAndConsume to prevent over-issue ([#213](https://github.com/civic-source/us-code-tracker/issues/213)) ([7f92425](https://github.com/civic-source/us-code-tracker/commit/7f924251c8e999d56cc4d58e9c90bb9f0421af2e)), closes [#209](https://github.com/civic-source/us-code-tracker/issues/209)
* **transformer:** escape &lt; and &gt; in extracted text (XSS defense-in-depth) ([#207](https://github.com/civic-source/us-code-tracker/issues/207)) ([301e598](https://github.com/civic-source/us-code-tracker/commit/301e5983ca821fe5a5c0fa2c2ecc52983c5af5a6))
* **transformer:** escape YAML frontmatter strings (closes [#221](https://github.com/civic-source/us-code-tracker/issues/221)) ([#222](https://github.com/civic-source/us-code-tracker/issues/222)) ([e1f7d40](https://github.com/civic-source/us-code-tracker/commit/e1f7d402ab18ef32d810738370d16e2b224a0bdd))
* **types:** constrain rendered/fetched URLs to http(s) scheme ([#211](https://github.com/civic-source/us-code-tracker/issues/211)) ([63d4375](https://github.com/civic-source/us-code-tracker/commit/63d4375c7f6941650e28df615745b46330284a16)), closes [#210](https://github.com/civic-source/us-code-tracker/issues/210)
* uncited-case dedupe collapse and appendix-title path collision ([#206](https://github.com/civic-source/us-code-tracker/issues/206)) ([c7193dd](https://github.com/civic-source/us-code-tracker/commit/c7193dd14e82f21ea986f2ff5872956fcc009628)), closes [#202](https://github.com/civic-source/us-code-tracker/issues/202)
* **web:** escape JSON-LD to prevent &lt;/script&gt; breakout XSS ([#203](https://github.com/civic-source/us-code-tracker/issues/203)) ([0af8e74](https://github.com/civic-source/us-code-tracker/commit/0af8e74c7427ca48bbb694228478195950e0888c))
* **web:** sanitize rendered statute Markdown with rehype-sanitize ([#200](https://github.com/civic-source/us-code-tracker/issues/200)) ([#215](https://github.com/civic-source/us-code-tracker/issues/215)) ([2fb5ef8](https://github.com/civic-source/us-code-tracker/commit/2fb5ef8472f6eb1361a4429e1de346d040c492dc))

## [0.5.7](https://github.com/civic-source/us-code-tracker/compare/v0.5.6...v0.5.7) (2026-03-29)

### Features

* pre-computed static diffs for zero-API version comparison ([#55](https://github.com/civic-source/us-code-tracker/issues/55)) ([46b5dd1](https://github.com/civic-source/us-code-tracker/commit/46b5dd18f6a970be3aa0c780af8ba751d23f6452))

### Bug Fixes

* **scripts:** filter diffs to body-only changes, exclude frontmatter noise ([#55](https://github.com/civic-source/us-code-tracker/issues/55)) ([ea56f15](https://github.com/civic-source/us-code-tracker/commit/ea56f151ead06b62b61997dfb31b51e2f0a4d3a3))
* **web:** DiffViewer — eliminate N+1 API calls, clean markdown display ([577aed3](https://github.com/civic-source/us-code-tracker/commit/577aed3d40c4ab387e47fecd06312877a54684b7))
* **web:** resolve 5 DiffViewer cosmetic issues ([#50](https://github.com/civic-source/us-code-tracker/issues/50)-[#54](https://github.com/civic-source/us-code-tracker/issues/54)) ([35042bc](https://github.com/civic-source/us-code-tracker/commit/35042bcff02821c0f847d24464b4d757c0c368d2)), closes [#51](https://github.com/civic-source/us-code-tracker/issues/51) [#52](https://github.com/civic-source/us-code-tracker/issues/52) [#53](https://github.com/civic-source/us-code-tracker/issues/53)

## [0.5.6](https://github.com/civic-source/us-code-tracker/compare/v0.5.5...v0.5.6) (2026-03-29)

### Bug Fixes

* **scripts:** add network retry + error resilience to historical importer ([de6fec5](https://github.com/civic-source/us-code-tracker/commit/de6fec593af281a48a0f83d616bb57062c0b26ac))
* **scripts:** batch git add by title directory + use 255 verified release points ([7332794](https://github.com/civic-source/us-code-tracker/commit/73327942cf25a1fd24bf25bdc83333033f1c359a))

## [0.5.5](https://github.com/civic-source/us-code-tracker/compare/v0.5.4...v0.5.5) (2026-03-29)

### Features

* **web:** version timeline + comparison in DiffViewer ([#46](https://github.com/civic-source/us-code-tracker/issues/46)) ([20766db](https://github.com/civic-source/us-code-tracker/commit/20766db636068bb9324aff7d7a7b3c207ff64364))

## [0.5.4](https://github.com/civic-source/us-code-tracker/compare/v0.5.3...v0.5.4) (2026-03-29)

### Bug Fixes

* **scripts:** add cached release points fallback + graceful 302 handling ([0ac0041](https://github.com/civic-source/us-code-tracker/commit/0ac0041a8031ab6d22ef03dd1947a2dcfdd41d8f))

## [0.5.3](https://github.com/civic-source/us-code-tracker/compare/v0.5.2...v0.5.3) (2026-03-29)

### Bug Fixes

* **transformer:** reformat 47 sections with inline list markers ([#47](https://github.com/civic-source/us-code-tracker/issues/47)) ([335e0b7](https://github.com/civic-source/us-code-tracker/commit/335e0b78d21b5ae71330f3164716233abfba1129))

## [0.5.2](https://github.com/civic-source/us-code-tracker/compare/v0.5.1...v0.5.2) (2026-03-29)

### Features

* **web:** add notices for Omitted, Transferred, Renumbered sections ([#48](https://github.com/civic-source/us-code-tracker/issues/48)) ([32f416d](https://github.com/civic-source/us-code-tracker/commit/32f416d41e7553e000dc355ce6c6df173d5c43c7)), closes [#47](https://github.com/civic-source/us-code-tracker/issues/47)

## [0.5.1](https://github.com/civic-source/us-code-tracker/compare/v0.5.0...v0.5.1) (2026-03-29)

### Features

* **pipeline:** historical release point importer with delta detection ([#42](https://github.com/civic-source/us-code-tracker/issues/42)) ([8a689e4](https://github.com/civic-source/us-code-tracker/commit/8a689e41c5a8cc5b2f9a86f3ef81935d212d2067))
* **types:** add statute version reference fields to CaseAnnotation ([#43](https://github.com/civic-source/us-code-tracker/issues/43)) ([c315987](https://github.com/civic-source/us-code-tracker/commit/c315987afeb47cc7cc663b1dee72a8af043505db))

### Bug Fixes

* **scripts:** use relative imports for tsx compatibility ([9e0d79d](https://github.com/civic-source/us-code-tracker/commit/9e0d79d4fa92f8e53de5ab4c0d487d9f0598f4f2))

## [0.5.0](https://github.com/civic-source/us-code-tracker/compare/v0.4.6...v0.5.0) (2026-03-29)

### Features

* **annotator:** Precedent Mapping Phase A — schema, rate limiting, dedup ([#40](https://github.com/civic-source/us-code-tracker/issues/40)) ([36d4d97](https://github.com/civic-source/us-code-tracker/commit/36d4d972c903087a832eb007264c9c23b4d52267))

## [0.4.6](https://github.com/civic-source/us-code-tracker/compare/v0.4.5...v0.4.6) (2026-03-29)

### Bug Fixes

* **web:** improve Change History display and OLRC URL pattern ([#39](https://github.com/civic-source/us-code-tracker/issues/39)) ([8b24548](https://github.com/civic-source/us-code-tracker/commit/8b24548145b5c1a5c9eb6c11c2cbafb7b417e688))

## [0.4.5](https://github.com/civic-source/us-code-tracker/compare/v0.4.4...v0.4.5) (2026-03-29)

### Bug Fixes

* **web:** comprehensive design review — 9 issues fixed ([6465601](https://github.com/civic-source/us-code-tracker/commit/6465601bc1cd1132215df4fb6c30b8a11b25f335)), closes [#main-content](https://github.com/civic-source/us-code-tracker/issues/main-content)

## [0.4.4](https://github.com/civic-source/us-code-tracker/compare/v0.4.3...v0.4.4) (2026-03-29)

### Features

* **web:** prev/next navigation, back-to-top, responsive prose width ([94b7f91](https://github.com/civic-source/us-code-tracker/commit/94b7f917e281ccd93653d507dbef57ef82525732)), closes [#D4A843](https://github.com/civic-source/us-code-tracker/issues/D4A843)

### Bug Fixes

* **web:** search bar path, theme toggle, typography improvements ([3ce2cdf](https://github.com/civic-source/us-code-tracker/commit/3ce2cdf27603a21a4808ef746afa02bae316a4cc))

## [0.4.3](https://github.com/civic-source/us-code-tracker/compare/v0.4.2...v0.4.3) (2026-03-29)

### Features

* **web:** UI polish — homepage stats, favicon, browse bars, heading styling ([68ee2c3](https://github.com/civic-source/us-code-tracker/commit/68ee2c353c1f2226af973e9d1a4caa03e8e85c57))

## [0.4.2](https://github.com/civic-source/us-code-tracker/compare/v0.4.1...v0.4.2) (2026-03-29)

### Features

* **web:** improved list formatting, sidebar navigation, footer ([#37](https://github.com/civic-source/us-code-tracker/issues/37)) ([1a98216](https://github.com/civic-source/us-code-tracker/commit/1a9821694883b1f04660187622330ab3706b72a1))
* **web:** markdown rendering improvements — prose tuning, repealed notices, OLRC links ([#38](https://github.com/civic-source/us-code-tracker/issues/38)) ([0b4b1e5](https://github.com/civic-source/us-code-tracker/commit/0b4b1e50400ac8650918114965e13da2b525ed20))

## [0.4.1](https://github.com/civic-source/us-code-tracker/compare/v0.4.0...v0.4.1) (2026-03-29)

### Bug Fixes

* **web:** add trailing slash to base path — fixes broken navigation URLs ([8ce6250](https://github.com/civic-source/us-code-tracker/commit/8ce6250d9d418d76bccb583ab2e36a51d66c1fab))
* **web:** resolve 12 UX/UI audit findings — accessibility, navigation, design ([#37](https://github.com/civic-source/us-code-tracker/issues/37)) ([3a7e353](https://github.com/civic-source/us-code-tracker/commit/3a7e3531061610feeb810afa6dbaec66a0108936))

## [0.4.0](https://github.com/civic-source/us-code-tracker/compare/v0.3.0...v0.4.0) (2026-03-29)

### Features

* bulk import 9 titles (2,885 sections) + bulk-import script ([#34](https://github.com/civic-source/us-code-tracker/issues/34)) ([ecc5628](https://github.com/civic-source/us-code-tracker/commit/ecc5628220b364230654892d43e9af93f4cab610)), closes [#35](https://github.com/civic-source/us-code-tracker/issues/35)
* **web:** hierarchical navigation, Pagefind search, 46K page build ([#36](https://github.com/civic-source/us-code-tracker/issues/36)) ([b04e25c](https://github.com/civic-source/us-code-tracker/commit/b04e25c84c8510b9ee00a8e4fa0684f8d7c118fc))

### Bug Fixes

* **transformer:** handle deeply nested US Code titles ([#35](https://github.com/civic-source/us-code-tracker/issues/35)) ([abae5da](https://github.com/civic-source/us-code-tracker/commit/abae5da9059afc6ff6563c542582c319691b98f2))

## [0.3.0](https://github.com/civic-source/us-code-tracker/compare/v0.2.0...v0.3.0) (2026-03-29)

### Features

* **web:** wire Pagefind search and update content submodule ([2769c1f](https://github.com/civic-source/us-code-tracker/commit/2769c1f38a89cc77db7b0925c2efd8860e33a94a))

### Bug Fixes

* **ci:** add submodule checkout for Content Collections in CI/deploy ([f645f72](https://github.com/civic-source/us-code-tracker/commit/f645f729599993202d51fbabbe4384811ab92ac8))
* **ci:** correct deploy-pages and upload-pages-artifact SHA pins ([1f68c32](https://github.com/civic-source/us-code-tracker/commit/1f68c329e29d010ea410eca7c789834ca049a36a))

## [0.2.0](https://github.com/civic-source/us-code-tracker/compare/v0.1.0...v0.2.0) (2026-03-28)

### Features

* **web:** Content Collections, dynamic pages, Pagefind search ([#33](https://github.com/civic-source/us-code-tracker/issues/33), [#34](https://github.com/civic-source/us-code-tracker/issues/34)) ([ceaa785](https://github.com/civic-source/us-code-tracker/commit/ceaa785c1215d7a4d05a0ed1f5fb5dbf5f98758f))

### Bug Fixes

* **ci:** update action-gh-release to v2.6.1 for Node.js 24 ([#32](https://github.com/civic-source/us-code-tracker/issues/32)) ([40b2994](https://github.com/civic-source/us-code-tracker/commit/40b29943d837b010becb709cbb25b939da092562))

## [0.1.0](https://github.com/civic-source/us-code-tracker/compare/67d6f6907cc902d52bcb6a1089b09986e98fc9e3...v0.1.0) (2026-03-28)

### Features

* add observability package and Title 18 golden snapshot tests ([#11](https://github.com/civic-source/us-code-tracker/issues/11), [#3](https://github.com/civic-source/us-code-tracker/issues/3)) ([950ecf3](https://github.com/civic-source/us-code-tracker/commit/950ecf38500592eac4fe1a4cfa9dd540a1244d3b))
* add sync pipeline, deploy workflow, and mixed content tests ([#1](https://github.com/civic-source/us-code-tracker/issues/1), [#20](https://github.com/civic-source/us-code-tracker/issues/20)) ([cfadb7e](https://github.com/civic-source/us-code-tracker/commit/cfadb7ee7586de3b6a13e17ffb62fdfe5c64e15f)), closes [#21](https://github.com/civic-source/us-code-tracker/issues/21)
* align implementation to spec v1.1.0 ([#15](https://github.com/civic-source/us-code-tracker/issues/15), [#16](https://github.com/civic-source/us-code-tracker/issues/16), [#17](https://github.com/civic-source/us-code-tracker/issues/17)) ([3a343dc](https://github.com/civic-source/us-code-tracker/commit/3a343dc53e655b26221660793c29d1ba9c7b9582))
* **annotator:** implement CourtListener sidecar precedent annotator ([#15](https://github.com/civic-source/us-code-tracker/issues/15)) ([c12e37a](https://github.com/civic-source/us-code-tracker/commit/c12e37a3dcd1822a777f60c659a477c00e58d7e1))
* **fetcher:** implement OLRC fetcher with idempotency and retry ([#2](https://github.com/civic-source/us-code-tracker/issues/2)) ([e07442e](https://github.com/civic-source/us-code-tracker/commit/e07442ef33b7df0489dc62cce15359fa5456592d))
* **pipeline:** add orchestrator tests, E2E validation, and fetch CLI ([#6](https://github.com/civic-source/us-code-tracker/issues/6)) ([3b08b14](https://github.com/civic-source/us-code-tracker/commit/3b08b147a930ee8bf950c1bcdae01585cb068317))
* scaffold Turborepo monorepo with packages and CI ([#1](https://github.com/civic-source/us-code-tracker/issues/1)) ([67d6f69](https://github.com/civic-source/us-code-tracker/commit/67d6f6907cc902d52bcb6a1089b09986e98fc9e3))
* **transformer:** implement USLM XML → Markdown transformer ([#3](https://github.com/civic-source/us-code-tracker/issues/3)) ([5c3f9ff](https://github.com/civic-source/us-code-tracker/commit/5c3f9ff924d5d92d59e9d3452e1d6814349475b1))
* **web:** build Astro frontend with Tailwind v4, Svelte 5, Pagefind ([#4](https://github.com/civic-source/us-code-tracker/issues/4), [#16](https://github.com/civic-source/us-code-tracker/issues/16)) ([702f8fa](https://github.com/civic-source/us-code-tracker/commit/702f8fa237fea54c3cf43996bace279e44ecd5a1)), closes [#1B3A5C](https://github.com/civic-source/us-code-tracker/issues/1B3A5C) [#0D7377](https://github.com/civic-source/us-code-tracker/issues/0D7377) [#D4A843](https://github.com/civic-source/us-code-tracker/issues/D4A843)
* **web:** implement DiffViewer and PrecedentDrawer components ([#4](https://github.com/civic-source/us-code-tracker/issues/4)) ([0cbb4b1](https://github.com/civic-source/us-code-tracker/commit/0cbb4b1582500b5b9c9cc081f569b29e1d6e7b84))

### Bug Fixes

* **ci:** add @types/node to fetcher and transformer packages ([736347e](https://github.com/civic-source/us-code-tracker/commit/736347ef030378425c579bb587bc9bd537362767))
* **ci:** pin GitHub Actions to SHA + Node.js 24 + add test step ([#8](https://github.com/civic-source/us-code-tracker/issues/8)) ([5c67ffb](https://github.com/civic-source/us-code-tracker/commit/5c67ffb3658d22c6f537f8dd962dd8b46f3a8239))
* resolve critical QA findings — paths, security, timestamps ([#22](https://github.com/civic-source/us-code-tracker/issues/22)-[#25](https://github.com/civic-source/us-code-tracker/issues/25)) ([a78e9f1](https://github.com/civic-source/us-code-tracker/commit/a78e9f18fdfbc25d9d11938733a3b4685a813e02))
* **transformer:** migrate parser to preserveOrder for mixed content ([#21](https://github.com/civic-source/us-code-tracker/issues/21)) ([b2450ad](https://github.com/civic-source/us-code-tracker/commit/b2450ad97a3a768f2ff637844b1b0f58f15cb76c))
* **transformer:** support real OLRC USLM 1.0 data (uscDoc root) ([#31](https://github.com/civic-source/us-code-tracker/issues/31)) ([e2e3ffd](https://github.com/civic-source/us-code-tracker/commit/e2e3ffd5edbfe81176a5b17f2495cb869459b8af))
