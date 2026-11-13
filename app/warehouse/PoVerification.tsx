"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cameraErrorMessage, openCameraStream } from "./camera";
import { PO_ITEM_TYPE_OPTIONS, poDay, type DoFile } from "./DoFiles";
import styles from "./warehouse.module.css";

// Stock In Verification for an uploaded PO: scan the serial code of each unit received against
// the PO's lines (read from the PO PDF). Laid out like Stock Out Verification and reusing its
// styles (soPage), including the phone layout. Every scan is saved at once on the server.

type Scan = { serial: string; lineIdx: number; scannedBy: string; scannedAt: string };
type Feedback = { type: "success" | "warning" | "error"; message: string } | null;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dateLabel(iso: string): string {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : iso;
}

export default function PoVerificationPage({
  file,
  onBack,
  onVerified,
}: {
  file: DoFile;
  onBack: () => void;
  // Called after Verified is saved, with who and when (the list updates its row).
  onVerified: (verifiedAt: string, verifiedBy: string) => void;
}) {
  const lines = file.poLines ?? [];
  const [scans, setScans] = useState<Scan[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedLine, setSelectedLine] = useState(0);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saving, setSaving] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState(file.verifiedAt ?? "");
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  // "Open PO file" shows the PO in a pop-up. The file is fetched and shown from a local copy
  // (blob URL): the server sends it with a sandboxing CSP, which stops Chrome showing a PDF
  // inside a page frame.
  const [poViewOpen, setPoViewOpen] = useState(false);
  const [poViewUrl, setPoViewUrl] = useState<string | null>(null);
  const [poViewError, setPoViewError] = useState<string | null>(null);
  useEffect(() => {
    if (!poViewOpen || poViewUrl) return;
    let cancelled = false;
    setPoViewError(null);
    fetch(`/api/warehouse/do-files/${encodeURIComponent(file.id)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not open the PO file.");
        const blob = await response.blob();
        const typed = blob.type ? blob : new Blob([blob], { type: file.mimeType });
        if (!cancelled) setPoViewUrl(URL.createObjectURL(typed));
      })
      .catch((err) => {
        if (!cancelled) setPoViewError(err instanceof Error ? err.message : "Could not open the PO file.");
      });
    return () => {
      cancelled = true;
    };
  }, [poViewOpen, poViewUrl, file.id, file.mimeType]);
  // Free the local copy when the page closes.
  useEffect(() => () => {
    if (poViewUrl) URL.revokeObjectURL(poViewUrl);
  }, [poViewUrl]);

  // Camera scanner (opened by Scan / Record with an empty box), as on the other scan pages.
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    // Ready for the laser gun on a computer only (on phones focusing zooms in and opens the keyboard).
    if (window.matchMedia("(pointer: fine)").matches) barcodeInputRef.current?.focus();
  }, []);

  // Scans already saved for this PO.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/warehouse/po-scans?po=${encodeURIComponent(file.id)}`, { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { scans?: Scan[]; error?: string };
        if (!response.ok) throw new Error(body.error || "Could not load the saved scans.");
        if (!cancelled) setScans(body.scans ?? []);
      })
      .catch((err) => {
        if (!cancelled) setFeedback({ type: "error", message: err instanceof Error ? err.message : "Could not load the saved scans." });
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [file.id]);

  const scannedPerLine = useMemo(
    () => lines.map((_, i) => scans.filter((scan) => scan.lineIdx === i).length),
    [lines, scans],
  );
  const totalRequired = lines.reduce((sum, line) => sum + line.qty, 0);
  const totalScanned = scans.length;
  const allScanned = totalRequired > 0 && totalScanned >= totalRequired;
  const progress = totalRequired > 0 ? Math.min(100, Math.round((totalScanned / totalRequired) * 100)) : 0;
  const lineScans = scans.filter((scan) => scan.lineIdx === selectedLine);

  async function handleScan(codeToTest?: string) {
    const code = (codeToTest ?? barcodeInput).trim();
    if (!code || saving) return;
    setBarcodeInput("");
    if (lines.length === 0) {
      setFeedback({ type: "error", message: "❌ No item lines were read from this PO, so there is nothing to scan against." });
      return;
    }
    if (verifiedAt) {
      setFeedback({ type: "warning", message: "⚠️ This PO is already verified." });
      return;
    }
    if (scans.some((scan) => scan.serial.toLowerCase() === code.toLowerCase())) {
      setFeedback({ type: "warning", message: `⚠️ Duplicate scan: S/N ${code} is already recorded on this PO.` });
      return;
    }
    // The chosen line, or the next line that still needs units.
    const hasRoom = (i: number) => scannedPerLine[i] < lines[i].qty;
    const target = hasRoom(selectedLine) ? selectedLine : lines.findIndex((_, i) => hasRoom(i));
    if (target < 0) {
      setFeedback({ type: "warning", message: "⚠️ Every unit on this PO is already scanned." });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/warehouse/po-scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ po: file.id, serial: code, lineIdx: target }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; duplicate?: boolean };
      if (!response.ok) {
        setFeedback({ type: body.duplicate ? "warning" : "error", message: `${body.duplicate ? "⚠️" : "❌"} ${body.error || "Could not save the scan."}` });
        return;
      }
      setScans((prev) => [...prev, { serial: code, lineIdx: target, scannedBy: "", scannedAt: new Date().toISOString() }]);
      if (target !== selectedLine) setSelectedLine(target);
      const line = lines[target];
      setFeedback({
        type: "success",
        message: `✅ Recorded S/N ${code} as ${line.itemCode} (${scannedPerLine[target] + 1}/${line.qty.toLocaleString("en-MY")})`,
      });
    } catch {
      setFeedback({ type: "error", message: "❌ Could not save the scan. Check the connection and scan again." });
    } finally {
      setSaving(false);
    }
  }

  async function removeScan(serial: string) {
    if (verifiedAt) return;
    const before = scans;
    setScans((prev) => prev.filter((scan) => scan.serial !== serial));
    try {
      const response = await fetch("/api/warehouse/po-scans", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ po: file.id, serial }),
      });
      if (!response.ok) throw new Error();
      setFeedback({ type: "warning", message: `Removed S/N ${serial}.` });
    } catch {
      setScans(before);
      setFeedback({ type: "error", message: `❌ Could not remove S/N ${serial}.` });
    }
  }

  async function markVerified() {
    if (!allScanned || saving) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/warehouse/do-files/${encodeURIComponent(file.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ verified: true }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; verifiedAt?: string; verifiedBy?: string };
      if (!response.ok) throw new Error(body.error || "Could not save the verification.");
      setVerifiedAt(body.verifiedAt ?? new Date().toISOString());
      onVerified(body.verifiedAt ?? new Date().toISOString(), body.verifiedBy ?? "");
      onBack();
    } catch (err) {
      setFeedback({ type: "error", message: `❌ ${err instanceof Error ? err.message : "Could not save the verification."}` });
    } finally {
      setSaving(false);
    }
  }

  // Camera stream + BarcodeDetector, stopped when closed (and late streams stopped too).
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    if (cameraActive) {
      if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") {
        openCameraStream()
          .then((s) => {
            if (cancelled) {
              s.getTracks().forEach((t) => t.stop());
              return;
            }
            stream = s;
            if (videoRef.current) {
              videoRef.current.srcObject = s;
              videoRef.current.play().catch(() => {});
            }
            setCameraError(null);
            if ("BarcodeDetector" in window) {
              try {
                // @ts-expect-error - standard browser BarcodeDetector API
                const detector = new window.BarcodeDetector({ formats: ["code_128", "qr_code", "ean_13", "data_matrix"] });
                let last = "";
                timer = setInterval(async () => {
                  if (!videoRef.current || videoRef.current.readyState < 2) return;
                  try {
                    const found = await detector.detect(videoRef.current);
                    const value = found?.[0]?.rawValue;
                    if (value && value !== last) {
                      last = value;
                      void handleScanRef.current(value);
                    }
                  } catch {}
                }, 400);
              } catch {}
            }
          })
          .catch((err) => {
            if (!cancelled) setCameraError(cameraErrorMessage(err));
          });
      } else {
        setCameraError(cameraErrorMessage(null));
      }
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [cameraActive]);
  // The camera callback always uses the latest scan state.
  const handleScanRef = useRef(handleScan);
  handleScanRef.current = handleScan;

  const itemTypeName = PO_ITEM_TYPE_OPTIONS.find(([value]) => value === file.itemType)?.[1] ?? "—";
  const poNumber = file.fileName.replace(/\.[a-z0-9]+$/i, "");

  return (
    <section className={`${styles.screen} ${styles.soPage}`} aria-labelledby="po-verify-title">
      <div className={styles.inspectTopBar}>
        <button className={styles.btnActionGhost} type="button" onClick={onBack}>
          &larr; Back
        </button>
        <button type="button" className={styles.btnActionGhost} onClick={() => setPoViewOpen(true)}>
          Open PO file
        </button>
      </div>

      <h1 id="po-verify-title" className={styles.inspectHeroTitle} style={{ margin: "0 0 12px" }}>
        Stock In Verification
      </h1>

      {/* PO details */}
      <div className={styles.inspectCard} style={{ marginBottom: "16px" }}>
        <h2 className={styles.inspectCardTitle} style={{ margin: 0, color: "#000", fontWeight: 700 }}>
          <span>📄</span> PO Details &middot; {poNumber}
        </h2>
        <div
          style={{
            fontSize: "13px",
            color: "#000",
            display: "grid",
            gridTemplateColumns: "max-content max-content 1fr",
            columnGap: "6px",
            rowGap: "4px",
          }}
        >
          {[
            ["PO Number", poNumber],
            ["PO Date", dateLabel(poDay(file))],
            ["Item Type", itemTypeName],
          ].map(([label, value]) => (
            <div key={label} style={{ display: "contents" }}>
              <span style={{ fontWeight: 700 }}>{label}</span>
              <span style={{ fontWeight: 700 }}>:</span>
              <span>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* One card per PO line; tap to scan into that line */}
      {lines.length > 0 ? (
        <div className={styles.soCards}>
          {lines.map((line, i) => (
            <button
              key={i}
              type="button"
              className={`${styles.soCard} ${selectedLine === i ? styles.soCardActive : ""}`}
              onClick={() => setSelectedLine(i)}
              aria-pressed={selectedLine === i}
              title={line.description}
            >
              <span className={styles.soCardLabel}>
                {i + 1}. {line.itemCode}
              </span>
              <strong className={styles.soCardNumber}>{line.qty.toLocaleString("en-MY")}</strong>
              <span className={styles.soCardSub}>{scannedPerLine[i].toLocaleString("en-MY")} scanned</span>
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.note} style={{ marginBottom: "12px" }}>
          No item lines could be read from this PO (it may be a scanned image). Open the PO file to check it.
        </p>
      )}

      {/* Scanner */}
      <div className={styles.scannerCard}>
        <div className={styles.scannerHeader}>
          <div>
            <h2 className={styles.scannerTitle}>
              <span>🔍</span> Barcode &amp; Serial Scanner for Stock In
            </h2>
            <p className={styles.scannerHelpText}>
              Scan each unit received with the handheld laser gun or the camera. Each serial is saved to the selected PO line.
            </p>
          </div>
        </div>

        {cameraActive && (
          <div className={styles.cameraViewfinder}>
            <button
              type="button"
              className={styles.cameraCloseBtn}
              onClick={() => setCameraActive(false)}
              aria-label="Close camera"
              title="Close camera"
            >
              ✕
            </button>
            <div className={styles.cameraScanLine} />
            <video ref={videoRef} className={styles.videoCameraActive} playsInline autoPlay muted />
            {cameraError && (
              <div style={{ padding: "12px 14px", background: "rgba(0,0,0,0.65)", borderRadius: "6px", margin: "8px" }}>
                <div style={{ fontSize: "22px", marginBottom: "2px" }}>📸</div>
                <strong style={{ color: "#f87171", fontSize: "12px" }}>Camera Notice:</strong>
                <div style={{ fontSize: "11px", color: "#e2e8f0", marginTop: "2px" }}>{cameraError}</div>
              </div>
            )}
          </div>
        )}

        <form
          className={styles.scannerInputRow}
          onSubmit={(e) => {
            e.preventDefault();
            void handleScan();
          }}
        >
          <input
            ref={barcodeInputRef}
            type="text"
            className={styles.scannerInput}
            placeholder="Scan barcode or type unit serial number..."
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            disabled={!!verifiedAt}
          />
          <button
            type="button"
            className={styles.scannerBtnScan}
            title="Records the typed serial; with an empty box it opens the camera scanner"
            disabled={!!verifiedAt || saving}
            onClick={() => {
              if (barcodeInput.trim()) void handleScan();
              else setCameraActive(true);
            }}
          >
            <span>⚡</span> Scan / Record
          </button>
        </form>

        {feedback && (
          <div
            className={`${styles.scanFeedback} ${
              feedback.type === "success"
                ? styles.scanFeedbackSuccess
                : feedback.type === "warning"
                  ? styles.scanFeedbackWarning
                  : styles.scanFeedbackError
            }`}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              style={{ border: 0, background: "transparent", cursor: "pointer", color: "inherit", fontWeight: 700 }}
              onClick={() => setFeedback(null)}
            >
              &times;
            </button>
          </div>
        )}

        <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "18px 0" }} />
        <div className={styles.skuProgressHeader}>
          <p className={styles.itemDesc}>Quantities come from the PO. Serial codes are recorded as each unit is scanned.</p>
          <div className={styles.skuOverallStats}>
            Scanned: <strong>{totalScanned.toLocaleString("en-MY")}</strong> / {totalRequired.toLocaleString("en-MY")} ({progress}%)
          </div>
        </div>
        <div className={styles.progressBarContainer}>
          <div
            className={`${styles.progressBarFill} ${progress < 100 ? styles.progressBarFillWarning : ""}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Scanned serials of the selected line, newest first */}
        {lines[selectedLine] && (
          <p className={styles.itemDesc} style={{ margin: "10px 0 6px" }}>
            <strong>
              Line {selectedLine + 1}: {lines[selectedLine].itemCode}
            </strong>{" "}
            · {lines[selectedLine].description} · {scannedPerLine[selectedLine].toLocaleString("en-MY")} /{" "}
            {lines[selectedLine].qty.toLocaleString("en-MY")} scanned
          </p>
        )}
        <div className={styles.unitScrollTableWrap}>
          <table>
            <thead>
              <tr>
                <th scope="col" style={{ width: "50px" }}>No.</th>
                <th scope="col">Serial Code</th>
                <th scope="col">Item Code</th>
                <th scope="col" style={{ width: "90px" }}>Remove</th>
              </tr>
            </thead>
            <tbody>
              {!loaded ? (
                <tr>
                  <td colSpan={4}>Loading saved scans…</td>
                </tr>
              ) : lineScans.length === 0 ? (
                <tr>
                  <td colSpan={4}>Nothing scanned for this line yet.</td>
                </tr>
              ) : (
                [...lineScans].reverse().map((scan, n) => (
                  <tr key={scan.serial} className={styles.unitRowVerified}>
                    <td style={{ color: "var(--muted)", fontSize: "11px", fontWeight: 600 }}>
                      #{String(lineScans.length - n).padStart(2, "0")}
                    </td>
                    <td>
                      <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: "13px", letterSpacing: "0.03em" }}>
                        {scan.serial}
                      </div>
                    </td>
                    <td>
                      <strong style={{ fontSize: "13px" }}>{lines[scan.lineIdx]?.itemCode ?? "—"}</strong>
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.btnActionGhost}
                        disabled={!!verifiedAt}
                        onClick={() => void removeScan(scan.serial)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Verified */}
      <div className={styles.inspectFooterBar}>
        <p className={`${styles.note} ${styles.footerTip}`}>
          💡 <strong>Warehouse Tip:</strong> Scan every unit on PO {poNumber}. When all{" "}
          {totalRequired.toLocaleString("en-MY")} units are scanned, the <strong>Verified</strong> button unlocks.
        </p>
        <div className={styles.inspectActionGroup}>
          <button
            className={`${styles.btnActionPrimary} ${allScanned && !verifiedAt ? styles.btnVerifiedGlow : styles.btnVerifiedLocked}`}
            type="button"
            disabled={!allScanned || !!verifiedAt || saving}
            onClick={() => void markVerified()}
          >
            {verifiedAt
              ? "✓ Verified"
              : allScanned
                ? "✓ Verified (All Units Received)"
                : `🔒 Verified (Scan ${(totalRequired - totalScanned).toLocaleString("en-MY")} more to unlock)`}
          </button>
        </div>
      </div>

      {/* PO file pop-up */}
      {poViewOpen && (
        <div className={styles.bankingReceiptBackdrop} onClick={() => setPoViewOpen(false)}>
          <div
            className={`${styles.transferReportCard} ${styles.poViewCard}`}
            role="dialog"
            aria-modal="true"
            aria-label={`PO file ${poNumber}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.transferReportHead}>
              <h2 className={styles.bankingCardTitle}>{poNumber}</h2>
              <div style={{ display: "flex", gap: "8px", marginLeft: "auto" }}>
                {poViewUrl && (
                  <a className={styles.btnActionGhost} href={poViewUrl} download={file.fileName} style={{ textDecoration: "none" }}>
                    Download
                  </a>
                )}
                <button type="button" className={styles.btnActionGhost} onClick={() => setPoViewOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            {poViewError ? (
              <p className={styles.note}>{poViewError}</p>
            ) : !poViewUrl ? (
              <p className={styles.note}>Loading the PO…</p>
            ) : file.mimeType.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={poViewUrl} alt={`PO ${poNumber}`} style={{ width: "100%", height: "auto", borderRadius: "8px" }} />
            ) : file.mimeType === "application/pdf" ? (
              <iframe title={`PO ${poNumber}`} src={poViewUrl} className={styles.poViewFrame} />
            ) : (
              <p className={styles.note}>This file type cannot be shown here. Use Download to open it.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
