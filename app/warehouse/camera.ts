// Shared by the Stock In, Stock Out, Transfer and PO verification scanners.

// Camera scanner: ask for the back camera first, then any camera (laptops and some
// tablets have no "environment" camera, which some browsers treat as a hard failure).
export async function openCameraStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } } });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") throw err;
    return navigator.mediaDevices.getUserMedia({ video: true });
  }
}

// A message that says why the camera did not start, so staff know what to fix.
export function cameraErrorMessage(err: unknown): string {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Camera needs a secure (https://) link. Open Inventory Management from its https address, or use the barcode gun / type the serial.";
  }
  if (!err) return "This browser has no camera support. Use the barcode gun or type the serial.";
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Camera permission is blocked. Tap the lock / site settings icon in the address bar, allow Camera, then press Scan again.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No camera found on this device. Use the barcode gun or type the serial.";
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return "The camera is being used by another app or tab. Close it there, then press Scan again.";
  }
  return `Camera could not start (${name || "unknown error"}). Use the barcode gun or type the serial.`;
}
