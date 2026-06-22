// /api/tts.js — Google Cloud Text-to-Speech 프록시 (Chirp 3: HD)
// 앱(브라우저)에서 텍스트를 보내면, 서버가 Google TTS를 호출해 MP3(base64)를 돌려준다.
// 키는 Vercel 환경변수 GOOGLE_TTS_KEY 에만 존재하며 브라우저에 노출되지 않는다.
//
// [이번 변경] 일본어 전용 → 일본어/한국어 둘 다 지원.
//   body.lang 으로 언어를 받는다: "ja"(기본) | "ko"
//   - lang 없거나 "ja": 기존과 100% 동일하게 동작(일본어 Chirp3-HD).
//   - lang "ko": 한국어 음성으로 읽는다.

// --- 보안 설정 -------------------------------------------------------------
const ALLOWED_ORIGINS = ["https://nomi-host.github.io"]; // 우리 앱만 허용
const RATE_MAX = 40;          // IP당 60초에 최대 호출 수 (예문/단어 듣기는 많을 수 있어 넉넉히)
const RATE_WINDOW = 60 * 1000;
const MAX_TEXT = 400;         // 한 번에 읽을 최대 글자 수 (예문은 짧음)

// --- Chirp 3: HD 음성 목록 (언어별/성별별) ---------------------------------
// 이름 형식: <languageCode>-Chirp3-HD-<이름>
const VOICES = {
  ja: {
    female: ["Aoede", "Kore", "Leda", "Zephyr", "Autonoe", "Callirrhoe", "Despina", "Erinome", "Gacrux", "Laomedeia", "Sulafat", "Vindemiatrix", "Achernar", "Pulcherrima"],
    male:   ["Puck", "Charon", "Fenrir", "Orus", "Algenib", "Algieba", "Alnilam", "Achird", "Enceladus", "Iapetus", "Rasalgethi", "Sadachbia", "Schedar", "Umbriel", "Zubenelgenubi", "Sadaltager"],
  },
};

// 언어별 languageCode 와 대표(고정) 음성
const LANG = {
  ja: { code: "ja-JP", fixedFemale: "Aoede", fixedMale: "Alnilam" },
  ko: { code: "ko-KR", fixedFemale: "Aoede", fixedMale: "Alnilam" },
};

const rateMap = new Map(); // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  const arr = (rateMap.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  arr.push(now);
  rateMap.set(ip, arr);
  return arr.length > RATE_MAX;
}

// 언어/성별/이름에 맞는 음성 풀네임을 만든다.
// 일본어: 기존과 동일하게 Chirp3-HD 특정 음성을 지정.
// 한국어: Chirp3-HD 음성 이름이 언어별로 다를 수 있어, 이름을 비우고
//         languageCode(ko-KR)만 줘서 구글이 기본 한국어 음성을 고르게 한다(가장 안전).
function pickVoice(lang, gender, name) {
  if (lang === "ko") {
    // 특정 이름을 명시적으로 보냈을 때만 사용, 아니면 null(=languageCode 기본)
    if (name && /^[A-Za-z-]+$/.test(name)) return name;
    return null;
  }
  const L = LANG[lang] || LANG.ja;
  const prefix = L.code + "-Chirp3-HD-";
  if (name && /^[A-Za-z]+$/.test(name)) return prefix + name;
  if (gender === "female") return prefix + L.fixedFemale;
  if (gender === "male") return prefix + L.fixedMale;
  const v = VOICES[lang] || VOICES.ja;
  const pool = v.female.concat(v.male);
  const pickName = pool[Math.floor(Math.random() * pool.length)];
  return prefix + pickName;
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

  // 언어: "ja"(기본) | "ko". languageCode("ko-KR")로 와도 앞 두 글자로 인식.
  let lang = (body && body.lang ? String(body.lang) : "ja").toLowerCase();
  if (lang.startsWith("ko")) lang = "ko";
  else lang = "ja";

  const gender = body.gender || "random";       // 'female' | 'male' | 'random'
  const voiceName = body.voice || "";           // 특정 이름 지정 시
  const rate = Math.min(2.0, Math.max(0.25, Number(body.rate) || 1.0)); // 0.25~2.0

  const voice = pickVoice(lang, gender, voiceName);
  const languageCode = (LANG[lang] || LANG.ja).code;

  const voiceObj = { languageCode };
  if (voice) voiceObj.name = voice; // 이름이 있을 때만 지정(없으면 기본 음성)

  const payload = {
    input: { text },
    voice: voiceObj,
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
