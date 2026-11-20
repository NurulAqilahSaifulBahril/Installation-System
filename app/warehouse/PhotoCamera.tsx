"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./warehouse.module.css";

// A camera inside the page, shown in place (inside the photo box, not a pop-up), for photos that
// must be taken on the spot (not picked from the phone's gallery): the live picture, a button to
// switch between the back and front camera, and a shutter. The photo comes back as a JPEG data: URL (longest side 1280 px), the same size the
// app uses for other photos.

type Facing = "environment" | "user";

function cameraProblem(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "The camera needs a secure (https://) link. Open Inventory Management from its https address.";
  }
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission is blocked. Tap the lock / site settings icon in the address bar, allow Camera, then try again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No camera found on this device.";
  if (name === "NotReadableError" || name === "AbortError") {
    return "The camera is being used by another app or tab. Close it there, then try again.";
  }
  return `The camera could not start (${name || "unknown error"}).`;
}

export function PhotoCamera({
  title,
  onCapture,
  onClose,
}: {
  title: string;
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [facing, setFacing] = useState<Facing>("environment");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // (Re)open the camera whenever the side changes; stop it when leaving.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    setReady(false);
    setError(null);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new DOMException("No camera support", "NotFoundError");
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing } }, audio: false });
        } catch (err) {
          const name = err instanceof DOMException ? err.name : "";
          if (name === "NotAllowedError" || name === "SecurityError") throw err;
          // A device with one camera (most laptops) ignores the side asked for.
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
          setReady(true);
        }
      } catch (err) {
        if (!cancelled) setError(cameraProblem(err));
      }
    })();
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [facing]);

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    onCapture(canvas.toDataURL("image/jpeg", 0.75));
  }

  return (
    <div className={styles.photoCamBox} role="group" aria-label={title}>
        <div className={styles.photoCamView}>
          {/* The front camera is shown mirrored, like a mirror; the photo itself is not. */}
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className={styles.photoCamVideo}
            style={facing === "user" ? { transform: "scaleX(-1)" } : undefined}
          />
          {!ready && !error && <span className={styles.photoCamHint}>Starting camera…</span>}
          {error && <span className={styles.photoCamHint}>{error}</span>}
        </div>
        <div className={styles.photoCamButtons}>
          <button type="button" className={styles.btnActionGhost} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.btnActionGhost}
            onClick={() => setFacing((side) => (side === "environment" ? "user" : "environment"))}
            title="Switch between the back and front camera"
          >
            🔄 {facing === "environment" ? "Front camera" : "Back camera"}
          </button>
          <button type="button" className={styles.btnActionPrimary} onClick={shoot} disabled={!ready}>
            📷 Take photo
          </button>
        </div>
    </div>
  );
}
