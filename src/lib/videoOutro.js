// Appends a brand logo as an outro card at the end of a generated video.
// Uses Canvas + MediaRecorder to play the source video frame-by-frame, then
// draws the logo centered on a dark background for `outroSec` seconds.
// Returns a base64 data URL (video/webm).

function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function loadImage(src, crossOrigin = true) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function appendLogoOutro(videoSrc, logoUrl, ratio, outroSec = 2.5) {
  const dims = ratio === '9:16' ? { w: 540, h: 960 } : { w: 960, h: 540 };

  // Load the logo image (with CORS for canvas).
  const logoImg = await loadImage(logoUrl, true);

  // Load the source video. Fetch as blob first if it's a URL to avoid
  // tainting the canvas (cross-origin videos without CORS flags break it).
  let videoSrcClean = videoSrc;
  let objectUrl = null;
  if (!videoSrc.startsWith('data:')) {
    const resp = await fetch(videoSrc);
    const blob = await resp.blob();
    objectUrl = URL.createObjectURL(blob);
    videoSrcClean = objectUrl;
  }

  const video = document.createElement('video');
  video.src = videoSrcClean;
  video.muted = true;
  video.playsInline = true;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Could not load source video for compositing'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = dims.w;
  canvas.height = dims.h;
  const ctx = canvas.getContext('2d');

  // Capture the canvas video stream at 30fps, then merge in the source
  // video's audio track so the composited output keeps the original audio.
  const canvasStream = canvas.captureStream(30);
  let recordingStream = canvasStream;
  try {
    const vStream = video.captureStream
      ? video.captureStream()
      : video.mozCaptureStream
        ? video.mozCaptureStream()
        : null;
    if (vStream) {
      const audioTracks = vStream.getAudioTracks();
      if (audioTracks.length) {
        recordingStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioTracks,
        ]);
      }
    }
  } catch (_) {
    // Audio capture not supported — fall back to video-only stream
  }

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus'
    : MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
  const recorder = new MediaRecorder(recordingStream, { mimeType, videoBitsPerSecond: 4_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start();

  // Phase 1 — play the video, drawing each frame to the canvas in real-time.
  let rafId;
  const drawVideo = () => {
    ctx.drawImage(video, 0, 0, dims.w, dims.h);
    rafId = requestAnimationFrame(drawVideo);
  };

  video.currentTime = 0;
  await video.play();
  drawVideo();

  await new Promise((resolve) => { video.onended = resolve; });
  cancelAnimationFrame(rafId);

  // Phase 2 — draw the logo outro card for outroSec seconds.
  const outroStart = performance.now();
  const drawOutro = () => {
    // Solid dark background
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, dims.w, dims.h);
    // Logo centered, scaled to fit ~50% of the frame
    const lr = logoImg.naturalWidth / logoImg.naturalHeight;
    const maxW = dims.w * 0.5;
    const maxH = dims.h * 0.5;
    let lw, lh;
    if (lr > maxW / maxH) { lw = maxW; lh = maxW / lr; }
    else { lh = maxH; lw = maxH * lr; }
    ctx.drawImage(logoImg, (dims.w - lw) / 2, (dims.h - lh) / 2, lw, lh);
    if (performance.now() - outroStart < outroSec * 1000) {
      rafId = requestAnimationFrame(drawOutro);
    }
  };
  drawOutro();

  // Keep the recorder running through the outro duration.
  await new Promise((resolve) => setTimeout(resolve, outroSec * 1000 + 150));

  recorder.stop();
  await stopped;
  cancelAnimationFrame(rafId);

  if (objectUrl) URL.revokeObjectURL(objectUrl);

  const blob = new Blob(chunks, { type: 'video/webm' });
  return blobToBase64(blob);
}