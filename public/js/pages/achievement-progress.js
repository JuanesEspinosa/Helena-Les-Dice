// Frase de avance hacia un logro ("Faltan 2 secciones por aprobar"…), compartida por el tablero y los logros.
// El servidor manda `key` + cifras; si no hay traducción se usa su `label` en español.
import { t, has } from '../core/i18n.js';

// En estas frases el plural depende de lo que falta, no de la meta
const COUNTS_WHAT_IS_LEFT = new Set(['sectionsLeft', 'commentsLeft']);

export function progressLabel(progress) {
  if (!progress) return '';
  const key = `student.progress.${progress.key}`;
  if (!progress.key || !has(key)) return progress.label || '';
  const left = progress.target - progress.current;
  return t(key, { current: progress.current, count: COUNTS_WHAT_IS_LEFT.has(progress.key) ? left : progress.target });
}
