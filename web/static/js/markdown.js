// web/static/js/markdown.js
// 轻量级 Markdown 渲染器（仅支持前端展示所需子集）

import { highlightCode } from "./highlight.js";

export function markdownToHtml(text) {
  if (!text) return "";
  let html = escapeHtml(text);
  html = processCodeBlocks(html);
  html = processInlineCode(html);
  html = processBoldAndItalic(html);
  html = processLinks(html);
  html = processLists(html);
  html = processHeadings(html);
  html = processParagraphs(html);
  return html;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function processCodeBlocks(html) {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  return html.replace(codeBlockRegex, (_, lang, code) => {
    const trimmed = code.trim();
    const highlighted = highlightCode(trimmed, lang);
    return `<pre class="code-block" data-lang="${lang || ""}"><code>${highlighted}</code></pre>`;
  });
}

function processInlineCode(html) {
  const inlineRegex = /`([^`]+)`/g;
  return html.replace(inlineRegex, '<code class="inline-code">$1</code>');
}

function processBoldAndItalic(html) {
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');
  return html;
}

function processLinks(html) {
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  return html.replace(linkRegex, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

function processLists(html) {
  const lines = html.split("\n");
  const result = [];
  let inOl = false;
  let inUl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const olMatch = line.match(/^(\d+)\.\s+(.*)/);
    const ulMatch = line.match(/^[-*+]\s+(.*)/);

    if (olMatch) {
      if (!inOl) {
        if (inUl) {
          result.push("</ul>");
          inUl = false;
        }
        result.push("<ol>");
        inOl = true;
      }
      result.push(`<li>${olMatch[2]}</li>`);
    } else if (ulMatch) {
      if (!inUl) {
        if (inOl) {
          result.push("</ol>");
          inOl = false;
        }
        result.push("<ul>");
        inUl = true;
      }
      result.push(`<li>${ulMatch[1]}</li>`);
    } else {
      if (inOl) {
        result.push("</ol>");
        inOl = false;
      }
      if (inUl) {
        result.push("</ul>");
        inUl = false;
      }
      result.push(line);
    }
  }

  if (inOl) result.push("</ol>");
  if (inUl) result.push("</ul>");

  return result.join("\n");
}

function processHeadings(html) {
  html = html.replace(/^###\s+(.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.*$)/gim, '<h1>$1</h1>');
  return html;
}

function processParagraphs(html) {
  const lines = html.split("\n");
  const result = [];
  let inPre = false;

  for (const line of lines) {
    if (line.startsWith("<pre")) {
      inPre = true;
      result.push(line);
    } else if (line.startsWith("</pre")) {
      inPre = false;
      result.push(line);
    } else if (inPre) {
      result.push(line);
    } else if (line.trim() === "") {
      result.push("");
    } else if (line.startsWith("<") && line.endsWith(">")) {
      result.push(line);
    } else {
      result.push(`<p>${line}</p>`);
    }
  }

  return result.join("\n");
}