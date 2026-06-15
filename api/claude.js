// Vercel Serverless Function - Anthropic proxy (CommonJS)
// POST { prompt } -> { ...parsedJson } | { error }
// env: ANTHROPIC_API_KEY

// 허용 도메인(우리 앱)에서 온 요청만 받도록 제한. 빈 배열이면 전체 허용.
const ALLOWED_ORIGINS = [
  'https://nomi-host.github.io',
];

function pickOrigin(req) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.length === 0) return '*';
  if (ALLOWED_ORIGINS.includes(origin)) return origin;
  return ALLOWED_ORIGINS[0]; // 기본값(차단된 origin엔 쿠키/CORS 불일치로 막힘)
}

module.exports = async (req, res) => {
  const allowOrigin = pickOrigin(req);
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

  // origin 제한: 허용 목록에 없으면 거부
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.length > 0 && origin && !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ error: 'forbidden origin' });
    return;
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: 'no ANTHROPIC_API_KEY' }); return; }

  try {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    if (!body || typeof body !== 'object') body = {};
    const prompt = body.prompt;
    if (!prompt) { res.status(400).json({ error: 'no prompt' }); return; }

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const text = await r.text();
    if (!r.ok) { res.status(502).json({ error: 'claude error', status: r.status, detail: text.slice(0, 500) }); return; }

    const data = JSON.parse(text);
    let out = '';
    const blocks = data.content || [];
    for (const b of blocks) { if (b.type === 'text') out += b.text + '\n'; }
    const clean = out.replace(/```json/g, '').replace(/```/g, '').trim();

    try { res.status(200).json(JSON.parse(clean)); }
    catch (e) { res.status(200).json({ text: clean }); }
  } catch (e) {
    res.status(500).json({ error: 'proxy error', detail: String(e && e.message ? e.message : e) });
  }
};
