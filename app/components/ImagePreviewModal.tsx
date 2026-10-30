"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  X,
  ExternalLink,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export interface ImagePreviewTarget {
  url: string;
  title?: string;
  images?: string[];
  currentIndex?: number;
}

interface ImagePreviewModalProps {
  target: ImagePreviewTarget | null;
  onClose: () => void;
}

export function ImagePreviewModal({ target, onClose }: ImagePreviewModalProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [activeIdx, setActiveIdx] = useState(0);

  // Sync active index whenever target changes
  useEffect(() => {
    if (target) {
      setActiveIdx(target.currentIndex ?? 0);
      setZoom(1);
      setRotation(0);
    }
  }, [target]);

  const images = target?.images && target.images.length > 0 ? target.images : null;
  const currentUrl = images ? images[activeIdx] ?? target?.url ?? "" : target?.url ?? "";
  const currentTitle = target?.title || "Image Preview";

  const handlePrev = useCallback(() => {
    if (!images || images.length <= 1) return;
    setActiveIdx((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    setZoom(1);
    setRotation(0);
  }, [images]);

  const handleNext = useCallback(() => {
    if (!images || images.length <= 1) return;
    setActiveIdx((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    setZoom(1);
    setRotation(0);
  }, [images]);

  // Keyboard navigation
  useEffect(() => {
    if (!target) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [target, onClose, handlePrev, handleNext]);

  // Prevent background scroll while modal is open
  useEffect(() => {
    if (target) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [target]);

  if (!target || !currentUrl) return null;

  const isPdf = /\.pdf(\?|$)/i.test(currentUrl);
  const isVideo = /\.(mp4|webm|mov|m4v)(\?|$)/i.test(currentUrl);

  const handleZoomIn = () => setZoom((z) => Math.min(3, +(z + 0.35).toFixed(2)));
  const handleZoomOut = () => setZoom((z) => Math.max(0.5, +(z - 0.35).toFixed(2)));
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const toggleZoom = () => {
    setZoom((z) => (z === 1 ? 1.75 : 1));
  };

  return (
    <div
      className="image-preview-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={currentTitle}
    >
      <div
        className="image-preview-panel"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header bar */}
        <div className="image-preview-header">
          <div className="image-preview-title">
            <strong>{currentTitle}</strong>
            {images && images.length > 1 && (
              <span className="image-preview-counter">
                {activeIdx + 1} / {images.length}
              </span>
            )}
          </div>

          <div className="image-preview-toolbar">
            {!isPdf && !isVideo && (
              <>
                <button
                  type="button"
                  className="image-preview-btn"
                  onClick={handleZoomIn}
                  title="Zoom In (+)"
                >
                  <ZoomIn size={17} />
                </button>
                <button
                  type="button"
                  className="image-preview-btn"
                  onClick={handleZoomOut}
                  title="Zoom Out (-)"
                >
                  <ZoomOut size={17} />
                </button>
                <button
                  type="button"
                  className="image-preview-btn"
                  onClick={handleRotate}
                  title="Rotate (90°)"
                >
                  <RotateCw size={17} />
                </button>
                {(zoom !== 1 || rotation !== 0) && (
                  <button
                    type="button"
                    className="image-preview-btn reset-btn"
                    onClick={handleReset}
                    title="Reset Zoom & Rotation"
                  >
                    <RotateCcw size={15} />
                    <span>Reset</span>
                  </button>
                )}
              </>
            )}

            <a
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="image-preview-btn"
              title="Open in new tab"
            >
              <ExternalLink size={16} />
            </a>

            <button
              type="button"
              className="image-preview-btn close-btn"
              onClick={onClose}
              title="Close (Esc)"
              aria-label="Close image preview"
            >
              <X size={19} />
            </button>
          </div>
        </div>

        {/* Viewer content */}
        <div className="image-preview-viewport">
          {images && images.length > 1 && (
            <>
              <button
                type="button"
                className="image-preview-nav prev-btn"
                onClick={handlePrev}
                title="Previous image (Left Arrow)"
              >
                <ChevronLeft size={28} />
              </button>
              <button
                type="button"
                className="image-preview-nav next-btn"
                onClick={handleNext}
                title="Next image (Right Arrow)"
              >
                <ChevronRight size={28} />
              </button>
            </>
          )}

          <div className="image-preview-media-wrapper">
            {isPdf ? (
              <iframe
                src={currentUrl}
                title={currentTitle}
                className="image-preview-iframe"
              />
            ) : isVideo ? (
              <video
                src={currentUrl}
                controls
                autoPlay
                className="image-preview-video"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentUrl}
                alt={currentTitle}
                className="image-preview-img"
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  cursor: zoom > 1 ? "grab" : "zoom-in",
                }}
                onClick={toggleZoom}
                title={zoom === 1 ? "Click to zoom in" : "Click to zoom out"}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
