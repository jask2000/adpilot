import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

// Google Veo image-to-video via the Gemini API (generativelanguage).
// Accepts a source image URL + motion prompt, returns a video data URL.
// Uses the long-running operation API with polling.
const VEO_MODEL = 'veo-3.0-generate-001';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const ASPECT_MAP = { '9:16': '9:16', '16:9': '16:9' };

async function bufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export default async function(req) {
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

    // Fetch the source image and base64-encode it for Veo.
    const imgResp = await fetch(sourceUrl);
    if (!imgResp.ok) return Response.json({ error: 'Could not fetch source image' }, { status: 502 });
    const imgBuf = await imgResp.arrayBuffer();
    const imgB64 = await bufferToBase64(imgBuf);
    // Veo REQUIRES mimeType to recognize the image; without it the model
    // silently ignores the image and falls back to text-only generation.
    const imgMime = (imgResp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();

    const ar = ASPECT_MAP[ratio] || '16:9';
    const dur = Math.min(Math.max(Number(duration) || 6, 4), 8);

    const predictResp = await fetch(
      API_BASE + '/models/' + VEO_MODEL + ':predictLongRunning?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [
            {
              prompt,
              image: { bytesBase64Encoded: imgB64, mimeType: imgMime },
            },
          ],
          parameters: {
            sampleCount: 1,
            aspectRatio: ar,
            durationSeconds: dur,
          },
        }),
      }
    );
    if (!predictResp.ok) {
      const errText = await predictResp.text();
      return Response.json({ error: 'Veo start failed: ' + errText }, { status: 502 });
    }
    const predictData = await predictResp.json();
    const opName = predictData.name;
    if (!opName) return Response.json({ error: 'No operation returned by Veo' }, { status: 502 });

    // Poll the long-running operation (up to ~150s).
    const deadline = Date.now() + 150000;
    let videoB64 = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 8000));
      const pollResp = await fetch(API_BASE + '/' + opName + '?key=' + apiKey);
      if (!pollResp.ok) {
        const errText = await pollResp.text();
        return Response.json({ error: 'Veo poll failed: ' + errText }, { status: 502 });
      }
      const pollData = await pollResp.json();
      if (pollData.done) {
        if (pollData.error) return Response.json({ error: 'Veo failed: ' + (pollData.error.message || 'unknown') }, { status: 502 });
        // Veo returns the video either as base64 bytes or as a download URI.
        const genResp = pollData.response?.generateVideoResponse || pollData.response || {};
        const samples = genResp.generatedSamples || [];
        const sample = samples[0];
        if (sample?.video?.bytesBase64Encoded) {
          videoB64 = sample.video.bytesBase64Encoded;
        } else if (sample?.video?.uri) {
          // Download the video from the URI using the API key.
          const dlResp = await fetch(sample.video.uri + '?key=' + apiKey);
          if (dlResp.ok) {
            const dlBuf = await dlResp.arrayBuffer();
            videoB64 = await bufferToBase64(dlBuf);
          }
        }
        if (videoB64) break;
        return Response.json({ error: 'Veo returned no video samples' }, { status: 502 });
      }
    }
    if (!videoB64) return Response.json({ error: 'Veo generation timed out' }, { status: 504 });

    return Response.json({
      base64: 'data:video/mp4;base64,' + videoB64,
      ratio,
    });
  } catch (error) {
    return Response.json({ error: (error && error.message) || 'Video generation failed' }, { status: 500 });
  }
}