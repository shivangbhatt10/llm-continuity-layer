import { describe, it, expect } from "vitest";
import { linearizeChatGPTBranch } from "../src/core/linearize.js";
import type { ChatGPTMapping } from "../src/core/schema.js";

describe("ChatGPT Tree Linearizer (Gotcha #1)", () => {
  it("linearizes a simple linear conversation from leaf to root", () => {
    const mapping: ChatGPTMapping = {
      root: { id: "root", parent: null, children: ["node1"] },
      node1: {
        id: "node1",
        parent: "root",
        children: ["node2"],
        message: {
          id: "node1",
          author: { role: "user" },
          content: { parts: ["Hello"] },
        },
      },
      node2: {
        id: "node2",
        parent: "node1",
        children: [],
        message: {
          id: "node2",
          author: { role: "assistant" },
          content: { parts: ["Hi there!"] },
        },
      },
    };

    const branch = linearizeChatGPTBranch(mapping, "node2");
    expect(branch.map((n) => n.id)).toEqual(["root", "node1", "node2"]);
  });

  it("selects only the active branch when regenerations or edits created branches", () => {
    // Tree:
    //          root
    //           |
    //         user1
    //        /     \
    //   asst_v1    asst_v2
    //                 |
    //               user2
    const mapping: ChatGPTMapping = {
      root: { id: "root", parent: null, children: ["user1"] },
      user1: {
        id: "user1",
        parent: "root",
        children: ["asst_v1", "asst_v2"],
        message: { id: "user1", author: { role: "user" }, content: { parts: ["Draft a function"] } },
      },
      asst_v1: {
        id: "asst_v1",
        parent: "user1",
        children: [],
        message: { id: "asst_v1", author: { role: "assistant" }, content: { parts: ["Old draft"] } },
      },
      asst_v2: {
        id: "asst_v2",
        parent: "user1",
        children: ["user2"],
        message: { id: "asst_v2", author: { role: "assistant" }, content: { parts: ["New draft"] } },
      },
      user2: {
        id: "user2",
        parent: "asst_v2",
        children: [],
        message: { id: "user2", author: { role: "user" }, content: { parts: ["Looks good!"] } },
      },
    };

    // When current_node points to user2, asst_v1 should be omitted
    const branch = linearizeChatGPTBranch(mapping, "user2");
    expect(branch.map((n) => n.id)).toEqual(["root", "user1", "asst_v2", "user2"]);
  });

  it("falls back to last-child descent when current_node is null or undefined", () => {
    // Should pick user1 -> asst_v2 -> user2 because asst_v2 is the last child of user1
    const mapping: ChatGPTMapping = {
      root: { id: "root", parent: null, children: ["user1"] },
      user1: {
        id: "user1",
        parent: "root",
        children: ["asst_v1", "asst_v2"],
        message: { id: "user1", author: { role: "user" }, content: { parts: ["Draft a function"] } },
      },
      asst_v1: {
        id: "asst_v1",
        parent: "user1",
        children: [],
        message: { id: "asst_v1", author: { role: "assistant" }, content: { parts: ["Old draft"] } },
      },
      asst_v2: {
        id: "asst_v2",
        parent: "user1",
        children: ["user2"],
        message: { id: "asst_v2", author: { role: "assistant" }, content: { parts: ["New draft"] } },
      },
      user2: {
        id: "user2",
        parent: "asst_v2",
        children: [],
        message: { id: "user2", author: { role: "user" }, content: { parts: ["Looks good!"] } },
      },
    };

    const branch = linearizeChatGPTBranch(mapping, null);
    expect(branch.map((n) => n.id)).toEqual(["root", "user1", "asst_v2", "user2"]);
  });

  it("handles circular references gracefully without infinite loops", () => {
    const mapping: ChatGPTMapping = {
      node1: { id: "node1", parent: "node2", children: ["node2"] },
      node2: { id: "node2", parent: "node1", children: ["node1"] },
    };

    const branch = linearizeChatGPTBranch(mapping, "node2");
    expect(branch.length).toBeLessThanOrEqual(2);
  });
});
