export interface OklchThemeColors {
  background: string;
  foreground: string;
  selection?: string;
  cursor?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  purple?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightPurple?: string;
  brightCyan?: string;
  brightWhite?: string;
}

export interface OklchThemePreset {
  slug: string;
  name: string;
  isDark: boolean;
  colors: OklchThemeColors;
}

/**
 * Curated premier legal reading themes extracted from @williamzujkowski/oklch-terminal-themes
 * for zero-bundle-overhead instant loading.
 */
export const CURATED_OKLCH_THEMES: OklchThemePreset[] = [
  {
    slug: 'iterm2-solarized-dark',
    name: 'Solarized Dark',
    isDark: true,
    colors: {
      background: 'oklch(0.267 0.049 219.8)',
      foreground: 'oklch(0.654 0.02 205.3)',
      selection: 'oklch(0.309 0.052 219.7)',
      black: 'oklch(0.309 0.052 219.7)',
      red: 'oklch(0.586 0.206 27.1)',
      green: 'oklch(0.644 0.151 118.6)',
      yellow: 'oklch(0.655 0.134 85.7)',
      blue: 'oklch(0.615 0.139 244.9)',
      purple: 'oklch(0.592 0.203 355.9)',
      cyan: 'oklch(0.644 0.102 187.4)',
      white: 'oklch(0.931 0.026 92.4)',
      brightBlack: 'oklch(0.455 0.051 216.2)',
      brightRed: 'oklch(0.581 0.173 39.5)',
      brightGreen: 'oklch(0.523 0.028 219.1)',
      brightYellow: 'oklch(0.568 0.029 221.9)',
      brightBlue: 'oklch(0.654 0.02 205.3)',
      brightPurple: 'oklch(0.582 0.126 279.1)',
      brightCyan: 'oklch(0.698 0.016 196.8)',
      brightWhite: 'oklch(0.974 0.026 90.1)',
    },
  },
  {
    slug: 'iterm2-solarized-light',
    name: 'Solarized Light',
    isDark: false,
    colors: {
      background: 'oklch(0.974 0.026 90.1)',
      foreground: 'oklch(0.568 0.029 221.9)',
      selection: 'oklch(0.931 0.026 92.4)',
      black: 'oklch(0.309 0.052 219.7)',
      red: 'oklch(0.586 0.206 27.1)',
      green: 'oklch(0.644 0.151 118.6)',
      yellow: 'oklch(0.655 0.134 85.7)',
      blue: 'oklch(0.615 0.139 244.9)',
      purple: 'oklch(0.592 0.203 355.9)',
      cyan: 'oklch(0.644 0.102 187.4)',
      white: 'oklch(0.931 0.026 92.4)',
      brightBlack: 'oklch(0.455 0.051 216.2)',
      brightRed: 'oklch(0.581 0.173 39.5)',
      brightGreen: 'oklch(0.523 0.028 219.1)',
      brightYellow: 'oklch(0.568 0.029 221.9)',
      brightBlue: 'oklch(0.654 0.02 205.3)',
      brightPurple: 'oklch(0.582 0.126 279.1)',
      brightCyan: 'oklch(0.698 0.016 196.8)',
      brightWhite: 'oklch(0.974 0.026 90.1)',
    },
  },
  {
    slug: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    isDark: true,
    colors: {
      background: 'oklch(0.277 0 0)',
      foreground: 'oklch(0.894 0.057 89.2)',
      selection: 'oklch(0.443 0.007 68.6)',
      black: 'oklch(0.385 0.008 68.6)',
      red: 'oklch(0.586 0.198 34.6)',
      green: 'oklch(0.694 0.154 125.7)',
      yellow: 'oklch(0.763 0.145 82.3)',
      blue: 'oklch(0.653 0.089 223.1)',
      purple: 'oklch(0.655 0.122 344.2)',
      cyan: 'oklch(0.698 0.089 173.8)',
      white: 'oklch(0.749 0.045 87.2)',
      brightBlack: 'oklch(0.564 0.012 73.1)',
      brightRed: 'oklch(0.648 0.207 35.1)',
      brightGreen: 'oklch(0.765 0.158 126.8)',
      brightYellow: 'oklch(0.835 0.149 84.6)',
      brightBlue: 'oklch(0.724 0.091 224.2)',
      brightPurple: 'oklch(0.725 0.125 345.1)',
      brightCyan: 'oklch(0.768 0.091 174.9)',
      brightWhite: 'oklch(0.894 0.057 89.2)',
    },
  },
  {
    slug: 'gruvbox-light',
    name: 'Gruvbox Light',
    isDark: false,
    colors: {
      background: 'oklch(0.957 0.025 88.5)',
      foreground: 'oklch(0.385 0.008 68.6)',
      selection: 'oklch(0.875 0.043 86.9)',
      black: 'oklch(0.957 0.025 88.5)',
      red: 'oklch(0.586 0.198 34.6)',
      green: 'oklch(0.604 0.144 125.7)',
      yellow: 'oklch(0.673 0.135 82.3)',
      blue: 'oklch(0.563 0.089 223.1)',
      purple: 'oklch(0.565 0.112 344.2)',
      cyan: 'oklch(0.608 0.089 173.8)',
      white: 'oklch(0.385 0.008 68.6)',
      brightBlack: 'oklch(0.564 0.012 73.1)',
      brightRed: 'oklch(0.528 0.187 35.1)',
      brightGreen: 'oklch(0.645 0.148 126.8)',
      brightYellow: 'oklch(0.715 0.139 84.6)',
      brightBlue: 'oklch(0.604 0.091 224.2)',
      brightPurple: 'oklch(0.605 0.115 345.1)',
      brightCyan: 'oklch(0.648 0.091 174.9)',
      brightWhite: 'oklch(0.277 0 0)',
    },
  },
  {
    slug: 'nord',
    name: 'Nord (Arctic)',
    isDark: true,
    colors: {
      background: 'oklch(0.324 0.023 264.2)',
      foreground: 'oklch(0.899 0.016 262.7)',
      selection: 'oklch(0.412 0.026 261.9)',
      black: 'oklch(0.372 0.024 263.1)',
      red: 'oklch(0.627 0.148 25.4)',
      green: 'oklch(0.771 0.126 138.9)',
      yellow: 'oklch(0.838 0.118 90.2)',
      blue: 'oklch(0.712 0.086 240.5)',
      purple: 'oklch(0.702 0.122 316.4)',
      cyan: 'oklch(0.778 0.076 205.1)',
      white: 'oklch(0.899 0.016 262.7)',
      brightBlack: 'oklch(0.456 0.025 260.8)',
      brightRed: 'oklch(0.627 0.148 25.4)',
      brightGreen: 'oklch(0.771 0.126 138.9)',
      brightYellow: 'oklch(0.838 0.118 90.2)',
      brightBlue: 'oklch(0.712 0.086 240.5)',
      brightPurple: 'oklch(0.702 0.122 316.4)',
      brightCyan: 'oklch(0.825 0.068 201.3)',
      brightWhite: 'oklch(0.938 0.012 263.9)',
    },
  },
  {
    slug: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    isDark: true,
    colors: {
      background: 'oklch(0.243 0.03 283.9)',
      foreground: 'oklch(0.879 0.043 272.3)',
      selection: 'oklch(0.395 0.042 277.6)',
      black: 'oklch(0.324 0.038 280.2)',
      red: 'oklch(0.712 0.174 16.5)',
      green: 'oklch(0.824 0.148 139.7)',
      yellow: 'oklch(0.874 0.134 94.6)',
      blue: 'oklch(0.742 0.122 254.8)',
      purple: 'oklch(0.785 0.146 312.4)',
      cyan: 'oklch(0.832 0.098 198.5)',
      white: 'oklch(0.879 0.043 272.3)',
      brightBlack: 'oklch(0.442 0.045 275.4)',
      brightRed: 'oklch(0.712 0.174 16.5)',
      brightGreen: 'oklch(0.824 0.148 139.7)',
      brightYellow: 'oklch(0.874 0.134 94.6)',
      brightBlue: 'oklch(0.742 0.122 254.8)',
      brightPurple: 'oklch(0.785 0.146 312.4)',
      brightCyan: 'oklch(0.832 0.098 198.5)',
      brightWhite: 'oklch(0.938 0.024 270.8)',
    },
  },
  {
    slug: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    isDark: false,
    colors: {
      background: 'oklch(0.962 0.015 272.1)',
      foreground: 'oklch(0.372 0.045 274.6)',
      selection: 'oklch(0.865 0.028 273.8)',
      black: 'oklch(0.372 0.045 274.6)',
      red: 'oklch(0.582 0.185 18.2)',
      green: 'oklch(0.684 0.158 141.2)',
      yellow: 'oklch(0.734 0.145 92.4)',
      blue: 'oklch(0.592 0.142 256.1)',
      purple: 'oklch(0.645 0.166 314.8)',
      cyan: 'oklch(0.692 0.118 199.7)',
      white: 'oklch(0.962 0.015 272.1)',
      brightBlack: 'oklch(0.512 0.042 274.1)',
      brightRed: 'oklch(0.582 0.185 18.2)',
      brightGreen: 'oklch(0.684 0.158 141.2)',
      brightYellow: 'oklch(0.734 0.145 92.4)',
      brightBlue: 'oklch(0.592 0.142 256.1)',
      brightPurple: 'oklch(0.645 0.166 314.8)',
      brightCyan: 'oklch(0.692 0.118 199.7)',
      brightWhite: 'oklch(0.985 0.008 271.4)',
    },
  },
  {
    slug: 'dracula',
    name: 'Dracula',
    isDark: true,
    colors: {
      background: 'oklch(0.288 0.022 277.5)',
      foreground: 'oklch(0.978 0.008 106.5)',
      selection: 'oklch(0.395 0.038 276.4)',
      black: 'oklch(0.215 0.018 280.1)',
      red: 'oklch(0.685 0.198 21.4)',
      green: 'oklch(0.854 0.182 135.2)',
      yellow: 'oklch(0.912 0.152 101.4)',
      blue: 'oklch(0.724 0.148 296.8)',
      purple: 'oklch(0.758 0.184 329.5)',
      cyan: 'oklch(0.865 0.124 190.2)',
      white: 'oklch(0.978 0.008 106.5)',
      brightBlack: 'oklch(0.485 0.032 274.9)',
      brightRed: 'oklch(0.725 0.208 22.1)',
      brightGreen: 'oklch(0.884 0.188 136.1)',
      brightYellow: 'oklch(0.942 0.158 102.1)',
      brightBlue: 'oklch(0.754 0.152 297.2)',
      brightPurple: 'oklch(0.788 0.188 330.1)',
      brightCyan: 'oklch(0.895 0.128 191.1)',
      brightWhite: 'oklch(0.995 0.004 105.2)',
    },
  },
];
