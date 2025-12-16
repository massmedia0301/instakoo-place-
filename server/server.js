/**
 * instakoo Backend Server
 * Monolith Deployment for Cloud Run (Express serving React Static Files)
 */

import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import NodeCache from "node-cache";
import rateLimit from "express-rate-limit";
import axios from "axios";
import * as cheerio from "cheerio";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright";
import dotenv from "dotenv";

dotenv.config();

// ESM __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// dist path (monolith: server/ 아래에서 ../dist)
const DIST_DIR = path.join(__dirname, "../dist");

// --------------------
// Middlewares
// --------------------
app.use(cors());
app.use(bodyParser.json());

// --------------------
// Cache
// --------------------
const diagnosisCache = new NodeCache({ stdTTL: 43200 });

// --------------------
// Rate Limit
// --------------------
const diagnosisLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const naverPlaceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
});

// --------------------
// Utils
// --------------------
const parseIgNumber = (str) => {
  if (!str) return 0;
  let clean = String(str).replace(/,/g, "").replace(/\s/g, "").toLowerCase();
  let multiplier = 1;
  if (clean.includes("k")) multiplier = 1000;
  if (clean.includes("m")) multiplier = 1_000_000;
  if (clean.includes("b")) multiplier = 1_000_000_000;
  clean = clean.replace(/[kmb]/g, "");
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : Math.floor(num * multiplier);
};

const extractKeywords = (text) => {
  if (!text) return { main: [], sub: [] };
  const tokens = String(text).replace(/[^\w\s가-힣]/g, " ").split(/\s+/);
  const stopWords = [
    "있는",
    "없는",
    "하는",
    "및",
    "등",
    "를",
    "을",
    "가",
    "이",
    "은",
    "는",
    "에",
    "의",
    "도",
    "다",
  ];
  const freq = {};
  tokens.forEach((t) => {
    if (t.length > 1 && !stopWords.includes(t)) {
      freq[t] = (freq[t] || 0) + 1;
    }
  });
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
  return {
    main: sorted.slice(0, 5).map((x) => x[0]),
    sub: sorted.slice(5, 12).map((x) => x[0]),
  };
};

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT_${ms}`)), ms)
    ),
  ]);

const normalizeUrl = (input) => {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `https://${raw}`;
};

const extractPlaceIdFromUrl = (urlLike = "") => {
  const s = String(urlLike || "");

  // map.naver.com/.../place/123
  let m = s.match(/\/place\/(\d+)/);
  if (m && m[1]) return m[1];

  // m.place.naver.com/{type}/123..., place.naver.com/{type}/123...
  m = s.match(
    /\/(restaurant|hospital|pharmacy|clinic|beauty|accommodation|place|hairshop|cafe)\/(\d+)/i
  );
  if (m && m[2]) return m[2];

  // query param
  m = s.match(/[?&]placeId=(\d+)/i);
  if (m && m[1]) return m[1];

  return null;
};

const extractTypeFromUrl = (urlLike = "") => {
  const s = String(urlLike || "");
  const m = s.match(/m\.place\.naver\.com\/([^\/]+)\/(\d+)/i);
  if (m && m[1]) return m[1].toLowerCase();
  return null;
};

const resolveNaverPlaceUrl = async (inputUrl) => {
  const normalized = normalizeUrl(inputUrl);

  const directId = extractPlaceIdFromUrl(normalized);
  const directType = extractTypeFromUrl(normalized);

  if (directId) {
    return {
      inputUrl,
      finalUrl: normalized,
      placeId: directId,
      typeHint: directType,
      canonicalUrl: `https://map.naver.com/p/entry/place/${directId}`,
    };
  }

  try {
    const res = await axios.get(normalized, {
      maxRedirects: 10,
      validateStatus: (s) => s < 400,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      timeout: 12000,
    });

    const finalUrl = res?.request?.res?.responseUrl || normalized;

    let placeId = extractPlaceIdFromUrl(finalUrl);
    let typeHint = extractTypeFromUrl(finalUrl);

    if (!placeId && typeof res.data === "string") {
      const html = res.data;
      const mm =
        html.match(/"placeId"\s*:\s*"(\d+)"/) ||
        html.match(/"placeId"\s*:\s*(\d+)/) ||
        html.match(/m\.place\.naver\.com\/([^\/]+)\/(\d+)/i) ||
        html.match(/\/place\/(\d+)/);
      if (mm) {
        if (!placeId && mm[2]) placeId = mm[2];
        if (!placeId && mm[1] && /^\d+$/.test(mm[1])) placeId = mm[1];
        if (!typeHint && mm[1] && !/^\d+$/.test(mm[1]))
          typeHint = String(mm[1]).toLowerCase();
      }
    }

    const canonicalUrl = placeId
      ? `https://map.naver.com/p/entry/place/${placeId}`
      : finalUrl;

    return {
      inputUrl,
      finalUrl,
      placeId: placeId || null,
      typeHint: typeHint || null,
      canonicalUrl,
    };
  } catch {
    return {
      inputUrl,
      finalUrl: normalized,
      placeId: null,
      typeHint: null,
      canonicalUrl: normalized,
    };
  }
};

