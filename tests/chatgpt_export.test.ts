import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { parseChatGPTConversation, loadChatGPTExport } from "../src/ingest/chatgpt_export.js";
import type { RawChatGPTConversation } from "../src/core/schema.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";

describe("ChatGPT Export Loader (Gotchas #2, #3, #4)", () => {
  it("filters out system messages, visually hidden nodes, and internal thought steps (Gotcha #2)", () => {
    const raw: RawChatGPTConversation = {
      id: "conv-1",
      title: "Filtering Test",
      current_node: "user2",
      mapping: {
        root: { id: "root", parent: null, children: ["sys1"] },
        sys1: {
          id: "sys1",
          parent: "root",
          children: ["hidden1"],
          message: {
            id: "sys1",
            author: { role: "system" },
            content: { content_type: "text", parts: ["You are ChatGPT."] },
          },
        },
        hidden1: {
          id: "hidden1",
          parent: "sys1",
          children: ["thought1"],
          message: {
            id: "hidden1",
            author: { role: "assistant" },
            metadata: { is_visually_hidden_from_conversation: true },
            content: { content_type: "text", parts: ["Hidden internal hook"] },
          },
        },
        thought1: {
          id: "thought1",
          parent: "hidden1",
          children: ["user1"],
          message: {
            id: "thought1",
            author: { role: "assistant" },
            content: { content_type: "thoughts", parts: ["Thinking about answer..."] },
          },
        },
        user1: {
          id: "user1",
          parent: "thought1",
          children: ["asst1"],
          message: {
            id: "user1",
            author: { role: "user" },
            content: { content_type: "text", parts: ["What is 2+2?"] },
          },
        },
        asst1: {
          id: "asst1",
          parent: "user1",
          children: ["user2"],
          message: {
            id: "asst1",
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["It is 4."] },
          },
        },
        user2: {
          id: "user2",
          parent: "asst1",
          children: [],
          message: {
            id: "user2",
            author: { role: "user" },
            content: { content_type: "text", parts: ["Thanks!"] },
          },
        },
      },
    };

    const parsed = parseChatGPTConversation(raw);
    expect(parsed.messages.length).toBe(3);
    expect(parsed.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(parsed.messages[0].content).toBe("What is 2+2?");
    expect(parsed.messages[1].content).toBe("It is 4.");
    expect(parsed.messages[2].content).toBe("Thanks!");
  });

  it("merges consecutive split assistant nodes and wraps code in fenced blocks (Gotcha #3)", () => {
    const raw: RawChatGPTConversation = {
      id: "conv-split",
      title: "Split Assistant Test",
      current_node: "asst_code",
      mapping: {
        root: { id: "root", parent: null, children: ["user1"] },
        user1: {
          id: "user1",
          parent: "root",
          children: ["asst_text"],
          message: {
            id: "user1",
            author: { role: "user" },
            content: { content_type: "text", parts: ["Write a fibonacci function in python."] },
          },
        },
        asst_text: {
          id: "asst_text",
          parent: "user1",
          children: ["asst_code"],
          message: {
            id: "asst_text",
            author: { role: "assistant" },
            content: { content_type: "text", parts: ["Here is the implementation:"] },
          },
        },
        asst_code: {
          id: "asst_code",
          parent: "asst_text",
          children: [],
          message: {
            id: "asst_code",
            author: { role: "assistant" },
            content: {
              content_type: "code",
              language: "python",
              text: "def fib(n):\n    return n if n <= 1 else fib(n-1) + fib(n-2)",
            },
          },
        },
      },
    };

    const parsed = parseChatGPTConversation(raw);
    expect(parsed.messages.length).toBe(2);
    expect(parsed.messages[0].role).toBe("user");
    expect(parsed.messages[1].role).toBe("assistant");
    expect(parsed.messages[1].content).toContain("Here is the implementation:");
    expect(parsed.messages[1].content).toContain("```python\ndef fib(n):\n    return n if n <= 1 else fib(n-1) + fib(n-2)\n```");
  });

  it("truncates raw tool output exceeding ~2000 characters", () => {
    const longOutput = "A".repeat(3500);
    const raw: RawChatGPTConversation = {
      id: "conv-tool",
      title: "Tool Output Truncation",
      current_node: "tool1",
      mapping: {
        root: { id: "root", parent: null, children: ["user1"] },
        user1: {
          id: "user1",
          parent: "root",
          children: ["tool1"],
          message: {
            id: "user1",
            author: { role: "user" },
            content: { content_type: "text", parts: ["Run big command"] },
          },
        },
        tool1: {
          id: "tool1",
          parent: "user1",
          children: [],
          message: {
            id: "tool1",
            author: { role: "tool" },
            content: { content_type: "execution_output", text: longOutput },
          },
        },
      },
    };

    const parsed = parseChatGPTConversation(raw);
    expect(parsed.messages.length).toBe(2);
    const toolMsg = parsed.messages[1];
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.content.length).toBeLessThan(2500);
    expect(toolMsg.content).toContain("[... output truncated ...]");
  });

  describe("Multi-Format Export Loader (Gotcha #4)", () => {
    let tempDir: string;

    beforeAll(async () => {
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "chatgpt-test-"));
    });

    afterAll(async () => {
      await fs.rm(tempDir, { recursive: true, force: true });
    });

    it("loads from a single conversations.json file", async () => {
      const singleFile = path.join(tempDir, "conversations.json");
      const sample = [
        {
          id: "c1",
          title: "Conversation 1",
          current_node: "m1",
          mapping: {
            root: { id: "root", parent: null, children: ["m1"] },
            m1: {
              id: "m1",
              parent: "root",
              children: [],
              message: { id: "m1", author: { role: "user" }, content: { parts: ["Hello single file"] } },
            },
          },
        },
      ];
      await fs.writeFile(singleFile, JSON.stringify(sample), "utf-8");

      const loaded = await loadChatGPTExport(singleFile);
      expect(loaded.length).toBe(1);
      expect(loaded[0].title).toBe("Conversation 1");
      expect(loaded[0].messages[0].content).toBe("Hello single file");
    });

    it("loads from a sharded directory with conversations-000.json, conversations-001.json", async () => {
      const shardDir = path.join(tempDir, "shards");
      await fs.mkdir(shardDir, { recursive: true });

      const shard0 = path.join(shardDir, "conversations-000.json");
      const shard1 = path.join(shardDir, "conversations-001.json");

      await fs.writeFile(
        shard0,
        JSON.stringify([
          {
            id: "s0",
            title: "Shard 0",
            current_node: "m0",
            mapping: {
              root: { id: "root", parent: null, children: ["m0"] },
              m0: {
                id: "m0",
                parent: "root",
                children: [],
                message: { id: "m0", author: { role: "user" }, content: { parts: ["From shard 0"] } },
              },
            },
          },
        ]),
        "utf-8"
      );

      await fs.writeFile(
        shard1,
        JSON.stringify([
          {
            id: "s1",
            title: "Shard 1",
            current_node: "m1",
            mapping: {
              root: { id: "root", parent: null, children: ["m1"] },
              m1: {
                id: "m1",
                parent: "root",
                children: [],
                message: { id: "m1", author: { role: "user" }, content: { parts: ["From shard 1"] } },
              },
            },
          },
        ]),
        "utf-8"
      );

      const loaded = await loadChatGPTExport(shardDir);
      expect(loaded.length).toBe(2);
      const titles = loaded.map((c) => c.title);
      expect(titles).toContain("Shard 0");
      expect(titles).toContain("Shard 1");
    });

    it("loads from a .zip archive containing conversations.json", async () => {
      const zipSourceDir = path.join(tempDir, "zip_contents");
      await fs.mkdir(zipSourceDir, { recursive: true });

      const convFile = path.join(zipSourceDir, "conversations.json");
      await fs.writeFile(
        convFile,
        JSON.stringify([
          {
            id: "zip-c1",
            title: "Zip Conversation",
            current_node: "z1",
            mapping: {
              root: { id: "root", parent: null, children: ["z1"] },
              z1: {
                id: "z1",
                parent: "root",
                children: [],
                message: { id: "z1", author: { role: "user" }, content: { parts: ["From zip file"] } },
              },
            },
          },
        ]),
        "utf-8"
      );

      const zipFile = path.join(tempDir, "export.zip");
      // Use tar to create zip file
      execSync(`tar -a -cf "${zipFile}" -C "${zipSourceDir}" conversations.json`);

      const loaded = await loadChatGPTExport(zipFile);
      expect(loaded.length).toBe(1);
      expect(loaded[0].title).toBe("Zip Conversation");
      expect(loaded[0].messages[0].content).toBe("From zip file");
    });
  });
});
