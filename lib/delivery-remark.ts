// Delivery Schedule "Remark": the stock notes with the address / timestamp lines and pure
// inverter spec lines taken out. Shared by the dashboard and the Inventory Management page.

function isDeliveryAddressOrTimestamp(line: string): boolean {
  const l = line.trim();
  if (
    /^(?:no\.?\s*\d+|lot\s*\d+|ptd\s*\d+|\d+,\s*jln|\d+\s+jln)/i.test(l) &&
    /(?:tmn|taman|jalan|bdr|bandar|johor|selangor|klang|skudai)/i.test(l)
  ) {
    return true;
  }
  if (/^(?:mon|tue|wed|thu|thur|fri|sat|sun)\s*\d+\s*-\s*\d+(?:am|pm)/i.test(l)) {
    return true;
  }
  return false;
}

function isPureInverterSpec(line: string): boolean {
  const l = line.trim();
  if (!l || l === "+" || l === "&") return true;

  // Operational instructions / locations / actions are NOT pure inverter specs
  if (
    /(?:office|car|bring|reach|stage|pass|leaking|done|visit|pending job|check|arrange|stone|cancel|hold|request|delivery on|inform|cable|roof)/i.test(
      l,
    )
  ) {
    return false;
  }

  // Stock items like Battery, ATS, Wallbox, Ballast, EV are warehouse stock, NOT inverter
  if (
    /(?:battery|base|ats|wallbox|charger|ballast|rccb|bracket|clamp|cable|rail)/i.test(
      l,
    )
  ) {
    return false;
  }

  // Pure inverter spec / swap pattern
  const invSpec =
    /^(?:[▶️✅❌➡️*#–\-=\s>》])*(?:\d+\s*[xX]\s*)?(?:R[56]|H[123]|M2|SUN2000|SAJ\s+R[56])(?:-[0-9]+[A-Za-z0-9.-]*)?(?:\s+Inverter|\s*\((?:HYBRID|STRING|MICRO)\s+INVERTER\))?(?:\s+(?:Single|Three)\s+phase)?(?:[▶️✅❌➡️*#–\-=\s>》✅❌])*$/i;

  if (invSpec.test(l)) return true;

  // Standalone phrases like "Hybrid Inverter", "String Inverter", "Micro Inverter"
  if (
    /^(?:[▶️✅❌➡️*#–\-=\s>》])*(?:Hybrid|String|Micro)\s+Inverter(?:[▶️✅❌➡️*#–\-=\s>》])*$/i.test(
      l,
    )
  ) {
    return true;
  }

  // Multi-inverter swap on single line: e.g. "❌1 X R6-8K-T2 =》✅1 X R6-10K-T2"
  if (
    l.includes("=>") ||
    l.includes("=》") ||
    l.includes("➡️") ||
    l.includes("->")
  ) {
    const parts = l.split(/(?:=>|=》|➡️|->)/);
    if (
      parts.length === 2 &&
      parts.every((p) => invSpec.test(p.trim()) || p.trim() === "")
    ) {
      return true;
    }
  }

  return false;
}

export function cleanDeliveryStockRemark(stock: string): string {
  if (!stock) return "";
  const lines = stock
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const remainingLines: string[] = [];

  for (const l of lines) {
    if (isDeliveryAddressOrTimestamp(l)) continue;
    if (isPureInverterSpec(l)) continue;
    remainingLines.push(l);
  }

  const cleaned = remainingLines.filter(
    (l) => l !== "+" && l !== "&" && l.trim() !== "",
  );
  return cleaned.join("\n");
}
