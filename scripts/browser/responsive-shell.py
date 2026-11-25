"""Check public shell reflow and keyboard access against a running static preview.

Use the existing Python Playwright environment; no browser is installed by this
runner. Request failures to GitHub's API are intentional static-site checks.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

SIZES = [(320, 568), (337, 844), (360, 800), (390, 844), (768, 1024), (1024, 768), (1440, 900)]
MEASURE = '''() => [...document.querySelectorAll('#search-input, #search-release-scope, #menu-toggle, #main-nav a, #main-nav button')]
  .filter(e => e.checkVisibility())
  .map(e => {
    const box=e.getBoundingClientRect();
    let clippedBy=null;
    for(let ancestor=e.parentElement;ancestor;ancestor=ancestor.parentElement){
      if(!['hidden','clip','auto','scroll'].includes(getComputedStyle(ancestor).overflowX))continue;
      const parent=ancestor.getBoundingClientRect();
      if(box.left<parent.left-1||box.right>parent.right+1){clippedBy=ancestor.tagName;break;}
    }
    return {label:e.id||e.textContent.trim(),left:box.left,right:box.right,viewport:innerWidth,clippedBy};
  })'''


def hydrated(page):
    for _ in range(100):
        if page.locator('astro-island[client=load][ssr]').count() == 0:
            break
        page.wait_for_timeout(100)
    assert page.locator('astro-island[client=load][ssr]').count() == 0, 'Components did not hydrate'
    page.evaluate('() => document.fonts.ready')


def geometry(page):
    bounds = page.evaluate(MEASURE)
    assert bounds, 'Shell controls are missing'
    assert all(item['left'] >= -1 and item['right'] <= item['viewport'] + 1 and not item['clippedBy']
               for item in bounds), bounds
    return bounds


def shell(page, width, javascript):
    observations = [{'state': 'closed', 'controls': geometry(page)}]
    menu = page.locator('#menu-toggle')
    if width < 1024 or not javascript:
        menu.focus()
        page.keyboard.press('Enter')
        assert page.locator('#site-menu').get_attribute('open') is not None
        assert page.get_by_role('link', name='Curated Topics & Feeds').is_visible()
        observations.append({'state': 'open', 'controls': geometry(page)})
        for _ in range(page.locator('#main-nav a, #main-nav button, #main-nav input').count()):
            page.keyboard.press('Tab')
            box = page.evaluate('''() => {const r=document.activeElement.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight}}''')
            assert box['left'] >= -1 and box['right'] <= box['w'] + 1, box
            assert box['top'] >= -1 and box['bottom'] <= box['h'] + 1, box
        if javascript:
            page.keyboard.press('Escape')
            assert page.locator('#site-menu').get_attribute('open') is None
            assert menu.evaluate('(element) => document.activeElement === element')
        else:
            before = page.url
            menu.focus()
            assert menu.evaluate('(element) => document.activeElement === element'), 'Menu cannot regain focus'
            page.keyboard.press('Enter')
            assert page.url == before, 'Closing the menu navigated away'
            assert page.locator('#site-menu').get_attribute('open') is None
    return observations


def reader_start(browser, base, out):
    context = browser.new_context(viewport={'width': 390, 'height': 844})
    context.route('https://api.github.com/**', lambda route: route.abort())
    page = context.new_page()
    records = []
    for state, path in [('current', 'statute/title-18/chapter-7/section-111/'),
                        ('historical', 'statute/title-18/chapter-47/section-1001/?release=pl-119-73')]:
        page.goto(base.rstrip('/') + '/' + path, wait_until='domcontentloaded')
        hydrated(page)
        page.locator('main h1:visible').first.wait_for(state='visible', timeout=10000)
        value = page.evaluate("""() => {
          const heading=[...document.querySelectorAll('main h1')].find(e=>e.checkVisibility());
          const body=heading?.nextElementSibling;
          return {heading:heading?.textContent,headingBottom:heading?.getBoundingClientRect().bottom,
                  openingTop:body?.getBoundingClientRect().top,openingText:body?.textContent.slice(0,80)};
        }""")
        records.append({'state': state, **value})
        page.screenshot(path=str(out / f'reader-{state}-390.png'))
    page.goto(base.rstrip('/') + '/statute/title-18/chapter-7/section-111/', wait_until='domcontentloaded')
    hydrated(page)
    body = page.locator('#current-statute-body')
    original_text = body.text_content()
    page.get_by_text('Reading preferences and version history', exact=True).click()
    page.get_by_role('radio', name='Sans', exact=True).click()
    page.get_by_role('button', name='Toggle text size', exact=True).click()
    page.get_by_role('button', name='Toggle reading line width', exact=True).click()
    assert body.text_content() == original_text, 'Reading preferences changed statute words'
    assert 'Public Sans' in body.evaluate('(element) => getComputedStyle(element).fontFamily')
    assert body.evaluate('(element) => getComputedStyle(element).fontSize') == '21px'
    assert page.evaluate('() => localStorage.getItem("reading-measure")') == 'wide'
    page.reload(wait_until='domcontentloaded')
    hydrated(page)
    assert body.evaluate('(element) => getComputedStyle(element).fontSize') == '21px'
    context.close()
    (out / 'reader-geometry.json').write_text(json.dumps(records, indent=2) + '\n')
    assert all(isinstance(item.get('headingBottom'), (int, float)) and item['headingBottom'] < 844
               and isinstance(item.get('openingTop'), (int, float)) and item['openingTop'] < 844
               and item.get('openingText') for item in records), records


def run_case(browser, args, case):
    width, height = case['viewport']
    javascript = case['javascript']
    context = browser.new_context(viewport={'width': width, 'height': height},
                                  java_script_enabled=javascript, **case.get('context', {}))
    context.route('https://api.github.com/**', lambda route: route.abort())
    page = context.new_page()
    page.goto(args.base.rstrip('/') + '/browse/', wait_until='domcontentloaded')
    if javascript:
        hydrated(page)
    if case.get('text_zoom'):
        page.add_style_tag(content='html { font-size: 200%; }')
    record = dict(case)
    try:
        record['states'] = shell(page, width, javascript)
        record['outcome'] = 'PASS'
    except AssertionError as error:
        record.update(outcome='FAIL', reason=str(error))
    page.screenshot(path=str(args.out / (case['name'] + '.png')), full_page=True)
    context.close()
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:4327/us-code-tracker/')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--executable', help='Optional existing Chromium binary')
    parser.add_argument('--reader', action='store_true', help='Check the opening text at 390 by 844')
    parser.add_argument('--width', type=int, help='Run one viewport width')
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    sizes = [(args.width, 844)] if args.width else SIZES
    cases = [{'name': f'shell-{width}-js-{javascript}', 'viewport': [width, height], 'javascript': javascript}
             for width, height in sizes for javascript in (True, False)]
    if not args.width:
        cases += [
            {'name': 'dark-reduced-motion', 'viewport': [390, 844], 'javascript': True,
             'context': {'color_scheme': 'dark', 'reduced_motion': 'reduce'}},
            {'name': 'text-200-percent', 'viewport': [390, 844], 'javascript': True, 'text_zoom': True},
            {'name': 'reflow-200-percent-equivalent', 'viewport': [720, 450], 'javascript': True,
             'context': {'device_scale_factor': 2}},
        ]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.executable)
        if args.reader:
            reader_start(browser, args.base, args.out)
            browser.close()
            return
        records = [run_case(browser, args, case) for case in cases]
        browser.close()
    (args.out / 'geometry.json').write_text(json.dumps(records, indent=2) + '\n')
    assert all(record['outcome'] == 'PASS' for record in records), records


if __name__ == '__main__':
    main()
