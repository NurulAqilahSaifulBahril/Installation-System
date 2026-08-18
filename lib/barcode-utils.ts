// Client-side barcode decoding utilities
// Note: Barcode decoding in browser requires canvas and image processing
// For production, consider using a library like:
// - @zxing/library (web camera)
// - barcode-detector (native API, limited browser support)
// - ml-kit (Google ML Kit for web)

export interface BarcodeDecodeResult {
  success: boolean;
  serial?: string;
  format?: string;
  confidence: number;
  rawData?: string;
  error?: string;
}

/**
 * Decode barcode from an image file using browser APIs
 * For now, this is a placeholder that requires manual entry or camera integration
 */
export async function decodeBarcodeFromImage(
  file: File
): Promise<BarcodeDecodeResult> {
  // Check if BarcodeDetector API is available (Chromium-based browsers only)
  if ("BarcodeDetector" in window) {
    try {
      const detector = new (window as any).BarcodeDetector({
        formats: ["code_128", "ean_13", "qr_code"],
      });

      const imageBitmap = await createImageBitmap(file);
      const barcodes = await detector.detect(imageBitmap);

      if (barcodes.length > 0) {
        const barcode = barcodes[0];
        return {
          success: true,
          serial: barcode.rawValue || barcode.data,
          format: barcode.format,
          confidence: 90,
          rawData: barcode.rawValue,
        };
      }

      return {
        success: false,
        confidence: 0,
        error:
          "No barcode detected in image. Please try again or enter manually.",
      };
    } catch (error) {
      console.error("BarcodeDetector error:", error);
      return {
        success: false,
        confidence: 0,
        error:
          "Failed to decode barcode. Please enter serial number manually.",
      };
    }
  }

  // Fallback: Return message to use camera or manual entry
  return {
    success: false,
    confidence: 0,
    error: "Barcode detection not supported in your browser. Please use camera capture or enter manually.",
  };
}

/**
 * Extract text from barcode image using OCR-like approach
 * This is a simplified version - for production use a proper OCR library
 */
export function extractSerialFromBarcodeImage(
  canvasContext: CanvasRenderingContext2D,
  width: number,
  height: number
): string {
  // This is a placeholder for actual OCR/barcode recognition
  // In production, integrate with:
  // - Tesseract.js for OCR
  // - jsQR for QR codes
  // - barcode-scanner library
  return "";
}

/**
 * Validate barcode format
 * Common formats: Code128, EAN-13, QR Code
 */
export function validateBarcodeFormat(
  barcode: string,
  expectedFormat?: string
): boolean {
  if (!barcode || barcode.length === 0) {
    return false;
  }

  // Basic validation - barcode should be alphanumeric
  const barcodeRegex = /^[a-zA-Z0-9\-_]+$/;
  return barcodeRegex.test(barcode);
}

/**
 * Compare two serial numbers for exact match
 */
export function compareSerials(serial1: string, serial2: string): boolean {
  return serial1?.trim().toUpperCase() === serial2?.trim().toUpperCase();
}

/**
 * Format barcode data for display
 */
export function formatBarcodeDisplay(barcode: string): string {
  return barcode?.trim().toUpperCase() || "N/A";
}

/**
 * Get human-readable barcode format name
 */
export function getBarcodeFormatName(format: string): string {
  const formats: Record<string, string> = {
    code_128: "Code 128",
    code_39: "Code 39",
    ean_13: "EAN-13",
    ean_8: "EAN-8",
    upca: "UPC-A",
    upce: "UPC-E",
    qr_code: "QR Code",
    pdf_417: "PDF 417",
    data_matrix: "Data Matrix",
  };
  return formats[format?.toLowerCase()] || format || "Unknown";
}
