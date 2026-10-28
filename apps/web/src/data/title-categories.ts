/**
 * High-level civic subject categories for U.S. Code Titles.
 */
export type TitleCategory =
  | 'Administration & Governance'
  | 'Judiciary & Criminal Law'
  | 'Commerce, Tax & Finance'
  | 'Health, Education & Resources'
  | 'Defense, Security & Foreign Affairs';

export const TITLE_CATEGORIES: Record<string, TitleCategory> = {
  // Administration & Governance
  '1': 'Administration & Governance',
  '2': 'Administration & Governance',
  '3': 'Administration & Governance',
  '4': 'Administration & Governance',
  '5': 'Administration & Governance',
  '5a': 'Administration & Governance',
  '13': 'Administration & Governance',
  '39': 'Administration & Governance',
  '40': 'Administration & Governance',
  '44': 'Administration & Governance',
  '52': 'Administration & Governance',

  // Judiciary & Criminal Law
  '9': 'Judiciary & Criminal Law',
  '18': 'Judiciary & Criminal Law',
  '18a': 'Judiciary & Criminal Law',
  '28': 'Judiciary & Criminal Law',
  '28a': 'Judiciary & Criminal Law',
  '34': 'Judiciary & Criminal Law',

  // Commerce, Tax & Finance
  '7': 'Commerce, Tax & Finance',
  '11': 'Commerce, Tax & Finance',
  '11a': 'Commerce, Tax & Finance',
  '12': 'Commerce, Tax & Finance',
  '15': 'Commerce, Tax & Finance',
  '17': 'Commerce, Tax & Finance',
  '19': 'Commerce, Tax & Finance',
  '26': 'Commerce, Tax & Finance',
  '26a': 'Commerce, Tax & Finance',
  '31': 'Commerce, Tax & Finance',
  '35': 'Commerce, Tax & Finance',
  '41': 'Commerce, Tax & Finance',
  '47': 'Commerce, Tax & Finance',
  '49': 'Commerce, Tax & Finance',
  '51': 'Commerce, Tax & Finance',

  // Health, Education & Resources
  '16': 'Health, Education & Resources',
  '20': 'Health, Education & Resources',
  '21': 'Health, Education & Resources',
  '23': 'Health, Education & Resources',
  '24': 'Health, Education & Resources',
  '25': 'Health, Education & Resources',
  '27': 'Health, Education & Resources',
  '29': 'Health, Education & Resources',
  '30': 'Health, Education & Resources',
  '38': 'Health, Education & Resources',
  '42': 'Health, Education & Resources',
  '43': 'Health, Education & Resources',
  '45': 'Health, Education & Resources',
  '53': 'Health, Education & Resources',
  '54': 'Health, Education & Resources',

  // Defense, Security & Foreign Affairs
  '6': 'Defense, Security & Foreign Affairs',
  '8': 'Defense, Security & Foreign Affairs',
  '10': 'Defense, Security & Foreign Affairs',
  '14': 'Defense, Security & Foreign Affairs',
  '22': 'Defense, Security & Foreign Affairs',
  '32': 'Defense, Security & Foreign Affairs',
  '33': 'Defense, Security & Foreign Affairs',
  '36': 'Defense, Security & Foreign Affairs',
  '37': 'Defense, Security & Foreign Affairs',
  '46': 'Defense, Security & Foreign Affairs',
  '48': 'Defense, Security & Foreign Affairs',
  '50': 'Defense, Security & Foreign Affairs',
  '50a': 'Defense, Security & Foreign Affairs',
};

export function getTitleCategory(titleNum: string): TitleCategory {
  return TITLE_CATEGORIES[titleNum] ?? 'Administration & Governance';
}
