/**
 * instakoo Backend Server
 * Monolith Deployment for Cloud Run (Express serving React Static Files)
 */

import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import NodeCache from 'node-cache';
import rateLimit from 'express-rate-limit';
import axios from 'axios';
import * as cheerio from 'cheerio';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright'; // Playwright ESM Import
import dotenv from 'dotenv';

dotenv.config();

// ESM __dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8080;

// --- Middlewares ---
app.use(cors()); // Allow CORS for dev (in prod, same-origin handles it)
app.use(bodyParser.json());

// --- Caching Strategy ---
const diagnosisCache = new NodeCache({ stdTTL: 43200 });

// --- Rate Limiting ---
const diagnosisLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 30,
  message: { error: "RATE_LIMITED", message: "요청 횟수가 너무 많습니다. 15분 후 다시 시도해주세요." },
  standardHeaders: true,
  legacyHeaders: false,
});

const naverPlaceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 10, 
  message: { error: "RATE_LIMITED", message: "분석 요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }
});

// --- Helper: Parse Instagram Numbers ---
const parseIgNumber = (str) => {
  if (!str) return 0;
  let clean = str.replace(/,/g, '').replace(/\s/g, '').toLowerCase();
  let multiplier = 1;
  if (clean.includes('k')) { multiplier = 1000; clean = clean.replace('k', ''); }
  else if (clean.includes('m')) { multiplier = 1000000; clean = clean.replace('m', ''); }
  else if (clean.includes('b')) { multiplier = 1000000000; clean = clean.replace('b', ''); }
  const num = parseFloat(clean);
  return isNaN(num) ? 0 : Math.floor(num * multiplier);
};

// --- Helper: Naver Place Logic ---
const extractKeywords = (text) => {
  if (!text) return { main: [], sub: [] };
  
  const tokens = text.replace(/[^\w\s가-힣]/g, ' ').split(/\s+/);
  const stopWords = ['있는', '없는', '하는', '및', '등', '를', '을', '가', '이', '은', '는', '에', '의', '도', '다', '습니다', '합니다', '안녕하세요', '입니다'];
  
  const freqMap = {};
  tokens.forEach(t => {
    if (t.length > 1 && !stopWords.includes(t)) {
      freqMap[t] = (freqMap[t] || 0) + 1;
    }
  });

  const sorted = Object.entries(freqMap).sort((a, b) => b[1] - a[1]);
  
  return {
    main: sorted.slice(0, 5).map(x => x[0]),
    sub: sorted.slice(5, 12).map(x => x[0])
  };
};

const resolveNaverUrl = async (shortUrl) => {
    try {
        const response = await axios.get(shortUrl, { 
            maxRedirects: 5,
            validateStatus: (status) => status < 400 
        });
        return response.request.res.responseUrl || shortUrl;
    } catch (e) {
        return shortUrl; 
    }
};

// 3. Playwright Scraper (Cloud Run Optimized)
const scrapeNaverPlace = async (url) => {
    let browser = null;
    try {
        // Cloud Run Safe Arguments
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage', // Memory optimization
                '--disable-gpu'
            ]
        });
        const page = await browser.newPage();
        
        await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2}', route => route.abort());

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

        try {
            await page.waitForSelector('#_title', { timeout: 5000 });
        } catch(e) {}

        const placeName = await page.locator('#_title span.Fc1rA').first().innerText().catch(() => 'Unknown');

        let storeInfoText = "";
        try {
             const descLocator = page.locator('.zPfVt');
             if (await descLocator.count() > 0) {
                 storeInfoText = await descLocator.first().innerText();
             }
        } catch(e) {}

        let directionsText = "";
        try {
            const directionLocator = page.locator('.O8qbU.tQY7D');
            if (await directionLocator.count() > 0) {
                directionsText = await directionLocator.first().innerText();
            }
        } catch(e) {}

        let receiptReviewCount = 0;
        let blogReviewCount = 0;
        
        try {
            const reviewText = await page.locator('.PXMot').allInnerTexts();
            for (const txt of reviewText) {
                if (txt.includes('방문자리뷰')) {
                    receiptReviewCount = parseIgNumber(txt.replace('방문자리뷰', ''));
                } else if (txt.includes('블로그리뷰')) {
                    blogReviewCount = parseIgNumber(txt.replace('블로그리뷰', ''));
                }
            }
        } catch(e) {}

        let menuCount = 0;
        let menuWithDescriptionCount = 0;
        try {
            const menuItems = page.locator('.E2jtL');
            menuCount = await menuItems.count();
            
            for (let i = 0; i < menuCount; i++) {
                const item = menuItems.nth(i);
                const desc = await item.locator('.kPogF').innerText().catch(() => '');
                if (desc && desc.length > 5) menuWithDescriptionCount++;
            }
        } catch(e) {}

        let photoCount = 0;
        try {
            if (await page.getByText('사진').count() > 0) {
                photoCount = 10; 
            }
        } catch(e) {}
        
        const fullText = (placeName + " " + storeInfoText + " " + directionsText).substring(0, 5000);

        return {
            placeName,
            directionsText,
            storeInfoText,
            photoCount,
            blogReviewCount,
            receiptReviewCount,
            menuCount,
            menuWithDescriptionCount,
            fullText
        };

    } catch (e) {
        console.error("Playwright Error:", e);
        throw new Error("SCRAPE_FAILED");
    } finally {
        if (browser) await browser.close();
    }
};

