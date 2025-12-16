import React, { useState, useEffect, useRef } from 'react';
import { getApiBaseUrl } from '../config';

interface DiagnosisPageProps {
  onBack: () => void;
}

type DiagnosisPlatform = 'INSTAGRAM' | 'NAVER_PLACE' | 'NAVER_SHOPPING';
type AnalysisStep = 'SELECT' | 'INPUT' | 'ANALYZING' | 'RESULT' | 'ERROR';

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

const DiagnosisPage: React.FC<DiagnosisPageProps> = ({ onBack }) => {
  const [step, setStep] = useState<AnalysisStep>('SELECT');
  const [platform, setPlatform] = useState<DiagnosisPlatform>('INSTAGRAM');
  const [inputId, setInputId] = useState('');

  const [loadingText, setLoadingText] = useState('서버 연결 중...');
  const [progress, setProgress] = useState(0);

  const [igResult, setIgResult] = useState<InstagramResponse | null>(null);
  const [npResult, setNpResult] = useState<NaverPlaceResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  // 텍스트 롤링을 위한 Ref
  const textIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* =====================
     Loading Messages
  ===================== */
  const getLoadingMessages = (p: DiagnosisPlatform) => {
    if (p === 'INSTAGRAM') {
      return [
        "분석 서버와 보안 세션 수립 중...",
        "AI 신경망 모델(Neural Network) 초기화...",
        "계정 메타데이터 및 비주얼 패턴 스캐닝...",
        "팔로워/팔로잉 네트워크 그래프 분석...",
        "게시물 인게이지먼트(Engagement) 정밀 측정...",
        "해시태그 도달률 알고리즘 시뮬레이션...",
        "계정 성장 잠재력 예측 모델링 구동...",
        "최종 진단 리포트 생성 중..."
      ];
    } else {
      return [
        "분석 서버와 보안 세션 수립 중...",
        "빅데이터 분석 엔진(Big Data Engine) 가동...",
        "플레이스 SEO 아키텍처 정밀 진단...",
        "리뷰 데이터 자연어 처리(NLP) 분석...",
        "사용자 트래픽 및 체류 시간 시뮬레이션...",
        "지도 검색 알고리즘 적합도 테스트...",
        "경쟁 업체 대비 경쟁력 지수 산출...",
        "최적화 솔루션 패키징 중..."
      ];
    }
  };

  /* =====================
     Platform Select
  ===================== */

  const handleSelectPlatform = (p: DiagnosisPlatform) => {
    if (p === 'NAVER_SHOPPING') {
      alert('네이버 쇼핑 진단은 준비중입니다.');
      return;
    }
    setPlatform(p);
    setStep('INPUT');
    setInputId('');
    setErrorMessage('');
    setIgResult(null);
    setNpResult(null);
  };

  /* =====================
     Start Analysis
  ===================== */

  const handleStartAnalysis = async () => {
    if (!inputId.trim()) {
      alert(
        platform === 'INSTAGRAM'
          ? '인스타그램 아이디를 입력해주세요.'
          : '네이버 플레이스 링크를 입력해주세요.'
      );
      return;
    }

    setStep('ANALYZING');
    setProgress(0);
    setErrorMessage('');

    const messages = getLoadingMessages(platform);
    let msgIndex = 0;
    setLoadingText(messages[0]);

    if (textIntervalRef.current) clearInterval(textIntervalRef.current);
    textIntervalRef.current = setInterval(() => {
      msgIndex = (msgIndex + 1) % messages.length;
      setLoadingText(messages[msgIndex]);
    }, 1500);

    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    progressIntervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev;

        let increment = 1;
        if (prev < 30) increment = 2;
        else if (prev < 60) increment = 0.5;
        else if (prev < 80) increment = 0.2;
        else increment = 0.05;

        return Math.min(prev + increment, 95);
      });
    }, 100);

    try {
      const API_BASE = getApiBaseUrl();
      console.log("Diagnosis API Base:", API_BASE);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      /* =====================
         INSTAGRAM
      ===================== */
      if (platform === 'INSTAGRAM') {
        const response = await fetch(
          `${API_BASE}/api/diagnosis/instagram?username=${encodeURIComponent(inputId.trim())}`,
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: controller.signal,
          }
        );
        clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const text = await response.text();
          console.error('API Response Error (Not JSON):', text.substring(0, 200));
          throw new Error('서버 연결 실패: 백엔드 서버 응답이 JSON이 아닙니다.');
        }

        const data = await response.json();

        if (response.ok && data.success) {
          setProgress(100);
          setIgResult(data.data);
          setTimeout(() => setStep('RESULT'), 500);
        } else {
          throw new Error(data.message || '인스타그램 진단 실패');
        }
      }

      /* =====================
         NAVER PLACE
      ===================== */
      if (platform === 'NAVER_PLACE') {
        const response = await fetch(`${API_BASE}/api/diagnosis/naver-place`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ url: inputId.trim() }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          const text = await response.text();
          console.error('API Response Error (Not JSON):', text.substring(0, 200));
          throw new Error('서버 연결 실패: 백엔드 서버 응답이 JSON이 아닙니다.');
        }

        const data = await response.json();

        if (response.ok) {
          // ✅ 핵심: 서버 응답 구조가 달라도 프론트가 절대 죽지 않게 안전 보정
          const safe: NaverPlaceResponse = {
            placeName: data.placeName ?? "Unknown",
            metrics: data.metrics ?? {
              directionsTextLength: 0,
              storeInfoTextLength: 0,
              photoCount: 0,
              blogReviewCount: 0,
              receiptReviewCount: 0,
              menuCount: 0,
              menuWithDescriptionCount: 0,
            },
            keywords: data.keywords ?? { main: [], sub: [] },
            score: typeof data.score === "number" ? data.score : 0,
            grade: data.grade ?? "D",
            scoreBreakdown: Array.isArray(data.scoreBreakdown) ? data.scoreBreakdown : [],
            recommendations: Array.isArray(data.recommendations) ? data.recommendations : [],
          };

          setProgress(100);
          setNpResult(safe);
          setTimeout(() => setStep('RESULT'), 500);
        } else {
          throw new Error(data.message || '네이버 플레이스 진단 실패');
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setErrorMessage('분석 시간이 초과되었습니다. (서버 응답 지연)\n잠시 후 다시 시도해주세요.');
      } else {
        console.error('Diagnosis Error:', err);
        let msg = err.message || '분석 중 오류가 발생했습니다.';
        if (msg.includes('Failed to fetch')) {
          msg = '서버에 연결할 수 없습니다. (백엔드 서버 실행/배포 확인 필요)';
        }
        setErrorMessage(msg);
      }
      setStep('ERROR');
    } finally {
      if (textIntervalRef.current) clearInterval(textIntervalRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (textIntervalRef.current) clearInterval(textIntervalRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, []);

  /* =====================
     UI Render Functions
  ===================== */

  const renderPlatformSelection = () => (
    <div className="max-w-2xl mx-auto animate-bounce-in">
      <div className="text-center mb-10">
        <h2 className="text-3xl font-extrabold text-gray-800 mb-3">무료 진단 서비스</h2>
        <p className="text-gray-500">
          인공지능 기반 분석 시스템으로<br />
          계정과 플레이스의 현재 상태를 정밀하게 진단합니다.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => handleSelectPlatform('INSTAGRAM')}
          className="bg-white p-8 rounded-[32px] shadow-sm hover:shadow-xl transition-all border-2 border-transparent hover:border-pink-500 group text-left relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-pink-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
          <div className="relative z-10">
            <div className="w-14 h-14 bg-pink-100 rounded-2xl flex items-center justify-center text-pink-500 text-2xl mb-6 group-hover:rotate-12 transition-transform">
              <i className="fa-brands fa-instagram"></i>
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">인스타그램 진단</h3>
            <p className="text-gray-500 text-sm leading-relaxed">
              계정 최적화 점수,<br />
              활성도 및 성장 가능성 분석
            </p>
          </div>
        </button>

        <button
          onClick={() => handleSelectPlatform('NAVER_PLACE')}
          className="bg-white p-8 rounded-[32px] shadow-sm hover:shadow-xl transition-all border-2 border-transparent hover:border-green-500 group text-left relative overflow-hidden"
        >
          <div className="absolute top-0 right-0 w-24 h-24 bg-green-50 rounded-bl-full -mr-4 -mt-4 transition-transform group-hover:scale-110"></div>
          <div className="relative z-10">
            <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center text-green-600 font-bold text-xl mb-6 group-hover:rotate-12 transition-transform">
              N
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">네이버 플레이스</h3>
            <p className="text-gray-500 text-sm leading-relaxed">
              플레이스 SEO 점수,<br />
              상위노출 필수 요소 점검
            </p>
          </div>
        </button>
      </div>

      <div className="mt-12 text-center">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-600 font-medium text-sm flex items-center justify-center gap-2 mx-auto"
        >
          <i className="fa-solid fa-arrow-left"></i>
          메인으로 돌아가기
        </button>
      </div>
    </div>
  );

  const renderInput = () => (
    <div className="max-w-md mx-auto animate-bounce-in">
      <div className="bg-white p-8 rounded-[32px] shadow-xl text-center">
        <div
          className={`w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-3xl mb-6 ${
            platform === 'INSTAGRAM'
              ? 'bg-pink-100 text-pink-500'
              : 'bg-green-100 text-green-600'
          }`}
        >
          {platform === 'INSTAGRAM' ? (
            <i className="fa-brands fa-instagram"></i>
          ) : (
            <span className="font-bold">N</span>
          )}
        </div>

        <h3 className="text-xl font-bold text-gray-800 mb-2">
          {platform === 'INSTAGRAM' ? '인스타그램 아이디 입력' : '플레이스 링크 입력'}
        </h3>
        <p className="text-gray-500 text-sm mb-8">
          {platform === 'INSTAGRAM'
            ? '@ 없이 아이디만 입력해주세요.'
            : '네이버 지도 공유 링크를 입력해주세요.'}
        </p>

        <div className="space-y-4">
          <input
            type="text"
            value={inputId}
            onChange={(e) => setInputId(e.target.value)}
            placeholder={platform === 'INSTAGRAM' ? 'instakoo_official' : 'https://naver.me/xxx'}
            className="w-full px-5 py-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all font-bold text-center text-lg"
            onKeyDown={(e) => e.key === 'Enter' && handleStartAnalysis()}
          />
          <button
            onClick={handleStartAnalysis}
            className="w-full bg-primary hover:bg-primaryLight text-white py-4 rounded-xl font-bold text-lg shadow-lg hover:shadow-xl transition-all transform hover:-translate-y-1"
          >
            진단 시작하기
          </button>
        </div>

        <button onClick={() => setStep('SELECT')} className="mt-6 text-gray-400 text-sm hover:text-gray-600">
          다른 플랫폼 선택
        </button>
      </div>
    </div>
  );

  const renderAnalyzing = () => (
    <div className="max-w-md mx-auto text-center pt-10">
      <div className="relative w-24 h-24 mx-auto mb-8">
        <svg className="animate-spin w-full h-full text-gray-200" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-primary">
          {Math.floor(progress)}%
        </div>
      </div>
      <h3 className="text-lg font-bold text-gray-800 mb-2 animate-pulse min-h-[28px]">{loadingText}</h3>
      <p className="text-gray-500 text-sm">실시간 분석 중입니다. 잠시만 기다려주세요.</p>
    </div>
  );

  const renderResult = () => {
    if (platform === 'INSTAGRAM' && igResult) {
      return (
        <div className="max-w-3xl mx-auto animate-bounce-in space-y-6">
          <div className="bg-white rounded-[32px] p-8 shadow-xl text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-pink-500 to-purple-500"></div>
            <h3 className="text-gray-500 font-bold mb-6">@{igResult.username} 계정 진단 결과</h3>

            <div className="flex justify-center items-center gap-8 mb-8">
              <div className="relative w-32 h-32 flex items-center justify-center">
                <svg className="transform -rotate-90 w-32 h-32">
                  <circle cx="64" cy="64" r="60" stroke="#f3f4f6" strokeWidth="8" fill="transparent" />
                  <circle
                    cx="64"
                    cy="64"
                    r="60"
                    stroke="#ec4899"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={377}
                    strokeDashoffset={377 - (377 * igResult.score) / 100}
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-4xl font-extrabold text-gray-800">{igResult.score}</span>
                  <span className="text-xs text-gray-400">점</span>
                </div>
              </div>
              <div className="text-left">
                <div className="text-sm text-gray-400 font-bold mb-1">계정 등급</div>
                <div
                  className={`text-5xl font-black ${
                    ['S', 'A'].includes(igResult.grade)
                      ? 'text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-purple-600'
                      : 'text-gray-700'
                  }`}
                >
                  {igResult.grade}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 bg-gray-50 rounded-2xl p-4">
              <div>
                <div className="text-xs text-gray-400 mb-1">팔로워</div>
                <div className="font-bold text-gray-800">{igResult.followers.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">팔로잉</div>
                <div className="font-bold text-gray-800">{igResult.following.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">게시물</div>
                <div className="font-bold text-gray-800">{igResult.posts.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-[32px] p-8 shadow-sm border border-gray-100">
            <h4 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
              <i className="fa-regular fa-lightbulb text-yellow-500"></i> 성장 솔루션
            </h4>
            <ul className="space-y-3">
              {igResult.tips.map((tip, idx) => (
                <li key={idx} className="flex items-start gap-3 bg-pink-50/50 p-3 rounded-xl">
                  <span className="bg-pink-100 text-pink-600 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                    {idx + 1}
                  </span>
                  <span className="text-gray-700 text-sm leading-relaxed">{tip}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex gap-4">
            <button onClick={() => setStep('SELECT')} className="flex-1 bg-gray-100 text-gray-600 py-4 rounded-xl font-bold">
              처음으로
            </button>
            <button
              onClick={() => {
                onBack();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex-1 bg-primary text-white py-4 rounded-xl font-bold shadow-lg"
            >
              솔루션 적용하기
            </button>
          </div>
        </div>
      );
    }

    if (platform === 'NAVER_PLACE' && npResult) {
      const breakdown = npResult.scoreBreakdown ?? [];
      const recs = npResult.recommendations ?? [];

      return (
        <div className="max-w-3xl mx-auto animate-bounce-in space-y-6">
          <div className="bg-white rounded-[32px] p-8 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-green-500 to-teal-500"></div>

            <div className="text-center mb-8">
              <h3 className="font-bold text-xl text-gray-800 mb-1">{npResult.placeName}</h3>
              <p className="text-sm text-gray-500">플레이스 최적화 진단 리포트</p>
            </div>

            <div className="flex justify-center items-center gap-4 mb-8">
              <div className="bg-gray-50 rounded-2xl p-4 text-center min-w-[100px]">
                <div className="text-xs text-gray-400 font-bold mb-1">종합 점수</div>
                <div className="text-3xl font-extrabold text-green-600">{npResult.score}점</div>
              </div>
              <div className="bg-gray-50 rounded-2xl p-4 text-center min-w-[100px]">
                <div className="text-xs text-gray-400 font-bold mb-1">등급</div>
                <div className="text-3xl font-black text-gray-800">{npResult.grade}</div>
              </div>
            </div>

            {/* ✅ scoreBreakdown이 없으면 빈 화면 대신 안내 */}
            {breakdown.length === 0 ? (
              <div className="bg-gray-50 rounded-2xl p-5 text-center text-gray-600 text-sm">
                세부 점수 항목(scoreBreakdown)이 아직 준비되지 않았어요.<br />
                (서버에서 breakdown을 내려주면 자동으로 표시됩니다.)
              </div>
            ) : (
              <div className="space-y-4">
                {breakdown.map((item, idx) => (
                  <div key={idx}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-bold text-gray-700">{item.name}</span>
                      <span className="text-gray-400">
                        {item.score}/{item.max}
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2.5 mb-2">
                      <div
                        className="bg-green-500 h-2.5 rounded-full"
                        style={{ width: `${item.max ? (item.score / item.max) * 100 : 0}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500 text-right">{item.notes}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-[32px] p-8 shadow-sm border border-gray-100">
            <h4 className="font-bold text-lg text-gray-800 mb-4 flex items-center gap-2">
              <i className="fa-solid fa-list-check text-green-500"></i> 개선 권장사항
            </h4>

            {recs.length === 0 ? (
              <p className="text-center text-gray-500 py-4">완벽합니다! 특별한 개선사항이 없습니다.</p>
            ) : (
              <ul className="space-y-3">
                {recs.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-3 bg-green-50/50 p-3 rounded-xl">
                    <i className="fa-solid fa-check text-green-600 mt-1"></i>
                    <span className="text-gray-700 text-sm leading-relaxed">{rec}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-4">
            <button onClick={() => setStep('SELECT')} className="flex-1 bg-gray-100 text-gray-600 py-4 rounded-xl font-bold">
              처음으로
            </button>
            <button
              onClick={() => {
                onBack();
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex-1 bg-primary text-white py-4 rounded-xl font-bold shadow-lg"
            >
              솔루션 적용하기
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderError = () => (
    <div className="max-w-md mx-auto animate-bounce-in text-center pt-10">
      <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center text-red-500 text-3xl mx-auto mb-6">
        <i className="fa-solid fa-triangle-exclamation"></i>
      </div>
      <h3 className="text-xl font-bold text-gray-800 mb-2">진단 실패</h3>
      <p className="text-gray-500 text-sm mb-8 leading-relaxed whitespace-pre-wrap">
        {errorMessage || '일시적인 오류가 발생했습니다.'}
        <br />
        입력하신 정보를 확인 후 다시 시도해주세요.
      </p>
      <button
        onClick={() => setStep('INPUT')}
        className="px-8 py-3 bg-gray-800 text-white rounded-xl font-bold hover:bg-black transition-colors"
      >
        다시 시도하기
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-primaryBg pt-24 pb-12 px-4">
      {step === 'SELECT' && renderPlatformSelection()}
      {step === 'INPUT' && renderInput()}
      {step === 'ANALYZING' && renderAnalyzing()}
      {step === 'RESULT' && renderResult()}
      {step === 'ERROR' && renderError()}
    </div>
  );
};

export default DiagnosisPage;
