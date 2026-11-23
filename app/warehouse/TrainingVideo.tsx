"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import styles from "./warehouse.module.css";

// The "How to use" training video, offered on the sign-in page: Watch or Skip. "Don't show this
// again" is remembered on this device (browser storage; if that is blocked, it simply asks again
// next time). The video (public/training, every customer detail blurred) is downloaded only when
// Watch is pressed, and streams as it plays.

const VIDEO_SRC = "/training/how-to-part1.mp4";
// Length of the video in seconds, used until the browser has read it from the file.
const VIDEO_LENGTH = 578;

// Chapters, YouTube style: the progress bar is split at each one, hovering shows its name, and
// the list under the video jumps to it. Start times (seconds) come from the video build
// (training-video/*.chapters.json); copy them here whenever the video is rebuilt.
const CHAPTERS = [
  { start: 0, title: "Sign in" },
  { start: 30.6, title: "Home page" },
  { start: 118.6, title: "Stock Out" },
  { start: 206.2, title: "New Stock Out" },
  { start: 280, title: "Preparing a job (scanning)" },
  { start: 373, title: "Submit and Verified" },
  { start: 412.8, title: "Loading" },
  { start: 496.6, title: "Lorry photos" },
  { start: 525.8, title: "Loading: Submit and Verified" },
];

function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function chapterAt(time: number) {
  let index = 0;
  CHAPTERS.forEach((chapter, i) => {
    if (time >= chapter.start) index = i;
  });
  return index;
}

function ChapterPlayer() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(VIDEO_LENGTH);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const current = chapterAt(time);
  const ends = CHAPTERS.map((chapter, i) => (i + 1 < CHAPTERS.length ? CHAPTERS[i + 1].start : duration));

  function seek(to: number, play = false) {
    const video = videoRef.current;
    if (!video) return;
    const t = Math.min(Math.max(to, 0), duration - 0.1);
    video.currentTime = t;
    setTime(t);
    if (play) void video.play().catch(() => {});
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) void video.play().catch(() => {});
    else video.pause();
  }

  function timeFromPointer(clientX: number) {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, time: 0 };
    const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
    return { x, time: (x / rect.width) * duration };
  }

  function onTrackDown(e: ReactPointerEvent<HTMLDivElement>) {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const at = timeFromPointer(e.clientX);
    setHover(at);
    seek(at.time);
  }

  function onTrackMove(e: ReactPointerEvent<HTMLDivElement>) {
    const at = timeFromPointer(e.clientX);
    setHover(at);
    if (dragging.current) seek(at.time);
  }

  function onTrackUp(e: ReactPointerEvent<HTMLDivElement>) {
    dragging.current = false;
    if (e.pointerType !== "mouse") setHover(null);
  }

  function toggleFullscreen() {
    const wrap = wrapRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else if (wrap?.requestFullscreen) {
      void wrap.requestFullscreen().catch(() => {});
    } else {
      // iPhone Safari: only the video itself can go full screen (with its own controls).
      video?.webkitEnterFullscreen?.();
    }
  }

  const hoverChapter = hover ? chapterAt(hover.time) : 0;

  return (
    <div className={styles.vp}>
      <div ref={wrapRef} className={`${styles.vpFrame} ${fullscreen ? styles.vpFrameFull : ""}`}>
        <video
          ref={videoRef}
          className={styles.howtoVideo}
          src={VIDEO_SRC}
          autoPlay
          playsInline
          // preload metadata only; the video streams as it plays.
          preload="metadata"
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => {
            if (!dragging.current) setTime(e.currentTarget.currentTime);
          }}
          onLoadedMetadata={(e) => {
            if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
          }}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        />

        <div className={styles.vpBar}>
          <div
            ref={trackRef}
            className={styles.vpTrack}
            role="slider"
            tabIndex={0}
            aria-label="Video position"
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            aria-valuetext={`${clock(time)}, ${CHAPTERS[current].title}`}
            onPointerDown={onTrackDown}
            onPointerMove={onTrackMove}
            onPointerUp={onTrackUp}
            onPointerCancel={onTrackUp}
            onPointerLeave={() => {
              if (!dragging.current) setHover(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") seek(time + 5);
              else if (e.key === "ArrowLeft") seek(time - 5);
              else if (e.key === "Home") seek(0);
              else if (e.key === "End") seek(duration);
              else return;
              e.preventDefault();
            }}
          >
            {CHAPTERS.map((chapter, i) => {
              const length = ends[i] - chapter.start;
              const done = Math.min(Math.max((time - chapter.start) / length, 0), 1);
              return (
                <div
                  key={chapter.start}
                  className={`${styles.vpSeg} ${hover && hoverChapter === i ? styles.vpSegHover : ""}`}
                  style={{ flexGrow: length }}
                >
                  <div className={styles.vpSegFill} style={{ width: `${done * 100}%` }} />
                </div>
              );
            })}
            {hover && (
              <div
                className={styles.vpTip}
                style={{ left: `clamp(70px, ${hover.x}px, calc(100% - 70px))` }}
              >
                <span className={styles.vpTipTitle}>{CHAPTERS[hoverChapter].title}</span>
                <span>{clock(hover.time)}</span>
              </div>
            )}
          </div>

          <div className={styles.vpRow}>
            <button type="button" className={styles.vpBtn} onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
              {playing ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              className={styles.vpBtn}
              onClick={() => {
                if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
              }}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 9h4l5-4v14l-5-4H4zM16 9.5l5 5M21 9.5l-5 5" strokeWidth="2" stroke="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 9h4l5-4v14l-5-4H4z" />
                  <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" strokeWidth="2" stroke="currentColor" />
                </svg>
              )}
            </button>
            <span className={styles.vpTime}>
              {clock(time)} / {clock(duration)}
            </span>
            <span className={styles.vpNow}>· {CHAPTERS[current].title}</span>
            <button
              type="button"
              className={`${styles.vpBtn} ${styles.vpBtnEnd}`}
              onClick={toggleFullscreen}
              aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {fullscreen ? (
                  <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" strokeWidth="2" stroke="currentColor" />
                ) : (
                  <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" strokeWidth="2" stroke="currentColor" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      <ol className={styles.vpChapters} aria-label="Chapters">
        {CHAPTERS.map((chapter, i) => (
          <li key={chapter.start}>
            <button
              type="button"
              className={`${styles.vpChapter} ${i === current ? styles.vpChapterOn : ""}`}
              aria-current={i === current ? "true" : undefined}
              onClick={() => seek(chapter.start, true)}
            >
              <span className={styles.vpChapterTime}>{clock(chapter.start)}</span>
              {chapter.title}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

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
          <ChapterPlayer />
        ) : (
          <p className={styles.howtoText}>
            A short video on signing in, the Home page, Stock Out (preparing a job, scanning, Submit and
            Verified) and Loading (lorry photos, Submit and Verified).
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
