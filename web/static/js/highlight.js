// web/static/js/highlight.js
// 轻量级语法高亮器（支持常见语言子集）

const KEYWORDS = {
  python: ["def", "class", "import", "from", "return", "if", "elif", "else", "for", "while", "in", "and", "or", "not", "is", "None", "True", "False", "try", "except", "finally", "raise", "with", "as", "lambda", "yield", "await", "async", "pass", "break", "continue"],
  javascript: ["function", "const", "let", "var", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "try", "catch", "finally", "throw", "async", "await", "class", "extends", "new", "this", "super", "import", "export", "from", "true", "false", "null", "undefined"],
  typescript: ["function", "const", "let", "var", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "try", "catch", "finally", "throw", "async", "await", "class", "extends", "new", "this", "super", "import", "export", "from", "true", "false", "null", "undefined", "type", "interface", "enum", "implements", "private", "public", "protected", "static", "readonly", "abstract"],
  go: ["func", "var", "const", "type", "struct", "interface", "package", "import", "return", "if", "else", "for", "range", "switch", "case", "default", "break", "continue", "go", "chan", "select", "defer", "map", "make", "new", "true", "false", "nil"],
  rust: ["fn", "let", "mut", "const", "static", "struct", "enum", "impl", "trait", "pub", "use", "mod", "crate", "self", "super", "where", "for", "loop", "while", "if", "else", "match", "return", "break", "continue", "async", "await", "move", "ref", "true", "false"],
  java: ["public", "private", "protected", "static", "final", "void", "class", "interface", "extends", "implements", "import", "package", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "try", "catch", "finally", "throw", "throws", "new", "this", "super", "true", "false", "null"],
  cpp: ["public", "private", "protected", "class", "struct", "union", "virtual", "override", "final", "static", "const", "volatile", "return", "if", "else", "for", "while", "do", "switch", "case", "default", "break", "continue", "try", "catch", "throw", "new", "delete", "true", "false", "nullptr"],
  bash: ["if", "then", "else", "fi", "for", "do", "done", "while", "case", "esac", "function", "return", "exit", "echo", "export", "source", "cd", "pwd", "ls", "cat", "grep", "awk", "sed", "true", "false"],
};

const BUILTINS = {
  python: ["print", "len", "range", "str", "int", "float", "bool", "list", "dict", "set", "tuple", "sum", "min", "max", "open", "close", "read", "write"],
  javascript: ["console", "document", "window", "JSON", "Math", "Promise", "Array", "String", "Number", "Boolean", "Object"],
};

export function highlightCode(code, lang) {
  lang = (lang || "").toLowerCase();
  const keywords = KEYWORDS[lang] || [];
  const builtins = BUILTINS[lang] || [];

  let result = escapeHtml(code);
  result = highlightStrings(result);
  result = highlightNumbers(result);
  result = highlightComments(result, lang);
  result = highlightKeywords(result, keywords);
  result = highlightBuiltins(result, builtins);
  result = highlightFunctions(result, lang);
  result = highlightTypes(result, lang);

  return result;
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlightStrings(html) {
  const strRegex = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;
  return html.replace(strRegex, '<span class="hl-string">$1</span>');
}

function highlightNumbers(html) {
  const numRegex = /\b(\d+\.?\d*)\b/g;
  return html.replace(numRegex, '<span class="hl-number">$1</span>');
}

function highlightComments(html, lang) {
  if (lang === "python") {
    const commentRegex = /(#.*$)/gm;
    html = html.replace(commentRegex, '<span class="hl-comment">$1</span>');
  } else if (lang === "bash") {
    const commentRegex = /(#.*$)/gm;
    html = html.replace(commentRegex, '<span class="hl-comment">$1</span>');
  } else {
    const lineCommentRegex = /(\/\/.*$)/gm;
    html = html.replace(lineCommentRegex, '<span class="hl-comment">$1</span>');
    const blockCommentRegex = /(\/\*[\s\S]*?\*\/)/g;
    html = html.replace(blockCommentRegex, '<span class="hl-comment">$1</span>');
  }
  return html;
}

function highlightKeywords(html, keywords) {
  if (keywords.length === 0) return html;
  const regex = new RegExp(`\\b(${keywords.join("|")})\\b`, "g");
  return html.replace(regex, '<span class="hl-keyword">$1</span>');
}

function highlightBuiltins(html, builtins) {
  if (builtins.length === 0) return html;
  const regex = new RegExp(`\\b(${builtins.join("|")})\\b`, "g");
  return html.replace(regex, '<span class="hl-builtin">$1</span>');
}

function highlightFunctions(html, lang) {
  if (lang === "python") {
    const funcRegex = /\b(\w+)\s*\(/g;
    return html.replace(funcRegex, '<span class="hl-function">$1</span>(');
  } else if (lang === "javascript" || lang === "typescript") {
    const funcRegex = /\b(\w+)\s*\(/g;
    return html.replace(funcRegex, '<span class="hl-function">$1</span>(');
  } else if (lang === "go") {
    const funcRegex = /\b(\w+)\s*\(/g;
    return html.replace(funcRegex, '<span class="hl-function">$1</span>(');
  } else if (lang === "rust") {
    const funcRegex = /\b(\w+)\s*\(/g;
    return html.replace(funcRegex, '<span class="hl-function">$1</span>(');
  }
  return html;
}

function highlightTypes(html, lang) {
  if (lang === "typescript" || lang === "java" || lang === "cpp") {
    const types = ["string", "number", "boolean", "any", "void", "null", "undefined", "never", "unknown", "Array", "Promise", "Map", "Set"];
    const regex = new RegExp(`\\b(${types.join("|")})\\b`, "g");
    return html.replace(regex, '<span class="hl-type">$1</span>');
  }
  return html;
}