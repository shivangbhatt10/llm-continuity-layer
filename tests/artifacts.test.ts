import { describe, it, expect } from "vitest";
import {
  extractArtifacts,
  deduplicateArtifacts,
  extractSymbols,
} from "../src/core/artifacts.js";
import type { Message, Artifact } from "../src/core/schema.js";

describe("Artifact Extraction & Symbol-Aware Dedup (Gotcha #6, Gotcha #18)", () => {
  describe("Backreference Fence Extraction (Gotcha #6)", () => {
    it("extracts standard 3-backtick code blocks", () => {
      const messages: Message[] = [
        {
          role: "assistant",
          content: "Here is the solution:\n```python\ndef solve():\n    return 42\n```\nDone.",
        },
      ];
      const artifacts = extractArtifacts(messages);
      expect(artifacts.length).toBe(1);
      expect(artifacts[0].lang).toBe("python");
      expect(artifacts[0].code).toBe("def solve():\n    return 42");
    });

    it("extracts 4-backtick fences containing nested 3-backtick blocks whole", () => {
      const nestedContent = "````markdown\n```python\nprint('inner')\n```\n````";
      const messages: Message[] = [
        {
          role: "assistant",
          content: `Take a look at this nested block:\n${nestedContent}\nThat is all.`,
        },
      ];
      const artifacts = extractArtifacts(messages);
      expect(artifacts.length).toBe(1);
      expect(artifacts[0].lang).toBe("markdown");
      expect(artifacts[0].code).toContain("```python");
      expect(artifacts[0].code).toContain("print('inner')");
    });

    it("extracts file path labels from preceding headings", () => {
      const messages: Message[] = [
        {
          role: "assistant",
          content: "## 📄 `app/services/auth.py`\n```python\ndef authenticate():\n    pass\n```",
        },
      ];
      const artifacts = extractArtifacts(messages);
      expect(artifacts.length).toBe(1);
      expect(artifacts[0].label).toBe("app/services/auth.py");
    });
  });

  describe("Symbol Extraction", () => {
    it("extracts Python def and class names", () => {
      const code = "class UserService:\n    def get_user(self):\n        pass\n    def delete_user(self):\n        pass";
      const symbols = extractSymbols(code, "python");
      expect(symbols).toEqual(new Set(["UserService", "get_user", "delete_user"]));
    });

    it("extracts TypeScript function, class, interface, and type names", () => {
      const code = `
export interface UserSession { id: string; }
export type Role = "admin" | "user";
export class AuthService {}
export function validateToken() {}
`;
      const symbols = extractSymbols(code, "typescript");
      expect(symbols).toEqual(new Set(["UserSession", "Role", "AuthService", "validateToken"]));
    });
  });

  describe("Gotcha #18 - The 96-Block Rule Deduplication", () => {
    it("never treats two blocks as the same file just because they share language + first line", () => {
      // Two different files both starting with 'import requests'
      const a1: Artifact = {
        lang: "python",
        code: "import requests\n\ndef fetch_users():\n    return requests.get('/users')",
        message_index: 0,
        role: "assistant",
        label: "users.py",
      };
      const a2: Artifact = {
        lang: "python",
        code: "import requests\n\ndef fetch_orders():\n    return requests.get('/orders')",
        message_index: 1,
        role: "assistant",
        label: "orders.py",
      };

      const result = deduplicateArtifacts([a1, a2]);
      expect(result.length).toBe(2);
      expect(result.map((a) => a.label)).toEqual(["users.py", "orders.py"]);
    });

    it("allows a newer block to supersede an older block ONLY if it defines every symbol of the older block", () => {
      const older: Artifact = {
        lang: "typescript",
        code: "export function auth() {}\nexport function logout() {}",
        message_index: 0,
        role: "assistant",
        label: "auth.ts",
      };
      const newerSuperset: Artifact = {
        lang: "typescript",
        code: "export function auth() {}\nexport function logout() {}\nexport function refresh() {}",
        message_index: 2,
        role: "assistant",
        label: "auth.ts",
      };

      const result = deduplicateArtifacts([older, newerSuperset]);
      expect(result.length).toBe(1);
      expect(result[0].code).toContain("refresh");
    });

    it("prevents small patches from overwriting full files", () => {
      const fullFile: Artifact = {
        lang: "python",
        code: "class Controller:\n    def a(self): pass\n    def b(self): pass\n    def c(self): pass",
        message_index: 0,
        role: "assistant",
        label: "controller.py",
      };
      // A small patch only defining method 'b'
      const smallPatch: Artifact = {
        lang: "python",
        code: "    def b(self):\n        return 'patched'",
        message_index: 1,
        role: "assistant",
        label: "controller.py",
      };

      const result = deduplicateArtifacts([fullFile, smallPatch]);
      // Full file MUST NOT be dropped in favor of a small 2-line snippet
      expect(result.length).toBe(2);
      expect(result[0].code).toContain("def a(self)");
    });

    it("collapses exact duplicates to the newest block", () => {
      const code = "export const API_URL = 'https://api.example.com';";
      const a1: Artifact = { lang: "typescript", code, message_index: 0, role: "assistant" };
      const a2: Artifact = { lang: "typescript", code, message_index: 3, role: "assistant" };

      const result = deduplicateArtifacts([a1, a2]);
      expect(result.length).toBe(1);
      expect(result[0].message_index).toBe(3);
    });

    it("drops noise blocks (<150 chars of URLs, sample JSON, or diagrams)", () => {
      const noiseUrl: Artifact = {
        lang: "text",
        code: "https://github.com/org/repo/issues/123\nhttps://example.com",
        message_index: 0,
        role: "assistant",
      };
      const noiseJson: Artifact = {
        lang: "json",
        code: '{"status": "ok", "count": 1}',
        message_index: 1,
        role: "assistant",
      };
      const validCode: Artifact = {
        lang: "typescript",
        code: "export function run() {\n  console.log('Running robust system service');\n  return true;\n}",
        message_index: 2,
        role: "assistant",
      };

      const result = deduplicateArtifacts([noiseUrl, noiseJson, validCode]);
      expect(result.length).toBe(1);
      expect(result[0].code).toContain("export function run");
    });

    it("merges scattered 1-line shell commands into a single deduplicated shell block", () => {
      const cmd1: Artifact = { lang: "bash", code: "npm install dotenv", message_index: 0, role: "assistant" };
      const cmd2: Artifact = { lang: "bash", code: "npm install dotenv", message_index: 1, role: "assistant" };
      const cmd3: Artifact = { lang: "sh", code: "npx vitest run", message_index: 2, role: "assistant" };

      const result = deduplicateArtifacts([cmd1, cmd2, cmd3]);
      expect(result.length).toBe(1);
      expect(result[0].lang).toBe("bash");
      expect(result[0].code).toBe("npm install dotenv\nnpx vitest run");
    });
  });
});
