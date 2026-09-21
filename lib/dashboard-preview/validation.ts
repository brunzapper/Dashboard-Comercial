export interface PreviewUpload { revision: string; accessVersion: number; image: string; width: number; height: number }

export function validPreviewUpload(value: unknown): PreviewUpload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as PreviewUpload;
  if (typeof v.revision !== "string" || !Number.isFinite(Date.parse(v.revision)) ||
    !Number.isSafeInteger(v.accessVersion) || v.accessVersion < 1 ||
    !Number.isInteger(v.width) || v.width < 320 || v.width > 5120 ||
    !Number.isInteger(v.height) || v.height < 200 || v.height > 2880 ||
    typeof v.image !== "string" || v.image.length > 53356 ||
    !/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(v.image)) return null;
  const bytes = Buffer.from(v.image.slice(23), "base64");
  if (bytes.length < 30 || bytes.length > 40000 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP" || bytes.readUInt32LE(4) + 8 !== bytes.length || !["VP8 ","VP8L","VP8X"].includes(bytes.toString("ascii",12,16))) return null;
  return v;
}
