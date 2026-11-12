// Standardise a person's name to Title Case: "KOW KOK YONG" and "kow kok yong" both
// become "Kow Kok Yong". A letter is capitalised at the start and after a space, hyphen,
// apostrophe, slash or opening bracket; all other letters are lower-cased.
export function toTitleCase(value: string): string {
  const separators = " -'/(";
  let result = "";
  let capitalizeNext = true;
  for (const ch of value.trim().replace(/ +/g, " ")) {
    result += capitalizeNext ? ch.toUpperCase() : ch.toLowerCase();
    capitalizeNext = separators.includes(ch);
  }
  return result;
}
