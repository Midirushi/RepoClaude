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
  html = processParagraphs(html);
  html = html.replace(/\x00CODE_BLOCK_(\d+)\x00/g, (_, idx) => {
    const { lang, code } = codeBlocks[parseInt(idx)];
    const highlighted = highlightCode(code, lang);
    return `<pre class="code-block" data-lang="${lang || ""}"><code>${highlighted}</code></pre>`;
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