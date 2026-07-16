import * as QRCode from "qrcode";

export interface PairingQrModel {
  path: string;
  size: number;
}

export function createPairingQrModel(url: string): PairingQrModel | null {
  try {
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const margin = 4;
    const path: string[] = [];
    for (let row = 0; row < qr.modules.size; row += 1) {
      for (let column = 0; column < qr.modules.size; column += 1) {
        if (qr.modules.get(row, column)) {
          path.push(`M${column + margin} ${row + margin}h1v1h-1z`);
        }
      }
    }
    return { path: path.join(""), size: qr.modules.size + margin * 2 };
  } catch {
    return null;
  }
}
