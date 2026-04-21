/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  PieChart as PieChartIcon, 
  Plus, 
  Sparkles,
  ChevronRight,
  Coins,
  Loader2,
  Settings,
  Edit2,
  Moon,
  Sun,
  Eye,
  EyeOff
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';
import { 
  format, 
  isWithinInterval, 
  startOfDay, 
  endOfDay, 
  startOfWeek, 
  endOfWeek, 
  startOfMonth, 
  endOfMonth, 
  startOfYear, 
  endOfYear,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  parseISO
} from 'date-fns';
import { cn, formatCurrency } from './utils';
import { Transaction, AIInsight } from './types';
import { getFinancialInsights } from './gemini';

// Mock data
const INITIAL_TRANSACTIONS: Transaction[] = [];

const COLORS = ['#3182f6', '#5aa2ff', '#1d4ed8', '#94bfff', '#cfe2ff'];
type ThemeMode = 'light' | 'dark';
type BrandTone = 'minimal' | 'premium' | 'enterprise';
type LayoutDensity = 'comfortable' | 'compact';
type AuthMode = 'login' | 'signup' | 'forgot' | 'change';
type AccountSessionUser = { id: string; name: string; email: string };

export default function Dashboard() {
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') || '';
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS);
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'assets' | 'expenses' | 'income' | 'settings'>('dashboard');
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [scannedData, setScannedData] = useState<Partial<Transaction> | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'day' | 'week' | 'month' | 'year'>('all');
  const [dateFromInput, setDateFromInput] = useState('');
  const [dateToInput, setDateToInput] = useState('');
  const [appliedDateFrom, setAppliedDateFrom] = useState('');
  const [appliedDateTo, setAppliedDateTo] = useState('');
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => (localStorage.getItem('finflow_theme_mode') as ThemeMode) || 'light');
  const [brandTone, setBrandTone] = useState<BrandTone>(() => (localStorage.getItem('finflow_brand_tone') as BrandTone) || 'enterprise');
  const [layoutDensity, setLayoutDensity] = useState<LayoutDensity>(() => (localStorage.getItem('finflow_layout_density') as LayoutDensity) || 'comfortable');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthMode>('signup');
  const [authModalName, setAuthModalName] = useState('');
  const [authModalEmail, setAuthModalEmail] = useState('');
  const [authModalCurrentPassword, setAuthModalCurrentPassword] = useState('');
  const [authModalPassword, setAuthModalPassword] = useState('');
  const [authModalPasswordConfirm, setAuthModalPasswordConfirm] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authModalEmailCheckState, setAuthModalEmailCheckState] = useState<'idle' | 'checking' | 'available' | 'duplicate' | 'invalid'>('idle');
  const [authModalEmailCheckMessage, setAuthModalEmailCheckMessage] = useState('');
  const [authModalError, setAuthModalError] = useState('');
  const [accountUser, setAccountUser] = useState<AccountSessionUser | null>(null);
  const emailCheckRequestSeq = useRef(0);
  const authModalEmailRef = useRef(authModalEmail);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    document.documentElement.setAttribute('data-tone', brandTone);
    document.documentElement.setAttribute('data-density', layoutDensity);
    localStorage.setItem('finflow_theme_mode', themeMode);
    localStorage.setItem('finflow_brand_tone', brandTone);
    localStorage.setItem('finflow_layout_density', layoutDensity);
  }, [themeMode, brandTone, layoutDensity]);

  // Filtered transactions
  const timeFilteredTransactions = useMemo(() => {
    let filtered = transactions;

    if (filterPeriod !== 'all') {
      const now = new Date();
      let start: Date, end: Date;

      switch (filterPeriod) {
        case 'day':
          start = startOfDay(now);
          end = endOfDay(now);
          break;
        case 'week':
          start = subDays(now, 7);
          end = now;
          break;
        case 'month':
          start = subMonths(now, 1);
          end = now;
          break;
        case 'year':
          start = subYears(now, 1);
          end = now;
          break;
        default:
          start = startOfDay(now);
          end = endOfDay(now);
      }

      filtered = filtered.filter(t => {
        const tDate = parseISO(t.date);
        return isWithinInterval(tDate, { start, end });
      });
    }

    if (appliedDateFrom || appliedDateTo) {
      const start = appliedDateFrom ? startOfDay(parseISO(appliedDateFrom)) : null;
      const end = appliedDateTo ? endOfDay(parseISO(appliedDateTo)) : null;

      filtered = filtered.filter(t => {
        const tDate = parseISO(t.date);
        if (start && tDate < start) return false;
        if (end && tDate > end) return false;
        return true;
      });
    }

    return filtered;
  }, [transactions, filterPeriod, appliedDateFrom, appliedDateTo]);

  // Tab-filtered transactions for list display
  const displayTransactions = useMemo(() => {
    if (currentTab === 'expenses') return timeFilteredTransactions.filter(t => t.type === 'expense');
    if (currentTab === 'income') return timeFilteredTransactions.filter(t => t.type === 'income');
    return timeFilteredTransactions;
  }, [timeFilteredTransactions, currentTab]);

  // Stats calculation
  const stats = useMemo(() => {
    const income = timeFilteredTransactions.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
    const expense = timeFilteredTransactions.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);
    return {
      income,
      expense,
      balance: income - expense
    };
  }, [timeFilteredTransactions]);

  // Chart data
  const categoryData = useMemo(() => {
    const categories: Record<string, number> = {};
    const baseList = currentTab === 'income' ? timeFilteredTransactions.filter(t => t.type === 'income') : timeFilteredTransactions.filter(t => t.type === 'expense');
    
    baseList.forEach(t => {
      categories[t.category] = (categories[t.category] || 0) + t.amount;
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [timeFilteredTransactions, currentTab]);

  const trendData = useMemo(() => {
    const daily: Record<string, { date: string, income: number, expense: number }> = {};
    timeFilteredTransactions.forEach(t => {
      if (!daily[t.date]) {
        daily[t.date] = { date: t.date, income: 0, expense: 0 };
      }
      if (t.type === 'income') daily[t.date].income += t.amount;
      else daily[t.date].expense += t.amount;
    });
    return Object.values(daily).sort((a, b) => a.date.localeCompare(b.date));
  }, [timeFilteredTransactions]);

  const hasData = timeFilteredTransactions.length > 0;
  const menuItems = [
    { id: 'dashboard', label: '대시보드', mobileLabel: '홈', icon: <PieChartIcon size={16} /> },
    { id: 'assets', label: '자산현황', mobileLabel: '자산', icon: <Wallet size={16} /> },
    { id: 'expenses', label: '지출분석', mobileLabel: '지출', icon: <TrendingDown size={16} /> },
    { id: 'income', label: '수입내역', mobileLabel: '수입', icon: <TrendingUp size={16} /> },
    { id: 'settings', label: '설정', mobileLabel: '설정', icon: <Settings size={16} /> },
  ] as const;
  const currentTabMeta = {
    dashboard: { title: '대시보드', description: '핵심 지표와 거래 흐름을 한 화면에서 확인합니다.' },
    assets: { title: '자산현황', description: '기간별 자산 변화와 분포를 확인합니다.' },
    expenses: { title: '지출분석', description: '카테고리별 지출 패턴과 상세 내역을 분석합니다.' },
    income: { title: '수입내역', description: '수입 항목과 추이를 체계적으로 관리합니다.' },
    settings: { title: '설정', description: '테마, 데이터 연동, 계정 정보를 관리합니다.' },
  }[currentTab];
  const isDashboardTab = currentTab === 'dashboard';

  const fetchAIInsights = async () => {
    setLoadingInsights(true);
    const newInsights = await getFinancialInsights(transactions);
    setInsights(newInsights);
    setLoadingInsights(false);
  };

  const handleClearAll = () => {
    setTransactions([]);
    setInsights([]);
  };

  const exportTransactionsToExcel = (items: Transaction[], suffix: string) => {
    if (items.length === 0) {
      alert('내보낼 거래 데이터가 없습니다.');
      return;
    }

    const rows = items.map((t) => ({
      날짜: t.date,
      구분: t.type === 'income' ? '수입' : '지출',
      카테고리: t.category,
      항목명: t.description,
      금액: t.amount,
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, '거래내역');

    const fileName = `베스트재무관리_거래내역_${suffix}_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const handleExportAllToExcel = () => {
    exportTransactionsToExcel(transactions, '전체');
  };

  const handleExportFilteredToExcel = () => {
    exportTransactionsToExcel(timeFilteredTransactions, '필터');
  };

  const handleDateSearch = () => {
    setFilterPeriod('all');
    if (dateFromInput && dateToInput && dateFromInput > dateToInput) {
      alert('시작일이 종료일보다 늦을 수 없습니다.');
      return;
    }
    setAppliedDateFrom(dateFromInput);
    setAppliedDateTo(dateToInput);
  };

  const handleDateReset = () => {
    setDateFromInput('');
    setDateToInput('');
    setAppliedDateFrom('');
    setAppliedDateTo('');
  };

  useEffect(() => {
    fetchAIInsights();
  }, [transactions]);

  const authModalPasswordStrength = useMemo(() => {
    const pw = authModalPassword;
    if (!pw) return { label: '미입력', color: 'bg-slate-200', width: 'w-0' };
    if (/^\d{4}$/.test(pw)) return { label: '사용 가능', color: 'bg-emerald-500', width: 'w-full' };
    return { label: '숫자 4자리 필요', color: 'bg-red-500', width: 'w-1/2' };
  }, [authModalPassword]);

  const isStrongAuthPassword = (password: string) => /^\d{4}$/.test(password);

  useEffect(() => {
    authModalEmailRef.current = authModalEmail;
  }, [authModalEmail]);

  useEffect(() => {
    if (!isAuthModalOpen || authModalMode !== 'signup') {
      setAuthModalEmailCheckState('idle');
      setAuthModalEmailCheckMessage('');
      return;
    }

    const email = authModalEmail.trim().toLowerCase();
    if (!email) {
      setAuthModalEmailCheckState('idle');
      setAuthModalEmailCheckMessage('');
      return;
    }
    if (!email.includes('@')) {
      setAuthModalEmailCheckState('idle');
      setAuthModalEmailCheckMessage('');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setAuthModalEmailCheckState('invalid');
      setAuthModalEmailCheckMessage('이메일 형식이 올바르지 않습니다.');
      return;
    }

    setAuthModalEmailCheckState('checking');
    const requestSeq = ++emailCheckRequestSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/account/check-email?email=${encodeURIComponent(email)}`);
        const data = await parseApiResponse(res);
        const latestEmail = authModalEmailRef.current.trim().toLowerCase();
        if (requestSeq !== emailCheckRequestSeq.current || latestEmail !== email) return;
        if (!res.ok) throw new Error(data.error || '확인 실패');
        if (typeof data.available !== 'boolean') {
          setAuthModalEmailCheckState('idle');
          setAuthModalEmailCheckMessage('');
          return;
        }
        if (data.available) {
          setAuthModalEmailCheckState('available');
          setAuthModalEmailCheckMessage('사용 가능한 이메일입니다.');
        } else {
          setAuthModalEmailCheckState('duplicate');
          setAuthModalEmailCheckMessage('이미 사용 중인 이메일입니다.');
        }
      } catch {
        setAuthModalEmailCheckState('idle');
        setAuthModalEmailCheckMessage('');
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      emailCheckRequestSeq.current += 1;
    };
  }, [isAuthModalOpen, authModalEmail, authModalMode]);

  const openAuthModal = (mode: AuthMode) => {
    setAuthModalMode(mode);
    setAuthModalError('');
    setIsAuthModalOpen(true);
  };

  const closeAuthModal = () => {
    setIsAuthModalOpen(false);
    setAuthModalError('');
    setAuthModalName('');
    setAuthModalEmail('');
    setAuthModalCurrentPassword('');
    setAuthModalPassword('');
    setAuthModalPasswordConfirm('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setAuthModalEmailCheckState('idle');
    setAuthModalEmailCheckMessage('');
  };

  const switchToLoginMode = () => {
    setAuthModalMode('login');
    setAuthModalError('');
    setAuthModalPassword('');
    setAuthModalPasswordConfirm('');
    setAuthModalCurrentPassword('');
  };

  const parseApiResponse = async (res: Response) => {
    const raw = await res.text();
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return { error: '서버 응답 형식이 올바르지 않습니다.' };
    }
  };

  const apiFetch = (path: string, init?: RequestInit) => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return fetch(`${apiBaseUrl}${normalizedPath}`, {
      credentials: 'include',
      ...init,
    });
  };

  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await apiFetch('/api/account/me');
        if (!res.ok) {
          setAccountUser(null);
          return;
        }
        const data = await parseApiResponse(res);
        setAccountUser((data.user as AccountSessionUser) || null);
      } catch {
        setAccountUser(null);
      }
    };
    checkSession();
  }, []);

  const handleAuthModalSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setAuthModalError('');
    try {
      if (authModalMode === 'signup') {
        if (authModalEmailCheckState === 'invalid') throw new Error('이메일 형식이 올바르지 않습니다.');
        if (authModalPassword !== authModalPasswordConfirm) throw new Error('비밀번호 확인이 일치하지 않습니다.');
        if (!isStrongAuthPassword(authModalPassword)) {
          throw new Error('비밀번호는 숫자 4자리여야 합니다.');
        }
      }
      if (authModalMode === 'forgot' || authModalMode === 'change') {
        if (authModalPassword !== authModalPasswordConfirm) throw new Error('비밀번호 확인이 일치하지 않습니다.');
        if (!isStrongAuthPassword(authModalPassword)) {
          throw new Error('새 비밀번호는 숫자 4자리여야 합니다.');
        }
      }

      const endpoint =
        authModalMode === 'signup'
          ? '/api/account/signup'
          : authModalMode === 'login'
            ? '/api/account/login'
            : authModalMode === 'forgot'
              ? '/api/account/forgot-password'
              : '/api/account/change-password';
      const payload =
        authModalMode === 'signup'
          ? { name: authModalName, email: authModalEmail, password: authModalPassword }
          : authModalMode === 'login'
            ? { email: authModalEmail, password: authModalPassword }
            : authModalMode === 'forgot'
              ? { name: authModalName, email: authModalEmail, newPassword: authModalPassword }
              : { currentPassword: authModalCurrentPassword, newPassword: authModalPassword };
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await parseApiResponse(res);
      if (!res.ok) {
        const serverMessage = typeof data.error === 'string' ? data.error : '';
        const actionLabel =
          authModalMode === 'signup'
            ? '회원가입'
            : authModalMode === 'login'
              ? '로그인'
              : authModalMode === 'forgot'
                ? '비밀번호 재설정'
                : '비밀번호 변경';
        throw new Error(serverMessage || `${actionLabel} 요청 실패 (HTTP ${res.status})`);
      }
      if ((authModalMode === 'signup' || authModalMode === 'login') && data.user) {
        setAccountUser(data.user as AccountSessionUser);
      }
      closeAuthModal();
      alert(
        authModalMode === 'signup'
          ? '회원가입이 완료되었습니다.'
          : authModalMode === 'login'
            ? '로그인되었습니다.'
            : authModalMode === 'forgot'
              ? '비밀번호 재설정이 완료되었습니다. 새 비밀번호로 로그인해주세요.'
              : '비밀번호 변경이 완료되었습니다.'
      );
      if (currentTab === 'settings') {
        setCurrentTab('dashboard');
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          setAuthModalError('서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.');
          return;
        }
        setAuthModalError(error.message);
        return;
      }
      setAuthModalError('오류가 발생했습니다.');
    }
  };

  const handleHeaderLogout = async () => {
    try {
      await apiFetch('/api/account/logout', { method: 'POST' });
    } finally {
      setAccountUser(null);
    }
  };

  return (
    <div className="min-h-screen bg-bg-main text-text-primary font-sans selection:bg-blue-100 flex flex-col">
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header (Action Bar) */}
        <header className="bg-bg-card border-b border-border h-16 flex items-center px-4 md:px-8 sticky top-0 z-20">
          <div className="max-w-7xl mx-auto w-full flex items-center gap-3 md:gap-4">
            <div className="flex items-center gap-2 shrink-0">
              <div className="bg-gradient-to-br from-cyan-500 via-blue-600 to-indigo-600 p-1.5 rounded-lg shadow-lg shadow-blue-500/45">
                <Coins className="text-white w-4 h-4" />
              </div>
              <h1 className="text-base md:text-lg font-black text-text-primary tracking-tight">베스트재무관리</h1>
            </div>

            <nav className="hidden lg:flex items-center gap-2 overflow-x-auto px-4 border-l border-border flex-1">
              {menuItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setCurrentTab(item.id as any)}
                  className={cn(
                    "px-3 py-2 text-sm font-bold whitespace-nowrap transition-all rounded-md",
                    currentTab === item.id
                      ? "text-white bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 shadow-lg shadow-blue-500/40"
                      : "text-text-secondary hover:text-text-primary hover:bg-blue-50"
                  )}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </nav>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setThemeMode(themeMode === 'light' ? 'dark' : 'light')}
                className="btn-secondary px-3 py-2 text-xs font-bold inline-flex items-center gap-1.5"
                title={themeMode === 'light' ? '다크모드로 전환' : '라이트모드로 전환'}
              >
                {themeMode === 'light' ? <Moon size={13} /> : <Sun size={13} />}
                <span>{themeMode === 'light' ? '다크모드' : '라이트모드'}</span>
              </button>
              {accountUser ? (
                <button
                  onClick={handleHeaderLogout}
                  className="btn-secondary hidden md:inline-flex px-3 py-2 text-xs font-bold"
                >
                  로그아웃
                </button>
              ) : (
                <>
                  <button
                    onClick={() => openAuthModal('signup')}
                    className="btn-secondary hidden md:inline-flex px-3 py-2 text-xs font-bold"
                  >
                    회원가입
                  </button>
                  <button
                    onClick={() => openAuthModal('login')}
                    className="btn-secondary hidden md:inline-flex px-3 py-2 text-xs font-bold"
                  >
                    로그인
                  </button>
                </>
              )}
              <button 
                onClick={() => {
                  setEditingTransactionId(null);
                  setScannedData(null);
                  setIsModalOpen(true);
                }}
                className="btn-primary px-3 md:px-4 py-2.5 flex items-center gap-1.5 text-sm font-bold"
              >
                <Plus size={14} />
                <span className="hidden md:inline">입출입력</span>
              </button>
            </div>
          </div>
        </header>

        <main className={cn(
          "max-w-7xl w-full mx-auto bg-bg-card border border-border rounded-2xl card-shadow",
          layoutDensity === 'compact'
            ? "px-4 md:px-6 pt-4 md:pt-5 pb-24 lg:pb-8 space-y-4"
            : "px-5 md:px-7 pt-5 md:pt-6 pb-24 lg:pb-8 space-y-6"
          ,
          isDashboardTab && "lg:h-[calc(100vh-6.5rem)] lg:overflow-y-auto"
        )}>
          {currentTab === 'settings' ? (
            <SettingsView 
              onClearAll={() => setTransactions([])} 
              onExportAllExcel={handleExportAllToExcel}
              onExportFilteredExcel={handleExportFilteredToExcel}
              onOpenAuthModal={openAuthModal}
            />
          ) : (
            <>
              <div className="bg-bg-main border border-border rounded-2xl p-4 md:p-5 card-shadow">
                <div className="flex items-start gap-4">
                  <div>
                    <h2 className="text-xl md:text-2xl font-black text-text-primary tracking-tight">{currentTabMeta.title}</h2>
                    <p className="text-sm text-text-secondary mt-1.5">{currentTabMeta.description}</p>
                  </div>
                </div>
              </div>

              {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-bg-main p-3 rounded-2xl border border-border card-shadow">
          <div className="flex flex-wrap items-center gap-2 md:gap-3 w-full lg:w-auto">
            <div className="flex bg-bg-card p-1 rounded-xl border border-border shrink-0 overflow-x-auto">
              {[
                { label: '전체', value: 'all' },
                { label: '오늘', value: 'day' },
                { label: '1주일', value: 'week' },
                { label: '1개월', value: 'month' },
                { label: '1년', value: 'year' },
              ].map((item) => (
                <button
                  key={item.value}
                  onClick={() => {
                    setFilterPeriod(item.value as any);
                    setAppliedDateFrom('');
                    setAppliedDateTo('');
                  }}
                  className={cn(
                    "px-3 md:px-4 py-2 rounded-lg text-sm font-bold transition-all whitespace-nowrap",
                    filterPeriod === item.value 
                      ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white" 
                      : "text-text-secondary hover:text-text-primary hover:bg-bg-main"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={dateFromInput}
                onChange={(e) => setDateFromInput(e.target.value)}
                className="bg-bg-card border border-border rounded-lg px-2.5 py-2 text-sm text-text-primary"
              />
              <span className="text-text-secondary text-sm">~</span>
              <input
                type="date"
                value={dateToInput}
                onChange={(e) => setDateToInput(e.target.value)}
                className="bg-bg-card border border-border rounded-lg px-2.5 py-2 text-sm text-text-primary"
              />
              <button
                onClick={handleDateSearch}
                className="btn-secondary px-3 py-2 text-sm font-bold"
              >
                검색
              </button>
              <button
                onClick={handleDateReset}
                className="btn-secondary px-3 py-2 text-sm font-bold"
              >
                초기화
              </button>
            </div>
          </div>
          <div className="px-2 md:px-3 py-1">
                  <p className="text-sm font-semibold text-text-secondary">
                    총 <span className="text-accent font-black text-base mx-0.5">{displayTransactions.length}</span> 건의 내역
                  </p>
          </div>
        </div>

        {/* Top Stats */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <StatCard 
            title="현재 총 자산" 
            value={stats.balance} 
            icon={<Wallet className="text-accent" />} 
            description="현재 보유 중인 순자산 합계"
            className="md:col-span-6"
          />
          <StatCard 
            title="기간 내 수입" 
            value={stats.income} 
            icon={<TrendingUp className="text-success" />} 
            isPositive
            description="선택한 기간 동안의 총 소득"
            className="md:col-span-3"
          />
          <StatCard 
            title="기간 내 지출" 
            value={stats.expense} 
            icon={<TrendingDown className="text-red-500" />} 
            description="선택한 기간 동안의 총 소비"
            className="md:col-span-3"
          />
        </div>

              <div className={cn(
                "grid grid-cols-1 gap-4",
                currentTab === 'dashboard' ? "lg:grid-cols-3" : "lg:grid-cols-1"
              )}>
                
                {/* Main Content (Chart or List) */}
                <div className={cn(
                  "bg-bg-card rounded-2xl p-4 md:p-5 border border-border card-shadow",
                  isDashboardTab && "lg:h-full",
                  currentTab === 'dashboard' ? "lg:col-span-2" : ""
                )}>
                  <div className="flex justify-between items-center mb-6">
                    <div>
                      <h2 className="text-xl font-black text-text-primary tracking-tight">
                        {currentTab === 'dashboard' && '수입 및 지출 추이'}
                        {currentTab === 'assets' && '자산 변동 흐름'}
                        {currentTab === 'expenses' && '지출 상세 내역'}
                        {currentTab === 'income' && '수입 상세 내역'}
                      </h2>
                      <p className="text-sm text-text-secondary mt-1.5 font-medium">
                        {currentTab === 'dashboard' && '시간 흐름에 따른 자산 변동 그래프'}
                        {currentTab === 'assets' && '일자별 자산 증감 현황'}
                        {currentTab === 'expenses' && '지출 항목에 대한 상세 기록입니다.'}
                        {currentTab === 'income' && '수입 항목에 대한 상세 기록입니다.'}
                      </p>
                    </div>
                  </div>
                  {(currentTab === 'dashboard' || currentTab === 'assets') && (
                    <div className={cn("mb-4", isDashboardTab ? "h-[180px] md:h-[200px]" : "h-[280px]")}>
                      {hasData ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                            <XAxis 
                              dataKey="date" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fill: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 500}}
                              tickFormatter={(str) => format(new Date(str), 'MM/dd')}
                              dy={10}
                            />
                            <YAxis axisLine={false} tickLine={false} tick={{fill: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 500}} dx={-10} />
                            <Tooltip 
                              contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)'}}
                              formatter={(val: number) => [formatCurrency(val), '']}
                            />
                            <Area type="monotone" dataKey="income" stroke="var(--color-success)" fillOpacity={0.08} fill="var(--color-success)" strokeWidth={3} />
                            <Area type="monotone" dataKey="expense" stroke="var(--color-accent)" fillOpacity={0.08} fill="var(--color-accent)" strokeWidth={3} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-text-secondary bg-bg-main rounded-xl border border-dashed border-border">
                          <p className="text-sm font-medium">조회 기간 내 데이터가 없습니다.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Transactions List */}
                  <div className="md:hidden space-y-3">
                    {displayTransactions.length > 0 ? displayTransactions.slice().reverse().map(t => (
                      <div key={t.id} className="p-4 rounded-xl border border-border bg-bg-main">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-black text-text-primary">{t.description}</p>
                            <p className="text-[11px] text-text-secondary mt-1">{format(new Date(t.date), 'yyyy.MM.dd')}</p>
                          </div>
                          <button
                            onClick={() => {
                              setEditingTransactionId(t.id);
                              setScannedData({
                                description: t.description,
                                amount: t.amount,
                                date: t.date,
                                category: t.category,
                                type: t.type
                              });
                              setIsModalOpen(true);
                            }}
                            className="btn-secondary p-2"
                            title="내역 수정"
                          >
                            <Edit2 size={12} />
                          </button>
                        </div>
                        <div className="flex items-center justify-between mt-3">
                          <span className="text-[10px] font-black px-2.5 py-1 rounded-lg bg-bg-card text-text-secondary uppercase tracking-wider">
                            {t.category}
                          </span>
                          <span className={cn(
                            "text-sm font-black tabular-nums",
                            t.type === 'income' ? "text-success" : "text-text-primary"
                          )}>
                            {t.type === 'income' ? '+' : '-'} {formatCurrency(t.amount)}
                          </span>
                        </div>
                      </div>
                    )) : (
                      <div className="py-12 text-center text-text-secondary text-sm font-medium italic border border-border rounded-xl bg-bg-main">
                        조회된 {currentTab === 'expenses' ? '지출' : (currentTab === 'income' ? '수입' : '거래')} 내역이 없습니다.
                      </div>
                    )}
                  </div>

                  <div className={cn("hidden md:block overflow-x-auto", isDashboardTab && "lg:max-h-[160px] lg:overflow-y-auto")}>
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-xs font-black text-text-secondary uppercase tracking-[0.15em]">
                          <th className="pb-6 border-b border-border">일자</th>
                          <th className="pb-6 border-b border-border">카테고리</th>
                          <th className="pb-6 border-b border-border">항목명</th>
                          <th className="pb-6 border-b border-border text-right">금액</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/70">
                        {displayTransactions.length > 0 ? displayTransactions.slice().reverse().map(t => (
                          <tr key={t.id} className="group hover:bg-bg-main/70 transition-all">
                            <td className="py-4 text-sm text-text-secondary font-semibold font-mono">{format(new Date(t.date), 'yyyy.MM.dd')}</td>
                            <td className="py-4">
                              <span className="text-xs font-black px-2.5 py-1 rounded-lg bg-bg-main text-text-secondary uppercase tracking-wider">
                                {t.category}
                              </span>
                            </td>
                            <td className="py-4 text-base font-semibold text-text-primary">{t.description}</td>
                            <td className={cn(
                              "py-4 text-sm font-black text-right",
                              t.type === 'income' ? "text-success" : "text-text-primary"
                            )}>
                              <div className="flex items-center justify-end gap-3 translate-x-12 group-hover:translate-x-0 transition-transform duration-300">
                                <span className="font-mono tracking-tight">{t.type === 'income' ? '+' : '-'} {formatCurrency(t.amount)}</span>
                                <button 
                                  onClick={() => {
                                    setEditingTransactionId(t.id);
                                    setScannedData({
                                      description: t.description,
                                      amount: t.amount,
                                      date: t.date,
                                      category: t.category,
                                      type: t.type
                                    });
                                    setIsModalOpen(true);
                                  }}
                                  className="p-2 text-white bg-accent rounded-xl shadow-md shadow-accent/20 opacity-0 group-hover:opacity-100 transition-all hover:scale-110 active:scale-95"
                                  title="내역 수정"
                                >
                                  <Edit2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={4} className={cn("text-center text-text-secondary text-sm font-medium italic", isDashboardTab ? "py-10" : "py-20")}>
                              조회된 {currentTab === 'expenses' ? '지출' : (currentTab === 'income' ? '수입' : '거래')} 내역이 없습니다.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* AI Insights & Breakdown (Displayed only on dashboard) */}
                {currentTab === 'dashboard' && (
                  <div className={cn("space-y-4", isDashboardTab && "lg:h-full lg:overflow-hidden")}>
                    {/* Category Breakdown */}
                    <div className={cn("bg-bg-card rounded-2xl p-4 md:p-5 border border-border card-shadow flex flex-col", isDashboardTab && "lg:h-[48%]")}>
                      <h2 className="text-xl font-black text-text-primary tracking-tight mb-6">카테고리별 비중</h2>
                      <div className={cn("relative mt-auto", isDashboardTab ? "h-[150px] md:h-[170px]" : "h-[240px]")}>
                        {categoryData.length > 0 ? (
                          <>
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={categoryData}
                                  innerRadius={70}
                                  outerRadius={95}
                                  paddingAngle={6}
                                  dataKey="value"
                                  stroke="none"
                                >
                                  {categoryData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                  ))}
                                </Pie>
                                <Tooltip 
                                  contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '12px', fontWeight: 600}}
                                  formatter={(val: number) => formatCurrency(val)} 
                                />
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                              <p className="text-[10px] font-black text-text-secondary uppercase tracking-[0.2em]">지출 합계</p>
                              <p className="text-xl font-black text-text-primary mt-1">{formatCurrency(stats.expense)}</p>
                            </div>
                          </>
                        ) : (
                          <div className="h-full flex items-center justify-center text-text-secondary italic text-sm font-bold">
                            표시할 데이터가 없습니다.
                          </div>
                        )}
                      </div>
                      
                      <div className={cn("space-y-3", isDashboardTab ? "mt-4" : "mt-8")}>
                        {categoryData.length > 0 ? categoryData.sort((a,b) => b.value - a.value).slice(0, 3).map((item, idx) => (
                          <div key={item.name} className="flex flex-col gap-1.5">
                            <div className="flex justify-between text-[10px] font-black uppercase tracking-wider">
                              <span className="text-text-secondary">{item.name}</span>
                              <span className="text-text-primary">{Math.round((item.value / (stats.expense || 1)) * 100)}%</span>
                            </div>
                            <div className="h-2 bg-bg-main rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }}
                                animate={{ width: `${(item.value / (stats.expense || 1)) * 100}%` }}
                                className="h-full bg-accent rounded-full" 
                              />
                            </div>
                          </div>
                        )) : null}
                      </div>
                    </div>

                    {/* AI Insights Side Panel */}
                    <div className={cn("bg-bg-card rounded-2xl p-4 md:p-5 border border-border card-shadow flex flex-col", isDashboardTab && "lg:h-[52%]")}>
                      <div className="flex justify-between items-center mb-6">
                        <div>
                          <h2 className="text-xl font-black text-text-primary tracking-tight flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-accent" />
                            AI 리포트
                          </h2>
                          <p className="text-sm text-text-secondary mt-1 font-medium">FinFlow AI의 분석 결과</p>
                        </div>
                        {loadingInsights && <Loader2 size={16} className="animate-spin text-accent" />}
                      </div>
                      <div className={cn("space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar", isDashboardTab && "min-h-0")}>
                        <AnimatePresence mode="wait">
                          {insights.length > 0 ? insights.map((insight, idx) => (
                            <motion.div
                              key={idx}
                              initial={{ opacity: 0, scale: 0.95 }}
                              animate={{ opacity: 1, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ delay: idx * 0.05 }}
                              className="p-5 rounded-2xl border border-border bg-bg-main hover:bg-bg-card hover:shadow-md transition-all group"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <div className={cn(
                                  "w-2.5 h-2.5 rounded-full shadow-sm",
                                  insight.type === 'saving_tip' ? "bg-success" :
                                  insight.type === 'warning' ? "bg-red-500" :
                                  "bg-accent"
                                )} />
                                <h3 className="font-black text-[10px] text-text-primary uppercase tracking-wider">{insight.title}</h3>
                              </div>
                              <p className="text-xs text-text-secondary leading-relaxed font-semibold">{insight.description}</p>
                            </motion.div>
                          )) : (
                            <div className="h-full flex flex-col items-center justify-center text-text-secondary text-center p-4">
                              <Sparkles className="w-9 h-9 opacity-20 mb-3" />
                              <p className="text-xs font-bold">새로운 거래를 추가하면<br/>AI가 분석을 시작합니다.</p>
                            </div>
                          )}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
    </div>

      {/* Mobile Bottom Navigation */}
      <nav className="fixed bottom-0 inset-x-0 z-40 lg:hidden border-t border-border bg-bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-bg-card/80">
        <div className="grid grid-cols-5">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id as any)}
              className={cn(
                "py-3 flex flex-col items-center justify-center gap-1 text-[10px] font-bold transition-colors",
                currentTab === item.id ? "text-accent" : "text-text-secondary"
              )}
            >
              {item.icon}
              <span>{item.mobileLabel}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Auth Modal */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-bg-card rounded-2xl w-full max-w-md border border-border card-shadow p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-black text-text-primary">
                {authModalMode === 'signup'
                  ? '회원가입'
                  : authModalMode === 'login'
                    ? '로그인'
                    : authModalMode === 'forgot'
                      ? '비밀번호 찾기'
                      : '비밀번호 변경'}
              </h3>
              <button onClick={closeAuthModal} className="btn-secondary px-2 py-1 text-xs font-bold">닫기</button>
            </div>

            <div className="flex gap-2 mb-4">
              <button
                type="button"
                onClick={() => setAuthModalMode('signup')}
                className={cn("btn-secondary px-3 py-2 text-xs font-bold", authModalMode === 'signup' && "ring-2 ring-accent/30")}
              >
                회원가입
              </button>
              <button
                type="button"
                onClick={() => setAuthModalMode('login')}
                className={cn("btn-secondary px-3 py-2 text-xs font-bold", authModalMode === 'login' && "ring-2 ring-accent/30")}
              >
                로그인
              </button>
            </div>

            <form onSubmit={handleAuthModalSubmit} className="space-y-3">
              {(authModalMode === 'signup' || authModalMode === 'forgot') && (
                <input
                  value={authModalName}
                  onChange={(e) => setAuthModalName(e.target.value)}
                  placeholder={authModalMode === 'signup' ? '이름' : '가입한 이름'}
                  className="w-full bg-bg-main border border-border rounded-xl p-3 text-sm"
                  required
                />
              )}
              {authModalMode !== 'change' && (
                <input
                  type="email"
                  value={authModalEmail}
                  onChange={(e) => setAuthModalEmail(e.target.value)}
                  placeholder="이메일"
                  className="w-full bg-bg-main border border-border rounded-xl p-3 text-sm"
                  required
                />
              )}
              {authModalMode === 'signup' && authModalEmailCheckMessage && (
                <p className={cn(
                  "text-xs font-semibold",
                  authModalEmailCheckState === 'available' && "text-success",
                  authModalEmailCheckState === 'duplicate' && "text-danger",
                  authModalEmailCheckState === 'invalid' && "text-amber-600",
                  authModalEmailCheckState === 'checking' && "text-text-secondary"
                )}>
                  {authModalEmailCheckState === 'checking' ? '이메일 중복 확인 중...' : authModalEmailCheckMessage}
                </p>
              )}
              {authModalMode === 'signup' && authModalEmailCheckState === 'duplicate' && (
                <button
                  type="button"
                  onClick={switchToLoginMode}
                  className="w-full btn-secondary px-3 py-2 text-xs font-bold"
                >
                  이미 계정이 있습니다. 로그인으로 전환
                </button>
              )}
              {authModalMode === 'change' && (
                <div className="relative">
                  <input
                    type={showCurrentPassword ? 'text' : 'password'}
                    value={authModalCurrentPassword}
                    onChange={(e) => setAuthModalCurrentPassword(e.target.value)}
                    placeholder="현재 비밀번호"
                    inputMode="numeric"
                    maxLength={4}
                    className="w-full bg-bg-main border border-border rounded-xl p-3 pr-11 text-sm"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPassword(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 btn-secondary p-1.5"
                    title={showCurrentPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                  >
                    {showCurrentPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              )}
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={authModalPassword}
                  onChange={(e) => setAuthModalPassword(e.target.value)}
                  placeholder={authModalMode === 'login' ? '비밀번호' : '새 비밀번호'}
                  inputMode="numeric"
                  maxLength={4}
                  className="w-full bg-bg-main border border-border rounded-xl p-3 pr-11 text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 btn-secondary p-1.5"
                  title={showNewPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                >
                  {showNewPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {(authModalMode === 'signup' || authModalMode === 'forgot' || authModalMode === 'change') && (
                <>
                  <div className="space-y-1">
                    <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                      <div className={cn("h-full transition-all", authModalPasswordStrength.color, authModalPasswordStrength.width)} />
                    </div>
                    <p className="text-xs text-text-secondary">비밀번호 강도: <span className="font-bold">{authModalPasswordStrength.label}</span></p>
                  </div>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={authModalPasswordConfirm}
                      onChange={(e) => setAuthModalPasswordConfirm(e.target.value)}
                      placeholder="비밀번호 확인"
                      inputMode="numeric"
                      maxLength={4}
                      className="w-full bg-bg-main border border-border rounded-xl p-3 pr-11 text-sm"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 btn-secondary p-1.5"
                      title={showConfirmPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                    >
                      {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </>
              )}
              {authModalMode === 'login' && (
                <div className="flex justify-end gap-3 text-xs">
                  <button type="button" onClick={() => setAuthModalMode('forgot')} className="text-accent font-bold hover:underline">
                    비밀번호 찾기
                  </button>
                  <button type="button" onClick={() => setAuthModalMode('change')} className="text-accent font-bold hover:underline">
                    비밀번호 변경
                  </button>
                </div>
              )}
              {authModalError && <p className="text-xs font-semibold text-danger">{authModalError}</p>}
              {authModalMode === 'signup' && (
                authModalError.toLowerCase().includes('email already exists') ||
                authModalError.includes('이미 사용 중인 이메일')
              ) && (
                <button
                  type="button"
                  onClick={switchToLoginMode}
                  className="w-full btn-secondary px-3 py-2 text-xs font-bold"
                >
                  이미 계정이 있습니다. 로그인으로 전환
                </button>
              )}
              <button type="submit" className="btn-primary w-full px-4 py-2.5 text-sm font-bold">
                {authModalMode === 'signup'
                  ? '회원가입'
                  : authModalMode === 'login'
                    ? '로그인'
                    : authModalMode === 'forgot'
                      ? '비밀번호 재설정'
                      : '비밀번호 변경'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Add Transaction Modal (Simplified) */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-bg-card rounded-3xl p-7 max-w-md w-full card-shadow border border-border"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-9 h-9 rounded-xl bg-accent text-white flex items-center justify-center shadow-md shadow-accent/30">
                <Plus size={16} />
              </div>
              <div>
                <h2 className="text-2xl font-extrabold text-text-primary tracking-tight">
                  {editingTransactionId ? '내역 수정' : (scannedData ? '추출 결과 확인' : '내역 추가')}
                </h2>
                <p className="text-xs text-text-secondary mt-0.5">거래 정보를 입력하고 저장하세요.</p>
              </div>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const data = {
                date: (formData.get('date') as string) || new Date().toISOString().split('T')[0],
                description: formData.get('desc') as string,
                amount: Number(formData.get('amount')),
                category: formData.get('cat') as string,
                type: formData.get('type') as 'income' | 'expense'
              };

              if (editingTransactionId) {
                setTransactions(prev => prev.map(t => 
                  t.id === editingTransactionId ? { ...t, ...data } : t
                ));
              } else {
                const newT: Transaction = {
                  id: Math.random().toString(36).substring(7),
                  ...data
                };
                setTransactions(prev => [...prev, newT]);
              }
              
              setIsModalOpen(false);
              setScannedData(null);
              setEditingTransactionId(null);
            }} className="space-y-5">
              {scannedData && !editingTransactionId && (
                <div className="bg-bg-main p-4 rounded-xl mb-2 flex items-center gap-3 border border-border">
                  <Sparkles className="text-accent w-4 h-4 shrink-0" />
                  <p className="text-[11px] font-bold text-accent uppercase tracking-wider">
                    AI 추출 완료
                  </p>
                </div>
              )}
              <div>
                <label className="block text-xs font-bold text-text-secondary mb-2 ml-1">설명</label>
                <input 
                  name="desc" 
                  required 
                  defaultValue={scannedData?.description}
                  className="w-full bg-bg-main border border-border rounded-xl p-3 text-sm font-medium focus:ring-2 focus:ring-accent/25 focus:border-accent outline-none transition-shadow" 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-2 ml-1">금액</label>
                  <input 
                    name="amount" 
                    type="number" 
                    required 
                    defaultValue={scannedData?.amount}
                    className="w-full bg-bg-main border border-border rounded-xl p-3 text-sm font-medium focus:ring-2 focus:ring-accent/25 focus:border-accent outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-2 ml-1">날짜</label>
                  <input 
                    name="date" 
                    type="date"
                    required 
                    defaultValue={scannedData?.date || new Date().toISOString().split('T')[0]}
                    className="w-full bg-bg-main border border-border rounded-xl p-3 text-sm font-medium focus:ring-2 focus:ring-accent/25 focus:border-accent outline-none" 
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-2 ml-1">카테고리</label>
                  <select 
                    name="cat" 
                    defaultValue={scannedData?.category || "식비"}
                    className="w-full bg-bg-main border border-border rounded-xl p-3 text-sm font-medium focus:ring-2 focus:ring-accent/25 focus:border-accent outline-none"
                  >
                    <optgroup label="지출">
                      <option>식비</option>
                      <option>교통</option>
                      <option>주거</option>
                      <option>쇼핑</option>
                      <option>생활</option>
                      <option>여가</option>
                    </optgroup>
                    <optgroup label="수입">
                      <option>급여</option>
                      <option>사업소득</option>
                      <option>금융소득</option>
                      <option>기타수입</option>
                    </optgroup>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-2 ml-1">분류</label>
                  <select 
                    name="type" 
                    defaultValue={scannedData?.type || "expense"}
                    className="w-full bg-bg-main border border-border rounded-xl p-3 text-sm font-medium focus:ring-2 focus:ring-accent/25 focus:border-accent outline-none"
                  >
                    <option value="expense">지출</option>
                    <option value="income">수입</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 mt-8">
                <button 
                  type="button" 
                  onClick={() => {
                    setIsModalOpen(false);
                    setScannedData(null);
                    setEditingTransactionId(null);
                  }} 
                  className="flex-1 py-3 text-text-secondary text-sm font-bold hover:bg-slate-100 rounded-xl transition-colors"
                >
                  취소
                </button>
                <button type="submit" className="flex-1 py-3 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg shadow-blue-500/30 hover:brightness-105 transition-all">
                  {editingTransactionId ? '수정완료' : '저장'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  title,
  value,
  icon,
  isPositive,
  description,
  className
}: {
  title: string,
  value: number,
  icon: React.ReactNode,
  isPositive?: boolean,
  description?: string,
  className?: string
}) {
  return (
      <div className={cn(
      "bg-bg-card p-6 rounded-2xl border border-border card-shadow transition-all group",
      className
    )}>
      <div className="flex items-center justify-between mb-5">
        <div className="p-2.5 bg-bg-main rounded-xl border border-border shadow-sm">
          {icon}
        </div>
        <div className={cn(
          "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider",
          isPositive ? "bg-success/10 text-success" : "bg-bg-main text-text-secondary"
        )}>
          {isPositive ? 'Income' : 'Spending'}
        </div>
      </div>
      <div>
        <p className="text-xs font-black text-text-secondary uppercase tracking-[0.18em] mb-2">{title}</p>
        <p className="text-3xl font-black tracking-tight text-text-primary tabular-nums">
          {formatCurrency(value)}
        </p>
        {description && (
          <p className="text-xs font-medium text-text-secondary/80 mt-3 border-t border-border pt-3 flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-border" />
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

function SettingsView({ 
  onClearAll, 
  onExportAllExcel,
  onExportFilteredExcel,
  onOpenAuthModal
}: { 
  onClearAll: () => void,
  onExportAllExcel: () => void,
  onExportFilteredExcel: () => void,
  onOpenAuthModal: (mode: AuthMode) => void
}) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-bg-card p-6 rounded-2xl border border-border card-shadow">
        <h2 className="text-lg font-black text-text-primary mb-6 tracking-tight">애플리케이션 설정</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="flex items-center justify-between p-5 bg-bg-main rounded-2xl border border-border group hover:border-accent/20 transition-colors">
            <div>
              <p className="text-xs font-black text-text-primary mb-1">데이터 초기화</p>
              <p className="text-[10px] text-text-secondary font-semibold">모든 내역과 AI 분석 데이터를 삭제합니다.</p>
            </div>
            <button 
              onClick={() => {
                if(window.confirm('정말로 모든 데이터를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) onClearAll();
              }}
              className="px-4 py-2 bg-red-50 text-red-600 rounded-xl text-[10px] font-black border border-red-100 hover:bg-red-100 transition-all active:scale-95"
            >
              전체 초기화
            </button>
          </div>
          
          <div className="flex items-center justify-between p-5 bg-bg-main rounded-2xl border border-border group hover:border-accent/20 transition-colors">
            <div>
              <p className="text-xs font-black text-text-primary mb-1">기본 통화 고정</p>
              <p className="text-[10px] text-text-secondary font-semibold">화면에 표시될 화폐 단위를 설정합니다.</p>
            </div>
            <select className="bg-bg-card border border-border rounded-xl px-3 py-1.5 text-[10px] font-black outline-none focus:ring-2 focus:ring-accent/20 transition-all cursor-pointer">
              <option value="KRW">KRW (₩)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </select>
          </div>

          <div className="flex items-center justify-between p-5 bg-bg-main rounded-2xl border border-border group hover:border-accent/20 transition-colors">
            <div>
              <p className="text-xs font-black text-text-primary mb-1">AI 분석 엔진</p>
              <p className="text-[10px] text-text-secondary font-semibold">분석에 사용될 AI 모델을 선택합니다.</p>
            </div>
            <span className="px-4 py-2 bg-accent/10 text-accent rounded-xl text-[9px] font-black uppercase tracking-widest border border-accent/10">
              Gemini 2.0
            </span>
          </div>

          <div className="flex items-center justify-between p-5 bg-bg-main rounded-2xl border border-border group hover:border-accent/20 transition-colors">
            <div>
              <p className="text-xs font-black text-text-primary mb-1">데이터 내보내기</p>
              <p className="text-[10px] text-text-secondary font-semibold">전체 데이터 또는 필터 결과를 엑셀로 저장합니다.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={onExportFilteredExcel} className="btn-secondary px-3 py-2 text-[10px] font-black">
                필터 내보내기
              </button>
              <button onClick={onExportAllExcel} className="btn-secondary px-3 py-2 text-[10px] font-black">
                전체 내보내기
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between p-5 bg-bg-main rounded-2xl border border-border group hover:border-accent/20 transition-colors">
            <div>
              <p className="text-xs font-black text-text-primary mb-1">계정 보안</p>
              <p className="text-[10px] text-text-secondary font-semibold">비밀번호 찾기와 비밀번호 변경을 관리합니다.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onOpenAuthModal('forgot')} className="btn-secondary px-3 py-2 text-[10px] font-black">
                비밀번호 찾기
              </button>
              <button onClick={() => onOpenAuthModal('change')} className="btn-secondary px-3 py-2 text-[10px] font-black">
                비밀번호 변경
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-bg-card p-6 rounded-2xl border border-border card-shadow">
        <h2 className="text-lg font-black text-text-primary mb-4 tracking-tight">정책 및 스토어 심사용 문서</h2>
        <p className="text-xs text-text-secondary mb-4">배포 시 Google Play 심사에 제출할 수 있는 공개 문서 링크입니다.</p>
        <div className="flex flex-wrap gap-2">
          <a href="/privacy-policy" target="_blank" rel="noreferrer" className="btn-secondary px-3 py-2 text-xs font-bold">
            개인정보처리방침
          </a>
          <a href="/account-deletion" target="_blank" rel="noreferrer" className="btn-secondary px-3 py-2 text-xs font-bold">
            계정 삭제 안내
          </a>
        </div>
      </div>
    </div>
  );
}
