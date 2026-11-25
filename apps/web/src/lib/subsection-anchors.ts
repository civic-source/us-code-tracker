interface TreeNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: TreeNode[];
}

function marker(item: TreeNode): string | null {
  const first = item.children?.find(node => node.type !== 'text' || node.value?.trim());
  const inline = first?.tagName === 'p' ? first.children?.[0] : first;
  if (inline?.tagName !== 'strong') return null;
  const text = inline.children?.map(node => node.value ?? '').join('') ?? '';
  return /^\([a-zA-Z0-9]+\)$/.test(text) ? text.slice(1, -1) : null;
}

function listAnchors(list: TreeNode, parents: string[], candidates: Map<string, TreeNode[]>): void {
  for (const item of list.children ?? []) {
    if (item.tagName !== 'li') continue;
    const label = marker(item);
    if (!label) continue;
    const path = [...parents, label];
    const id = `subsec-${path.join('-')}`;
    const matches = candidates.get(id) ?? [];
    matches.push(item);
    candidates.set(id, matches);
    for (const child of item.children ?? []) {
      if (child.tagName === 'ul' || child.tagName === 'ol') listAnchors(child, path, candidates);
    }
  }
}

/** Anchors describe unambiguous rendered list structure, excluding the notes lane. */
export default function subsectionAnchors() {
  return (tree: TreeNode): void => {
    const candidates = new Map<string, TreeNode[]>();
    for (const node of tree.children ?? []) {
      if (/^h[2-6]$/.test(node.tagName ?? '')) break;
      if (node.tagName === 'ul' || node.tagName === 'ol') listAnchors(node, [], candidates);
    }
    for (const [id, matches] of candidates) {
      if (matches.length === 1) matches[0]!.properties = { ...matches[0]!.properties, id };
    }
  };
}
