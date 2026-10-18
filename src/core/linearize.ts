import type { ChatGPTMapping, ChatGPTMappingNode } from "./schema.js";

/**
 * Linearizes a ChatGPT conversation mapping tree into the single active root-to-leaf branch.
 * 
 * Gotcha #1:
 * ChatGPT exports are trees, NOT lists. Edits and regenerations branch off parent nodes.
 * Iterating dictionary keys produces an out-of-order, contradictory transcript.
 * 
 * Algorithm:
 * 1. If `currentNodeId` is provided and valid, walk `parent` pointers backward to root,
 *    then reverse the path to produce chronological order.
 * 2. If `currentNodeId` is absent or invalid, locate the root node (parent === null) and
 *    descend forward, consistently selecting the LAST child in `children` at each fork.
 * 3. Cycle-detection prevents infinite loops from corrupted exports.
 */
export function linearizeChatGPTBranch(
  mapping: ChatGPTMapping,
  currentNodeId?: string | null
): ChatGPTMappingNode[] {
  if (!mapping || Object.keys(mapping).length === 0) {
    return [];
  }

  // Strategy 1: Walk parent pointers backwards from currentNodeId if present
  if (currentNodeId && mapping[currentNodeId]) {
    const branch: ChatGPTMappingNode[] = [];
    const visited = new Set<string>();
    let curr: ChatGPTMappingNode | undefined = mapping[currentNodeId];

    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      branch.push(curr);

      if (!curr.parent || !mapping[curr.parent]) {
        break;
      }
      curr = mapping[curr.parent];
    }

    // Chronological order: reverse from leaf-to-root -> root-to-leaf
    return branch.reverse();
  }

  // Strategy 2: Fallback — locate root node and descend choosing the last child at every fork
  // Root nodes have null parent, or parent not in mapping
  let rootNode: ChatGPTMappingNode | undefined;

  for (const node of Object.values(mapping)) {
    if (node.parent === null || node.parent === undefined) {
      rootNode = node;
      break;
    }
  }

  // Fallback to any node whose parent is missing from mapping
  if (!rootNode) {
    for (const node of Object.values(mapping)) {
      if (!mapping[node.parent!]) {
        rootNode = node;
        break;
      }
    }
  }

  // Final fallback to the first object value
  if (!rootNode) {
    rootNode = Object.values(mapping)[0];
  }

  if (!rootNode) {
    return [];
  }

  const branch: ChatGPTMappingNode[] = [rootNode];
  const visited = new Set<string>([rootNode.id]);
  let curr: ChatGPTMappingNode = rootNode;

  while (curr.children && curr.children.length > 0) {
    // Pick the last child (most recent branch/edit)
    const lastChildId = curr.children[curr.children.length - 1];
    const nextNode: ChatGPTMappingNode | undefined = mapping[lastChildId];

    if (!nextNode || visited.has(nextNode.id)) {
      break;
    }

    visited.add(nextNode.id);
    branch.push(nextNode);
    curr = nextNode;
  }

  return branch;
}
