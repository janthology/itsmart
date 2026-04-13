import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
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
    QRCode.toDataURL(qrValue, {
      width: 160,
      margin: 1,
      color: { dark: "#123456", light: "#ffffff" },
    }).then(setQrDataUrl);
  }, [qrValue]);

  const handlePrint = () => {
    if (!qrDataUrl) return;

    const win = window.open("", "_blank", "width=400,height=500");
    if (!win) return;

    win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Asset Label — ${assetTag}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: flex-start; padding: 24px; background: #fff; }
          .label {
            border: 2px solid #123456;
            border-radius: 12px;
            padding: 20px;
            width: 280px;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
          }
          .header {
            width: 100%;
            background: #123456;
            color: white;
            text-align: center;
            padding: 8px 12px;
            border-radius: 8px;
            font-size: 11px;
            font-weight: 600;
            letter-spacing: 0.05em;
            text-transform: uppercase;
          }
          .qr { width: 140px; height: 140px; }
          .tag {
            font-size: 22px;
            font-weight: 800;
            color: #123456;
            letter-spacing: 0.05em;
            font-family: monospace;
          }
          .name { font-size: 13px; font-weight: 600; color: #1e293b; text-align: center; }
          .meta { font-size: 11px; color: #64748b; text-align: center; line-height: 1.6; }
          .divider { width: 100%; border-top: 1px dashed #cbd5e1; }
          @media print {
            body { padding: 0; }
            .label { border-radius: 0; border: 2px solid #123456; }
          }
        </style>
      </head>
      <body>
        <div class="label">
          <div class="header">DOST — IT Asset</div>
          <img class="qr" src="${qrDataUrl}" alt="QR Code" />
          <div class="tag">${assetTag}</div>
          <div class="divider"></div>
          <div class="name">${assetName}</div>
          <div class="meta">
            ${category.charAt(0).toUpperCase() + category.slice(1)}
            ${location ? `<br/>${location}` : ""}
            ${serialNumber ? `<br/>S/N: ${serialNumber}` : ""}
          </div>
        </div>
        <script>window.onload = () => { window.print(); window.close(); }<\/script>
      </body>
      </html>
    `);
    win.document.close();
  };

  return (
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
  );
}
