// Sorts an invoice's item lines into the groups the warehouse works with.
//
// The invoice text lists one item per line, e.g.
//   "26X 650W JinkoSolar TIGER NEO 3.0 Panel N-Type TOPCon"
//   "1X [3P] SAJ H2 12KW THREE PHASE Hybird Inverter"
//   "MIBET Solar Mounting Structure"
//   "MasterTec Solar DC Cable"
// Rules come from example wording only (not yet checked against every invoice), so
// a line that matches nothing is simply left out rather than guessed.

export type InvoiceLineGroup = "panel" | "inverter" | "battery" | "mounting" | "electrical";

export type InvoiceLine = {
  group: InvoiceLineGroup;
  // Description without the leading count ("26X ").
  name: string;
  // Count written on the invoice line, or null when the line has none.
  qty: number | null;
};

// "26X 650W JinkoSolar …" -> { qty: 26, name: "650W JinkoSolar …" }; "26 Jinko 620W" the same.
export function parseCountedItem(text: string): { qty: number | null; name: string } {
  const first =
    (text || "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) ?? "";
  const match = first.match(/^(\d+)\s*[xX]?\s+(.*)$/);
  if (match) return { qty: Number(match[1]), name: match[2].trim() };
  return { qty: null, name: first };
}

// Services and paperwork on an invoice: never stock.
const SERVICE = /seda|tnb|smart meter|application|design|survey|architecture|installation|electrical works|electrical system|skylift|sky lift|permit|warranty|labou?r|n\/a/i;
const MOUNTING = /mounting|mibet|winstar|railing|\brail\b|bracket|clamp|\bhook/i;
const ELECTRICAL = /\bats\b|cable|wiring|connector|ballast|isolator|breaker|db box|trunking/i;
const INVERTER = /inverte/i;
const BATTERY = /battery|batt\b/i;
const PANEL = /panel|jinko|astronergy|longi|trina|canadian solar|solar module/i;

export function classifyInvoiceLines(texts: string[]): InvoiceLine[] {
  const seen = new Set<string>();
  const result: InvoiceLine[] = [];

  texts
    .flatMap((text) => (text || "").split("\n"))
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((raw) => {
      const key = raw.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      // Package texts list items as "- MIBET Solar Mounting Structure": drop the bullet.
      let cleaned = raw;
      while (cleaned.length > 0 && "-*• ".includes(cleaned[0])) cleaned = cleaned.slice(1);
      const { qty, name } = parseCountedItem(cleaned);
      if (!name || SERVICE.test(name)) return;

      let group: InvoiceLineGroup | null = null;
      if (MOUNTING.test(name)) group = "mounting";
      else if (ELECTRICAL.test(name)) group = "electrical";
      else if (INVERTER.test(name)) group = "inverter";
      else if (BATTERY.test(name)) group = "battery";
      else if (PANEL.test(name)) group = "panel";

      if (group) result.push({ group, name, qty });
    });

  return result;
}
