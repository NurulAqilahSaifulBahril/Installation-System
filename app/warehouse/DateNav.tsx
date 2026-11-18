"use client";

import { useRef } from "react";
import styles from "./warehouse.module.css";

// The date control used on every page:  ‹  [calendar]  ›
// ‹ and › step back and forward (a day, or a week on the Project Team page); the calendar
// icon opens the browser's date picker. The picked date is shown in the button's tooltip.

export function DateNav({
  value,
  onPick,
  onPrev,
  onNext,
  prevDisabled = false,
  nextDisabled = false,
  prevLabel = "Previous day",
  nextLabel = "Next day",
  pickLabel = "Pick a day",
}: {
  // The date shown in the picker (YYYY-MM-DD).
  value: string;
  onPick: (isoDate: string) => void;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled?: boolean;
  nextDisabled?: boolean;
  prevLabel?: string;
  nextLabel?: string;
  pickLabel?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const input = inputRef.current;
    if (!input) return;
    try {
      if (typeof input.showPicker === "function") {
        input.showPicker();
        return;
      }
    } catch {
      // Some browsers refuse showPicker; clicking the field opens it instead.
    }
    input.focus();
    input.click();
  }

  return (
    <div className={styles.dateNav}>
      <button type="button" className={styles.dateNavBtn} onClick={onPrev} disabled={prevDisabled} aria-label={prevLabel} title={prevLabel}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <span className={styles.dateNavCal}>
        <button type="button" className={styles.dateNavBtn} onClick={openPicker} aria-label={pickLabel} title={pickLabel}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
            <path d="M3 9.5h18" />
            <path d="M8 2.5v4" />
            <path d="M16 2.5v4" />
            <path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" />
          </svg>
        </button>
        {/* The real date field, invisible and lying over the calendar button. On a phone the tap
            opens the phone's own picker; on a computer a click on the field body does not, so
            open it from code too. The button underneath stays for keyboard use. */}
        <input
          ref={inputRef}
          type="date"
          className={styles.dateNavInput}
          value={value}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker?.();
            } catch {
              // Already open, or the browser opens it from the tap by itself.
            }
          }}
          onChange={(e) => {
            if (e.target.value) onPick(e.target.value);
          }}
          tabIndex={-1}
          aria-hidden="true"
          title={pickLabel}
        />
      </span>
      <button type="button" className={styles.dateNavBtn} onClick={onNext} disabled={nextDisabled} aria-label={nextLabel} title={nextLabel}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  );
}
