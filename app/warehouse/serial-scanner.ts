// Camera serial reader for the Panel / Inverter / Battery scanners, with the scan-accuracy steps
// of the Serial-Number-Scanner app (github.com/NurulAqilahSaifulBahril/Serial-Number-Scanner):
//
//  - Code 128 and Code 39 only. ITF / EAN are left out on purpose: a reader can lock onto part of
//    a long Code 128 label and return a short "valid" number.
//  - A high-resolution back camera (1920 x 1080, 30 fps, continuous focus): long panel serials
//    are dense and need the pixels.
//  - Only the middle band of the picture is read (SCAN_BAND of its height, the scan frame drawn
//    over the video).
//  - Auto contrast: each frame's brightness is stretched between its 1st and 99th percentile, so
//    a label washed out by glare or a dim aisle comes back to black and white before reading.
//  - The browser's own BarcodeDetector when there is one (Android Chrome), else ZXing (iPhone
//    Safari and others), set to try harder.
//  - A fast loop (a try every ~16 ms) and the same serial ignored for 1.2 s after a read.
//  - Frames take turns: auto contrast or the plain picture, and (ZXing) its two binarizers, the
//    global one being kinder to a slightly blurred 1D code.
//  - The camera starts at 2x zoom where the phone allows it: a long, dense label (panel serials,
//    25 characters) is then read from a distance the phone can still focus at.
//  - Snap: one full-resolution photo decoded carefully (several strips, both binarizers), for a
//    label the live picture cannot read.
//  - A beep and a vibration on each read.

import { cameraErrorMessage } from "./camera";

const REPEAT_LOCKOUT_MS = 1200;
export const SCAN_BAND = 0.4;
const SCAN_INTERVAL_MS = 16;
const ENHANCE_CLIP = 0.01;
const ENHANCE_STRIDE = 4;
const ENHANCE_MIN_SPAN = 16;
// Starting zoom for the back camera, where the phone supports zoom.
const START_ZOOM = 2;

export type SerialScanner = {
  stop: () => void;
  // The camera's torch and zoom, where the phone allows them.
  torch: boolean;
  zoom: { min: number; max: number; step: number; value: number } | null;
  setTorch: (on: boolean) => Promise<boolean>;
  setZoom: (value: number) => Promise<void>;
  // Decodes one full-resolution photo of the label; the serial, or null when none is found.
  snap: () => Promise<string | null>;
  engine: "native" | "zxing";
};

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
type ZxingReader = { decodeWithState: (bitmap: unknown) => { getText: () => string } };

// Back camera at high resolution; then any camera (laptops have no "environment" camera).
async function openSerialStream(): Promise<MediaStream> {
  const video: MediaTrackConstraints = {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30 },
    // Continuous focus where supported (not in the TypeScript types).
    advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") throw err;
    return navigator.mediaDevices.getUserMedia({ video: true });
  }
}

const hist = new Uint32Array(256);
const lut = new Uint8Array(256);
const lumaOf = (r: number, g: number, b: number) => (r * 77 + g * 150 + b * 29) >> 8;

export function measureLevels(data: Uint8ClampedArray): { lo: number; hi: number } | null {
  hist.fill(0);
  let n = 0;
  for (let i = 0; i < data.length; i += 4 * ENHANCE_STRIDE) {
    hist[lumaOf(data[i], data[i + 1], data[i + 2])]++;
    n++;
  }
  const cut = Math.max(1, Math.round(n * ENHANCE_CLIP));
  let lo = 0;
  let hi = 255;
  for (let v = 0, acc = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= cut) {
      lo = v;
      break;
    }
  }
  for (let v = 255, acc = 0; v >= 0; v--) {
    acc += hist[v];
    if (acc >= cut) {
      hi = v;
      break;
    }
  }
  return hi - lo < ENHANCE_MIN_SPAN ? null : { lo, hi };
}

// Gray written to all three channels, so ZXing's own luminance ((r + 2g + b) / 4) keeps it.
export function applyLevels(data: Uint8ClampedArray, levels: { lo: number; hi: number }) {
  const scale = 255 / (levels.hi - levels.lo);
  for (let v = 0; v < 256; v++) lut[v] = v <= levels.lo ? 0 : v >= levels.hi ? 255 : ((v - levels.lo) * scale) | 0;
  for (let i = 0; i < data.length; i += 4) {
    const g = lut[lumaOf(data[i], data[i + 1], data[i + 2])];
    data[i] = g;
    data[i + 1] = g;
    data[i + 2] = g;
  }
}

