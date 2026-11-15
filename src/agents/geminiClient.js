/**
 * Google AI (Gemini) API Client
 *
 * Uses `GEMINI_API_KEY` (via Google AI Studio / Vertex AI Express / Secret Manager on Cloud Run)
 * to invoke Gemini models over HTTPS with structured JSON output.
 * Falls back cleanly when `GEMINI_API_KEY` is not set so local development & testing work seamlessly.
 */

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

function isGeminiConfigured() {
  return Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
}

async function callGeminiJson({ systemPrompt, userPrompt, imageBase64, imageMimeType, model = DEFAULT_MODEL }) {
  if (!isGeminiConfigured()) {
    return { ok: false, mode: 'local-deterministic-fallback', reason: 'GEMINI_API_KEY not configured' };
  }

  const parts = [];
  if (imageBase64 && imageMimeType) {
    parts.push({
      inlineData: {
        mimeType: imageMimeType,
        data: imageBase64,
      },
    });
  }
  parts.push({ text: userPrompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;

  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, mode: 'local-deterministic-fallback', reason: `Gemini HTTP ${res.status}: ${errText.slice(0, 200)}` };
    }

    const data = await res.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      return { ok: false, mode: 'local-deterministic-fallback', reason: 'Empty Gemini response' };
    }

    const parsed = JSON.parse(rawText);
    return { ok: true, mode: 'gemini-live', model, data: parsed };
  } catch (err) {
    return { ok: false, mode: 'local-deterministic-fallback', reason: err.message };
  }
}

module.exports = {
  isGeminiConfigured,
  callGeminiJson,
};
