import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QRCodeImage({ value, size = 240 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" })
      .then(setSrc).catch(() => setSrc(""));
  }, [value, size]);
  if (!src) return <div style={{ width: size, height: size }} className="bg-muted animate-pulse rounded-lg" />;
  return <img src={src} alt="QR Code" width={size} height={size} className="rounded-lg bg-white p-2" />;
}
