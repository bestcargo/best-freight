import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import dotenv from 'dotenv';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import type { Request, Response, NextFunction } from 'express';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(process.cwd(), 'data');
const usersFile = path.join(dataDir, 'users.json');
const isProd = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET;

if (isProd && (!SESSION_SECRET || SESSION_SECRET.length < 16)) {
  throw new Error('SESSION_SECRET must be set and at least 16 chars in production.');
}

type StoredUser = {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  updatedAt: string;
};

async function ensureUsersFile() {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(usersFile, 'utf-8');
  } catch {
    await writeFile(usersFile, '[]', 'utf-8');
  }
}

async function readUsers(): Promise<StoredUser[]> {
  await ensureUsersFile();
  const raw = await readFile(usersFile, 'utf-8');
  return JSON.parse(raw) as StoredUser[];
}

async function writeUsers(users: StoredUser[]) {
  await writeFile(usersFile, JSON.stringify(users, null, 2), 'utf-8');
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, salt: string, expectedHash: string) {
  const hashBuffer = Buffer.from(hashPassword(password, salt), 'hex');
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  if (hashBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(hashBuffer, expectedBuffer);
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isStrongPassword(password: string) {
  return /^\d{4}$/.test(password);
}

function getAppOrigin(req: Request) {
  const configured = process.env.APP_ORIGIN?.trim().replace(/\/$/, '');
  if (configured) return configured;
  return `${req.protocol}://${req.get('host')}`;
}

function createRateLimiter(options: { windowMs: number; max: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = `${req.ip}:${req.path}`;
    const current = hits.get(key);
    if (!current || now > current.resetAt) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    if (current.count >= options.max) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    current.count += 1;
    hits.set(key, current);
    next();
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3100;
  const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20 });
  const allowedOrigins = new Set(
    (process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN || '')
      .split(',')
      .map(origin => origin.trim().replace(/\/$/, ''))
      .filter(Boolean)
  );

  if (isProd) {
    app.set('trust proxy', 1);
  }
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (isProd) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
  });
  app.use((req, res, next) => {
    const origin = req.headers.origin?.replace(/\/$/, '');
    if (origin && (allowedOrigins.has(origin) || (!isProd && origin.includes('localhost')))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    next();
  });
  app.use(session({
    secret: SESSION_SECRET || 'dev-session-secret-only',
    name: 'best_finflow_sid',
    resave: false,
    saveUninitialized: false,
    cookie: { 
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
    }
  }));

  // --- Local Account Routes (signup/update/delete) ---
  app.get('/api/account/check-email', authLimiter, async (req, res) => {
    const rawEmail = String(req.query.email ?? '').trim().toLowerCase();
    if (!rawEmail) {
      return res.status(400).json({ error: 'Email is required.' });
    }
    if (!isValidEmail(rawEmail)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }
    const users = await readUsers();
    const exists = users.some(u => u.email.toLowerCase() === rawEmail);
    res.json({ available: !exists });
  });

  app.post('/api/account/signup', authLimiter, async (req, res) => {
    const { name, email, password } = req.body ?? {};
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }
    if (String(name).trim().length < 2 || String(name).trim().length > 80) {
      return res.status(400).json({ error: 'Name must be between 2 and 80 characters.' });
    }
    if (!isValidEmail(String(email).trim().toLowerCase())) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }
    if (!isStrongPassword(String(password))) {
      return res.status(400).json({ error: '비밀번호는 숫자 4자리여야 합니다.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const users = await readUsers();
    const exists = users.some(u => u.email.toLowerCase() === normalizedEmail);
    if (exists) {
      return res.status(409).json({ error: 'Email already exists.' });
    }

    const salt = randomBytes(16).toString('hex');
    const now = new Date().toISOString();
    const user: StoredUser = {
      id: randomBytes(16).toString('hex'),
      name: String(name).trim(),
      email: normalizedEmail,
      passwordHash: hashPassword(password, salt),
      salt,
      createdAt: now,
      updatedAt: now,
    };

    users.push(user);
    await writeUsers(users);
    (req.session as any).userId = user.id;
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  });

  app.post('/api/account/login', authLimiter, async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }
    const users = await readUsers();
    const user = users.find(u => u.email.toLowerCase() === normalizedEmail);
    if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    (req.session as any).userId = user.id;
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  });

  app.post('/api/account/forgot-password', authLimiter, async (req, res) => {
    const { name, email, newPassword } = req.body ?? {};
    if (!name || !email || !newPassword) {
      return res.status(400).json({ error: 'Name, email, and newPassword are required.' });
    }

    const cleanName = String(name).trim();
    const normalizedEmail = String(email).trim().toLowerCase();
    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Invalid email format.' });
    }
    if (!isStrongPassword(String(newPassword))) {
      return res.status(400).json({ error: '새 비밀번호는 숫자 4자리여야 합니다.' });
    }

    const users = await readUsers();
    const idx = users.findIndex(
      u => u.email.toLowerCase() === normalizedEmail && u.name.trim() === cleanName
    );
    if (idx < 0) {
      return res.status(404).json({ error: '일치하는 계정을 찾을 수 없습니다.' });
    }

    const user = users[idx];
    const newSalt = randomBytes(16).toString('hex');
    user.salt = newSalt;
    user.passwordHash = hashPassword(String(newPassword), newSalt);
    user.updatedAt = new Date().toISOString();
    users[idx] = user;
    await writeUsers(users);

    res.json({ success: true });
  });

  app.post('/api/account/change-password', authLimiter, async (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });

    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required.' });
    }
    if (!isStrongPassword(String(newPassword))) {
      return res.status(400).json({ error: '새 비밀번호는 숫자 4자리여야 합니다.' });
    }

    const users = await readUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx < 0) return res.status(401).json({ error: 'Unauthorized' });
    const user = users[idx];

    if (!verifyPassword(String(currentPassword), user.salt, user.passwordHash)) {
      return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다.' });
    }

    const newSalt = randomBytes(16).toString('hex');
    user.salt = newSalt;
    user.passwordHash = hashPassword(String(newPassword), newSalt);
    user.updatedAt = new Date().toISOString();
    users[idx] = user;
    await writeUsers(users);

    res.json({ success: true });
  });

  app.post('/api/account/logout', (req, res) => {
    delete (req.session as any).userId;
    res.json({ success: true });
  });

  app.get('/api/account/me', async (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const users = await readUsers();
    const user = users.find(u => u.id === userId);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  });

  app.put('/api/account/update', authLimiter, async (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { name, email, currentPassword, newPassword } = req.body ?? {};
    const users = await readUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx < 0) return res.status(401).json({ error: 'Unauthorized' });

    const user = users[idx];
    if (name) {
      const cleanName = String(name).trim();
      if (cleanName.length < 2 || cleanName.length > 80) {
        return res.status(400).json({ error: 'Name must be between 2 and 80 characters.' });
      }
      user.name = cleanName;
    }

    if (email) {
      const normalizedEmail = String(email).trim().toLowerCase();
      if (!isValidEmail(normalizedEmail)) {
        return res.status(400).json({ error: 'Invalid email format.' });
      }
      const duplicate = users.some(u => u.id !== userId && u.email.toLowerCase() === normalizedEmail);
      if (duplicate) return res.status(409).json({ error: 'Email already exists.' });
      user.email = normalizedEmail;
    }

    if (newPassword) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required to change password.' });
      }
      if (!verifyPassword(currentPassword, user.salt, user.passwordHash)) {
        return res.status(401).json({ error: 'Current password is incorrect.' });
      }
      if (!isStrongPassword(String(newPassword))) {
        return res.status(400).json({ error: '새 비밀번호는 숫자 4자리여야 합니다.' });
      }
      const newSalt = randomBytes(16).toString('hex');
      user.salt = newSalt;
      user.passwordHash = hashPassword(newPassword, newSalt);
    }

    user.updatedAt = new Date().toISOString();
    users[idx] = user;
    await writeUsers(users);
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  });

  app.delete('/api/account/delete', authLimiter, async (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const { password } = req.body ?? {};
    if (!password) return res.status(400).json({ error: 'Password is required.' });

    const users = await readUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx < 0) return res.status(401).json({ error: 'Unauthorized' });
    const user = users[idx];
    if (!verifyPassword(password, user.salt, user.passwordHash)) {
      return res.status(401).json({ error: 'Password is incorrect.' });
    }

    users.splice(idx, 1);
    await writeUsers(users);
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    // Redirect URI will be constructed dynamically in the implementation
  );

  // --- Auth Routes ---

  app.get('/api/auth/google/url', (req, res) => {
    const appOrigin = getAppOrigin(req);
    const redirectUri = `${appOrigin}/auth/callback`;

    const scopes = [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ];

    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      redirect_uri: redirectUri,
      prompt: 'consent'
    });

    res.json({ url });
  });

  app.get(['/auth/callback', '/auth/callback/'], async (req, res) => {
    const { code } = req.query;
    
    // Construct redirect URI again to match what was sent to auth URL
    const appOrigin = getAppOrigin(req);
    const redirectUri = `${appOrigin}/auth/callback`;

    try {
      const { tokens } = await oauth2Client.getToken({
        code: code as string,
        redirect_uri: redirectUri
      });
      
      // Store tokens in session
      (req.session as any).tokens = tokens;
      
      res.send(`
        <html>
          <body>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '${appOrigin}');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>인증 성공! 창을 닫는 중입니다...</p>
          </body>
        </html>
      `);
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      res.status(500).send('Authentication failed');
    }
  });

  app.get('/api/auth/status', (req, res) => {
    const tokens = (req.session as any).tokens;
    res.json({ isAuthenticated: !!tokens });
  });

  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // --- Sheets API Routes ---

  app.post('/api/sheets/sync', async (req, res) => {
    const tokens = (req.session as any).tokens;
    if (!tokens) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { transactions, spreadsheetId } = req.body;
    oauth2Client.setCredentials(tokens);

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

    try {
      let targetId = spreadsheetId;

      // 1. Create spreadsheet if not provided
      if (!targetId) {
        const spreadsheet = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title: 'FinFlow Transactions' },
          },
        });
        targetId = spreadsheet.data.spreadsheetId;
      }

      // 2. Prepare data (Headers + Transactions)
      const values = [
        ['Date', 'Category', 'Description', 'Amount', 'Type'],
        ...transactions.map((t: any) => [t.date, t.category, t.description, t.amount, t.type])
      ];

      // 3. Clear and Update
      await sheets.spreadsheets.values.update({
        spreadsheetId: targetId,
        range: 'Sheet1!A1',
        valueInputOption: 'RAW',
        requestBody: { values },
      });

      res.json({ success: true, spreadsheetId: targetId });
    } catch (error) {
      console.error('Sheets sync error:', error);
      res.status(500).json({ error: 'Failed to sync to Google Sheets' });
    }
  });

  // --- Public Compliance Pages (for store review) ---
  app.get('/privacy-policy', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>개인정보처리방침 - 베스트재무관리</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 860px; margin: 0 auto; padding: 24px; line-height: 1.6; color: #1f2937; }
      h1, h2 { color: #111827; }
      code { background: #f3f4f6; padding: 2px 6px; border-radius: 6px; }
      .box { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; }
    </style>
  </head>
  <body>
    <h1>베스트재무관리 개인정보처리방침</h1>
    <p>최종 업데이트: ${new Date().toISOString().slice(0, 10)}</p>
    <div class="box">
      본 서비스는 재무 데이터 관리 기능 제공을 위해 최소한의 정보만 수집/처리합니다.
    </div>
    <h2>1. 수집 정보</h2>
    <ul>
      <li>회원 기능 사용 시: 이름, 이메일, 비밀번호(암호화 저장)</li>
      <li>서비스 데이터: 사용자가 직접 입력한 거래 내역</li>
      <li>Google 연동 시: Google OAuth 토큰(세션 기반)</li>
    </ul>
    <h2>2. 이용 목적</h2>
    <ul>
      <li>계정 인증 및 사용자 식별</li>
      <li>거래 내역 관리 및 내보내기</li>
      <li>Google Sheets 동기화 기능 제공</li>
    </ul>
    <h2>3. 보관 및 삭제</h2>
    <ul>
      <li>회원 계정 정보는 사용자의 회원탈퇴 요청 시 삭제됩니다.</li>
      <li>앱 내 <code>설정 &gt; 사용자 프로필 &gt; 회원탈퇴</code>에서 즉시 삭제 가능합니다.</li>
    </ul>
    <h2>4. 문의</h2>
    <p>정책 관련 문의: 운영자 이메일(배포 시 실제 연락처로 교체)</p>
  </body>
</html>`);
  });

  app.get('/account-deletion', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>계정 삭제 안내 - 베스트재무관리</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 860px; margin: 0 auto; padding: 24px; line-height: 1.6; color: #1f2937; }
      h1, h2 { color: #111827; }
      .step { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px; margin: 10px 0; }
    </style>
  </head>
  <body>
    <h1>계정 삭제(회원탈퇴) 안내</h1>
    <p>앱 내에서 직접 계정 삭제를 요청할 수 있습니다.</p>
    <div class="step"><strong>1)</strong> 앱 로그인 후 <strong>설정</strong> 메뉴로 이동</div>
    <div class="step"><strong>2)</strong> <strong>사용자 프로필</strong> 영역의 <strong>회원탈퇴</strong> 선택</div>
    <div class="step"><strong>3)</strong> 비밀번호 확인 후 계정 즉시 삭제</div>
    <h2>삭제 범위</h2>
    <ul>
      <li>계정 식별 정보(이름, 이메일, 암호 해시)</li>
      <li>세션 정보</li>
    </ul>
  </body>
</html>`);
  });

  // --- Vite Middleware ---

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
