// /api/tts.js — Google Cloud Text-to-Speech 프록시 (Chirp 3: HD, 일본어)
// 앱(브라우저)에서 텍스트를 보내면, 서버가 Google TTS를 호출해 MP3(base64)를 돌려준다.
// 키는 Vercel 환경변수 GOOGLE_TTS_KEY 에만 존재하며 브라우저에 노출되지 않는다.

// --- 보안 설정 -------------------------------------------------------------
const ALLOWED_ORIGINS = ["https://nomi-host.github.io"]; // 우리 앱만 허용
const RATE_MAX = 40;          // IP당 60초에 최대 호출 수 (예문/단어 듣기는 많을 수 있어 넉넉히)
const RATE_WINDOW = 60 * 1000;
const MAX_TEXT = 400;         // 한 번에 읽을 최대 글자 수 (예문은 짧음)

// --- Chirp 3: HD 일본어 음성 목록 (성별별) ---------------------------------
// 이름 형식: ja-JP-Chirp3-HD-<이름>
const VOICES = {
  female: ["Aoede", "Kore", "Leda", "Zephyr", "Autonoe", "Callirrhoe", "Despina", "Erinome", "Gacrux", "Laomedeia", "Sulafat", "Vindemiatrix", "Achernar", "Pulcherrima"],
  male:   ["Puck", "Charon", "Fenrir", "Orus", "Algenib", "Algieba", "Alnilam", "Achird", "Enceladus", "Iapetus", "Rasalgethi", "Sadachbia", "Schedar", "Umbriel", "Zubenelgenubi", "Sadaltager"],
};

const rateMap = new Map(); // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  const arr = (rateMap.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  arr.push(now);
  rateMap.set(ip, arr);
  return arr.length > RATE_MAX;
}

// 성별 고정 시 항상 같은 목소리가 나오도록 대표 음성을 지정한다.
// (이전엔 매 요청마다 랜덤으로 뽑아 단어/예문/속도마다 사람이 바뀌는 문제가 있었음)
const FIXED_FEMALE = "Aoede"; // 대표 여성
const FIXED_MALE = "Alnilam";  // 대표 남성

function pickVoice(gender, name) {
  // 특정 이름이 지정되면 그대로 사용
  if (name && /^[A-Za-z]+$/.test(name)) return "ja-JP-Chirp3-HD-" + name;
  if (gender === "female") return "ja-JP-Chirp3-HD-" + FIXED_FEMALE;
  if (gender === "male") return "ja-JP-Chirp3-HD-" + FIXED_MALE;
  // random: 전체에서 매번 다르게
  const pool = VOICES.female.concat(VOICES.male);
  const pickName = pool[Math.floor(Math.random() * pool.length)];
  return "ja-JP-Chirp3-HD-" + pickName;
}

module.exports = async (req, res) => {
  const origin = req.headers.origin || "";

  // CORS: 허용된 출처에만 응답
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  // 브라우저 출처 제한(우리 앱 외 차단). curl 등으로 우회는 가능하나 1차 방어.
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    res.status(403).json({ error: "origin not allowed" });
    return;
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) { res.status(429).json({ error: "rate limit" }); return; }

  const KEY = process.env.GOOGLE_TTS_KEY;
  if (!KEY) { res.status(500).json({ error: "server key missing" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = (body && body.text ? String(body.text) : "").slice(0, MAX_TEXT);
  if (!text.trim()) { res.status(400).json({ error: "no text" }); return; }

  const gender = body.gender || "random";       // 'female' | 'male' | 'random'
  const voiceName = body.voice || "";           // 특정 이름 지정 시
  const rate = Math.min(2.0, Math.max(0.25, Number(body.rate) || 1.0)); // 0.25~2.0

  const voice = pickVoice(gender, voiceName);

  const payload = {
    input: { text },
    voice: { languageCode: "ja-JP", name: voice },
    audioConfig: { audioEncoding: "MP3", speakingRate: rate },
  };

  try {
    const r = await fetch(
      "https://texttospeech.googleapis.com/v1/text:synthesize?key=" + encodeURIComponent(KEY),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    const data = await r.json();
    if (!r.ok) {
      res.status(502).json({ error: "tts failed", detail: (data && data.error && data.error.message) || "unknown" });
      return;
    }
    // data.audioContent = base64 MP3
    res.status(200).json({ audio: data.audioContent, voice });
  } catch (e) {
    res.status(500).json({ error: "fetch error", detail: String(e && e.message ? e.message : e) });
  }
};
