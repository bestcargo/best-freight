/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  TrendingUp, 
  TrendingDown, 
  Wallet, 
  PieChart as PieChartIcon, 
  Plus, 
  History,
  Sparkles,
  ChevronRight,
  Coins,
  Camera,
  Loader2,
  Settings,
  Edit2,
  Download
} from 'lucide-react';
import * as XLSX from 'xlsx';
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
import { cn, formatCurrency, formatNumberWithCommas } from './utils';
import { Transaction, AIInsight } from '../types';
import { getFinancialInsights, extractTransactionFromReceipt } from '../gemini';
import { useAuth } from '../contexts/AuthContext';
import { db, auth, handleFirestoreError } from '../lib/firebase';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  orderBy,
  setDoc,
  serverTimestamp
} from 'firebase/firestore';
import { updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';

// Mock data
const INITIAL_TRANSACTIONS: Transaction[] = [];

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export default function Dashboard() {
  const { user, logout: firebaseLogout } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(true);
  const [currentTab, setCurrentTab] = useState<'dashboard' | 'assets' | 'expenses' | 'income' | 'settings'>('dashboard');
  const [insights, setInsights] = useState<AIInsight[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scannedData, setScannedData] = useState<Partial<Transaction> | null>(null);
  const [editingTransactionId, setEditingTransactionId] = useState<string | null>(null);
  const [filterPeriod, setFilterPeriod] = useState<'all' | 'day' | 'week' | 'month' | 'year' | 'custom'>('all');
  const [filterStartDate, setFilterStartDate] = useState(format(subMonths(new Date(), 1), 'yyyy-MM-dd'));
  const [filterEndDate, setFilterEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync transactions with Firestore
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'transactions'),
      where('userId', '==', user.uid),
      orderBy('date', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Transaction[];
      setTransactions(data);
      setLoadingTransactions(false);
    }, (error) => {
      handleFirestoreError(error, 'list', 'transactions');
      setLoadingTransactions(false);
    });

    return () => unsubscribe();
  }, [user]);

  // Save transactions to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('finflow_transactions', JSON.stringify(transactions));
  }, [transactions]);

  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Filtered transactions
  const timeFilteredTransactions = useMemo(() => {
    if (filterPeriod === 'all') return transactions;

    const now = new Date();
    let start: Date, end: Date;

    switch (filterPeriod) {
      case 'custom':
        start = startOfDay(parseISO(filterStartDate));
        end = endOfDay(parseISO(filterEndDate));
        break;
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
        return transactions;
    }

    return transactions.filter(t => {
      const tDate = parseISO(t.date);
      return isWithinInterval(tDate, { start, end });
    });
  }, [transactions, filterPeriod, filterStartDate, filterEndDate]);

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

  const fetchAIInsights = async () => {
    setLoadingInsights(true);
    const newInsights = await getFinancialInsights(transactions);
    setInsights(newInsights);
    setLoadingInsights(false);
  };

  const handleReceiptScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsScanning(true);
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64String = (reader.result as string).split(',')[1];
        const result = await extractTransactionFromReceipt(base64String, file.type);
        if (result) {
          setScannedData(result);
          if (result.amount) {
            setAmountInput(formatNumberWithCommas(result.amount));
          } else {
            setAmountInput('');
          }
          setIsModalOpen(true);
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Scan failed:", error);
    } finally {
      setIsScanning(false);
      if (e.target) e.target.value = ''; // Reset input to allow same file selection
    }
  };

  const handleClearAll = () => {
    setTransactions([]);
    setInsights([]);
  };

  const exportToExcel = () => {
    if (transactions.length === 0) {
      alert('내보낼 데이터가 없습니다.');
      return;
    }

    const exportData = transactions.map(t => ({
      '일자': t.date,
      '구분': t.type === 'income' ? '수입' : '지출',
      '카테고리': t.category,
      '항목명': t.description,
      '금액': t.amount
    }));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "내역");

    // 컬럼 너비 조정
    const wscols = [
      {wch: 15},
      {wch: 10},
      {wch: 15},
      {wch: 30},
      {wch: 15}
    ];
    worksheet['!cols'] = wscols;

    XLSX.writeFile(workbook, `베스트전국화물_내역_${format(new Date(), 'yyyyMMdd')}.xlsx`);
  };

  useEffect(() => {
    fetchAIInsights();
  }, [transactions]);

  return (
    <div className="min-h-screen bg-bg-main text-text-primary font-sans selection:bg-blue-100">
      {/* Top Navigation Header */}
      <header className="bg-slate-900 sticky top-0 z-40 border-b border-slate-800 relative overflow-hidden">
        {/* Top vibrant accent */}
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-accent-purple via-primary to-accent-cyan" />
        
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between relative z-10">
          <div className="flex items-center gap-8">
            {/* Logo */}
            <div className="flex flex-col">
              <h1 className="text-lg font-black tracking-tighter text-white flex items-center gap-1 group cursor-default leading-tight">
                베스트전국화물<span className="text-slate-500 group-hover:text-primary transition-colors">.</span>
              </h1>
              <p className="text-[9px] font-medium text-slate-500 uppercase tracking-widest leading-none">Financial Logistics</p>
            </div>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-1">
              {[
                { id: 'dashboard', label: '대시보드', icon: <PieChartIcon size={16} /> },
                { id: 'assets', label: '자산현황', icon: <Wallet size={16} /> },
                { id: 'expenses', label: '지출분석', icon: <TrendingDown size={16} /> },
                { id: 'income', label: '수입내역', icon: <TrendingUp size={16} /> },
                { id: 'settings', label: '환경설정', icon: <Settings size={16} /> },
              ].map((item) => (
                <button
                  key={item.id}
                  onClick={() => setCurrentTab(item.id as any)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all transition-colors",
                    currentTab === item.id
                      ? "bg-slate-800 text-white shadow-lg border border-slate-700" 
                      : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                  )}
                >
                  <span className={cn(
                    "transition-colors",
                    currentTab === item.id ? "text-primary" : "text-slate-500"
                  )}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="flex items-center gap-4">
            {/* Action Buttons (Merged from the secondary header) */}
            <div className="hidden sm:flex items-center gap-2 pr-4 border-r border-slate-800">
              <button 
                onClick={() => {
                  setEditingTransactionId(null);
                  setScannedData(null);
                  setAmountInput('');
                  setSaveError(null);
                  setIsModalOpen(true);
                }}
                className="bg-primary hover:bg-primary-hover text-white px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all transform active:scale-95 text-[11px] font-bold shadow-sm"
              >
                <Plus size={14} />
                등록
              </button>

              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isScanning}
                className="bg-slate-800 border border-slate-700 hover:bg-slate-700 text-white px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all transform active:scale-95 disabled:opacity-50 text-[11px] font-bold shadow-sm"
              >
                {isScanning ? (
                  <Loader2 size={14} className="animate-spin text-primary" />
                ) : (
                  <Camera size={14} className="text-primary" />
                )}
                <span>스캔</span>
              </button>
              
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleReceiptScan} 
                accept="image/*" 
                className="hidden" 
              />
            </div>

            {/* Profile Dropdown (Simplified) */}
            <div className="flex items-center gap-3">
              <div className="hidden lg:flex flex-col items-end">
                <span className="text-xs font-bold text-white leading-tight">{user?.displayName || '김철기'}</span>
                <span className="text-[9px] font-medium text-slate-500">Premium</span>
              </div>
              <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center border border-primary/20 shadow-inner">
                <span className="text-[10px] font-bold text-primary">{user?.displayName?.[0] || '김'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Mobile Nav (Horizontal Scroll) */}
        <div className="md:hidden flex items-center gap-1 px-4 py-2 bg-slate-900 border-t border-slate-800 overflow-x-auto no-scrollbar">
          {[
            { id: 'dashboard', label: '대시보드' },
            { id: 'assets', label: '자산' },
            { id: 'expenses', label: '지출' },
            { id: 'income', label: '수입' },
            { id: 'settings', label: '환경설정' },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id as any)}
              className={cn(
                "whitespace-nowrap px-3 py-1 rounded-full text-[11px] font-bold transition-all",
                currentTab === item.id 
                  ? "bg-slate-800 text-white border border-slate-700" 
                  : "text-slate-500 hover:text-white"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <main className="flex-1 flex flex-col min-w-0">
        {/* Action Title Bar (Simplified Header) */}
        <div className="bg-white border-b border-slate-500 h-14 flex items-center px-4 md:px-8">
          <div className="max-w-7xl mx-auto w-full flex justify-between items-center">
            <h1 className="text-lg font-bold text-text-main tracking-tight">
              {currentTab === 'dashboard' && '대시보드'}
              {currentTab === 'assets' && '자산현황'}
              {currentTab === 'expenses' && '지출분석'}
              {currentTab === 'income' && '수입내역'}
              {currentTab === 'settings' && '환경설정'}
            </h1>

            <div className="flex items-center gap-2">
              <button 
                onClick={exportToExcel}
                className="bg-white border border-slate-500 hover:bg-slate-50 text-text-main px-3 py-1.5 rounded-lg flex items-center gap-2 transition-all transform active:scale-95 text-[11px] font-bold shadow-sm"
              >
                <Download size={14} className="text-primary" />
                <span>엑셀 저장</span>
              </button>
            </div>
          </div>
        </div>

        <section className="max-w-7xl w-full mx-auto p-4 md:p-8 space-y-6">
          {currentTab === 'settings' ? (
            <SettingsView 
              onChangePassword={() => setIsPasswordModalOpen(true)}
              onLogoutAccount={firebaseLogout}
            />
          ) : (
            <>
              {currentTab === 'dashboard' && (
                <div className="space-y-6">
                </div>
              )}
              {/* Filter Toolbar & Stats Grid */}
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex bg-white p-1 rounded-lg border border-slate-500 shadow-sm">
                      {[
                        { label: '전체', value: 'all' },
                        { label: '오늘', value: 'day' },
                        { label: '1주일', value: 'week' },
                        { label: '1개월', value: 'month' },
                        { label: '1년', value: 'year' },
                        { label: '직접선택', value: 'custom' },
                      ].map((item) => (
                        <button
                          key={item.value}
                          onClick={() => setFilterPeriod(item.value as any)}
                          className={cn(
                            "px-4 py-1.5 rounded-md text-[11px] font-bold transition-all",
                            filterPeriod === item.value 
                              ? "bg-slate-100 text-text-main" 
                              : "text-text-muted hover:text-text-main hover:bg-slate-50"
                          )}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>

                    {filterPeriod === 'custom' && (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-500 shadow-sm"
                      >
                        <input 
                          type="date" 
                          value={filterStartDate}
                          onChange={(e) => setFilterStartDate(e.target.value)}
                          className="bg-transparent text-[11px] font-bold px-2 py-0.5 outline-none"
                        />
                        <span className="text-slate-300 text-[11px]">~</span>
                        <input 
                          type="date" 
                          value={filterEndDate}
                          onChange={(e) => setFilterEndDate(e.target.value)}
                          className="bg-transparent text-[11px] font-bold px-2 py-0.5 outline-none"
                        />
                      </motion.div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-text-muted">전체보기</span>
                    <ChevronRight size={14} className="text-text-muted" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <StatCard 
                    title="현재 총 자산" 
                    value={stats.balance} 
                    icon={<Wallet size={20} />} 
                    accentColor="purple"
                    description="현재 보유 중인 순자산 합계"
                  />
                  <StatCard 
                    title="기간 내 수입" 
                    value={stats.income} 
                    icon={<TrendingUp size={20} />} 
                    isPositive
                    accentColor="success"
                    description="선택한 기간 동안의 총 소득"
                  />
                  <StatCard 
                    title="기간 내 지출" 
                    value={stats.expense} 
                    icon={<TrendingDown size={20} />} 
                    accentColor="danger"
                    description="선택한 기간 동안의 총 소비"
                  />
                </div>
              </div>

              <div className={cn(
                "grid grid-cols-1 gap-8",
                currentTab === 'dashboard' ? "lg:grid-cols-3" : "lg:grid-cols-1"
              )}>
                
                {/* Main Content (Chart or List) */}
                <div className={cn(
                  "bg-white rounded-xl p-6 border border-slate-500 shadow-sm",
                  currentTab === 'dashboard' ? "lg:col-span-2" : ""
                )}>
                  <div className="flex justify-between items-center mb-10">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h2 className="text-lg font-bold text-text-main tracking-tight">
                          {currentTab === 'dashboard' && '수입 및 지출 추이'}
                          {currentTab === 'assets' && '자산 변동 흐름'}
                          {currentTab === 'expenses' && '지출 상세 내역'}
                          {currentTab === 'income' && '수입 상세 내역'}
                        </h2>
                        <ChevronRight size={18} className="text-text-muted cursor-pointer hover:text-text-main transition-colors" />
                      </div>
                      <p className="text-[11px] text-text-muted font-medium">
                        {currentTab === 'dashboard' && '시간 흐름에 따른 자산 변동 그래프'}
                        {currentTab === 'assets' && '일자별 자산 증감 현황'}
                        {currentTab === 'expenses' && '지출 항목에 대한 상세 기록입니다.'}
                        {currentTab === 'income' && '수입 항목에 대한 상세 기록입니다.'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] font-bold text-text-muted cursor-pointer hover:text-text-main">
                      <span>전체보기</span>
                      <ChevronRight size={14} />
                    </div>
                  </div>
                  {(currentTab === 'dashboard' || currentTab === 'assets') && (
                    <div className="h-[280px] mb-8">
                      {hasData ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={trendData}>
                            <defs>
                              <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                              </linearGradient>
                              <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15}/>
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis 
                              dataKey="date" 
                              axisLine={false} 
                              tickLine={false} 
                              tick={{fill: '#64748b', fontSize: 11, fontWeight: 500}}
                              tickFormatter={(str) => format(new Date(str), 'MM/dd')}
                              dy={10}
                            />
                            <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 11, fontWeight: 500}} dx={-10} />
                            <Tooltip 
                              contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '11px', fontWeight: 700}}
                              formatter={(val: number) => [formatCurrency(val), '']}
                            />
                            <Area type="monotone" dataKey="income" stroke="#10b981" fillOpacity={1} fill="url(#colorIncome)" strokeWidth={3} />
                            <Area type="monotone" dataKey="expense" stroke="#ef4444" fillOpacity={1} fill="url(#colorExpense)" strokeWidth={3} />
                          </AreaChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center text-text-secondary bg-slate-50 rounded-xl border border-dashed border-border">
                          <p className="text-sm font-medium">조회 기간 내 데이터가 없습니다.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Transactions List */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-bg-main border-y border-slate-500 text-[11px] font-bold text-text-muted">
                          <th className="px-4 py-3">일자</th>
                          <th className="px-4 py-3">카테고리</th>
                          <th className="px-4 py-3">항목명</th>
                          <th className="px-4 py-3 text-right">금액</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {displayTransactions.length > 0 ? displayTransactions.slice().reverse().map(t => (
                          <tr key={t.id} className="group hover:bg-slate-50 transition-all cursor-pointer">
                            <td className="px-4 py-4 text-[12px] text-text-muted font-medium">{format(new Date(t.date), 'MM월 dd일')}</td>
                            <td className="px-4 py-4">
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-bg-main border border-border-light text-text-muted">
                                {t.category}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-[13px] font-bold text-text-main">{t.description}</td>
                            <td className={cn(
                              "px-4 py-4 text-[13px] font-bold text-right",
                              t.type === 'income' ? "text-primary" : "text-text-main"
                            )}>
                              <div className="flex items-center justify-end gap-3 group-hover:translate-x-0 transition-transform">
                                <span>{t.type === 'income' ? '+' : '-'} {formatCurrency(t.amount)}</span>
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingTransactionId(t.id);
                                    setScannedData({...t});
                                    setAmountInput(formatNumberWithCommas(t.amount));
                                    setIsModalOpen(true);
                                  }}
                                  className="p-1.5 text-text-muted hover:text-primary opacity-0 group-hover:opacity-100 transition-all"
                                  title="내역 수정"
                                >
                                  <Edit2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={4} className="py-20 text-center text-text-muted text-[13px] font-medium italic">
                              조회된 내역이 없습니다.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* AI Insights & Breakdown (Displayed only on dashboard) */}
                {currentTab === 'dashboard' && (
                  <div className="space-y-8">
                    {/* Category Breakdown */}
                    <div className="bg-white rounded-xl p-6 border border-slate-500 shadow-sm flex flex-col">
                      <div className="flex items-center justify-between mb-6">
                        <h2 className="text-lg font-bold text-text-main tracking-tight">카테고리별 비중</h2>
                      </div>
                      <div className="h-[240px] relative mt-auto">
                        {categoryData.length > 0 ? (
                          <>
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={categoryData}
                                  innerRadius={70}
                                  outerRadius={95}
                                  paddingAngle={8}
                                  dataKey="value"
                                  stroke="none"
                                >
                                  {categoryData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                  ))}
                                </Pie>
                                <Tooltip 
                                  contentStyle={{borderRadius: '8px', border: '1px solid #eef1f6', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.05)', fontSize: '12px', fontWeight: 600}}
                                  formatter={(val: number) => formatCurrency(val)} 
                                />
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
                              <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider">지출 합계</p>
                              <p className="text-lg font-bold text-text-main mt-0.5">{formatCurrency(stats.expense)}</p>
                            </div>
                          </>
                        ) : (
                          <div className="h-full flex items-center justify-center text-text-muted italic text-[13px] font-medium">
                            데이터가 없습니다.
                          </div>
                        )}
                      </div>
                    </div>

                    {/* AI Insights Side Panel */}
                    <div className="bg-white rounded-xl p-6 border border-slate-500 shadow-sm flex flex-col">
                      <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-bold text-text-main tracking-tight flex items-center gap-2">
                          <Sparkles className="w-5 h-5 text-primary" />
                          AI 분석 리포트
                        </h2>
                        {loadingInsights && <Loader2 size={16} className="animate-spin text-primary" />}
                      </div>
                      <div className="space-y-4 flex-1 overflow-y-auto pr-2 custom-scrollbar">
                        <AnimatePresence mode="wait">
                          {insights.length > 0 ? insights.map((insight, idx) => (
                            <motion.div
                              key={idx}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              className="p-4 rounded-xl border border-border-light bg-bg-main hover:bg-white transition-all group"
                            >
                              <div className="flex items-center gap-2 mb-2">
                                <h3 className="font-bold text-[12px] text-text-main">{insight.title}</h3>
                              </div>
                              <p className="text-[11px] text-text-muted leading-relaxed font-medium">{insight.description}</p>
                            </motion.div>
                          )) : (
                            <div className="h-full flex flex-col items-center justify-center text-text-muted text-center p-4">
                              <Sparkles className="w-8 h-8 opacity-20 mb-3" />
                              <p className="text-[11px] font-medium">거래 데이터가 부족하여<br/>분석을 생성할 수 없습니다.</p>
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

      {/* Password Change Modal */}
      {isPasswordModalOpen && (
        <PasswordChangeModal onClose={() => setIsPasswordModalOpen(false)} />
      )}
      
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            className="bg-white rounded-xl p-8 max-w-md w-full shadow-2xl border border-border-light"
          >
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-xl font-bold text-text-main">
                {editingTransactionId ? '내역 수정' : (scannedData ? '추출 결과 확인' : '등록하기')}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-text-muted hover:text-text-main">
                <ChevronRight size={20} className="rotate-90" />
              </button>
            </div>
            
            <form onSubmit={async (e) => {
              e.preventDefault();
              setSaveError(null);
              const formData = new FormData(e.currentTarget);
              const amountRaw = formData.get('amount') as string;
              const amountNum = Number(amountRaw.replace(/[^0-9]/g, ''));
              
              const data = {
                date: (formData.get('date') as string) || new Date().toISOString().split('T')[0],
                description: formData.get('desc') as string,
                amount: amountNum,
                category: formData.get('cat') as string,
                type: formData.get('type') as 'income' | 'expense'
              };

              try {
                if (editingTransactionId) {
                  const updatedData = { ...data };
                  await updateDoc(doc(db, 'transactions', editingTransactionId), updatedData);
                } else {
                  if (!user?.uid) {
                    setSaveError('로그인 정보가 없습니다. 다시 로그인 후 시도해주세요.');
                    return;
                  }
                  const newT = {
                    ...data,
                    userId: user.uid,
                    createdAt: serverTimestamp()
                  };
                  await addDoc(collection(db, 'transactions'), newT);
                }

                setIsModalOpen(false);
                setScannedData(null);
                setEditingTransactionId(null);
                setSaveError(null);
              } catch (err: any) {
                console.error('Transaction save failed:', err);
                if (err?.code === 'permission-denied') {
                  setSaveError('저장 권한이 없습니다. Firestore 규칙/로그인 상태를 확인해주세요.');
                } else {
                  setSaveError('저장에 실패했습니다. 네트워크 또는 Firebase 설정을 확인해주세요.');
                }
              }
            }} className="space-y-6">
              {saveError && (
                <div className="p-3 bg-red-50 text-red-600 text-[11px] font-bold rounded-lg border border-red-100">
                  {saveError}
                </div>
              )}
              {scannedData && !editingTransactionId && (
                <div className="bg-primary/5 p-4 rounded-lg mb-2 flex items-center gap-3 border border-primary/10">
                  <Sparkles className="text-primary w-4 h-4 shrink-0" />
                  <p className="text-[11px] font-bold text-primary">AI가 영수증 정보를 추출했습니다.</p>
                </div>
              )}
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-bold text-text-muted mb-1.5 ml-0.5">상세 내용</label>
                  <input 
                    name="desc" 
                    required 
                    defaultValue={scannedData?.description}
                    placeholder="지출 및 수입 내용을 입력하세요"
                    className="w-full bg-bg-main border border-slate-500 rounded-lg p-3 text-sm font-medium focus:ring-1 focus:ring-primary outline-none transition-all" 
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-text-muted mb-1.5 ml-0.5">금액</label>
                    <input 
                      name="amount" 
                      type="text" 
                      inputMode="numeric"
                      pattern="[0-9,]*"
                      required 
                      value={amountInput}
                      onChange={(e) => {
                        const onlyDigits = e.target.value.replace(/[^0-9]/g, '');
                        setAmountInput(onlyDigits ? formatNumberWithCommas(onlyDigits) : '');
                      }}
                      placeholder="0"
                      className="w-full bg-bg-main border border-slate-500 rounded-lg p-3 text-sm font-medium focus:ring-1 focus:ring-primary outline-none" 
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-text-muted mb-1.5 ml-0.5">날짜</label>
                    <input 
                      name="date" 
                      type="date"
                      required 
                      defaultValue={scannedData?.date || new Date().toISOString().split('T')[0]}
                      className="w-full bg-bg-main border border-slate-500 rounded-lg p-3 text-sm font-medium focus:ring-1 focus:ring-primary outline-none" 
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-text-muted mb-1.5 ml-0.5">카테고리</label>
                    <select 
                      name="cat" 
                      defaultValue={scannedData?.category || "식비"}
                      className="w-full bg-bg-main border border-slate-500 rounded-lg p-3 text-sm font-medium focus:ring-1 focus:ring-primary outline-none"
                    >
                      <optgroup label="지출">
                        <option>식비</option>
                        <option>교통</option>
                        <option>주거</option>
                        <option>쇼핑</option>
                        <option>생활</option>
                        <option>여가</option>
                        <option>교육비</option>
                        <option>투자비</option>
                        <option>기사운임비</option>
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
                    <label className="block text-[11px] font-bold text-text-muted mb-1.5 ml-0.5">분류</label>
                    <select 
                      name="type" 
                      defaultValue={scannedData?.type || "expense"}
                      className="w-full bg-bg-main border border-border-light rounded-lg p-3 text-sm font-medium focus:ring-1 focus:ring-primary outline-none text-text-main"
                    >
                      <option value="expense">지출</option>
                      <option value="income">수입</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)} 
                  className="flex-1 py-3 bg-white border border-border-light text-text-main text-[13px] font-bold rounded-lg hover:bg-slate-50 transition-colors"
                >
                  취소
                </button>
                <button type="submit" className="flex-1 py-3 bg-primary text-white rounded-lg text-[13px] font-bold shadow-md hover:bg-primary-hover transition-colors">
                  {editingTransactionId ? '수정 완료' : '내역 저장'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
        </section>
      </main>
    </div>
  );
}

function StatCard({ 
  title, 
  value, 
  icon, 
  isPositive, 
  description,
  accentColor = "primary"
}: { 
  title: string, 
  value: number, 
  icon: React.ReactNode, 
  isPositive?: boolean, 
  description?: string,
  accentColor?: "primary" | "success" | "danger" | "warning" | "purple" | "pink" | "cyan"
}) {
  const colorMap = {
    primary: "border-primary bg-primary/5 text-primary",
    success: "border-success bg-success/5 text-success",
    danger: "border-danger bg-danger/5 text-danger",
    warning: "border-warning bg-warning/5 text-warning",
    purple: "border-accent-purple bg-accent-purple/5 text-accent-purple",
    pink: "border-accent-pink bg-accent-pink/5 text-accent-pink",
    cyan: "border-accent-cyan bg-accent-cyan/5 text-accent-cyan",
  };

  return (
    <div className={cn(
      "bg-white p-6 rounded-2xl border-2 border-slate-500 card-shadow transition-all group relative overflow-hidden",
      "hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:-translate-y-0.5"
    )}>
      <div className={cn(
        "absolute -top-12 -right-12 w-24 h-24 blur-3xl opacity-10 transition-opacity group-hover:opacity-20",
        accentColor === 'primary' && "bg-primary",
        accentColor === 'success' && "bg-success",
        accentColor === 'danger' && "bg-danger",
        accentColor === 'warning' && "bg-warning",
        accentColor === 'purple' && "bg-accent-purple",
        accentColor === 'pink' && "bg-accent-pink",
        accentColor === 'cyan' && "bg-accent-cyan",
      )} />

      <div className="flex items-center justify-between mb-5">
        <div className={cn(
          "p-2.5 rounded-xl border border-slate-500 transition-colors",
          colorMap[accentColor]
        )}>
          {icon}
        </div>
        <div className={cn(
          "px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider",
          isPositive ? "bg-success/10 text-success" : "bg-danger/10 text-danger"
        )}>
          {isPositive ? 'Income' : 'Spending'}
        </div>
      </div>
      <div>
        <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider mb-1.5">{title}</p>
        <p className="text-xl font-black tracking-tight text-text-main">{formatCurrency(value)}</p>
        {description && (
          <p className="text-[10px] font-bold text-slate-400 mt-4 border-t border-slate-100 pt-4 flex items-center gap-2">
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              accentColor === 'success' ? "bg-success" : (accentColor === 'danger' ? "bg-danger" : "bg-slate-300")
            )} />
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

function PasswordChangeModal({ onClose }: { onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error('로그인이 필요합니다.');

      // Re-authenticate user
      const credential = EmailAuthProvider.credential(user.email, currentPassword);
      await reauthenticateWithCredential(user, credential);

      // Update password
      await updatePassword(user, newPassword);
      alert('비밀번호가 성공적으로 변경되었습니다.');
      onClose();
    } catch (err: any) {
      console.error('Password update error:', err);
      let msg = '비밀번호 변경에 실패했습니다.';
      if (err.code === 'auth/wrong-password') msg = '현재 비밀번호가 올바르지 않습니다.';
      if (err.code === 'auth/weak-password') msg = '새 비밀번호는 6자리 이상이어야 합니다.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[60] flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="bg-white rounded-xl p-8 max-w-sm w-full shadow-2xl border border-border-light"
      >
        <h2 className="text-xl font-black text-text-primary mb-6">비밀번호 변경</h2>
        <form onSubmit={handleUpdate} className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-[11px] font-bold rounded-lg border border-red-100">
              {error}
            </div>
          )}
          <div>
            <label className="block text-[11px] font-bold text-text-secondary mb-1.5 px-1">현재 비밀번호</label>
            <input 
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full bg-slate-50 border border-border-light rounded-lg p-3 text-sm focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-text-secondary mb-1.5 px-1">새 비밀번호</label>
            <input 
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full bg-slate-50 border border-border-light rounded-lg p-3 text-sm focus:ring-1 focus:ring-primary outline-none"
            />
          </div>
          <div className="flex gap-2 mt-6">
            <button 
              type="button" 
              onClick={onClose}
              className="flex-1 py-3 bg-slate-100 text-text-primary rounded-xl text-xs font-black hover:bg-slate-200 transition-all"
            >
              취소
            </button>
            <button 
              type="submit"
              disabled={loading}
              className="flex-1 py-3 bg-primary text-white rounded-xl text-xs font-black shadow-lg shadow-primary/20 hover:bg-primary-hover transition-all flex items-center justify-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : '변경하기'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function SettingsView({ 
  onChangePassword,
  onLogoutAccount
}: { 
  onChangePassword: () => void,
  onLogoutAccount: () => void
}) {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onChangePassword}
          className="px-4 py-2 bg-white border border-border-light text-text-primary rounded-xl text-[11px] font-black hover:bg-slate-50 transition-all shadow-sm"
        >
          비밀번호 변경
        </button>
        <button
          onClick={onLogoutAccount}
          className="px-4 py-2 bg-red-50 text-red-600 border border-red-100 rounded-xl text-[11px] font-black hover:bg-red-100 transition-all"
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}
