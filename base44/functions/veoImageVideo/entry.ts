import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { GoogleGenAI } from 'npm:@google/genai@^1.0.0';

// Google Veo image-to-video via the official @google/genai SDK.
// Accepts a source image URL + motion prompt, returns a video data URL.

const VEO_MODEL = 'veo-3.1-generate-preview';
const ASPECT_MAP = { '9:16': '9:16', '16:9': '16:9' };

function bufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

// Detect actual image MIME type from magic bytes — don't trust the Content-Type
// header since base44 storage may return application/octet-stream or similar.
function detectMimeType(bytes: Uint8Array): string {
  if (bytes.length < 4) return 'image/jpeg';
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  // WebP: 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp';
  return 'image/jpeg';
}

export default async function(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { sourceUrl, prompt, ratio, duration } = body || {};
    if (!sourceUrl) return Response.json({ error: 'sourceUrl is required' }, { status: 400 });
    if (!prompt) return Response.json({ error: 'prompt is required' }, { status: 400 });

    const apiKey = secrets.get('GOOGLE_AI_STUDIO_API_KEY');
    if (!apiKey) return Response.json({ error: 'Google AI Studio API key not configured' }, { status: 500 });

    // Fetch the source image.
    const imgResp = await fetch(sourceUrl);
    if (!imgResp.ok) return Response.json({ error: 'Could not fetch source image (' + imgResp.status + ')' }, { status: 502 });
    const imgBuf = await imgResp.arrayBuffer();
    const imgBytes = new Uint8Array(imgBuf);
    const imgMime = detectMimeType(imgBytes);
    const imgB64 = bufferToBase64(imgBuf);

    console.log('veoImageVideo: image fetched, size=' + imgBytes.length + ' bytes, mime=' + imgMime + ', b64len=' + imgB64.length);

    if (imgBytes.length < 100) {
      return Response.json({ error: 'Source image too small (' + imgBytes.length + ' bytes) — possibly not an image' }, { status: 502 });
    }

    const ar = ASPECT_MAP[ratio] || '16:9';
    const dur = Math.min(Math.max(Number(duration) || 6, 4), 8);

    const ai = new GoogleGenAI({ apiKey });

    // Image-to-video: pass the image as inline base64. The SDK serializes
    // image.imageBytes → instances[0].image.bytesBase64Encoded for the REST call.
    let operation = await ai.models.generateVideos({
      model: VEO_MODEL,
      prompt,
      image: {
        imageBytes: imgB64,
        mimeType: imgMime,
      },
      config: {
        aspectRatio: ar,
        durationSeconds: dur,
        numberOfVideos: 1,
      } as any,
    });

    console.log('veoImageVideo: operation started, name=' + (operation as any).name + ', done=' + (operation as any).done);

    // Poll the long-running operation (up to ~90s, checking every 5s).
    const deadline = Date.now() + 90000;
    while (!operation.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      operation = await ai.operations.getVideosOperation({ operation } as any);
    }

    if (!operation.done) return Response.json({ error: 'Veo generation is taking longer than 90 seconds — please try again. Veo clips normally take 30-60 seconds; retry if it still fails.' }, { status: 504 });

    if ((operation as any).error) {
      console.error('veoImageVideo: operation error:', JSON.stringify((operation as any).error));
      const opMsg = (operation as any).error?.message || 'unknown';
      if (/429|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(opMsg)) {
        return Response.json({ error: 'Google AI Studio quota or rate limit exceeded (429). Veo is a paid model — please top up your AI Studio billing credits and wait a moment before retrying. (' + opMsg + ')' }, { status: 429 });
      }
      return Response.json({ error: 'Veo failed: ' + opMsg }, { status: 502 });
    }

    const generatedVideos = (operation as any).response?.generatedVideos || [];
    const videoRef = generatedVideos[0]?.video;
    if (!videoRef) {
      console.error('veoImageVideo: no video in response:', JSON.stringify((operation as any).response || {}).slice(0, 500));
      return Response.json({ error: 'Veo returned no video' }, { status: 502 });
    }

    const videoUri = videoRef.uri || videoRef.videoUri;
    if (!videoUri) return Response.json({ error: 'Veo returned no video URI' }, { status: 502 });

    console.log('veoImageVideo: video URI=' + videoUri);

    // Download the video bytes.
    let dlBuf: ArrayBuffer | null = null;
    const dlResp = await fetch(videoUri, { headers: { 'x-goog-api-key': apiKey } });
    if (dlResp.ok) {
      dlBuf = await dlResp.arrayBuffer();
    } else {
      const dlResp2 = await fetch(videoUri + (videoUri.includes('?') ? '&' : '?') + 'key=' + apiKey);
      if (dlResp2.ok) dlBuf = await dlResp2.arrayBuffer();
    }
    if (!dlBuf) return Response.json({ error: 'Could not download video' }, { status: 502 });

    const dlB64 = bufferToBase64(dlBuf);
    return Response.json({ base64: 'data:video/mp4;base64,' + dlB64, ratio });
  } catch (error: any) {
    console.error('veoImageVideo: exception:', error?.message, error?.stack);
    // Google API errors arrive as stringified JSON in error.message — try to
    // extract a clean human-readable message and the real status code.
    let msg = (error && error.message) || 'Video generation failed';
    let status = 500;
    try {
      const parsed = typeof msg === 'string' ? JSON.parse(msg) : null;
      if (parsed?.error?.message) {
        msg = parsed.error.message;
        if (parsed.error.code === 429) status = 429;
      }
    } catch (_) { /* not JSON, use raw message */ }
    if (status === 429 || /429|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(msg)) {
      status = 429;
      msg = 'Google AI Studio quota or rate limit exceeded (429). Veo is a paid model — please top up your AI Studio billing credits and wait a moment before retrying. (' + msg + ')';
    }
    return Response.json({ error: msg }, { status });
  }
}