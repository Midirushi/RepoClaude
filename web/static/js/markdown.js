// web/static/js/markdown.js
// 轻量级 Markdown 渲染器（仅支持前端展示所需子集）

import { highlightCode } from "./highlight.js";

export function markdownToHtml(text) {
  if (!text) return "";
  const codeBlocks = [];
  let html = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang, code: code.trim() });
    return `\x00CODE_BLOCK_${idx}\x00`;
  });
  html = escapeHtml(html);
  html = processInlineCode(html);
  html = processBoldAndItalic(html);
  html = processLinks(html);
  html = processTables(html);
  html = processLists(html);
  html = processHeadings(html);
  html = processCodeblockPlaceholders(html);
  html = processParagraphs(html);
  html = html.replace(/\x00CODE_BLOCK_(\d+)\x00/g, (_, idx) => {
    const { lang, code } = codeBlocks[parseInt(idx)];
    const highlighted = highlightCode(code, lang);
    const langLabel = lang || "text";
    const encodedCode = encodeURIComponent(code);
    return `<div class="code-block-wrapper" data-lang="${langLabel}">
      <div class="code-block-header">
        <span class="code-block-lang">${langLabel}</span>
        <button class="code-copy-btn" data-code="${encodedCode}" title="复制代码">复制</button>
      </div>
      <pre class="code-block" data-lang="${lang || ""}"><code>${highlighted}</code></pre>
    </div>`;
  });
  return html;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
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

function processTables(html) {
  let result = html;
  result = parsePipeTables(result);
  result = parseTabTables(result);
  return result;
}

function parsePipeTables(html) {
  const lines = html.split("\n");
  const result = [];
  let inTable = false;
  let tableLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        inTable = true;
        tableLines = [];
      }
      tableLines.push(trimmed);
    } else {
      if (inTable && tableLines.length >= 2) {
        result.push(renderPipeTable(tableLines));
        inTable = false;
        tableLines = [];
      } else if (inTable) {
        result.push(...tableLines);
        inTable = false;
        tableLines = [];
      }
      result.push(line);
    }
  }

  if (inTable && tableLines.length >= 2) {
    result.push(renderPipeTable(tableLines));
  } else if (inTable) {
    result.push(...tableLines);
  }

  return result.join("\n");
}

function renderPipeTable(lines) {
  const rows = [];
  for (const line of lines) {
    const parts = line.split("|").map(p => p.trim()).filter(p => p !== "");
    if (parts.length > 0) rows.push(parts);
  }
  if (rows.length < 2) return lines.join("\n");

  let html = '<table class="md-table">';
  html += "<thead><tr>";
  for (const header of rows[0]) {
    html += `<th>${header}</th>`;
  }
  html += "</tr></thead>";

  html += "<tbody>";
  for (let i = 1; i < rows.length; i++) {
    if (/^[-:]+$/.test(rows[i][0])) continue;
    html += "<tr>";
    for (const cell of rows[i]) {
      html += `<td>${cell}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";

  return html;
}

function parseTabTables(html) {
  const lines = html.split("\n");
  const result = [];
  let inTable = false;
  let tableRows = [];
  let colCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const hasTabs = line.includes("\t");
    const isSeparator = /^[-=]+$/.test(trimmed);

    if (hasTabs && !isSeparator) {
      const parts = line.split("\t").map(p => p.trim()).filter(p => p !== "");
      if (parts.length > 1) {
        if (!inTable) {
          inTable = true;
          tableRows = [];
          colCount = parts.length;
        }
        tableRows.push(parts);
      } else {
        if (inTable) {
          result.push(renderTabTable(tableRows, colCount));
          inTable = false;
          tableRows = [];
          colCount = 0;
        }
        result.push(line);
      }
    } else if (isSeparator && inTable) {
      tableRows.push(new Array(colCount).fill("---"));
    } else {
      if (inTable && tableRows.length >= 2) {
        result.push(renderTabTable(tableRows, colCount));
        inTable = false;
        tableRows = [];
        colCount = 0;
      } else if (inTable) {
        result.push(...tableRows.map(r => r.join("\t")));
        inTable = false;
        tableRows = [];
        colCount = 0;
      }
      result.push(line);
    }
  }

  if (inTable && tableRows.length >= 2) {
    result.push(renderTabTable(tableRows, colCount));
  }

  return result.join("\n");
}

function renderTabTable(rows, colCount) {
  if (rows.length < 2) return rows.map(r => r.join("\t")).join("\n");

  let html = '<table class="md-table">';
  html += "<thead><tr>";
  for (const header of rows[0]) {
    html += `<th>${header}</th>`;
  }
  html += "</tr></thead>";

  html += "<tbody>";
  for (let i = 1; i < rows.length; i++) {
    if (/^[-=]+$/.test(rows[i][0])) continue;
    html += "<tr>";
    for (let j = 0; j < colCount; j++) {
      html += `<td>${rows[i][j] || ""}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";

  return html;
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

// 兜底：把 LLM 输出的 CODEBLOCK 占位符（如 CODEBLOCK0, CODE_BLOCK_1）
// 替换为醒目的警告框，提示用户重新提问以获取完整代码
function processCodeblockPlaceholders(html) {
  // 匹配独立成行的 CODEBLOCK 占位符（可能被 <p> 包裹）
  const blockPattern = /<p>\s*CODE[_ ]?BLOCK[_ ]?\d+\s*<\/p>/gi;
  if (blockPattern.test(html)) {
    // 重建 regex 避免 lastIndex 问题
    html = html.replace(/<p>\s*CODE[_ ]?BLOCK[_ ]?\d+\s*<\/p>/gi,
      '<div class="codeblock-warning">⚠️ AI 返回了代码占位符而非实际代码。请回复"请重新输出完整代码"获取完整内容。</div>');
  }
  // 匹配行内出现的占位符
  const inlinePattern = /\bCODE[_ ]?BLOCK[_ ]?\d+\b/gi;
  if (inlinePattern.test(html)) {
    html = html.replace(/\bCODE[_ ]?BLOCK[_ ]?\d+\b/gi,
      '<span class="codeblock-warning-inline">⚠️ [代码占位符]</span>');
  }
  return html;
}

function processParagraphs(html) {
  const lines = html.split("\n");
  const result = [];
  let inPre = false;
  let inTable = false;

  for (const line of lines) {
    if (line.startsWith("<pre")) {
      inPre = true;
      result.push(line);
    } else if (line.startsWith("</pre")) {
      inPre = false;
      result.push(line);
    } else if (line.startsWith("<table")) {
      inTable = true;
      result.push(line);
    } else if (line.startsWith("</table")) {
      inTable = false;
      result.push(line);
    } else if (inPre || inTable) {
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