"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { parsePublicQrValue } from "@/lib/public-verification/public-qr-value";

const SCAN_TIMEOUT_MS = 15_000;

interface DetectedBarcode {
  rawValue?: string;
}

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<readonly DetectedBarcode[]>;
}

type NativeBarcodeDetectorConstructor = new (input: {
  formats: readonly string[];
}) => NativeBarcodeDetector;

function barcodeDetectorConstructor(): NativeBarcodeDetectorConstructor | null {
  return (
    window as unknown as {
      BarcodeDetector?: NativeBarcodeDetectorConstructor;
    }
  ).BarcodeDetector ?? null;
}

function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function PublicQrScanner({
  onIdentifier
}: {
  onIdentifier: (identifier: string) => void;
}): React.JSX.Element {
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function acceptScannedValue(rawValue: string): boolean {
    const value = parsePublicQrValue(rawValue, window.location.origin);
    if (!value) return false;
    if (value.kind === "identifier") {
      onIdentifier(value.identifier);
      setMessage("QR code read. Review the ID, then choose Verify.");
    } else {
      window.location.assign(value.path);
    }
    return true;
  }

  async function startScanner(): Promise<void> {
    setMessage(null);
    const Detector = barcodeDetectorConstructor();
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setMessage(
        "QR scanning is unavailable in this browser. Enter the Worker ID or Credential ID manually."
      );
      return;
    }

    setScanning(true);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } }
      });
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await video.play();

      const detector = new Detector({ formats: ["qr_code"] });
      const deadline = Date.now() + SCAN_TIMEOUT_MS;
      while (Date.now() < deadline) {
        const detections = await detector.detect(video);
        const rawValue = detections.find(
          (item) => typeof item.rawValue === "string" && item.rawValue.length > 0
        )?.rawValue;
        if (rawValue && acceptScannedValue(rawValue)) return;
        await wait(150);
      }
      setMessage(
        "No supported HSE Verify QR code was detected. You can enter the ID manually."
      );
    } catch (error) {
      const denied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError");
      setMessage(
        denied
          ? "Camera permission was denied. Manual verification is still available."
          : "QR scanning could not start. Manual verification is still available."
      );
    } finally {
      stopStream(stream);
      setScanning(false);
    }
  }

  return (
    <div className="public-qr-control">
      <Button disabled={scanning} onClick={startScanner} type="button" variant="secondary">
        {scanning ? "Scanning…" : "Scan QR"}
      </Button>
      {message ? <p aria-live="polite" className="muted-copy">{message}</p> : null}
    </div>
  );
}