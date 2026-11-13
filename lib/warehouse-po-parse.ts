import { extractText, getDocumentProxy } from "unpdf";

// Reads an uploaded purchase order (PO) PDF for the Stock In table: its item lines (Item Code,
// Qty), its date and a guessed item type. Works on text PDFs laid out like the supplier's PO:
//
//   Date : 29/10/2026
//   Item Item Code Description UOM Qty U/ Price Disc. Total
//   1. SP-JKM-650N SOLAR MODULE JKM650N-66QL6-BDV PC 2,590 302.5 783,475.00
//
// Scanned (image-only) PDFs and other file types have no text to read and give nothing.

export type PoLine = {
  itemCode: string;
  description: string;
  uom: string;
  qty: number;
};

// An item starts "1. CODE ..." and ends with "UOM QTY PRICE [DISC] TOTAL": the unit is a short
// capitalised word (PC, PCS, UNIT, SET, ROLL, M, ...) followed by the quantity and the prices.
// A long description can wrap, so the end may be on a later text line, e.g.
//   1. EK60-B3-16LV EK60-B3-16LV LOW VOLTAGE LITHIUM
//   ENERGY STORAGE SYSTEM (ESS)
//   PC 79 5,553.42 438,720.18
const ITEM_START = /^\s*\d+\.\s+(\S+)\s*(.*)$/;
const NUMBER = String.raw`[\d,]+(?:\.\d+)?`;
const ITEM_END = new RegExp(String.raw`(?:^|\s)([A-Z]{1,6})\s+(${NUMBER})(?:\s+${NUMBER}){1,3}\s*$`);
// An item's text is at most this many lines (start, wrapped description, end).
const MAX_ITEM_LINES = 5;

export function parsePoText(text: string): PoLine[] {
  const lines: PoLine[] = [];
  const rows = text.split(/\r?\n/);
  for (let i = 0; i < rows.length; i += 1) {
    const start = rows[i].match(ITEM_START);
    if (!start) continue;
    // Join this row with the following ones until the "UOM QTY PRICE TOTAL" end appears.
    let joined = rows[i];
    for (let k = 0; k < MAX_ITEM_LINES; k += 1) {
      const end = joined.match(ITEM_END);
      if (end && end.index !== undefined) {
        const qty = Number(end[2].replace(/,/g, ""));
        const body = joined.slice(0, end.index).replace(ITEM_START, "$2").replace(/\s+/g, " ").trim();
        if (Number.isFinite(qty)) lines.push({ itemCode: start[1], description: body, uom: end[1], qty });
        i += k; // continue after the rows used by this item
        break;
      }
      const next = rows[i + k + 1];
      if (next === undefined || ITEM_START.test(next)) break; // the next item starts: give up on this one
      joined = `${joined} ${next}`;
    }
  }
  return lines;
}

// "Date : 29/10/2026" on the PO (day/month/year) as YYYY-MM-DD, or "" when there is none.
export function parsePoDate(text: string): string {
  const match = text.match(/\bDate\s*:\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/i);
  if (!match) return "";
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// What the PO is for, guessed from its lines (staff can change it on the Stock In table).
// One of PO_ITEM_TYPES, or "" when the lines do not say.
export function guessItemType(lines: PoLine[]): string {
  const text = lines.map((line) => `${line.itemCode} ${line.description}`).join(" ").toUpperCase();
  if (/SOLAR MODULE|\bPANEL\b|\bPV MODULE\b|\bJKM\d|\bJINKO\b|\bASTRONERGY\b/.test(text)) return "panel";
  if (/INVERTER/.test(text)) return "inverter";
  if (/BATTERY|\bLIFEPO4\b|LITHIUM|ENERGY STORAGE|\bESS\b/.test(text)) return "battery";
  if (/\bRAIL\b|MOUNTING|\bCLAMP\b|\bHOOK\b|\bL-FEET\b/.test(text)) return "mounting";
  if (/TRUNKING|CABLE GLAND|\bHDG\b/.test(text)) return "special";
  if (/BREAKER|\bSPD\b|\bCABLE\b|\bDB BOX\b|\bMETER\b|ISOLATOR/.test(text)) return "electrical";
  return "";
}

// What can be read from a PO file: its item lines, its date ("" if none) and a guessed item type.
export type PoReading = { lines: PoLine[]; date: string; itemType: string };

export async function readPo(bytes: Uint8Array, mimeType: string): Promise<PoReading> {
  if (mimeType !== "application/pdf") return { lines: [], date: "", itemType: "" };
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const all = Array.isArray(text) ? text.join("\n") : text;
    const lines = parsePoText(all);
    return { lines, date: parsePoDate(all), itemType: guessItemType(lines) };
  } catch {
    return { lines: [], date: "", itemType: "" };
  }
}

// The PO's item lines, or [] when the file is not a readable PDF.
export async function readPoLines(bytes: Uint8Array, mimeType: string): Promise<PoLine[]> {
  return (await readPo(bytes, mimeType)).lines;
}
