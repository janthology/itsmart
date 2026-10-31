import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QrCode, Printer } from "lucide-react";

interface AssetQRLabelProps {
  assetTag: string;
  assetName: string;
  category: string;
  location?: string | null;
  serialNumber?: string | null;
}

export function AssetQRLabel({ assetTag, assetName, category, location, serialNumber }: AssetQRLabelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  // QR encodes the asset tag — scannable to look up the asset
  const qrValue = `ASSET:${assetTag}`;

  useEffect(() => {
    // The qrcode library is only needed here, so it loads on demand
    // instead of shipping with the main bundle.
    let cancelled = false;
    import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(qrValue, {
          width: 160,
          margin: 1,
          color: { dark: "#355872", light: "#ffffff" },
        })
      )
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { /* QR preview is non-critical; label printing still works */ });
    return () => { cancelled = true; };
  }, [qrValue]);

  // Popup-free print (Phase 5b): the label print view below renders in
  // .print-area; CSS hides everything else when printing.
  const handlePrint = () => {
    if (!qrDataUrl) return;
    window.print();
  };

  return (
    <>
      <div className="print-area">
        <div style={{ display: "flex", justifyContent: "center", padding: 0, fontFamily: "Arial, sans-serif", background: "#fff" }}>
          <div style={{ border: "2px solid #355872", borderRadius: 0, padding: 20, width: 280, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
            <div style={{ width: "100%", background: "#355872", color: "#fff", textAlign: "center", padding: "8px 12px", borderRadius: 8, fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>
              DOST &middot; ITSMART — IT Asset
            </div>
            {qrDataUrl ? <img src={qrDataUrl} alt="" style={{ width: 140, height: 140 }} /> : null}
            <div style={{ fontSize: 22, fontWeight: 800, color: "#355872", letterSpacing: "0.05em", fontFamily: "monospace" }}>{assetTag}</div>
            <div style={{ width: "100%", borderTop: "1px dashed #cbd5e1" }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", textAlign: "center" }}>{assetName}</div>
            <div style={{ fontSize: 11, color: "#64748b", textAlign: "center", lineHeight: 1.6 }}>
              {category.charAt(0).toUpperCase() + category.slice(1)}
              {location ? <><br />{location}</> : null}
              {serialNumber ? <><br />S/N: {serialNumber}</> : null}
            </div>
          </div>
        </div>
      </div>
    <Card className="border-border/50 shadow-lg shadow-black/5 rounded-2xl">
      <CardHeader className="border-b border-border/50 py-4 px-6">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <QrCode className="w-5 h-5 text-primary" /> Asset Label
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 flex flex-col items-center gap-4">
        {qrDataUrl ? (
          <div className="border-2 border-primary/20 rounded-xl p-3 bg-white">
            <img src={qrDataUrl} alt={`QR code for ${assetTag}`} className="w-32 h-32" />
          </div>
        ) : (
          <div className="w-32 h-32 rounded-xl bg-muted animate-pulse" />
        )}
        <div className="text-center space-y-0.5">
          <p className="font-mono font-bold text-lg text-foreground tracking-wide">{assetTag}</p>
          <p className="text-xs text-muted-foreground capitalize">{category}</p>
        </div>
        <Button
          variant="outline"
          className="w-full rounded-xl gap-2"
          onClick={handlePrint}
          disabled={!qrDataUrl}
        >
          <Printer className="w-4 h-4" /> Print Label
        </Button>
      </CardContent>
    </Card>
    </>
  );
}

