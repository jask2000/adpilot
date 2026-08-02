import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import OpenAI from 'npm:openai@4.96.0';
import { secrets } from 'base44:runtime';

// gpt-image-1 only supports three native sizes — pick the closest to the target ratio.
const NATIVE_SIZES = [
  { w: 1024, h: 1024 },
  { w: 1536, h: 1024 },
  { w: 1024, h: 1536 },
];

function closestSize(w, h) {
  if (!w || !h) return '1024x1024';
  const ar = w / h;
  let best = NATIVE_SIZES[0], bestDiff = Infinity;
  for (const s of NATIVE_SIZES) {
    const d = Math.abs(s.w / s.h - ar);
    if (d < bestDiff) { bestDiff = d; best = s; }
  }
  return best.w + 'x' + best.h;
}

// Generates one ad image natively re-composed for a target aspect ratio using
// OpenAI gpt-image-1 (the model behind ChatGPT's image generation), with the
// user's uploaded photo as the content/style reference.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { sourceUrl, ratio, w, h, label, prompt } = body || {};
    if (!sourceUrl || !ratio) {
      return Response.json({ error: 'sourceUrl and ratio are required' }, { status: 400 });
    }

    const apiKey = secrets.get('OPENAI_API_KEY');
    if (!apiKey) return Response.json({ error: 'OpenAI API key not configured' }, { status: 500 });
    const openai = new OpenAI({ apiKey });

    // Fetch the source image into a File for the edit endpoint.
    const imgResp = await fetch(sourceUrl);
    if (!imgResp.ok) return Response.json({ error: 'Could not fetch source image' }, { status: 502 });
    const imgBuf = await imgResp.arrayBuffer();
    const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const file = new File([imgBuf], 'source.' + ext, { type: contentType });

    const size = closestSize(w, h);
    const finalPrompt = (prompt && prompt.trim()) ||
      ('Recompose this food advertising photo into a ' + ratio + ' (' + (label || ratio) +
        ') aspect ratio. CRITICAL — PRESERVE EXACT COLORS: keep the identical background color, surface, and full color palette/grading of the original. Do NOT change, shift, warm, cool, or recolor the background or any element. ' +
        'Keep EVERY element from the original — the pizza, the box, the table, the branding, the steam, any props and background — and REARRANGE them into a wider/taller balanced layout so the whole scene still fits. Do NOT zoom in, do NOT crop tightly onto the pizza, do NOT cut anything off, do NOT letterbox. ' +
        'Show a wide establishing shot of the full scene recomposed to fill the new frame naturally with tasteful negative space for ad copy. ' +
        'Identical product, plating, colors, lighting, and styling as the reference. Crisp sharp detail, no people, no extra text overlay.');

    const result = await openai.images.edit({
      model: 'gpt-image-1',
      image: file,
      prompt: finalPrompt,
      size,
      n: 1,
    });

    const b64 = result?.data?.[0]?.b64_json;
    if (!b64) return Response.json({ error: 'OpenAI returned no image data' }, { status: 502 });

    return Response.json({
      base64: 'data:image/png;base64,' + b64,
      ratio,
      size,
    });
  } catch (error) {
    return Response.json({ error: (error && error.message) || 'Image generation failed' }, { status: 500 });
  }
}