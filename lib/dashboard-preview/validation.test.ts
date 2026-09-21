import { expect,it } from "vitest";
import { validPreviewUpload } from "./validation";
function input(){
  const bytes=Buffer.alloc(32);bytes.write("RIFF");bytes.writeUInt32LE(24,4);bytes.write("WEBPVP8 ",8);
  return {revision:"2026-09-21T10:00:00Z",accessVersion:1,image:`data:image/webp;base64,${bytes.toString("base64")}`,width:1440,height:900};
}
it("aceita só envelope WebP pequeno com revisão/epoch/dimensões válidas",()=>{
  expect(validPreviewUpload(input())).not.toBeNull();
  for(const patch of [{accessVersion:null},{revision:"invalid"},{width:0},{image:"data:image/svg+xml,<svg/>"},{image:"data:image/webp;base64,"+"A".repeat(60000)}])expect(validPreviewUpload({...input(),...patch})).toBeNull();
  const truncated=input();truncated.image=truncated.image.slice(0,-4);expect(validPreviewUpload(truncated)).toBeNull();
});
