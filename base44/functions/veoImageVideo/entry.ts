import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { GoogleGenAI } from 'npm:@google/genai@^1.0.0';

// Google Veo image-to-video via the official @google/genai SDK.
// The SDK handles correct serialization of the image parameter for Veo 3.1.
// Accepts a source image URL + motion prompt, returns a video data URL.

const VEO_MODEL = 'veo-3.1-generate-preview';
const ASPECT_MAP = { '9:16': '9:16', '16:9': '16:9' };

async function bufferToBase64(buf: ArrayBuffer): Promise<string> {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
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

    // Fetch the source image and base64-encode it.
    const imgResp = await fetch(sourceUrl);
    if (!imgResp.ok) return Response.json({ error: 'Could not fetch source image (' + imgResp.status + ')' }, { status: 502 });
    const imgBuf = await imgResp.arrayBuffer();
    const imgB64 = await bufferToBase64(imgBuf);
    const imgMime = (imgResp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim() || 'image/jpeg';

    const ar = ASPECT_MAP[ratio] || '16:9';
    const dur = Math.min(Math.max(Number(duration) || 6, 4), 8);

    const ai = new GoogleGenAI({ apiKey });

    // Start image-to-video generation using the SDK.
    // The image is passed as inline base64 — the SDK serializes it correctly
    // for the Veo 3.1 predictLongRunning endpoint.
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
        sampleCount: 1,
      } as any,
    });

    // Poll the long-running operation (up to ~150s).
    const deadline = Date.now() + 150000;
    while (!operation.done && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10000));
      operation = await ai.operations.getVideosOperation({ operation } as any);
    }

    if (!operation.done) return Response.json({ error: 'Veo generation timed out' }, { status: 504 });

    if ((operation as any).error) {
      return Response.json({ error: 'Veo failed: ' + ((operation as any).error?.message || 'unknown') }, { status: 502 });
    }

    const generatedVideos = (operation as any).response?.generatedVideos || [];
    const videoRef = generatedVideos[0]?.video;
    if (!videoRef) return Response.json({ error: 'Veo returned no video' }, { status: 502 });

    // The video ref has a URI — download the bytes using the API key.
    const videoUri = videoRef.uri || videoRef.videoUri;
    if (!videoUri) return Response.json({ error: 'Veo returned no video URI' }, { status: 502 });

    const dlResp = await fetch(videoUri, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!dlResp.ok) {
      // The URI might already include query params — try with key as query param.
      const dlResp2 = await fetch(videoUri + (videoUri.includes('?') ? '&' : '?') + 'key=' + apiKey);
      if (!dlResp2.ok) return Response.json({ error: 'Could not download video (' + dlResp.status + ')' }, { status: 502 });
      const dlBuf2 = await dlResp2.arrayBuffer();
      const dlB642 = await bufferToBase64(dlBuf2);
      return Response.json({ base64: 'data:video/mp4;base64,' + dlB642, ratio });
    }
    const dlBuf = await dlResp.arrayBuffer();
    const dlB64 = await bufferToBase64(dlBuf);

    return Response.json({
      base64: 'data:video/mp4;base64,' + dlB64,
      ratio,
    });
  } catch (error: any) {
    return Response.json({ error: (error && error.message) || 'Video generation failed' }, { status: 500 });
  }
}