const buildMobileScrapeCandidates = (placeId, typeHint) => {
  const id = String(placeId || "").trim();
  if (!id) return [];
  const candidates = [];
  if (typeHint) candidates.push(`https://m.place.naver.com/${typeHint}/${id}`);
  candidates.push(`https://m.place.naver.com/place/${id}`);
  candidates.push(`https://m.place.naver.com/restaurant/${id}`);
  return [...new Set(candidates)];
};

const scrapeNaverPlace = async (url) => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
      ],
    });

    const context = await browser.newContext({
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      userAgent:
        "Mozilla/5.0 (Linux; Android 12; SM-G991N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      viewport: { width: 412, height: 915 },
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (["image", "font", "media"].includes(t)) return route.abort();
      route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);

    await page.waitForFunction(
      () => {
        const t = document.body?.innerText || "";
        return t.length > 500;
      },
      { timeout: 20000 }
    );

    const dom = await page.evaluate(() => {
      const bodyText = document.body?.innerText || "";
      const title =
        document.querySelector("h1")?.innerText ||
        document.querySelector("[role='heading']")?.innerText ||
        document.querySelector("title")?.innerText ||
        "Unknown";
      return { bodyText: bodyText.slice(0, 60000), placeName: title };
    });

    const receiptMatch =
      dom.bodyText.match(/방문\s*자?\s*리뷰\s*([0-9.,kmKM]+)/) ||
      dom.bodyText.match(/방문\s*자리뷰\s*([0-9.,kmKM]+)/);

    const blogMatch =
      dom.bodyText.match(/블로그\s*리뷰\s*([0-9.,kmKM]+)/) ||
      dom.bodyText.match(/블로그리뷰\s*([0-9.,kmKM]+)/);

    return {
      placeName: dom.placeName,
      directionsText: "",
      storeInfoText: dom.bodyText.slice(0, 9000),
      photoCount:
        dom.bodyText.includes("사진") || dom.bodyText.includes("이미지") ? 10 : 0,
      blogReviewCount: blogMatch ? parseIgNumber(blogMatch[1]) : 0,
      receiptReviewCount: receiptMatch ? parseIgNumber(receiptMatch[1]) : 0,
      menuCount: 0,
      menuWithDescriptionCount: 0,
      fullText: dom.bodyText.slice(0, 15000),
    };
  } catch (e) {
    const detail = e?.stack || e?.message || String(e);
    throw new Error(`SCRAPE_FAILED: ${detail}`);
  } finally {
    if (browser) await browser.close();
  }
};

const calculateNaverScore = (data) => {
  let score = 0;
  const keywords = extractKeywords(data.fullText);

  if ((data.storeInfoText || "").length > 300) score += 25;
  if ((data.receiptReviewCount || 0) > 50) score += 15;
  if ((data.blogReviewCount || 0) > 10) score += 15;
  if ((data.photoCount || 0) > 5) score += 10;
  if ((keywords.main || []).length >= 3) score += 10;

  let grade = "D";
  if (score >= 90) grade = "S";
  else if (score >= 70) grade = "A";
  else if (score >= 50) grade = "B";
  else if (score >= 30) grade = "C";

  return { score, grade, keywords, breakdown: [], recommendations: [] };
};

/* ============================================================
   ✅ IMPORTANT: Static files / runtime-config BEFORE SPA fallback
   ============================================================ */

// runtime-config.js는 반드시 SPA fallback보다 먼저!
app.get("/runtime-config.js", (req, res) => {
  res.type("application/javascript");
  res.setHeader("Cache-Control", "no-store");
  res.send(
    `window.__RUNTIME_CONFIG__ = { API_BASE_URL: "${process.env.API_URL || ""}" };`
  );
});

// 정적파일은 최대한 먼저 서빙 (assets가 HTML로 떨어지는 걸 방지)
app.use(
  express.static(DIST_DIR, {
    index: false, // index.html은 SPA fallback에서 처리
    maxAge: "1h",
    setHeaders: (res, filePath) => {
      // js 모듈은 제대로된 mime으로 보내기 (기본도 되지만 안전)
      if (filePath.endsWith(".js")) res.type("application/javascript");
      if (filePath.endsWith(".mjs")) res.type("application/javascript");
      if (filePath.endsWith(".css")) res.type("text/css");
    },
  })
);

