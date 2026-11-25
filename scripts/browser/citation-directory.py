"""Public navigation journeys against a production-mode Civic Source preview."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

from playwright.sync_api import sync_playwright


def hydrated(page):
    for _ in range(100):
        if page.locator('astro-island[client=load][ssr]').count() == 0:
            return
        page.wait_for_timeout(100)
    raise AssertionError('Components did not hydrate')


def directory(page, base, out):
    page.goto(base + 'browse/', wait_until='networkidle')
    hydrated(page)
    field = page.get_by_role('searchbox', name='Filter United States Code titles')
    field.fill('Tax')
    link = page.locator('main a[href$="/browse/title-26/"]')
    link.wait_for(state='visible')
    page.wait_for_url('**/browse/?q=Tax')
    page.get_by_role('tab', name=re.compile(r'^Commerce, Tax & Finance\s*\(\d+\)$')).click()
    assert parse_qs(urlparse(page.url).query)['category'] == ['Commerce, Tax & Finance']
    page.reload(wait_until='networkidle')
    hydrated(page)
    assert field.input_value() == 'Tax'
    page.go_back(wait_until='networkidle')
    assert 'category' not in parse_qs(urlparse(page.url).query)
    assert field.input_value() == 'Tax'
    page.screenshot(path=str(out / 'tax-filter.png'), full_page=True)
    assert page.locator('a[href*="NaN"]').count() == 0
    assert page.locator('#title-list a[href$="title-5a/"]').count() == 0
    return {'tax': '26', 'query_restored': True, 'back_restored': True}


def citation(page, base, out):
    page.goto(base + 'browse/', wait_until='networkidle')
    hydrated(page)
    page.locator('#search-input').fill('18 USC 111(a)(1)')
    jump = page.get_by_role('link', name='Go to 18 U.S.C. § 111(a)(1)', exact=False)
    jump.wait_for(state='visible')
    href = jump.get_attribute('href')
    assert '/statute/title-18/chapter-7/section-111/?release=' in href, href
    assert href.endswith('#subsec-a-1'), href
    jump.click()
    page.wait_for_load_state('networkidle')
    assert urlparse(page.url).fragment == 'subsec-a-1'
    assert parse_qs(urlparse(page.url).query).get('release')
    with urlopen(page.url.split('#')[0], timeout=30) as response:
        raw = response.read(2 * 1024 * 1024).decode('utf8')
    gap = page.locator('[data-current-source-fallback]').count() > 0
    if not gap:
        assert 'id="subsec-a-1"' in raw, 'Pinpoint requires a cold HTML anchor'
        assert page.locator('#current-statute-body #subsec-a-1').count() == 1
    else:
        assert page.locator('#current-statute-body [id^=subsec-]').count() == 0
        assert 'id="subsec-a-1"' not in raw
    page.screenshot(path=str(out / 'citation-result.png'), full_page=True)
    return {'href': href, 'source_gap': gap, 'cold_anchor': not gap, 'html_sha256': hashlib.sha256(raw.encode()).hexdigest()}


def rollup_containment(page, base):
    results = []
    for chapter, section in [('1', '19'), ('7', '111'), ('47', '1001')]:
        page.goto(base + f'browse/title-18/chapter-{chapter}/', wait_until='networkidle')
        content = page.locator('#full-content')
        if not content.is_visible():
            page.get_by_role('button', name='Read full chapter', exact=True).click()
        article = page.locator(f'article#section-{section}')
        gap = article.locator('[data-current-source-fallback]')
        assert gap.count() == 1, f'Known faulty {section} is exposed in the chapter rollup'
        assert gap.is_visible()
        assert article.locator('.prose ul, .prose ol').count() == 0
        assert gap.get_by_role('link', name='Read this section at the official OLRC source').count() == 1
        if chapter == '1':
            assert page.locator('article#section-2 .prose').inner_text().find('Whoever') >= 0
            assert page.locator('article#section-2 [data-current-source-fallback]').count() == 0
        results.append({'chapter': chapter, 'section': section, 'known_body_withheld': True})
    return results


def alphanumeric_navigation(page, base):
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.goto(base + 'statute/title-12/chapter-6a/section-635t/', wait_until='networkidle')
    hydrated(page)
    crumb = page.locator('nav[aria-label="Breadcrumb"] a[href$="/browse/title-12/chapter-6a/"]')
    assert crumb.count() == 1
    source = page.locator('astro-island[component-url*="DiffViewer"]').get_attribute('props')
    source_path = json.loads(source)['sectionPath'][1]
    assert source_path == 'statutes/title-12/chapter-6A/section-635t.md', source_path
    chapter_link = crumb.get_attribute('href')
    crumb.click()
    page.wait_for_load_state('networkidle')
    assert urlparse(page.url).path.endswith('/browse/title-12/chapter-6a/')
    assert page.locator('a[href$="/statute/title-12/chapter-6a/section-635t/"]').count() >= 1
    assert page.locator('a[href*="NaN"]').count() == 0
    return {'chapter_href': chapter_link, 'source_path': source_path, 'literal_chapter_preserved': True}


def cold_rollups(browser, base):
    page = browser.new_page(java_script_enabled=False, viewport={'width': 390, 'height': 844})
    result = rollup_containment(page, base)
    page.close()
    return {'javascript': False, 'sections': result}


def historical_scope(page, base):
    page.goto(base + 'browse/?release=pl-118-1', wait_until='networkidle')
    hydrated(page)
    assert page.locator('#search-release-scope').input_value() == 'pl-118-1'
    page.locator('#search-input').fill('18 USC 111(a)(1)')
    page.get_by_text('Exact historical citation routing requires a retained source', exact=False).wait_for(state='visible')
    assert page.get_by_role('link', name='Go to 18 U.S.C. § 111(a)(1)', exact=False).count() == 0
    assert parse_qs(urlparse(page.url).query)['release'] == ['pl-118-1']
    return {'requested': 'pl-118-1', 'scope_preserved': True, 'current_substituted': False}


def cold_control(browser, base):
    with urlopen(base + 'publication-receipt.json', timeout=30) as response:
        release = json.load(response)['acceptedDataTag']
    target = base + f'statute/title-18/chapter-1/section-2/?release={release}#subsec-a'
    page = browser.new_page(java_script_enabled=False, viewport={'width': 390, 'height': 844})
    page.goto(target, wait_until='networkidle')
    anchor = page.locator('#current-statute-body #subsec-a')
    assert anchor.count() == 1, 'Unrelated available control requires a cold anchor'
    box = anchor.bounding_box()
    assert box and -1 <= box['y'] < 844, box
    page.close()
    return {'url': target, 'javascript': False, 'anchor': 'subsec-a', 'visible': True}


def chapter_and_gap(page, base):
    page.goto(base + 'browse/title-18/', wait_until='networkidle')
    assert page.locator('#chapter-1 summary').inner_text().find('GENERAL PROVISIONS') >= 0
    assert page.locator('#chapter-7 summary').inner_text().find('ASSAULT') >= 0
    page.goto(base + 'browse/title-18/chapter-7/', wait_until='networkidle')
    assert page.get_by_role('heading', name='Title 18, Chapter 7 — ASSAULT', exact=True).count() == 1
    assert page.locator('[id="subsec-a"]').count() == 0, 'Chapter rollups must not duplicate standalone anchors'
    hydrated(page)
    page.locator('#search-input').fill('18 USC 999999999')
    page.get_by_text('Section unavailable in this edition.', exact=False).wait_for(state='visible')
    assert page.get_by_role('link', name='Go to 18 U.S.C. § 999999999', exact=False).count() == 0
    return {'chapter_1': 'GENERAL PROVISIONS', 'chapter_7': 'ASSAULT', 'missing_route': 'explicit gap'}


def crawl(dist):
    checked = 0
    sizes = []
    for index in sorted((dist / 'route-index').rglob('*.json')):
        raw = index.read_bytes()
        assert len(raw) <= 2 * 1024 * 1024
        value = json.loads(raw)
        assert value['schemaVersion'] == 'usct.route-index/v1'
        for entry in value['entries']:
            assert (dist / 'statute' / entry['path'] / 'index.html').is_file(), entry
            checked += 1
        sizes.append({'path': str(index.relative_to(dist)), 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    assert sizes and checked > 0, 'No route indexes emitted'
    return {'routes_checked': checked, 'indexes': sizes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:4328/us-code-tracker/')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--dist', type=Path)
    parser.add_argument('--block-pagefind', action='store_true', help='Prove exact routes work without full-text assets')
    parser.add_argument('--executable', help='Optional existing Chromium binary')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    base = args.base.rstrip('/') + '/'
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.executable)
        page = browser.new_page(viewport={'width': 390, 'height': 844})
        page.route('https://api.github.com/**', lambda route: route.abort())
        if args.block_pagefind:
            page.route('**/pagefind/**', lambda route: route.abort())
        receipt = {'directory': directory(page, base, args.out), 'citation': citation(page, base, args.out), 'chapters_and_gap': chapter_and_gap(page, base), 'cold_control': cold_control(browser, base), 'historical_scope': historical_scope(page, base), 'rollup_containment': rollup_containment(page, base), 'cold_rollups': cold_rollups(browser, base), 'alphanumeric_navigation': alphanumeric_navigation(page, base)}
        if args.dist:
            receipt['crawl'] = crawl(args.dist)
        browser.close()
    (args.out / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')


if __name__ == '__main__':
    main()