const calculateNaverScore = (data) => {
    let score = 0;
    const breakdown = [];
    const recommendations = [];

    const dirLen = data.directionsText.length;
    const dirScore = Math.min(15, Math.floor((dirLen / 50) * 15));
    score += dirScore;
    breakdown.push({
        name: "찾아오는길 상세안내",
        score: dirScore,
        max: 15,
        notes: dirLen < 20 ? "찾아오는 길이 너무 짧거나 없습니다. 상세하게 작성하세요." : "상세하게 잘 작성되었습니다."
    });

    const infoLen = data.storeInfoText.length;
    const infoScore = Math.min(25, Math.floor((infoLen / 300) * 25));
    score += infoScore;
    breakdown.push({
        name: "업체 소개글(정보)",
        score: infoScore,
        max: 25,
        notes: infoLen < 50 ? "소개글이 부족합니다. 키워드를 포함해 500자 이상 작성 추천." : "소개글 분량이 충분합니다."
    });

    const receiptScore = Math.min(15, Math.floor((data.receiptReviewCount / 100) * 15));
    const blogScore = Math.min(15, Math.floor((data.blogReviewCount / 30) * 15));
    score += receiptScore + blogScore;
    breakdown.push({
        name: "리뷰 활성화 (영수증/블로그)",
        score: receiptScore + blogScore,
        max: 30,
        notes: `방문자 리뷰 ${data.receiptReviewCount}개, 블로그 리뷰 ${data.blogReviewCount}개`
    });
    if (data.receiptReviewCount < 50) recommendations.push("영수증 리뷰 이벤트를 통해 방문자 리뷰를 확보하세요.");
    if (data.blogReviewCount < 10) recommendations.push("블로그 체험단을 통해 상세 후기를 늘려야 합니다.");

    let menuScore = 0;
    if (data.menuCount > 0) menuScore += 10;
    if (data.menuCount > 0 && (data.menuWithDescriptionCount / data.menuCount) > 0.5) menuScore += 10;
    score += menuScore;
    breakdown.push({
        name: "메뉴 등록 및 설명",
        score: menuScore,
        max: 20,
        notes: data.menuCount === 0 ? "메뉴가 등록되지 않았습니다." : `${data.menuCount}개 메뉴 중 ${data.menuWithDescriptionCount}개 설명 보유`
    });
    if (data.menuCount > 0 && data.menuWithDescriptionCount === 0) recommendations.push("메뉴마다 상세 설명을 추가하여 검색 노출 확률을 높이세요.");

    let extraScore = 0;
    if (data.photoCount > 5) extraScore += 5;
    const keywords = extractKeywords(data.fullText);
    if (keywords.main.length >= 3) extraScore += 5;
    score += extraScore;
    breakdown.push({
        name: "사진 및 키워드",
        score: extraScore,
        max: 10,
        notes: "대표 키워드 및 매장 사진 등록 상태"
    });

    let grade = 'D';
    if (score >= 90) grade = 'S';
    else if (score >= 70) grade = 'A';
    else if (score >= 50) grade = 'B';
    else if (score >= 30) grade = 'C';

    if (score < 40) recommendations.push("전반적인 플레이스 정보(소개글, 메뉴, 사진) 보강이 시급합니다.");

    return { score, grade, breakdown, recommendations, keywords };
};

