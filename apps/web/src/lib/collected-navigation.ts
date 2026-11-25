import { getCollection } from 'astro:content';
import { titleNavigation } from './title-navigation';

let navigation: ReturnType<typeof loadNavigation> | undefined;

async function loadNavigation() {
  const entries = await getCollection('statutes');
  return titleNavigation([...new Set(entries.map(entry => entry.data.usc_title))]);
}

/** Collection membership is computed once per build process, rather than per page. */
export function collectedNavigation() {
  navigation ??= loadNavigation();
  return navigation;
}
