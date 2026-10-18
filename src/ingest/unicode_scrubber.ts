/**
 * Unicode Scrubber & Citation Stripper (Gotcha #14, Gotcha #17)
 * 
 * ChatGPT web exports and DOM scraping frequently leak private-use Unicode characters
 * (U+E000-U+F8FF), structured entity tags, and web citation strings (fileL8-L28).
 * 
 * Critical Invariant:
 * These must ONLY be scrubbed outside of code fences. Any legitimate Unicode or
 * variable names matching these patterns inside a code fence must remain 100% untouched.
 */

export interface ScrubResult {
  text: string;
  strippedCitations: number;
  entitiesReplaced: number;
}

const ENTITY_REGEX = /\ue200entity\ue202\[(.*?)\]\ue201/g;
const CITE_REGEX = /\ue200cite\ue202.*?\ue201/g;
const PUA_REGEX = /[\uE000-\uF8FF]/g;
const CITATION_TAG_REGEX = /\bfileL\d+(?:-L\d+)?\b/g;

export function scrubChatGPTUnicodeAndCitations(content: string): ScrubResult {
  const lines = content.split("\n");
  const processedLines: string[] = [];

  let inFence = false;
  let fenceDelimiter = "";
  let strippedCitations = 0;
  let entitiesReplaced = 0;

  for (const line of lines) {
    const trimmed = line.trimStart();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const delim = fenceMatch[1];
      if (!inFence) {
        // Entering a code fence
        inFence = true;
        fenceDelimiter = delim[0]; // '`' or '~'
        processedLines.push(line);
        continue;
      } else if (delim[0] === fenceDelimiter && delim.length >= 3) {
        // Exiting code fence
        inFence = false;
        fenceDelimiter = "";
        processedLines.push(line);
        continue;
      }
    }

    if (inFence) {
      // Inside code fence: preserve verbatim
      processedLines.push(line);
    } else {
      // Outside code fence: perform sanitization
      let processed = line;

      // 1. Replace entity groups: \ue200entity\ue202["website","Semantic Scholar",...]\ue201 -> "Semantic Scholar"
      processed = processed.replace(ENTITY_REGEX, (_match, arrayContent) => {
        entitiesReplaced++;
        try {
          const parsed = JSON.parse(`[${arrayContent}]`);
          if (Array.isArray(parsed) && parsed.length >= 2 && typeof parsed[1] === "string") {
            return parsed[1];
          }
          if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "string") {
            return parsed[0];
          }
        } catch {
          // If JSON parse fails, extract second quoted string via regex
          const quotes = arrayContent.match(/"([^"]+)"/g);
          if (quotes && quotes.length >= 2) {
            return quotes[1].replace(/^"|"$/g, "");
          }
        }
        return "";
      });

      // 2. Remove cite groups: \ue200cite\ue202...\ue201
      processed = processed.replace(CITE_REGEX, "");

      // 3. Remove any remaining PUA Unicode characters (U+E000-U+F8FF)
      processed = processed.replace(PUA_REGEX, "");

      // 4. Strip leaked file citations outside fences (fileL8-L28, fileL100)
      processed = processed.replace(CITATION_TAG_REGEX, () => {
        strippedCitations++;
        return "";
      });

      processedLines.push(processed);
    }
  }

  return {
    text: processedLines.join("\n"),
    strippedCitations,
    entitiesReplaced,
  };
}
