import React, { useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "../config";

interface DiagnosisPageProps {
  onBack: () => void;
}

type DiagnosisPlatform = "INSTAGRAM" | "NAVER_PLACE" | "NAVER_SHOPPING";
type AnalysisStep = "SELECT" | "INPUT" | "ANALYZING" | "RESULT" | "ERROR";

/* =====================
   Result Interfaces
===================== */

interface InstagramResponse {
  username: string;
  followers: number;
  following: number;
  posts: number;
  score: number;
  grade: string;
  tips: string[];
  status: string;
}

interface NaverPlaceResponse {
  placeName: string;
  metrics: {
    directionsTextLength: number;
    storeInfoTextLength: number;
    photoCount: number;
    blogReviewCount: number;
    receiptReviewCount: number;
    menuCount: number;
    menuWithDescriptionCount: number;
  };
  keywords: {
    main: string[];
    sub: string[];
  };
  score: number;
  grade: string;
  scoreBreakdown: {
    name: string;
    score: number;
    max: number;
    notes: string;
  }[];
  recommendations: string[];
}

/* =====================
   Utils
===================== */

const toNumber = (v: any, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const toString = (v: any, fallback = "") =>
  typeof v === "string" ? v : fallback;

const toStringArray = (v: any): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];

const joinUrl = (base: string, path: string) => {
  const b = (base || "").trim();
  const p = (path || "").trim();
  if (!b) return p.startsWith("/") ? p : `/${p}`;
  return `${b.replace(/\/+$/, "")}/${p.replace(/^\/+/, "")}`;
};

async function safeReadJson(res: Response) {
  const ct = res.headers.get("content-type") || "";
  // JSON으로 보일 때만 json() 시도
  if (ct.includes("application/json") || ct.includes("application/problem+json")) {
    try {
      return await res.json();
    } catch {
      // JSON 파싱 실패 시 text fallback
      const t = await res.text().catch(() => "");
      return { ok: false, message: "Invalid JSON response", rawText: t };
    }
  }

  // HTML/text가 오면 json() 하지 말고 text로 받기
  const text = await res.text().catch(() => "");
  return {
    ok: false,
    message:
      "Server returned non-JSON response (maybe HTML). Check server SPA fallback / API route order.",
    rawText: text,
  };
}

const normalizeInstagram = (payload: any): InstagramResponse => {
  const p = payload ?? {};
  return {
    username: toString(p.username, "unknown"),
    followers: toNumber(p.followers, 0),
    following: toNumber(p.following, 0),
    posts: toNumber(p.posts, 0),
    score: toNumber(p.score, 0),
    grade: toString(p.grade, "D"),
    tips: toStringArray(p.tips),
    status: toString(p.status, ""),
  };
};

const normalizeNaverPlace = (payload: any): NaverPlaceResponse => {
  const d = payload ?? {};
  const metrics = d.metrics ?? {};
  const keywords = d.keywords ?? {};

  return {
    placeName: toString(d.placeName, "Unknown"),
    metrics: {
      directionsTextLength: toNumber(metrics.directionsTextLength, 0),
      storeInfoTextLength: toNumber(metrics.storeInfoTextLength, 0),
      photoCount: toNumber(metrics.photoCount, 0),
      blogReviewCount: toNumber(metrics.blogReviewCount, 0),
      receiptReviewCount: toNumber(metrics.receiptReviewCount, 0),
      menuCount: toNumber(metrics.menuCount, 0),
      menuWithDescriptionCount: toNumber(metrics.menuWithDescriptionCount, 0),
    },
    keywords: {
      main: toStringArray(keywords.main),
      sub: toStringArray(keywords.sub),
    },
    score: toNumber(d.score, 0),
    grade: toString(d.grade, "D"),
    scoreBreakdown: Array.isArray(d.scoreBreakdown)
      ? d.scoreBreakdown
          .filter((x: any) => x && typeof x === "object")
          .map((x: any) => ({
            name: toString(x.name, ""),
            score: toNumber(x.score, 0),
            max: toNumber(x.max, 0),
            notes: toString(x.notes, ""),
          }))
      : [],
    recommendations: toStringArray(d.recommendations),
  };
};

/* =====================
   Component
===================== */

const DiagnosisPage: React.FC<DiagnosisPageProps> = ({ onBack }) => {
  const [step, setStep] = useState<AnalysisStep>("SELECT");
  const [platform, setPlatform] = useState<DiagnosisPlatform>("INSTAGRAM");
  const [inputId, setInputId] = useState("");

  const [loadingText, setLoadingText] = useState("서버 연결 중...");
  const [progress, setProgress] = useState(0);

  const [igResult, setIgResult] = useState<InstagramResponse | null>(null);
  const [npResult, setNpResult] = useState<NaverPlaceResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const textIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 컴포넌트 언마운트 시 interval 정리
  useEffect(() => {
    return () => {
      if (textIntervalRef.current) clearInterval(textIntervalRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  /* =====================
     Loading Messages
  ===================== */

  const getLoadingMessages = (p: DiagnosisPlatform) =>
    p === "INSTAGRAM"
      ? [
          "분석 서버와 보안 세션 수립 중...",
          "AI 모델 초기화...",
          "계정 데이터 분석 중...",
          "성장 가능성 계산 중...",
          "최종 리포트 생성 중...",
        ]
      : [
          "분석 서버 연결 중...",
          "플레이스 데이터 수집 중...",
          "리뷰·SEO 분석 중...",
          "경쟁력 지수 산출 중...",
          "최종 리포트 생성 중...",
        ];

  /* =====================
     Platform Select
  ===================== */

  const handleSelectPlatform = (p: DiagnosisPlatform) => {
    if (p === "NAVER_SHOPPING") {
      alert("네이버 쇼핑 진단은 준비중입니다.");
      return;
    }
    setPlatform(p);
    setStep("INPUT");
    setInputId("");
    setIgResult(null);
    setNpResult(null);
    setErrorMessage("");
  };

  /* =====================
     Start Analysis
  ===================== */

  const handleStartAnalysis = async () => {
    const trimmed = inputId.trim();
    if (!trimmed) {
      alert(
        platform === "INSTAGRAM"
          ? "인스타그램 아이디를 입력해주세요."
          : "네이버 플레이스 링크를 입력해주세요."
      );
      return;
    }

    setStep("ANALYZING");
    setProgress(0);
    setErrorMessage("");

    // 이전 결과 초기화(플랫폼별)
    if (platform === "INSTAGRAM") setIgResult(null);
    if (platform === "NAVER_PLACE") setNpResult(null);

    const messages = getLoadingMessages(platform);
    let msgIndex = 0;
    setLoadingText(messages[0]);

    if (textIntervalRef.current) clearInterval(textIntervalRef.current);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);

    textIntervalRef.current = setInterval(() => {
      msgIndex = (msgIndex + 1) % messages.length;
      setLoadingText(messages[msgIndex]);
    }, 1500);

    progressIntervalRef.current = setInterval(() => {
      setProgress((p) => (p < 90 ? p + 1 : p));
    }, 120);

    // API BASE 안전 처리 (빈 문자열이면 같은 오리진으로 요청됨)
    const apiBaseRaw = (() => {
      try {
        return (getApiBaseUrl?.() || "").trim();
      } catch {
        return "";
      }
    })();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        /* ===== INSTAGRAM ===== */
        if (platform === "INSTAGRAM") {
          const url = joinUrl(
            apiBaseRaw,
            `/api/diagnosis/instagram?username=${encodeURIComponent(trimmed)}`
          );

          const res = await fetch(url, { signal: controller.signal });
          const body = await safeReadJson(res);

          if (!res.ok) {
            const msg = body?.message || `HTTP ${res.status}`;
            throw new Error(msg);
          }

          // 백엔드가 { data: {...} } 형태일 수도, 바로 {...}일 수도 있으니 둘 다 수용
          const payload = body?.data ?? body;
          const safe = normalizeInstagram(payload);

          setIgResult(safe);
          setProgress(100);
          setStep("RESULT");
        }

        /* ===== NAVER PLACE ===== */
        if (platform === "NAVER_PLACE") {
          const url = joinUrl(apiBaseRaw, `/api/diagnosis/naver-place`);

          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: trimmed }),
            signal: controller.signal,
          });

          const body = await safeReadJson(res);

          if (!res.ok) {
            const msg = body?.message || `HTTP ${res.status}`;
            throw new Error(msg);
          }

          const safe = normalizeNaverPlace(body);
          setNpResult(safe);
          setProgress(100);
          setStep("RESULT");
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (e: any) {
      const msg =
        e?.name === "AbortError"
          ? "요청 시간이 초과되었습니다. (60초) 다시 시도해주세요."
          : e?.message || "분석 중 오류가 발생했습니다.";

      setErrorMessage(msg);
      setStep("ERROR");
    } finally {
      if (textIntervalRef.current) clearInterval(textIntervalRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    }
  };

  /* =====================
     RESULT RENDER (절대 안 터지게)
  ===================== */

  const renderResult = () => {
    if (platform === "INSTAGRAM") {
      if (!igResult) return <ResultFallback onRetry={() => setStep("INPUT")} />;

      const tips = igResult.tips ?? []; // 절대 undefined 금지
      return (
        <div className="text-center text-gray-800 font-bold">
          <div>
            @{igResult.username} / {igResult.score}점 ({igResult.grade})
          </div>

          {/* tips가 없더라도 안전 */}
          {tips.length > 0 && (
            <ul className="mt-3 text-left font-normal max-w-md mx-auto">
              {tips.map((t, idx) => (
                <li key={idx} className="text-gray-700">
                  • {t}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }

    if (platform === "NAVER_PLACE") {
      if (!npResult) return <ResultFallback onRetry={() => setStep("INPUT")} />;

      const mainKeywords = npResult.keywords?.main ?? [];
      const subKeywords = npResult.keywords?.sub ?? [];
      const recs = npResult.recommendations ?? [];
      const breakdown = npResult.scoreBreakdown ?? [];

      return (
        <div className="text-center text-gray-800 font-bold">
          <div>
            {npResult.placeName} / {npResult.score}점 ({npResult.grade})
          </div>

          {/* 안전 표시(없어도 안 터짐) */}
          {(mainKeywords.length > 0 || subKeywords.length > 0) && (
            <div className="mt-3 text-left font-normal max-w-md mx-auto">
              {mainKeywords.length > 0 && (
                <div className="mb-2">
                  <div className="font-semibold text-gray-800">메인 키워드</div>
                  <div className="text-gray-700">
                    {mainKeywords.join(", ")}
                  </div>
                </div>
              )}
              {subKeywords.length > 0 && (
                <div>
                  <div className="font-semibold text-gray-800">서브 키워드</div>
                  <div className="text-gray-700">{subKeywords.join(", ")}</div>
                </div>
              )}
            </div>
          )}

          {breakdown.length > 0 && (
            <div className="mt-4 text-left font-normal max-w-md mx-auto">
              <div className="font-semibold text-gray-800">점수 구성</div>
              <ul className="mt-2">
                {breakdown.map((b, idx) => (
                  <li key={idx} className="text-gray-700">
                    • {b.name}: {b.score}/{b.max}{" "}
                    {b.notes ? `(${b.notes})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {recs.length > 0 && (
            <div className="mt-4 text-left font-normal max-w-md mx-auto">
              <div className="font-semibold text-gray-800">추천 액션</div>
              <ul className="mt-2">
                {recs.map((r, idx) => (
                  <li key={idx} className="text-gray-700">
                    • {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      );
    }

    return <ResultFallback onRetry={() => setStep("SELECT")} />;
  };

  return (
    <div className="min-h-screen bg-primaryBg pt-24 pb-12 px-4">
      {/* Back button (원하면 사용) */}
      <div className="max-w-xl mx-auto mb-4">
        <button onClick={onBack} className="text-gray-700 font-bold">
          ← 뒤로
        </button>
      </div>

      {step === "SELECT" && (
        <div className="text-center max-w-xl mx-auto">
          <button onClick={() => handleSelectPlatform("INSTAGRAM")}>
            인스타그램
          </button>
          <button onClick={() => handleSelectPlatform("NAVER_PLACE")}>
            네이버 플레이스
          </button>
        </div>
      )}

      {step === "INPUT" && (
        <div className="text-center max-w-xl mx-auto">
          <input
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            placeholder={
              platform === "INSTAGRAM"
                ? "instagram_id"
                : "https://naver.me/xxxx"
            }
          />
          <button onClick={handleStartAnalysis}>진단 시작</button>
        </div>
      )}

      {step === "ANALYZING" && (
        <div className="text-center max-w-xl mx-auto">
          <p>{loadingText}</p>
          <p>{progress}%</p>
        </div>
      )}

      {step === "RESULT" && <div className="max-w-xl mx-auto">{renderResult()}</div>}

      {step === "ERROR" && (
        <div className="text-center text-red-500 max-w-xl mx-auto">
          <p className="whitespace-pre-wrap">{errorMessage}</p>
          <button onClick={() => setStep("INPUT")}>다시 시도</button>
        </div>
      )}
    </div>
  );
};

/* =====================
   Result Fallback
===================== */
const ResultFallback = ({ onRetry }: { onRetry: () => void }) => (
  <div className="text-center">
    <p className="font-bold text-gray-700">결과를 표시할 수 없습니다.</p>
    <button onClick={onRetry}>다시 시도</button>
  </div>
);

export default DiagnosisPage;
