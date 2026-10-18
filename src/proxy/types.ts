import type { Role, ConversationType, LLMClient } from "../core/schema.js";
import type { TargetFormat } from "../deliver/formatters/index.js";
import type { ConversationStore } from "../store/db.js";

export interface HandoffRequest {
  title?: string;
  source?: string;
  messages: Array<{ role: Role; content: string; id?: string; ts?: number }>;
  target?: TargetFormat;
  dryRun?: boolean;
}

export interface HandoffResponse {
  success: boolean;
  conversation_id: string;
  title: string;
  types: ConversationType[];
  target: TargetFormat;
  envelope: string;
  next_step: string;
  artifact_count: number;
  created_at: number;
}

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  finish_reason: "stop" | "length";
}

export interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ServerOptions {
  port?: number;
  host?: string;
  dbPath?: string;
  llm?: LLMClient;
  store?: ConversationStore;
}

export interface FailoverResult<T> {
  result: T;
  failoverOccurred: boolean;
  attempts: number;
}
