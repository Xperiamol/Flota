/**
 * 组件代码的片段修改：update_widget 的 edits（[{ search, replace }]）按顺序应用到当前代码。
 * search 要与原代码逐字一致且唯一；精确匹配不到时按「每行去掉首尾空白」比较，容忍缩进差异。
 */

const countOccurrences = (haystack, needle) => {
  let count = 0;
  for (let index = haystack.indexOf(needle); index >= 0; index = haystack.indexOf(needle, index + 1)) count++;
  return count;
};

const findTrimmedRange = (code, search) => {
  const lines = code.split('\n');
  const wanted = search.split('\n').map((line) => line.trim());
  while (wanted.length && !wanted[0]) wanted.shift();
  while (wanted.length && !wanted[wanted.length - 1]) wanted.pop();
  if (!wanted.length) return null;
  const hits = [];
  for (let start = 0; start + wanted.length <= lines.length; start++) {
    if (wanted.every((line, offset) => lines[start + offset].trim() === line)) hits.push(start);
  }
  if (hits.length !== 1) return { count: hits.length };
  const before = lines.slice(0, hits[0]).join('\n');
  const from = hits[0] === 0 ? 0 : before.length + 1;
  const to = from + lines.slice(hits[0], hits[0] + wanted.length).join('\n').length;
  return { count: 1, from, to };
};

const applyPatches = (code, patches) => {
  let result = String(code);
  patches.forEach((patch, index) => {
    const label = `第 ${index + 1} 处修改`;
    if (!patch.search.trim()) throw new Error(`${label}的 search 为空`);
    const exact = countOccurrences(result, patch.search);
    if (exact === 1) {
      result = result.replace(patch.search, () => patch.replace);
      return;
    }
    if (exact > 1) throw new Error(`${label}的 search 在原代码中出现了 ${exact} 次，请多包含几行使它唯一`);
    const range = findTrimmedRange(result, patch.search);
    if (range?.count === 1) {
      result = `${result.slice(0, range.from)}${patch.replace}${result.slice(range.to)}`;
      return;
    }
    throw new Error(range?.count > 1
      ? `${label}的 search 在原代码中出现了多次，请多包含几行使它唯一`
      : `${label}的 search 在原代码中找不到（必须与原代码逐行一致）：${patch.search.split('\n')[0].slice(0, 80)}`);
  });
  return result;
};

module.exports = { applyPatches };
