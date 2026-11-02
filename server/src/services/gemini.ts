import { config } from '../config.js';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  return cleaned.trim();
}

export function parseJsonFromLlm<T = any>(content: string): T {
  const stripped = stripCodeFences(content);
  try {
    return JSON.parse(stripped);
  } catch {
    // Try to locate JSON object between braces
    const firstBrace = stripped.indexOf('{');
    const lastBrace = stripped.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const sub = stripped.substring(firstBrace, lastBrace + 1);
      return JSON.parse(sub);
    }
    throw new Error('Failed to parse valid JSON from LLM response.');
  }
}

export async function generateGeminiCompletion(
  prompt: string,
  options: {
    temperature?: number;
    maxTokens?: number;
    responseJson?: boolean;
    systemInstruction?: string;
  } = {}
): Promise<string> {
  const apiKey = config.geminiApiKey;
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Please add GEMINI_API_KEY in .env.');
  }

  const model = config.geminiModel || 'gemini-3.8-flash';
  const temperature = options.temperature ?? 0.25;

  // Approach 1: Direct Google Generative Language REST API
  const directUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const requestBody: any = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens: options.maxTokens ?? 2048,
    },
  };

  if (options.systemInstruction) {
    requestBody.systemInstruction = {
      parts: [{ text: options.systemInstruction }],
    };
  }

  if (options.responseJson) {
    requestBody.generationConfig.responseMimeType = 'application/json';
  }

  try {
    const res = await fetch(directUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (res.ok) {
      const data = (await res.json()) as any;
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        return text;
      }
    }

    // If direct endpoint failed, let's try OpenAI-compatible endpoint
    const errorText = await res.text();
    console.warn(`Direct Gemini API returned ${res.status}: ${errorText}. Trying OpenAI compatible endpoint...`);
  } catch (err) {
    console.warn('Direct Gemini API request error, attempting fallback endpoint:', err);
  }

  // Approach 2: OpenAI-compatible endpoint
  const openAiUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
  const openAiBody = {
    model,
    messages: [
      ...(options.systemInstruction ? [{ role: 'system', content: options.systemInstruction }] : []),
      { role: 'user', content: prompt },
    ],
    temperature,
    max_tokens: options.maxTokens ?? 2048,
  };

  const openAiRes = await fetch(openAiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(openAiBody),
  });

  if (!openAiRes.ok) {
    const errPayload = await openAiRes.text();
    throw new Error(`Gemini API call failed (${openAiRes.status}): ${errPayload}`);
  }

  const openAiData = (await openAiRes.json()) as any;
  const reply = openAiData?.choices?.[0]?.message?.content;
  if (!reply) {
    throw new Error('Gemini API returned an empty completion.');
  }

  return reply;
}
