const RTL_CHARACTER = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/u;
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u;

export function textDirection(value: string): "rtl" | "ltr" | "auto" {
  for (const character of value) {
    if (!LETTER_OR_NUMBER.test(character)) continue;
    return RTL_CHARACTER.test(character) ? "rtl" : "ltr";
  }
  return "auto";
}
