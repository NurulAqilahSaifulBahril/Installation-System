// Suggested mounting structure quantities, fitted to the staff's own MIBET record
// ("Mounting Structure Record (MIBET)"), not to a textbook layout.
//
// What the record showed (panels -> parts):
//   Leong Chee Wei   16 panels  rail 4x3.6M + 10x2.4M (38.4 m)  tile hook 36+8  mid 24  earthing 24  end 24
//   Ong Boon Lee     11 panels  rail 6x3.6M +  2x2.4M (26.4 m)  tile hook 30     mid 14  earthing 14  end 16
//   Kien Hin factory 90 panels  rail 60x3.6M + 1x2.4M (218 m)    L-feet c/w 210  mid 160 earthing 160 end 40
// From those three jobs:
//   - rail is about 2.4 m per panel (the rails run along the panel's short side);
//   - hooks are about 2.75 per panel on tile, about 2.3 on metal (L-feet);
//   - end clamps are 4 per run of panels on one pair of rails, and mid clamps are 2 per
//     panel join, i.e. 2 x (panels - runs) - exact for two of the three jobs;
//   - earthing clips are recorded equal to the mid clamps;
//   - bolt & nut is not recorded per job, so nothing is suggested for it;
//   - the split between 3.6M and 2.4M lengths varies job to job: long runs were nearly all
//     3.6M, short runs mixed both. Only a starting split is suggested; the warehouse chooses.
// Three jobs is a thin base: the warehouse confirms every figure, and the ratios should
// be re-fitted when more rows of the record are available.

export type MountingSystemId = "mibet" | "winstar";
export type RoofType = "tile" | "metal" | "kliplock" | "standing" | "trapezoidal" | "flat";
export type Orientation = "portrait" | "landscape";

export type MountingEstimateInput = {
  system: MountingSystemId;
  roof: RoofType;
  // Only used for flat-roof ballast frames; pitched-roof ratios do not depend on it.
  orientation: Orientation;
  panels: number;
  // Runs of panels that each sit on their own pair of rails (from the PV drawing).
  rows: number;
};

export type MountingEstimate = {
  // Part name (as listed in MOUNTING_SYSTEMS) -> suggested quantity.
  parts: Record<string, number>;
  notes: string[];
};

export const ROOF_OPTIONS: Array<[RoofType, string]> = [
  ["tile", "Tile roof"],
  ["metal", "Metal roof (L-feet / L-bracket)"],
  ["kliplock", "Kliplock roof"],
  ["standing", "Standing seam roof"],
  ["trapezoidal", "Trapezoidal metal roof"],
  ["flat", "Flat roof (ballast)"],
];

const RAIL_M_PER_PANEL = 2.4;
const RAIL_LONG_M = 3.6;
const RAIL_SHORT_M = 2.4;
const SPLICES_PER_PANEL = 0.15;
const HOOKS_PER_PANEL_TILE = 2.75;
const HOOKS_PER_PANEL_METAL = 2.33;
// No staff data for the other roof types yet: use the average of the two known ratios.
const HOOKS_PER_PANEL_OTHER = 2.5;

function hookPartName(system: MountingSystemId, roof: RoofType): string | null {
  if (roof === "flat") return null;
  // The staff record shows plain "Tile hook" even on landscape layouts.
  if (roof === "tile") return "Tile hook";
  if (roof === "kliplock") return "Kliplock";
  if (roof === "standing") return "Standing seam base grip";
  if (roof === "trapezoidal") return system === "mibet" ? "Trapezoidal roof support" : "L-bracket c/w screw";
  return system === "mibet" ? "L-feet c/w screw" : "L-bracket c/w screw";
}

function hooksPerPanel(roof: RoofType): number {
  if (roof === "tile") return HOOKS_PER_PANEL_TILE;
  if (roof === "metal") return HOOKS_PER_PANEL_METAL;
  return HOOKS_PER_PANEL_OTHER;
}

export function estimateMounting(input: MountingEstimateInput): MountingEstimate {
  const panels = Math.max(0, Math.floor(input.panels));
  const parts: Record<string, number> = {};
  if (panels === 0) return { parts, notes: ["No panel count, so nothing to suggest."] };
  const runs = Math.min(panels, Math.max(1, Math.floor(input.rows)));

  const notes: string[] = [
    "Fitted to three jobs in the staff's MIBET record (about 2.4 m of rail and 2.75 tile hooks per panel). Confirm each quantity.",
  ];

  // Clamps follow the layout: 4 end clamps per run, 2 mid clamps per join; earthing clips match the mid clamps.
  const mid = 2 * (panels - runs);
  const end = 4 * runs;

  if (input.roof === "flat") {
    if (input.system === "winstar") {
      notes.push("WINSTAR has no ballast system in its list; enter the flat-roof parts by hand.");
      return { parts, notes };
    }
    // No staff data for flat roofs: ballast frames carrying 3 panels, adjusted by hand.
    parts[input.orientation === "landscape" ? "3 panels landscape" : "3 panels portrait"] = Math.ceil(panels / 3);
    parts["Mid clamp"] = mid;
    parts["End clamp"] = end;
    parts["Earthing clip"] = mid;
    notes.push("Flat roof: no staff data yet. Frames are suggested as 3-panel units; adjust if the drawing differs.");
    return { parts, notes };
  }

  // Rail: total length from the per-panel ratio, split half and half as a starting mix.
  const totalRail = panels * RAIL_M_PER_PANEL;
  // Long runs (6+ panels each) were almost all 3.6M lengths in the record; short runs mixed both.
  if (panels / runs >= 6) {
    parts["3.6M"] = Math.round(totalRail / RAIL_LONG_M);
    parts["2.4M"] = 0;
  } else {
    parts["3.6M"] = Math.round(totalRail / 2 / RAIL_LONG_M);
    parts["2.4M"] = Math.round(totalRail / 2 / RAIL_SHORT_M);
  }
  parts["Rail splice"] = Math.ceil(panels * SPLICES_PER_PANEL);

  const hook = hookPartName(input.system, input.roof);
  if (hook) parts[hook] = Math.round(panels * hooksPerPanel(input.roof));

  parts["Mid clamp"] = mid;
  parts["End clamp"] = end;
  parts["Earthing clip"] = mid;

  notes.push(
    `About ${totalRail.toFixed(1)} m of rail in total. The 3.6M / 2.4M split is only a starting point: choose the real mix.`,
  );
  if (input.roof !== "tile" && input.roof !== "metal") {
    notes.push("Hook count for this roof type has no staff data yet (average of tile and metal used).");
  }
  return { parts, notes };
}
