import "server-only";
import OpenAI from "openai";
import { setDefaultOpenAIClient, setOpenAIAPI } from "@openai/agents";

export interface LiveLlmConfig {
  actorModel: string;
  supervisorModel: string;
}

/**
 * Configures only the server-side Agents SDK. Agent modules receive model names,
 * never API keys, base URLs, clients, or arbitrary network capabilities.
 */
export function configureLiveLlm(): LiveLlmConfig {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required in Live mode");

  const baseURL = process.env.OPENAI_BASE_URL?.trim();
  setDefaultOpenAIClient(new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  }));
  setOpenAIAPI("chat_completions");

  return {
    actorModel: process.env.OPENAI_MODEL_ACTOR?.trim() || "gpt-4.1-mini",
    supervisorModel: process.env.OPENAI_MODEL_SUPERVISOR?.trim() || "gpt-4.1-mini",
  };
}
