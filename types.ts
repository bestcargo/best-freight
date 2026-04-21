/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  type: 'income' | 'expense';
}

export interface Budget {
  category: string;
  limit: number;
  spent: number;
}

export interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  netSavings: number;
  monthlyTrends: Array<{
    month: string;
    income: number;
    expenses: number;
  }>;
  spendingByCategory: Array<{
    category: string;
    amount: number;
  }>;
}

export interface AIInsight {
  title: string;
  description: string;
  type: 'saving_tip' | 'warning' | 'positive';
}
