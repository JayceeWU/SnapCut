import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

interface DecodedRgbaPng {
  readonly width: number;
  readonly height: number;
  readonly pixels: Buffer;
}

function paethPredictor(left: number, above: number, upperLeft: number): number {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeRgbaPng(filePath: string): DecodedRgbaPng {
  const png = fs.readFileSync(filePath);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  let offset = 8;
  let width = 0;
  let height = 0;
  const compressed: Buffer[] = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      expect(data[8]).toBe(8);
      expect(data[9]).toBe(6);
      expect(data[12]).toBe(0);
    } else if (type === 'IDAT') {
      compressed.push(data);
    }
    offset += length + 12;
  }

  const bytesPerPixel = 4;
  const rowBytes = width * bytesPerPixel;
  const filtered = zlib.inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[sourceOffset++];
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = filtered[sourceOffset++];
      const outputOffset = y * rowBytes + x;
      const left = x >= bytesPerPixel ? pixels[outputOffset - bytesPerPixel]! : 0;
      const above = y > 0 ? pixels[outputOffset - rowBytes]! : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel ? pixels[outputOffset - rowBytes - bytesPerPixel]! : 0;
      const predictor = (() => {
        switch (filter) {
          case 0:
            return 0;
          case 1:
            return left;
          case 2:
            return above;
          case 3:
            return Math.floor((left + above) / 2);
          case 4:
            return paethPredictor(left, above, upperLeft);
          default:
            throw new Error(`Unsupported PNG filter ${String(filter)}`);
        }
      })();
      pixels[outputOffset] = (raw! + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

describe('SnapCut brand assets', () => {
  const images = path.resolve(__dirname, '../assets/images');

  it('uses a real transparent adaptive foreground inside the mask-safe center', () => {
    const image = decodeRgbaPng(path.join(images, 'snapcut-adaptive-foreground.png'));
    expect(image.width).toBe(image.height);
    expect(image.width).toBeGreaterThanOrEqual(1024);

    let minimumX = image.width;
    let maximumX = -1;
    let minimumY = image.height;
    let maximumY = -1;
    let transparentPixels = 0;
    for (let y = 0; y < image.height; y += 1) {
      for (let x = 0; x < image.width; x += 1) {
        const alpha = image.pixels[(y * image.width + x) * 4 + 3]!;
        if (alpha === 0) transparentPixels += 1;
        // Ignore sub-visible antialiasing noise when measuring artwork bounds.
        if (alpha >= 8) {
          minimumX = Math.min(minimumX, x);
          maximumX = Math.max(maximumX, x);
          minimumY = Math.min(minimumY, y);
          maximumY = Math.max(maximumY, y);
        }
      }
    }

    expect(transparentPixels).toBeGreaterThan(image.width * image.height * 0.8);
    expect((maximumX - minimumX + 1) / image.width).toBeLessThanOrEqual(0.5);
    expect((maximumY - minimumY + 1) / image.height).toBeLessThanOrEqual(0.5);
  });

  it('does not reuse the opaque launcher icon as the adaptive foreground', () => {
    const icon = fs.readFileSync(path.join(images, 'snapcut-icon.png'));
    const foreground = fs.readFileSync(path.join(images, 'snapcut-adaptive-foreground.png'));
    expect(foreground.equals(icon)).toBe(false);
  });
});