const calculateScore = (followers, posts, following) => {
  let score = 0;
  let tips = [];

  if (followers > 0) {
    const fScore = Math.min(40, Math.log10(followers) * 10); 
    score += fScore;
  }

  if (posts > 0) {
    const pScore = Math.min(40, Math.log10(posts) * 15);
    score += pScore;
  }

  if (followers > following) score += 10;
  if (posts > 10) score += 10;

  score = Math.min(100, Math.floor(score));

  let grade = 'D';
  if (score >= 90) grade = 'S';
  else if (score >= 75) grade = 'A';
  else if (score >= 50) grade = 'B';
  else if (score >= 25) grade = 'C';

  if (posts === 0) tips.push("게시물이 하나도 없습니다. 콘텐츠 업로드가 시급합니다.");
  else if (posts < 10) tips.push("게시물 수가 부족하여 계정 지수가 낮습니다. 꾸준한 업로드가 필요합니다.");
  if (followers < 100) tips.push("초기 계정입니다. '한국인 팔로워' 서비스로 기초 인지도를 확보하세요.");
  if (following > followers) tips.push("팔로잉(구독) 숫자가 너무 많습니다. 언팔로우 관리가 필요합니다.");
  if (grade === 'S' || grade === 'A') tips.push("계정 최적화 상태가 훌륭합니다. 인기게시물 노출을 노려보세요.");
  if (tips.length === 0) tips.push("꾸준한 활동을 통해 계정 최적화 지수를 유지하세요.");

  return { score, grade, tips: tips.slice(0, 3) };
};

// --- Playwright Health Check Endpoint ---
app.get('/api/pw-health', async (req, res) => {
    let browser;
    try {
        console.log("Launching Playwright...");
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
        });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        await page.goto('https://example.com');
        const title = await page.title();
        
        console.log("Playwright Success:", title);
        res.json({ ok: true, title });
    } catch (e) {
        console.error("Playwright Check Failed:", e);
        res.status(500).json({ ok: false, error: e.message });
    } finally {
        if (browser) await browser.close();
    }
});

// 1. Instagram Diagnosis Endpoint
app.get('/api/diagnosis/instagram', diagnosisLimiter, async (req, res) => {
  const { username } = req.query;

  if (!username) {
    return res.status(400).json({ success: false, message: '사용자 ID를 입력해주세요.' });
  }

  const cleanUsername = username.trim().toLowerCase();
  const cacheKey = `ig_${cleanUsername}`;
  const cachedData = diagnosisCache.get(cacheKey);

  if (cachedData) {
    return res.json({ success: true, source: 'cache', data: cachedData });
  }

  try {
    const url = `https://www.instagram.com/${cleanUsername}/`;
    
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 8000
    });

    const html = response.data;
    const $ = cheerio.load(html);

    const metaDescription = $('meta[property="og:description"]').attr('content');

    if (!metaDescription) {
        const pageTitle = $('title').text();
        if (pageTitle.includes('Page Not Found') || pageTitle.includes('페이지를 찾을 수 없습니다')) {
            return res.status(404).json({ success: false, message: '계정을 찾을 수 없습니다. 아이디를 확인해주세요.' });
        }
        throw new Error("PUBLIC_DATA_UNACCESSIBLE");
    }

    const regex = /([0-9.,km]+)\s*Followers?,\s*([0-9.,km]+)\s*Following,\s*([0-9.,km]+)\s*Posts?/i;
    const match = metaDescription.match(regex);

    if (!match) {
      throw new Error("DATA_PARSE_FAILED"); 
    }

    const followersRaw = match[1];
    const followingRaw = match[2];
    const postsRaw = match[3];

    const followers = parseIgNumber(followersRaw);
    const following = parseIgNumber(followingRaw);
    const posts = parseIgNumber(postsRaw);

    const { score, grade, tips } = calculateScore(followers, posts, following);

    const result = {
      username: cleanUsername,
      followers,
      following,
      posts,
      score,
      grade,
      tips,
      status: posts > 0 ? 'Active' : 'Inactive',
      analyzedAt: new Date().toISOString()
    };

    diagnosisCache.set(cacheKey, result);

    res.json({ success: true, source: 'live', data: result });

  } catch (error) {
    console.error(`[Diagnosis Error] ${cleanUsername}:`, error.message);
    
    if (error.response && error.response.status === 404) {
      return res.status(404).json({ success: false, message: '존재하지 않는 계정입니다.' });
    }

    if (error.message === "PUBLIC_DATA_UNACCESSIBLE") {
        return res.status(422).json({ 
            success: false, 
            message: '공개 프로필 데이터를 읽을 수 없습니다. 비공개 계정이거나 인스타그램 보안 정책으로 인해 접근이 제한되었습니다.' 
        });
    }

    if (error.message === "DATA_PARSE_FAILED") {
         return res.status(422).json({ 
            success: false, 
            message: '프로필 데이터 형식을 해석할 수 없습니다. (프로필 레이아웃 변경 가능성)' 
        });
    }
    
    res.status(503).json({ 
      success: false, 
      message: '일시적인 서버 연결 오류입니다. 잠시 후 다시 시도해주세요.' 
    });
  }
});

