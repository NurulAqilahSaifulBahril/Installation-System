"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./warehouse.module.css";

// Delivery order (DO) upload and list for the Stock In screen. Uploading is for admins
// (checked on the server); any signed-in dashboard user can list and open the files.

const MAX_BYTES = 10 * 1024 * 1024;

export type DoFile = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  note: string;
  uploadedBy: string;
  uploadedAt: string;
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "medium", timeStyle: "short" });
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
        setError("Sign in to the dashboard (same browser) to see delivery orders.");
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { files?: DoFile[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load the delivery orders.");
      setFiles(body.files ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the delivery orders.");
    }
  }, []);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  async function upload(file: File) {
    setMessage(null);
    if (file.size > MAX_BYTES) {
      setMessage({ ok: false, text: `That file is ${formatSize(file.size)}. The limit is 10 MB.` });
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/warehouse/do-files", { method: "POST", body: form, credentials: "same-origin" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; id?: string };
      if (response.status === 401 || response.status === 403) {
        throw new Error("Only a signed-in dashboard admin can upload delivery orders.");
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
          summary: `Uploaded delivery order "${file.name}" (${formatSize(file.size)})`,
        }),
      }).catch(() => {});
      await load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not upload the file." });
    } finally {
      setBusy(false);
    }
  }

  return { files, error, busy, message, upload };
}

// The Upload DO button (admins): opens the file picker, any file type.
export function UploadDoButton({ busy, onFile }: { busy: boolean; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={styles.btnActionGhost} disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Uploading…" : "Upload DO"}
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

export function DoFileList({
  files,
  error,
  message,
}: {
  files: DoFile[];
  error: string | null;
  message: { ok: boolean; text: string } | null;
}) {
  // Nothing uploaded yet: show nothing (an upload or load message still shows on its own).
  if (files.length === 0) {
    const note = message ?? (error ? { ok: false, text: error } : null);
    if (!note) return null;
    return (
      <p className={styles.note} style={{ marginBottom: "16px", color: note.ok ? "var(--green)" : "#b91c1c" }}>
        {note.text}
      </p>
    );
  }

  return (
    <div style={{ marginBottom: "16px" }}>
      <h2 className={styles.sectionTitle} style={{ margin: "0 0 8px" }}>
        Delivery orders (DO)
      </h2>
      {message && (
        <p className={styles.note} style={{ color: message.ok ? "var(--green)" : "#b91c1c" }}>
          {message.text}
        </p>
      )}
      {(
        <div className={styles.tableWrap}>
          <table className={`${styles.detailTable} ${styles.mountTable}`}>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Uploaded</th>
                <th scope="col">By</th>
                <th scope="col" className={styles.num}>Size</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.id}>
                  <td>
                    <a href={`/api/warehouse/do-files/${encodeURIComponent(file.id)}`} target="_blank" rel="noopener noreferrer">
                      {file.fileName}
                    </a>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatTime(file.uploadedAt)}</td>
                  <td>{file.uploadedBy}</td>
                  <td className={styles.num}>{formatSize(file.sizeBytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
