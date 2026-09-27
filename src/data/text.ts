/**
 * Text as two French spellings of it are compared: surrounding space, case and
 * accents removed. On a phone keyboard "liberte" and "Liberté", or "controle"
 * and "Contrôle", are the same word typed twice.
 *
 * The one definition of "same text" for the activity catalogue's dedupe, the
 * list search and the combobox's filter, so the three cannot disagree about
 * what a match is.
 */
export const foldText = (text: string): string =>
  text
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("fr-FR");
