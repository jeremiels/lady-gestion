import type { ThemeKey, ThemeMeta } from './theme.types.ts';

export const THEME_META: Record<ThemeKey, ThemeMeta> = {
  pink: {
    color: 'var(--color-theme-pink)',
    backgroundColor: 'var(--color-theme-pink-background)',
  },
  green: {
    color: 'var(--color-theme-green)',
    backgroundColor: 'var(--color-theme-green-background)',
  },
  purple: {
    color: 'var(--color-theme-purple)',
    backgroundColor: 'var(--color-theme-purple-background)',
  },
  orange: {
    color: 'var(--color-theme-orange)',
    backgroundColor: 'var(--color-theme-orange-background)',
  },
  brown: {
    color: 'var(--color-theme-brown)',
    backgroundColor: 'var(--color-theme-brown-background)',
  },
  yellow: {
    color: 'var(--color-theme-yellow)',
    backgroundColor: 'var(--color-theme-yellow-background)',
  },
  taupe: {
    color: 'var(--color-theme-taupe)',
    backgroundColor: 'var(--color-theme-taupe-background)',
  },
  turquoise: {
    color: 'var(--color-theme-turquoise)',
    backgroundColor: 'var(--color-theme-turquoise-background)',
  },
  fuchsia: {
    color: 'var(--color-theme-fuchsia)',
    backgroundColor: 'var(--color-theme-fuchsia-background)',
  },
};

export type { ThemeKey, ThemeMeta };
