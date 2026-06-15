/**
 * 从 LLM 文本输出中尽力解析 JSON（容忍 ```json 包裹和前后噪声）。
 */
function tryParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (_) {
    return { ok: false };
  }
}

// 去除对象/数组里常见的尾逗号： ,} 或 ,]
function stripTrailingCommas(text) {
  return text.replace(/,(\s*[}\]])/g, '$1');
}

// 从 start 处的起始括号开始做平衡匹配，返回完整片段（处理字符串内的括号与转义）
function extractBalanced(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

// 修复被截断的 JSON：截到最后一个完整的结构性收尾（} 或 ]），再补全未闭合的括号。
// 适用于 LLM 因 max_tokens 截断、JSON 尾部不完整的场景（会丢弃最后一个不完整的元素）。
function repairTruncatedJSON(text) {
  let inString = false;
  let escaped = false;
  let lastStructuralClose = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '}' || ch === ']') lastStructuralClose = i;
  }
  if (lastStructuralClose < 0) return null;

  let cut = text.slice(0, lastStructuralClose + 1).replace(/,\s*$/, '');

  // 重新扫描 cut，统计未闭合的括号，按栈逆序补全
  const stack = [];
  inString = false;
  escaped = false;
  for (let i = 0; i < cut.length; i += 1) {
    const ch = cut[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  while (stack.length) cut += stack.pop();
  return cut;
}

function extractJSON(text, fallback = null) {
  if (!text) return fallback;
  const str = String(text).trim();

  const fenced = str.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : str;

  // 1) 直接解析
  let r = tryParse(candidate);
  if (r.ok) return r.value;

  // 2) 去尾逗号后解析
  r = tryParse(stripTrailingCommas(candidate));
  if (r.ok) return r.value;

  // 3) 定位第一个 { 或 [，做平衡括号提取
  const firstObj = candidate.indexOf('{');
  const firstArr = candidate.indexOf('[');
  let start = -1;
  if (firstObj === -1 && firstArr === -1) return fallback;
  if (firstArr === -1 || (firstObj !== -1 && firstObj < firstArr)) {
    start = firstObj;
  } else {
    start = firstArr;
  }

  const balanced = extractBalanced(candidate, start);
  if (balanced) {
    r = tryParse(balanced);
    if (r.ok) return r.value;
    r = tryParse(stripTrailingCommas(balanced));
    if (r.ok) return r.value;
  }

  // 4) 兜底：第一个起始括号到最后一个对应收尾括号
  const endChar = candidate[start] === '{' ? '}' : ']';
  const end = candidate.lastIndexOf(endChar);
  if (end > start) {
    const slice = candidate.slice(start, end + 1);
    r = tryParse(slice);
    if (r.ok) return r.value;
    r = tryParse(stripTrailingCommas(slice));
    if (r.ok) return r.value;
  }

  // 5) 截断修复：从起始括号开始，修复未闭合的 JSON
  const repaired = repairTruncatedJSON(candidate.slice(start));
  if (repaired) {
    r = tryParse(repaired);
    if (r.ok) return r.value;
    r = tryParse(stripTrailingCommas(repaired));
    if (r.ok) return r.value;
  }

  return fallback;
}

module.exports = { extractJSON };