// 2. Naver Place Diagnosis Endpoint
app.post('/api/diagnosis/naver-place', naverPlaceLimiter, async (req, res) => {
    const { url } = req.body;

    if (!url || (!url.includes('naver.me') && !url.includes('naver.com'))) {
        return res.status(400).json({ error: "INVALID_URL", message: "올바른 네이버 플레이스 링크(naver.me 또는 map.naver.com)를 입력해주세요." });
    }

    try {
        const resolvedUrl = url.includes('naver.me') ? await resolveNaverUrl(url) : url;

        const cacheKey = `np_${Buffer.from(resolvedUrl).toString('base64')}`;
        const cachedData = diagnosisCache.get(cacheKey);
        if (cachedData) {
            return res.json(cachedData);
        }

        const scrapedData = await scrapeNaverPlace(resolvedUrl);

        const analysis = calculateNaverScore(scrapedData);

        const responseData = {
            inputUrl: url,
            resolvedUrl,
            placeName: scrapedData.placeName,
            metrics: {
                directionsTextLength: scrapedData.directionsText.length,
                storeInfoTextLength: scrapedData.storeInfoText.length,
                photoCount: scrapedData.photoCount,
                blogReviewCount: scrapedData.blogReviewCount,
                receiptReviewCount: scrapedData.receiptReviewCount,
                menuCount: scrapedData.menuCount,
                menuWithDescriptionCount: scrapedData.menuWithDescriptionCount,
                extractedTextSample: scrapedData.fullText.substring(0, 100) + "..."
            },
            keywords: analysis.keywords,
            score: analysis.score,
            grade: analysis.grade,
            scoreBreakdown: analysis.breakdown,
            recommendations: analysis.recommendations
        };

        diagnosisCache.set(cacheKey, responseData);

        res.json(responseData);

    } catch (e) {
        console.error("Naver Diagnosis Error:", e);
        if (e.message === "SCRAPE_FAILED") {
            return res.status(500).json({ error: "SCRAPE_FAILED", message: "페이지 정보를 수집하는데 실패했습니다. 잠시 후 다시 시도해주세요." });
        }
        res.status(500).json({ error: "UNKNOWN", message: "서버 내부 오류가 발생했습니다." });
    }
});

// --- Runtime Config Injection ---
app.get('/runtime-config.js', (req, res) => {
  res.type('application/javascript');
  // ✅ 통일: API_URL 대신 VITE_API_URL만 쓰지 말고, 프론트에서 쓰는 키로 고정
  const apiUrl = process.env.API_URL || ''; 
  res.setHeader('Cache-Control', 'no-store');
  res.send(`window.__RUNTIME_CONFIG__ = { API_BASE_URL: "${apiUrl}" };`);
});

// ✅ Health check 추가 (반드시 static/fallback 보다 위)
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// --- Order Routes (Mock) ---
const orders = [];
app.post('/api/orders', (req, res) => {
  const { platform, serviceId, url, quantity, totalPrice } = req.body;
  const newOrder = {
    id: `ORD-${Date.now()}`,
    platform,
    serviceId,
    url,
    quantity,
    totalPrice,
    status: 'PENDING',
    createdAt: new Date()
  };
  orders.push(newOrder);
  res.json({ success: true, data: newOrder });
});

// --- Serve Static Frontend Files ---
// ✅ API 라우트 다 등록한 다음에 static!
app.use(express.static(path.join(__dirname, '../dist')));

// --- SPA Fallback ---
// ✅ 맨 마지막
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'NOT_FOUND' });
  }
  res.sendFile(path.join(__dirname, '../dist', 'index.html'));
});
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