/* =====================
   APIs
===================== */

// Instagram
app.get("/api/diagnosis/instagram", diagnosisLimiter, async (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ success: false });

  const cacheKey = `ig_${username}`;
  const cached = diagnosisCache.get(cacheKey);
  if (cached) return res.json({ success: true, source: "cache", data: cached });

  try {
    const html = (await axios.get(`https://www.instagram.com/${username}/`)).data;
    const $ = cheerio.load(html);
    const meta = $('meta[property="og:description"]').attr("content");
    const match = meta?.match(
      /([0-9.,km]+)\s*Followers?,\s*([0-9.,km]+)\s*Following,\s*([0-9.,km]+)\s*Posts?/i
    );
    if (!match) throw new Error("PARSE_FAILED");

    const data = {
      followers: parseIgNumber(match[1]),
      following: parseIgNumber(match[2]),
      posts: parseIgNumber(match[3]),
    };

    diagnosisCache.set(cacheKey, data);
    res.json({ success: true, source: "live", data });
  } catch {
    res.status(503).json({ success: false });
  }
});

// Naver Place
app.post("/api/diagnosis/naver-place", naverPlaceLimiter, async (req, res) => {
  const { url } = req.body;
  const input = normalizeUrl(url);

  if (
    !input ||
    (!input.includes("naver.me") &&
      !input.includes("naver.com") &&
      !input.includes("naver.net"))
  ) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_URL",
      message: "올바른 네이버 플레이스 링크를 입력해주세요.",
    });
  }

  let resolved = null;

  try {
    resolved = await resolveNaverPlaceUrl(input);
    console.log("[DEBUG] resolved =", resolved);

    if (!resolved.placeId) {
      return res.status(422).json({
        ok: false,
        error: "PLACE_ID_NOT_FOUND",
        message:
          "플레이스 ID를 추출하지 못했습니다. 링크 형식이 예상과 다를 수 있습니다.",
        debug: { resolved },
      });
    }

    const cacheKey = `np_id_${resolved.placeId}`;
    const cached = diagnosisCache.get(cacheKey);
    if (cached) return res.json(cached);

    const candidates = buildMobileScrapeCandidates(
      resolved.placeId,
      resolved.typeHint
    );

    let lastErr = null;
    let scraped = null;
    let usedUrl = null;

    for (const cand of candidates) {
      try {
        usedUrl = cand;
        scraped = await withTimeout(scrapeNaverPlace(cand), 55000);
        break;
      } catch (e) {
        lastErr = e;
      }
    }

    if (!scraped) throw lastErr || new Error("SCRAPE_FAILED: all candidates failed");

    const analysis = calculateNaverScore(scraped);

    const response = {
      ok: true,
      inputUrl: input,
      finalUrl: resolved.finalUrl,
      canonicalUrl: resolved.canonicalUrl,
      placeId: resolved.placeId,
      typeHint: resolved.typeHint,
      scrapeUrl: usedUrl,
      scrapeCandidates: candidates,
      placeName: scraped.placeName,
      metrics: scraped,
      score: analysis.score,
      grade: analysis.grade,
      keywords: analysis.keywords,
    };

    diagnosisCache.set(cacheKey, response);
    return res.json(response);
  } catch (e) {
    const detail =
      e?.stack ||
      e?.message ||
      (typeof e === "string" ? e : JSON.stringify(e, null, 2));

    console.log("[ERROR] naver-place failed");
    console.log(detail);

    if (String(detail).includes("TIMEOUT_") || String(detail).includes("TIMEOUT")) {
      return res.status(504).json({
        ok: false,
        error: "TIMEOUT",
        message: "네이버 페이지 응답이 지연되어 분석이 중단되었습니다.",
        debug: { message: detail, resolved },
      });
    }

    return res.status(500).json({
      ok: false,
      error: "SCRAPE_FAILED",
      message: "페이지 정보를 수집하는데 실패했습니다.",
      debug: { message: detail, resolved },
    });
  }
});

// Health & Version
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/version", (req, res) =>
  res.json({ ok: true, version: "LOCAL-FINAL-TYPE-AWARE-V4" })
);

/* =====================
   SPA fallback (LAST)
===================== */

// ✅ 정적/런타임/API 어떤 것도 매칭 안 될 때만 index.html
app.get("*", (req, res) => {
  return res.sendFile(path.join(DIST_DIR, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});
