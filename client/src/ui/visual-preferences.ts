import { useEffect } from 'react';
export const VISUAL_PREFERENCES_EVENT = 'pz-visual-preferences';
const key = 'pz_visual_preferences';
let unsaved: VisualPreferences | null = null;
export const TEXT_SCALES = [1, 1.25, 1.5, 2] as const;
export interface VisualPreferences {
  textScale: number;
  reducedMotion: boolean;
}
export function visualPreferences(value: unknown): VisualPreferences {
  const input = value && typeof value === 'object' ? (value as Partial<VisualPreferences>) : {};
  return {
    textScale: TEXT_SCALES.some((scale) => scale === input.textScale) ? input.textScale! : 1,
    reducedMotion: input.reducedMotion === true,
  };
}
export function readVisualPreferences(): VisualPreferences {
  if (unsaved) return unsaved;
  try {
    return visualPreferences(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return visualPreferences(null);
  }
}
export function saveVisualPreferences(value: VisualPreferences): boolean {
  const safe = visualPreferences(value);
  let saved = true;
  try {
    localStorage.setItem(key, JSON.stringify(safe));
  } catch {
    saved = false;
  }
  unsaved = saved ? null : safe;
  window.dispatchEvent(new CustomEvent(VISUAL_PREFERENCES_EVENT, { detail: safe }));
  return saved;
}
export function useVisualPreferences() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = (value: VisualPreferences) => {
      root.style.setProperty('--web-font-scale', String(value.textScale));
      root.dataset.reducedMotion = String(value.reducedMotion);
    };
    const update = (event: Event) => {
      if (event.type === 'storage') unsaved = null;
      apply(event instanceof CustomEvent ? visualPreferences(event.detail) : readVisualPreferences());
    };
    apply(readVisualPreferences());
    window.addEventListener('storage', update);
    window.addEventListener(VISUAL_PREFERENCES_EVENT, update);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener(VISUAL_PREFERENCES_EVENT, update);
      root.style.removeProperty('--web-font-scale');
      delete root.dataset.reducedMotion;
    };
  }, []);
}
