/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Type } from "@google/genai";
import { Transaction, AIInsight } from "../types";

const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY?.trim();
let missingApiKeyWarned = false;

function getAiClient(): GoogleGenAI | null {
  if (!geminiApiKey) {
    if (!missingApiKeyWarned) {
      console.warn("VITE_GEMINI_API_KEY is not set. AI features are disabled.");
      missingApiKeyWarned = true;
    }
    return null;
  }
  return new GoogleGenAI({ apiKey: geminiApiKey });
}

export async function getFinancialInsights(transactions: Transaction[]): Promise<AIInsight[]> {
  try {
    const ai = getAiClient();
    if (!ai) {
      return [{
        title: "AI 키 미설정",
        description: "`.env.local`에 VITE_GEMINI_API_KEY를 설정하면 AI 분석이 활성화됩니다.",
        type: "warning"
      }];
    }

    const transactionSummary = transactions.slice(0, 50).map(t => ({
      date: t.date,
      desc: t.description,
      amt: t.amount,
      cat: t.category,
      type: t.type
    }));

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `
        Analyze the following finance data and provide 3 smart, actionable insights in Korean.
        Each insight should have a title, description, and type ('saving_tip', 'warning', or 'positive').
        
        Data: ${JSON.stringify(transactionSummary)}
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              description: { type: Type.STRING },
              type: { 
                type: Type.STRING,
                enum: ['saving_tip', 'warning', 'positive']
              }
            },
            required: ['title', 'description', 'type']
          }
        }
      }
    });

    const text = response.text || "[]";
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini AI Insight Error:", error);
    return [{
      title: "AI 분석 가이드",
      description: "거래 내역이 더 쌓이면 AI가 지출 패턴을 분석해 드립니다.",
      type: "positive"
    }];
  }
}

export async function extractTransactionFromReceipt(base64Image: string, mimeType: string): Promise<Partial<Transaction> | null> {
  try {
    const ai = getAiClient();
    if (!ai) {
      return null;
    }

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          inlineData: {
            data: base64Image,
            mimeType: mimeType
          }
        },
        {
          text: `
            Analyze this receipt image and extract the following information in JSON format:
            - description: The name of the store or service.
            - amount: The total amount paid (numeric).
            - category: Categorize this expense (e.g., 식비, 교통, 주거, 쇼핑, 생활, 여가).
            - date: The date of the transaction (YYYY-MM-DD). If not found, use today's date.
            
            Return ONLY the JSON object.
          `
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            description: { type: Type.STRING },
            amount: { type: Type.NUMBER },
            category: { type: Type.STRING },
            date: { type: Type.STRING }
          },
          required: ['description', 'amount', 'category', 'date']
        }
      }
    });

    const text = response.text || "null";
    return JSON.parse(text);
  } catch (error) {
    console.error("Gemini Receipt Extraction Error:", error);
    return null;
  }
}
