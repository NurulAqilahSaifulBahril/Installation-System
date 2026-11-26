"use client";

// The serial camera view shared by the Stock Out lorry page, the Stock Out job page and Stock In
// verification: the picture with its scan frame, Torch and Zoom where the phone allows them, and
// why the camera did not start. The camera runs while this is shown (see serial-scanner.ts for the
// scan-accuracy steps).

import { useEffect, useRef, useState } from "react";
import { startSerialScanner, type SerialScanner } from "./serial-scanner";
import styles from "./warehouse.module.css";

export default function SerialCamera({ onRead }: { onRead: (serial: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // The latest handler, so a read always uses the page's current state.
  const onReadRef = useRef(onRead);
  useEffect(() => {
    onReadRef.current = onRead;
  });
  const [ctl, setCtl] = useState<SerialScanner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [torchOn, setTorchOn] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let scanner: SerialScanner | null = null;
    startSerialScanner(video, (serial) => onReadRef.current(serial))
      .then((started) => {
        if (cancelled) {
          started.stop();
          return;
        }
        scanner = started;
        setCtl(started);
        setZoom(started.zoom?.value ?? null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Camera could not start. Use the barcode gun or type the serial.");
      });
    return () => {
      cancelled = true;
      scanner?.stop();
    };
  }, []);

  return (
    <>
      {/* The whole picture shows (not cropped), so the frame marks exactly the band read */}
      <div className={styles.serialCamStage}>
        <video ref={videoRef} className={styles.serialCamVideo} playsInline autoPlay muted />
        <div className={styles.serialCamBand} aria-hidden />
      </div>
      {error && (
        <div style={{ padding: "12px 14px", background: "rgba(0,0,0,0.65)", borderRadius: "6px", margin: "8px" }}>
          <div style={{ fontSize: "22px", marginBottom: "2px" }}>📸</div>
          <strong style={{ color: "#f87171", fontSize: "12px" }}>Camera Notice:</strong>
          <div style={{ fontSize: "11px", color: "#e2e8f0", marginTop: "2px" }}>{error}</div>
        </div>
      )}
      {(ctl?.torch || ctl?.zoom) && (
        <div className={styles.serialCamTools}>
          {ctl.torch && (
            <button
              type="button"
              className={`${styles.serialCamTorch} ${torchOn ? styles.serialCamTorchOn : ""}`}
              onClick={async () => {
                if (await ctl.setTorch(!torchOn)) setTorchOn(!torchOn);
              }}
              aria-pressed={torchOn}
            >
              🔦 Torch
            </button>
          )}
          {ctl.zoom && zoom !== null && (
            <label className={styles.serialCamZoom}>
              Zoom
              <input
                type="range"
                min={ctl.zoom.min}
                max={ctl.zoom.max}
                step={ctl.zoom.step}
                value={zoom}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setZoom(v);
                  void ctl.setZoom(v);
                }}
              />
              <span>{zoom.toFixed(1)}×</span>
            </label>
          )}
        </div>
      )}
    </>
  );
}
