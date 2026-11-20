"use client";

import { useState } from "react";
import styles from "./warehouse.module.css";

// The "How to use" training video, offered on the sign-in page: Watch or Skip. "Don't show this
// again" is remembered on this device (browser storage; if that is blocked, it simply asks again
// next time). The video (public/training, every customer detail blurred) is downloaded only when
// Watch is pressed, and streams as it plays.

const hiddenKey = (who: string) => `inventory-howto-hidden:${who}`;

export function trainingHidden(who: string): boolean {
  try {
    return window.localStorage.getItem(hiddenKey(who)) === "1";
  } catch {
    return false;
  }
}

function setTrainingHidden(who: string, hidden: boolean) {
  try {
    if (hidden) window.localStorage.setItem(hiddenKey(who), "1");
    else window.localStorage.removeItem(hiddenKey(who));
  } catch {
    // Storage blocked: the popup just shows again next time.
  }
}

export function TrainingVideo({ who, onClose }: { who: string; onClose: () => void }) {
  const [watching, setWatching] = useState(false);
  const [dontShow, setDontShow] = useState(() => trainingHidden(who));

  function close() {
    setTrainingHidden(who, dontShow);
    onClose();
  }

  return (
    <div className={styles.howtoBackdrop} role="dialog" aria-modal="true" aria-labelledby="howto-title">
      <div className={`${styles.howtoBox} ${watching ? styles.howtoBoxWide : ""}`}>
        <div className={styles.howtoHead}>
          <h2 id="howto-title" className={styles.howtoTitle}>
            How to use Inventory Management
          </h2>
          <button type="button" className={styles.howtoX} onClick={close} aria-label="Close">
            ✕
          </button>
        </div>

        {watching ? (
          // preload metadata only; the video streams as it plays.
          <video
            className={styles.howtoVideo}
            src="/training/how-to-part1.mp4"
            controls
            autoPlay
            playsInline
            preload="metadata"
          />
        ) : (
          <p className={styles.howtoText}>
            A short video (about 5 minutes) on signing in, the Home page and Stock Out: preparing a job,
            scanning, Submit and Verified.
          </p>
        )}

        <div className={styles.howtoFoot}>
          <label className={styles.howtoCheck}>
            <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} />
            Don&apos;t show this again
          </label>
          <div className={styles.howtoButtons}>
            {watching ? (
              <button type="button" className={styles.btnActionPrimary} onClick={close}>
                Close
              </button>
            ) : (
              <>
                <button type="button" className={styles.btnActionGhost} onClick={close}>
                  Skip
                </button>
                <button type="button" className={styles.btnActionPrimary} onClick={() => setWatching(true)}>
                  ▶ Watch
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
