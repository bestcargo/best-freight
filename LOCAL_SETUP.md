# FinFlow - Smart Asset Manager (Local Setup Guide)

이 프로젝트는 React(Vite)와 Express(Node.js)를 기반으로 한 풀스택 금융 관리 애플리케이션입니다.

## 🚀 로컬 실행 방법

### 1. 필수 프로그램 설치
- [Node.js](https://nodejs.org/) (v18 이상 권장)가 설치되어 있어야 합니다.

### 2. 의존성 설치
터미널에서 프로젝트 폴더로 이동한 후 아래 명령어를 입력합니다.
```bash
npm install
```

### 3. 환경 변수 설정
프로젝트 루트 폴더에 `.env` 파일을 생성하고 아래 내용을 입력합니다.
(API 키는 본인의 키로 교체해야 합니다.)

```env
# Google Sheets 연동을 위한 OAuth 정보
GOOGLE_CLIENT_ID=실제_클라이언트_ID
GOOGLE_CLIENT_SECRET=실제_클라이언트_시크릿
SESSION_SECRET=아무_문자열_입력

# Gemini AI 기능을 위한 API 키 (Vite 클라이언트 환경 변수)
VITE_GEMINI_API_KEY=본인의_GEMINI_API_KEY
```

### 4. 실행
```bash
npm run dev
```
로그에 나타나는 주소(`http://localhost:3000`)를 브라우저에서 열면 앱이 실행됩니다.

## 📦 상용 배포 및 아키텍처
- **Frontend**: React + Tailwind CSS + Framer Motion
- **Backend**: Node.js Express (Google Sheets API 연결)
- **Database**: 현재는 Google Sheets를 DB로 사용하도록 설계되었습니다.
