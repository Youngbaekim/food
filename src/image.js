// 음식 사진 처리 — 올리기 전에 최대한 가볍게 줄임 (보관용) + 목록용 미리보기
// 보관용: 긴 변 1,280px, 200KB 이하. WebP를 지원하는 브라우저는 JPEG와 비교해 더 작은 쪽을 씀
const MAX_SIDE = 1280;
const MAX_BYTES = 200 * 1024;
const QUALITIES = [0.78, 0.7, 0.62, 0.55, 0.48];

const toBlob = (canvas, type, q) => new Promise((r) => canvas.toBlob(r, type, q));

export async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* 아래 방식 */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawTo(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h);
  return c;
}

let webpOK = null;
async function canWebp() {
  if (webpOK !== null) return webpOK;
  const c = document.createElement('canvas');
  c.width = c.height = 2;
  const b = await toBlob(c, 'image/webp', 0.8);
  webpOK = !!b && b.type === 'image/webp';
  return webpOK;
}

/** 한 가지 형식으로 기준 이하가 될 때까지 화질을 낮춤 */
async function fit(canvas, type) {
  let last = null;
  for (const q of QUALITIES) {
    last = await toBlob(canvas, type, q);
    if (last && last.size <= MAX_BYTES) return last;
  }
  return last;
}

/** 보관용 압축: 긴 변 1,280px → 200KB 이하가 될 때까지 화질·크기를 단계적으로 낮춤 */
export async function compressImage(src) {
  const types = (await canWebp()) ? ['image/webp', 'image/jpeg'] : ['image/jpeg'];
  let scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  let best = null;
  for (let round = 0; round < 4; round++) {
    const c = drawTo(src, Math.round(src.width * scale), Math.round(src.height * scale));
    for (const t of types) {
      const b = await fit(c, t);
      if (b && (!best || b.size < best.size)) best = b;
    }
    if (best && best.size <= MAX_BYTES) return best;
    scale *= 0.8;
  }
  return best;
}

/** 목록용 미리보기: 긴 변 200px JPEG data URL (약 6~10KB) */
export function makeThumb(src) {
  const s = Math.min(1, 200 / Math.max(src.width, src.height));
  const c = drawTo(src, Math.round(src.width * s), Math.round(src.height * s));
  return c.toDataURL('image/jpeg', 0.6);
}

/** 90° 회전 (시계 방향) → canvas */
export function rotateCanvas(src, deg) {
  const d = ((deg % 360) + 360) % 360;
  const swap = d === 90 || d === 270;
  const c = document.createElement('canvas');
  c.width = swap ? src.height : src.width;
  c.height = swap ? src.width : src.height;
  const ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((d * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
}

export const kb = (n) => `${Math.round((n || 0) / 1024)}KB`;
