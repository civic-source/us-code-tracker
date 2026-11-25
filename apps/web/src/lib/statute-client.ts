/** Client-side progressive enhancement for statute pages: chapter cross-links, subsection anchors, and keyboard nav. */
export function initStatutePage(): void {
  const statuteBody = document.querySelector<HTMLElement>('#current-statute-body');
  if (statuteBody) {
    const base = statuteBody.dataset.base ?? '/us-code-tracker/';
    const uscTitle = statuteBody.dataset.title ?? '';
    const chapter = statuteBody.dataset.chapter ?? '';
    const chapterSectionMap = Object.create(null) as Record<string, string>;
    try {
      const parsedSections: unknown = JSON.parse(statuteBody.dataset.chapterSections ?? '[]');
      if (Array.isArray(parsedSections)) {
        for (const sec of parsedSections) {
          chapterSectionMap[String(sec).toLowerCase()] = String(sec);
        }
      }
    } catch {
      // Leave map empty if attribute is missing or malformed
    }

    if (uscTitle && chapter) {
      const pattern = /\bsection (\d+[a-z]?)\b(?:\s+of this title)?/gi;
      const chapterUrl = `${base}browse/title-${uscTitle}/chapter-${chapter}/`;
      const walker = document.createTreeWalker(statuteBody, NodeFilter.SHOW_TEXT);
      const textNodes: Text[] = [];
      let currentNode: Node | null;
      while ((currentNode = walker.nextNode()) !== null) {
        if (currentNode instanceof Text) textNodes.push(currentNode);
      }
      for (const node of textNodes) {
        const parent = node.parentElement;
        if (!parent || parent.tagName === 'A' || parent.closest('h1,h2')) continue;
        const text = node.textContent ?? '';
        if (!pattern.test(text)) continue;
        pattern.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let lastIdx = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(text)) !== null) {
          const matchedNum = match[1];
          const canonicalSec = matchedNum ? chapterSectionMap[matchedNum.toLowerCase()] : undefined;
          if (!canonicalSec) continue;
          if (match.index > lastIdx) frag.appendChild(document.createTextNode(text.slice(lastIdx, match.index)));
          const anchor = document.createElement('a');
          anchor.href = `${chapterUrl}#section-${canonicalSec}`;
          anchor.textContent = match[0];
          anchor.className = 'text-teal underline underline-offset-2 decoration-teal/30 hover:decoration-teal';
          anchor.title = `View section ${canonicalSec}`;
          frag.appendChild(anchor);
          lastIdx = match.index + match[0].length;
        }
        if (lastIdx > 0 && lastIdx < text.length) frag.appendChild(document.createTextNode(text.slice(lastIdx)));
        if (lastIdx > 0 && node.parentElement) node.parentElement.replaceChild(frag, node);
      }
    }

    if (/^#subsec-[a-zA-Z0-9-]+$/.test(window.location.hash) && !document.getElementById(window.location.hash.slice(1))) {
      const notice = document.createElement('p');
      notice.setAttribute('role', 'status');
      notice.dataset.pinpointGap = 'true';
      notice.textContent = 'The requested subsection anchor is unavailable in this local representation. This does not establish that the subsection is absent from the law; check the official source.';
      statuteBody.before(notice);
    }

  }

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable) return;
    const nav = document.querySelector('nav[aria-label="Section navigation"]');
    if (!nav) return;
    const links = nav.querySelectorAll<HTMLAnchorElement>('a');
    if (e.key === 'k' || (e.key === 'ArrowLeft' && !e.metaKey)) {
      if (links[0]) window.location.href = links[0].href;
    } else if (e.key === 'j' || (e.key === 'ArrowRight' && !e.metaKey)) {
      if (links[1]) window.location.href = links[1].href;
      else if (links[0] && links.length === 1) window.location.href = links[0].href;
    }
  });
}
