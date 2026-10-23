/**
 * A small, cached, mid-grey-centred noise tile, used to give the sample
 * illustrations and demo backdrop a printed-photo texture.
 */
let grainTile: HTMLCanvasElement | null = null;

export function getGrainTile(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const size = 192;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    // Sum of two uniforms → soft triangular distribution, closer to film grain.
    const v = 128 + (Math.random() + Math.random() - 1) * 70;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}
