# Playwright 공식 이미지 (Chromium + 필수 라이브러리 포함)
FROM mcr.microsoft.com/playwright:v1.57.0-jammy

# 작업 디렉토리
WORKDIR /app

# 의존성 파일 먼저 복사
COPY package*.json ./

# 의존성 설치 (package-lock.json 필수)
RUN npm ci

# 전체 소스 복사
COPY . .

# 프론트엔드 빌드 (Vite)
RUN npm run build

# Cloud Run 포트
ENV PORT=8080
EXPOSE 8080

# 서버 실행 (Express)
CMD ["npm", "start"]