let audioCtx: AudioContext | null = null;
function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "square";
    osc.frequency.value = 1180;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    const t = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.start(t);
    osc.stop(t + 0.07);
  } catch {
    // no audio
  }
}

// Starts the camera on `video` and calls onRead with each serial read. Throws a message that
// says why the camera did not start.
export async function startSerialScanner(video: HTMLVideoElement, onRead: (serial: string) => void): Promise<SerialScanner> {
  if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getUserMedia !== "function") {
    throw new Error(cameraErrorMessage(null));
  }
  let stream: MediaStream;
  try {
    stream = await openSerialStream();
  } catch (err) {
    throw new Error(cameraErrorMessage(err));
  }
  const track = stream.getVideoTracks()[0];

  // The decoder: the browser's own when it reads Code 128, else ZXing.
  let detector: Detector | null = null;
  let reader: ZxingReader | null = null;
  let zx: typeof import("@zxing/library") | null = null;
  const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats: () => Promise<string[]> } })
    .BarcodeDetector;
  if (BD) {
    try {
      const supported = await BD.getSupportedFormats();
      const formats = ["code_128", "code_39"].filter((f) => supported.includes(f));
      if (formats.includes("code_128")) detector = new BD({ formats });
    } catch {
      detector = null;
    }
  }
  // ZXing is also loaded with a native reader, for Snap's careful decode.
  zx = await import("@zxing/library");
  if (!detector) {
    const hints = new Map();
    hints.set(zx.DecodeHintType.TRY_HARDER, true);
    hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.CODE_39]);
    const multi = new zx.MultiFormatReader();
    multi.setHints(hints);
    reader = multi as unknown as ZxingReader;
  }

  video.srcObject = stream;
  try {
    await video.play();
  } catch {
    // autoplay with muted + playsInline normally works; the loop waits for frames anyway
  }

  // Reusable frame buffers.
  const canvas = document.createElement("canvas");
  let ctx: CanvasRenderingContext2D | null = null;
  let buf: Int32Array | null = null;
  let w = 0;
  let h = 0;
  // Frames take turns: even = auto contrast + hybrid binarizer, odd = plain + global binarizer.
  let frameNo = 0;
  const band = (enhance: boolean) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return null;
    const bandH = Math.max(64, Math.round(vh * SCAN_BAND));
    const bandY = Math.round((vh - bandH) / 2);
    if (w !== vw || h !== bandH || !ctx) {
      canvas.width = vw;
      canvas.height = bandH;
      ctx = canvas.getContext("2d", { willReadFrequently: true });
      buf = new Int32Array(vw * bandH);
      w = vw;
      h = bandH;
    }
    if (!ctx) return null;
    ctx.drawImage(video, 0, bandY, vw, bandH, 0, 0, vw, bandH);
    const img = ctx.getImageData(0, 0, vw, bandH);
    if (enhance) {
      const levels = measureLevels(img.data);
      if (levels) applyLevels(img.data, levels);
    }
    return img;
  };

  let running = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastValue = "";
  let lastAt = 0;
  const read = (raw: string) => {
    const value = raw.trim();
    if (!value) return;
    const now = performance.now();
    if (value === lastValue && now - lastAt < REPEAT_LOCKOUT_MS) return;
    lastValue = value;
    lastAt = now;
    beep();
    if (navigator.vibrate) navigator.vibrate(55);
    onRead(value);
  };
  const step = async () => {
    if (!running) return;
    if (video.readyState >= 2 && !video.paused && !document.hidden) {
      try {
        frameNo++;
        const even = frameNo % 2 === 0;
        const img = band(even);
        if (img && detector && ctx) {
          ctx.putImageData(img, 0, 0);
          const codes = await detector.detect(canvas);
          if (codes?.length && codes[0].rawValue) read(codes[0].rawValue);
        } else if (img && reader && zx && buf) {
          const data = img.data;
          for (let i = 0, j = 0; j < buf.length; i += 4, j++) buf[j] = (0xff << 24) | (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
          // RGBLuminanceSource (not the canvas source, which inverts every second frame).
          const source = new zx.RGBLuminanceSource(buf, w, h);
          const bitmap = new zx.BinaryBitmap(even ? new zx.HybridBinarizer(source) : new zx.GlobalHistogramBinarizer(source));
          read(reader.decodeWithState(bitmap).getText());
        }
      } catch {
        // nothing found in most frames: normal
      }
    }
    if (running) timer = setTimeout(step, SCAN_INTERVAL_MS);
  };
  timer = setTimeout(step, 0);

  const caps = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & {
    torch?: boolean;
    zoom?: { min: number; max: number; step?: number };
  };
  const settings = (track?.getSettings?.() ?? {}) as MediaTrackSettings & { zoom?: number };
  let zoomNow = settings.zoom ?? caps.zoom?.min ?? 1;
  if (caps.zoom && typeof caps.zoom.max === "number" && caps.zoom.max >= START_ZOOM && zoomNow < START_ZOOM) {
    try {
      await track.applyConstraints({ advanced: [{ zoom: START_ZOOM } as MediaTrackConstraintSet] });
      zoomNow = START_ZOOM;
    } catch {
      // keeps the phone's own zoom
    }
  }

  // Snap: a full-resolution still (the camera's own photo where the browser allows it, else the
  // current video frame), then several horizontal strips of it, each tried with both binarizers
  // and, where there is one, the browser's reader.
  const snap = async (): Promise<string | null> => {
    let source: CanvasImageSource = video;
    let sw = video.videoWidth;
    let sh = video.videoHeight;
    const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => { takePhoto: () => Promise<Blob> } }).ImageCapture;
    if (IC && track) {
      try {
        const bitmap = await createImageBitmap(await new IC(track).takePhoto());
        source = bitmap;
        sw = bitmap.width;
        sh = bitmap.height;
      } catch {
        // the video frame instead
      }
    }
    if (!sw || !sh) return null;
    const still = document.createElement("canvas");
    const sctx = still.getContext("2d", { willReadFrequently: true });
    if (!sctx) return null;
    // Strips across the middle (the scan frame), then the whole picture.
    const strips: [number, number][] = [
      [0.4, 0.2],
      [0.3, 0.4],
      [0.45, 0.1],
      [0.35, 0.3],
      [0, 1],
    ];
    for (const [top, height] of strips) {
      const y = Math.round(sh * top);
      const hh = Math.max(32, Math.round(sh * height));
      still.width = sw;
      still.height = hh;
      sctx.drawImage(source, 0, y, sw, hh, 0, 0, sw, hh);
      if (detector) {
        try {
          const codes = await detector.detect(still);
          if (codes?.length && codes[0].rawValue) return codes[0].rawValue.trim();
        } catch {
          // ZXing below
        }
      }
      if (zx) {
        for (const enhance of [false, true]) {
          const img = sctx.getImageData(0, 0, sw, hh);
          if (enhance) {
            const levels = measureLevels(img.data);
            if (levels) applyLevels(img.data, levels);
          }
          const px = new Int32Array(sw * hh);
          for (let i = 0, j = 0; j < px.length; i += 4, j++) px[j] = (0xff << 24) | (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
          const hints = new Map();
          hints.set(zx.DecodeHintType.TRY_HARDER, true);
          hints.set(zx.DecodeHintType.POSSIBLE_FORMATS, [zx.BarcodeFormat.CODE_128, zx.BarcodeFormat.CODE_39]);
          const multi = new zx.MultiFormatReader();
          multi.setHints(hints);
          for (const global of [true, false]) {
            try {
              const lum = new zx.RGBLuminanceSource(px, sw, hh);
              const text = multi
                .decode(new zx.BinaryBitmap(global ? new zx.GlobalHistogramBinarizer(lum) : new zx.HybridBinarizer(lum)))
                .getText()
                .trim();
              if (text) return text;
            } catch {
              // next try
            }
          }
        }
      }
    }
    return null;
  };

  return {
    snap,
    engine: detector ? "native" : "zxing",
    torch: "torch" in caps,
    zoom:
      caps.zoom && typeof caps.zoom.min === "number"
        ? { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, value: zoomNow }
        : null,
    setTorch: async (on) => {
      try {
        await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
        return true;
      } catch {
        return false;
      }
    },
    setZoom: async (value) => {
      try {
        await track.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] });
      } catch {
        // rejected mid-slide: the next change tries again
      }
    },
    stop: () => {
      running = false;
      if (timer) clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      if (video.srcObject === stream) video.srcObject = null;
    },
  };
}
