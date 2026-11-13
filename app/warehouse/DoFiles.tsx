"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./warehouse.module.css";

// Purchase order (PO) upload for the Stock In screen. Uploaded POs show as rows of the
// Stock In table. Uploading is for admins (checked on the server); any signed-in
// dashboard user can list and open the files.

const MAX_BYTES = 10 * 1024 * 1024;

export type DoFile = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  note: string;
  uploadedBy: string;
  uploadedAt: string;
  // Date written on the PO (YYYY-MM-DD), entered at upload; "" for older uploads.
  poDate: string;
  // What the PO is for (panel, inverter, ...), chosen at upload; "" for older uploads.
  itemType: string;
  // Item lines read from the PO PDF (empty when the file has no readable lines).
  poLines: { itemCode: string; description: string; uom: string; qty: number }[];
  // Stock In verification of the PO ("" until every unit was scanned and Verified pressed).
  verifiedAt: string;
  verifiedBy: string;
};

// Item types a PO can be for, named like the stock cards (Home / Stock Details). Used by the
// upload box and the Stock In "Item Type" column.
export const PO_ITEM_TYPE_OPTIONS: [string, string][] = [
  ["panel", "Panel"],
  ["inverter", "Inverter"],
  ["battery", "Battery"],
  ["mounting", "Mounting Structure"],
  ["electrical", "Electrical Item"],
  ["special", "Special Material"],
];

function todayInMalaysia(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

// The day a PO belongs to: its own date, or the upload day for POs uploaded before the date was asked.
export function poDay(file: DoFile): string {
  return file.poDate || new Date(file.uploadedAt).toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function useDoFiles(enabled: boolean) {
  const [files, setFiles] = useState<DoFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/warehouse/do-files", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) {
        setError("Sign in to the dashboard (same browser) to see purchase orders.");
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { files?: DoFile[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load the purchase orders.");
      setFiles(body.files ?? []);
      setError(null);
      return body.files ?? [];
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the purchase orders.");
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  // Resolves to the uploaded PO's day (its own date when the PO shows one), or null on failure.
  async function upload(file: File): Promise<string | null> {
    setMessage(null);
    if (file.size > MAX_BYTES) {
      setMessage({ ok: false, text: `That file is ${formatSize(file.size)}. The limit is 10 MB.` });
      return null;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/warehouse/do-files", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
      if (response.status === 401 || response.status === 403) {
        throw new Error("Only a signed-in dashboard admin can upload purchase orders.");
      }
      if (!response.ok) throw new Error(body.error || "Could not upload the file.");
      setMessage({ ok: true, text: `Uploaded ${file.name}.` });
      // Record it in the Inventory Management audit log.
      void fetch("/api/warehouse/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "do_uploaded",
          entityType: "do_file",
          entityId: body.id,
          summary: `Uploaded purchase order (PO) "${file.name}" (${formatSize(file.size)})`,
        }),
      }).catch(() => {});
      const fresh = await load();
      const saved = fresh?.find((row) => row.id === body.id);
      return saved ? poDay(saved) : todayInMalaysia();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not upload the file." });
      return null;
    } finally {
      setBusy(false);
    }
  }

  // Change a PO's item type (admins). The row updates at once; a failed save puts it back.
  async function setItemType(id: string, itemType: string): Promise<void> {
    const before = files.find((file) => file.id === id)?.itemType ?? "";
    setFiles((prev) => prev.map((file) => (file.id === id ? { ...file, itemType } : file)));
    try {
      const response = await fetch(`/api/warehouse/do-files/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ itemType }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "Could not save the item type.");
      }
      setMessage(null);
    } catch (err) {
      setFiles((prev) => prev.map((file) => (file.id === id ? { ...file, itemType: before } : file)));
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not save the item type." });
    }
  }

  // After a PO is verified on its Stock In Verification page: move its row to Verified.
  function markVerified(id: string, verifiedAt: string, verifiedBy: string) {
    setFiles((prev) => prev.map((file) => (file.id === id ? { ...file, verifiedAt, verifiedBy } : file)));
  }

  return { files, error, busy, message, upload, setItemType, markVerified };
}

// The Upload PO button (admins): opens the file picker (any file type). The PO date and item
// type are read from the PO itself on the server (the type can be changed on the Stock In table).
export function UploadDoButton({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={styles.btnActionGhost} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Uploading…" : "Upload PO"}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </>
  );
}
