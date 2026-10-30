import type { InstallationJob } from "@/lib/types";

export function extractPanelBrand(text: string): string {
  if (!text) return "";
  if (/jinko/i.test(text)) return "Jinko";
  if (/astronergy/i.test(text)) return "Astronergy";
  if (/ja\s*solar/i.test(text)) return "JA Solar";
  if (/longi/i.test(text)) return "Longi";
  if (/trina/i.test(text)) return "Trina";
  if (/canadian/i.test(text)) return "Canadian Solar";
  return "";
}

/**
 * Extracts only the panel specification line from a potentially multiline text
 * (such as invoice package descriptions that include inverters, SEDA, mounting, cables, etc.).
 */
export function extractPanelLine(text: string | null | undefined): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return "";

  // 1. Look for line with solar panel brand/model/panel keywords, avoiding inverter/service components
  for (const line of lines) {
    const isSolarKeyword =
      /\b(panel|panels|jinko|jinkosolar|astronergy|longi|trina|ja\s*solar|canadian\s*solar|risen|topcon|bi-?facial|tiger\s*neo)\b/i.test(line);
    const isNotComponent =
      !/\b(inverter|battery|seda|tnb|smart\s*meter|skylift|mounting|cable|works|design|surveying|application)\b/i.test(line);
    if (isSolarKeyword && isNotComponent) {
      return line;
    }
  }

  // 2. Look for line starting with quantity like 11X or 11 pcs or (22+1)X, not an inverter/component
  for (const line of lines) {
    const isQty = /^\(?\d+(?:\+\d+)?\)?\s*(?:[xX×]|pcs|panels?\b)/i.test(line);
    const isNotComponent =
      !/\b(inverter|battery|seda|tnb|smart\s*meter|skylift|mounting|cable|works|design|surveying|application)\b/i.test(line);
    if (isQty && isNotComponent) {
      return line;
    }
  }

  return lines[0];
}

/**
 * Checks if a string is a detailed panel specification from the database,
 * such as "11X 650W JinkoSolar TIGER NEO 3.0 Panel N-Type TOPCon".
 */
export function isDetailedPanelLine(line: string | null | undefined): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  const hasQtyLead = /^\(?\d+(?:\+\d+)?\)?\s*[xX×]\b/i.test(trimmed);
  const hasPanelKeywords =
    /\b(panel|topcon|tiger|bi-?facial|n-type|astronergy|longi|trina|jinko|solar)\b/i.test(trimmed);
  return hasQtyLead && hasPanelKeywords;
}

/**
 * Returns the exact panel column text for a job.
 * On both 'Arranged Installation' and 'Propose to Install',
 * prioritizes pulling the detailed panel line directly from the database
 * (example: '11X 650W JinkoSolar TIGER NEO 3.0 Panel N-Type TOPCon')
 * rather than truncating it or showing multiline invoice details.
 */
export function formatPanelDisplay(job: InstallationJob): string {
  // 1. Check packageName (which comes directly from database invoice_item package line)
  const pkgPanelLine = extractPanelLine(job.packageName);
  if (isDetailedPanelLine(pkgPanelLine)) {
    return pkgPanelLine;
  }

  // 2. Check powerOutput (if it has detailed panel line or multiline with panel line)
  const poPanelLine = extractPanelLine(job.powerOutput);
  if (isDetailedPanelLine(poPanelLine)) {
    return poPanelLine;
  }

  // 3. Check panelDetails
  const pdPanelLine = extractPanelLine(job.panelDetails);
  if (isDetailedPanelLine(pdPanelLine)) {
    return pdPanelLine;
  }

  // 4. If powerOutput was manually typed and not generic placeholder, use it
  if (poPanelLine && poPanelLine !== "Not available") {
    return poPanelLine;
  }

  // 5. If pkgPanelLine exists and is not an EV charger or generic label
  if (
    pkgPanelLine &&
    !/ev\s*charger/i.test(pkgPanelLine) &&
    pkgPanelLine !== "Not available" &&
    pkgPanelLine !== "Solar PV System"
  ) {
    return pkgPanelLine;
  }

  // 6. Fallback: synthesize from brand, quantity, rating if available
  const existing = poPanelLine || "";
  const brand =
    extractPanelBrand(existing) ||
    extractPanelBrand(job.packageName || "") ||
    extractPanelBrand(job.panelDetails || "") ||
    extractPanelBrand(job.remarks || "") ||
    extractPanelBrand(job.installationRemarks || "") ||
    extractPanelBrand(job.availabilityRemarks || "");

  const qty =
    job.panelQuantity ??
    (() => {
      const m = (job.packageName || existing).match(/(\d+)\s*(?:pcs|panels\b|[xX×]\b)/i);
      return m ? Number(m[1]) : null;
    })();

  const rating =
    job.panelRating ??
    (() => {
      const m = (job.packageName || existing).match(/(\d{3,4})\s*W(?:p|att)?\b/i);
      return m ? Number(m[1]) : null;
    })();

  if (qty && brand && rating) return `${qty} ${brand} ${rating}W`;
  if (qty && brand) return `${qty} ${brand}`;
  if (brand && rating) return `${brand} ${rating}W`;
  if (brand) return brand;
  if (qty && rating) return `${qty} × ${rating}W`;
  if (qty) return `${qty} panels`;
  if (rating) return `${rating}W`;
  return existing;
}
