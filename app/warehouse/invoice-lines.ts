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

// "Change To" on an invoice is a swap, not a second item:
//   "1X [3P] SAJ H2-8K-LT2 Hybrid Inverter"
//   "Change To"
//   "1X [3P] SAJ H2-12K-LT2 Hybrid Inverter"
// is one inverter, the 12K (CHANG CHU YING). The same swap can sit on one line
// ("1X … 8K … Change To 1X … 12K …").
const CHANGE_TO = /\bchange\s*to\b/i;

function groupOf(name: string): InvoiceLineGroup | null {
  if (MOUNTING.test(name)) return "mounting";
  if (ELECTRICAL.test(name)) return "electrical";
  if (INVERTER.test(name)) return "inverter";
  if (BATTERY.test(name)) return "battery";
  if (PANEL.test(name)) return "panel";
  return null;
}

// Description and count of one item text: bullet dropped, services left out (null).
function readItem(text: string): InvoiceLine | null {
  // Package texts list items as "- MIBET Solar Mounting Structure": drop the bullet.
  let cleaned = text.trim();
  while (cleaned.length > 0 && "-*• ".includes(cleaned[0])) cleaned = cleaned.slice(1);
  const { qty, name } = parseCountedItem(cleaned);
  if (!name || SERVICE.test(name)) return null;
  const group = groupOf(name);
  return group ? { group, name, qty } : null;
}

export function classifyInvoiceLines(texts: string[]): InvoiceLine[] {
  const seen = new Set<string>();
  const result: InvoiceLine[] = [];
  // The item a "Change To" swaps out: the next item of its group replaces it.
  let swapOut: InvoiceLine | null = null;
  // A "Change To" line was just read; the item it names comes on a later line.
  let changePending = false;

  // The new item takes the old one's place (same group); with no old one to replace, it is added.
  const replace = (old: InvoiceLine | null, item: InvoiceLine) => {
    const at = old && old.group === item.group ? result.indexOf(old) : -1;
    if (at >= 0) result[at] = item;
    else {
      // Otherwise the last item of that group before the swap, if any.
      const last = result.map((line) => line.group).lastIndexOf(item.group);
      if (last >= 0) result[last] = item;
      else result.push(item);
    }
  };

  texts
    .flatMap((text) => (text || "").split("\n"))
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((raw) => {
      const key = raw.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);

      const change = raw.match(CHANGE_TO);
      if (change) {
        const before = raw.slice(0, change.index).trim();
        const after = raw.slice((change.index ?? 0) + change[0].length).replace(/^[\s:.\-–>]+/, "").trim();
        const oldItem = before ? readItem(before) : null;
        // "old Change To new" on one line: the old one is replaced if it was listed already.
        const old = oldItem
          ? result.find((line) => line.group === oldItem.group && line.name.toLowerCase() === oldItem.name.toLowerCase()) ?? null
          : result[result.length - 1] ?? null;
        const newItem = after ? readItem(after) : null;
        if (newItem) {
          replace(old, newItem);
          changePending = false;
          swapOut = null;
        } else {
          // "Change To" alone (or with nothing readable after it): the next item replaces.
          if (oldItem && !old) result.push(oldItem);
          swapOut = old ?? (oldItem ? result[result.length - 1] : null);
          changePending = true;
        }
        return;
      }

      const item = readItem(raw);
      if (!item) return;
      if (changePending) {
        replace(swapOut, item);
        changePending = false;
        swapOut = null;
        return;
      }
      result.push(item);
    });

  return result;
}
