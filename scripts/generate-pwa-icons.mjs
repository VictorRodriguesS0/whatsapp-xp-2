import sharp from "sharp";

const source = "public/brand/xp-symbol.png";
const background = { r: 5, g: 5, b: 5, alpha: 1 };

for (const size of [16, 32, 180, 192, 512]) {
  await sharp(source)
    .resize(size, size, { fit: "contain", background })
    .png({ compressionLevel: 9 })
    .toFile(`public/icons/xp-${size}.png`);
}

const safeSize = Math.round(512 * 0.66);
const safeLogo = await sharp(source)
  .resize(safeSize, safeSize, { fit: "contain", background })
  .png()
  .toBuffer();

await sharp({ create: { width: 512, height: 512, channels: 4, background } })
  .composite([{ input: safeLogo, gravity: "center" }])
  .png({ compressionLevel: 9 })
  .toFile("public/icons/xp-maskable-512.png");
