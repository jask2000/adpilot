// Shared image cropping utility — crops a data URL to a target aspect ratio.
export function cropToRatio(dataUrl, rw, rh) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const targetW = 1080;
      const targetH = Math.round((1080 * rh) / rw);
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      const srcRatio = img.width / img.height;
      const dstRatio = targetW / targetH;
      let sx = 0, sy = 0, sw = img.width, sh = img.height;
      if (srcRatio > dstRatio) {
        sw = img.height * dstRatio;
        sx = (img.width - sw) / 2;
      } else {
        sh = img.width / dstRatio;
        sy = (img.height - sh) / 2;
      }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// Fits the ENTIRE source image inside a canvas of the target aspect ratio
// (contain, not cover) — nothing is cut off. The remaining space is filled
// with a blurred, slightly-oversized copy of the image for a clean letterbox.
export function fitToRatio(dataUrl, rw, rh) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const targetW = 1080;
      const targetH = Math.round((1080 * rh) / rw);
      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      const dstRatio = targetW / targetH;
      const srcRatio = img.width / img.height;

      // 1. Blurred background fill — cover, drawn 15% oversized so blur edges
      //    sample real pixels (no dark/transparent fringe at the bars).
      ctx.filter = 'blur(24px)';
      const over = 1.15;
      let bx = 0, by = 0, bw = targetW * over, bh = targetH * over;
      if (srcRatio > dstRatio) {
        bh = (targetW * over) / srcRatio;
        by = (targetH - bh) / 2;
      } else {
        bw = (targetH * over) * srcRatio;
        bx = (targetW - bw) / 2;
      }
      ctx.drawImage(img, bx, by, bw, bh);
      ctx.filter = 'none';

      // 2. Sharp contained image centered on top — full content intact.
      let ix = 0, iy = 0, iw = targetW, ih = targetH;
      if (srcRatio > dstRatio) {
        ih = targetW / srcRatio;
        iy = (targetH - ih) / 2;
      } else {
        iw = targetH * srcRatio;
        ix = (targetW - iw) / 2;
      }
      ctx.drawImage(img, ix, iy, iw, ih);

      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export const ASSET_RATIOS = [
  { value: '1:1', label: '1:1 · Feed', w: 1, h: 1 },
  { value: '4:5', label: '4:5 · Instagram Feed', w: 4, h: 5 },
  { value: '9:16', label: '9:16 · Stories / Reels', w: 9, h: 16 },
  { value: '1.91:1', label: '1.91:1 · Link ads', w: 1.91, h: 1 },
];