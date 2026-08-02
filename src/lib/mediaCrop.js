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

export const ASSET_RATIOS = [
  { value: '1:1', label: '1:1 · Feed', w: 1, h: 1 },
  { value: '4:5', label: '4:5 · Instagram Feed', w: 4, h: 5 },
  { value: '9:16', label: '9:16 · Stories / Reels', w: 9, h: 16 },
  { value: '1.91:1', label: '1.91:1 · Link ads', w: 1.91, h: 1 },
];