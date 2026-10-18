/**
 * Canonical Schema for the Cross-Provider LLM Continuity Layer.
 */

export type Role = "user" | "assistant" | "tool" | "unknown";
export type ConversationType = "coding" | "debugging" | "research" | "learning" | "general";
export type LLMTask = "classify" | "chunk_summary" | "merge_notes" | "capsule" | "eval_reply" | "eval_judge";

export interface Message {
  role: Role;
  content: string;
  id?: string | null;
  ts?: number | null;
}

export interface Conversation {
  id: string;
  source: string;
  title: string;
  messages: Message[];
  created_at?: number | null;
  updated_at?: number | null;
  meta: Record<string, unknown>;
}

export interface Artifact {
  lang: string;
  code: string;
  message_index: number;
  role: Role;
  label?: string | null; // e.g. extracted file path "app/services/x.py"
  sha256?: string;
}

export interface Capsule {
  conversation_id: string;
  title: string;
  source: string;
  types: ConversationType[];
  sections: Record<string, string>; // Ordered section title -> markdown body
  next_step: string;
  recent_turns: Message[];
  artifacts: Artifact[];
  created_at: number;
  meta: Record<string, unknown>;
}

export interface LLMClient {
  readonly name: string;
  complete(
    system: string,
    prompt: string,
    options?: { maxTokens?: number; task?: LLMTask }
  ): Promise<string>;
}

/**
 * Raw ChatGPT Export Node Schemas (Gotcha #1, #2, #3)
 */
export interface ChatGPTNodeAuthor {
  role: string;
  name?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ChatGPTNodeContent {
  content_type?: string;
  parts?: (string | unknown)[];
  text?: string;
  [key: string]: unknown;
}

export interface ChatGPTNodeMessage {
  id: string;
  author: ChatGPTNodeAuthor;
  create_time?: number | null;
  update_time?: number | null;
  content?: ChatGPTNodeContent | null;
  status?: string;
  end_turn?: boolean | null;
  weight?: number;
  metadata?: Record<string, unknown>;
  recipient?: string;
}

export interface ChatGPTMappingNode {
  id: string;
  message?: ChatGPTNodeMessage | null;
  parent?: string | null;
  children: string[];
}

export type ChatGPTMapping = Record<string, ChatGPTMappingNode>;

export interface RawChatGPTConversation {
  id: string;
  title: string;
  create_time?: number | null;
  update_time?: number | null;
  mapping: ChatGPTMapping;
  current_node?: string | null;
  conversation_template_id?: string | null;
  gizmo_id?: string | null;
  [key: string]: unknown;
}
