// A deliberately small Markdown subset for the bundled, offline installation guide.
// Input HTML and links are inert. Only explicitly supplied bundled PNGs are embedded.
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function inline(value, depth = 0, images = {}) {
  if (depth > 8) return escape(value);
  let html = '', index = 0;
  while (index < value.length) {
    const rest = value.slice(index);
    if (rest[0] === '\\' && rest.length > 1 && /[\\`*_[\]{}()#+.!|>~-]/.test(rest[1])) {
      html += escape(rest[1]); index += 2; continue;
    }
    const ticks = /^`+/.exec(rest)?.[0];
    if (ticks) {
      const end = value.indexOf(ticks, index + ticks.length);
      if (end >= 0) {
        html += `<code>${escape(value.slice(index + ticks.length, end))}</code>`;
        index = end + ticks.length; continue;
      }
    }
    const delimiter = rest.startsWith('**') ? '**' : rest.startsWith('*') ? '*' : null;
    if (delimiter) {
      const end = value.indexOf(delimiter, index + delimiter.length);
      if (end > index + delimiter.length) {
        const tag = delimiter.length === 2 ? 'strong' : 'em';
        html += `<${tag}>${inline(value.slice(index + delimiter.length, end), depth + 1, images)}</${tag}>`;
        index = end + delimiter.length; continue;
      }
    }
    const labelStart = rest.startsWith('![') ? index + 2 : rest.startsWith('[') ? index + 1 : -1;
    if (labelStart >= 0) {
      const labelEnd = value.indexOf('](', labelStart);
      if (labelEnd >= 0) {
        let cursor = labelEnd + 2, nesting = 1;
        for (; cursor < value.length && nesting; cursor++) {
          if (value[cursor] === '\\') { cursor++; continue; }
          if (value[cursor] === '(') nesting++;
          if (value[cursor] === ')') nesting--;
        }
        if (!nesting) {
          const label = inline(value.slice(labelStart, labelEnd), depth + 1, images);
          const destination = escape(value.slice(labelEnd + 2, cursor - 1));
          const reference = value.slice(labelEnd + 2, cursor - 1);
          const embedded = rest.startsWith('![') && Object.hasOwn(images, reference) ? images[reference] : undefined;
          const documentReference = /^(?:\.\.\/)*[a-zA-Z0-9._/-]+\.md(?:#[^\s]*)?$/.test(reference);
          html += embedded ? `<img class="guide-image" src="${embedded}" alt="${escape(value.slice(labelStart, labelEnd))}">`
            : documentReference ? `<span class="reference">${label}</span>`
            : `<span class="reference">${label} <span class="reference-url">(${destination})</span></span>`;
          index = cursor; continue;
        }
      }
    }
    html += escape(value[index]); index++;
  }
  return html;
}

function cells(line) {
  const values = []; let cell = '', ticks = '';
  const text = line.trim();
  for (let index = 0; index < text.length; index++) {
    if (text[index] === '\\' && text[index + 1] === '|') { cell += '\\|'; index++; continue; }
    if (text[index] === '`') {
      const run = /^`+/.exec(text.slice(index))[0];
      if (!ticks) ticks = run; else if (ticks === run) ticks = '';
      cell += run; index += run.length - 1; continue;
    }
    if (text[index] === '|' && !ticks) { values.push(cell.trim()); cell = ''; }
    else cell += text[index];
  }
  values.push(cell.trim());
  if (values[0] === '') values.shift();
  if (values.at(-1) === '') values.pop();
  return values;
}

const heading = line => /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
const fence = line => /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
const item = line => /^( *)([-+*]|\d+[.)]) +(.*)$/.exec(line);
const rule = line => /^ {0,3}(?:\*\s*){3,}$|^ {0,3}(?:-\s*){3,}$|^ {0,3}(?:_\s*){3,}$/.test(line);
function tableAt(lines, index) {
  if (!lines[index]?.includes('|') || !lines[index + 1]) return false;
  const columns = cells(lines[index]), separators = cells(lines[index + 1]);
  return columns.length > 0 && columns.length === separators.length && separators.every(value => /^:?-{3,}:?$/.test(value));
}
const startsBlock = (lines, index) => heading(lines[index]) || fence(lines[index]) || item(lines[index])
  || /^ {0,3}>/.test(lines[index]) || rule(lines[index]) || tableAt(lines, index);

function blocks(lines, depth = 0, locale = 'ko', images = {}) {
  if (depth > 32) return `<p>${escape(lines.join('\n'))}</p>`;
  const output = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const opened = fence(line);
    if (opened) {
      const code = [], closing = new RegExp(`^ {0,3}${opened[1][0]}{${opened[1].length},}\\s*$`);
      for (index++; index < lines.length && !closing.test(lines[index]); index++) code.push(lines[index]);
      if (index < lines.length) index++;
      output.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`); continue;
    }
    const title = heading(line);
    if (title) { output.push(`<h${title[1].length}>${inline(title[2], 0, images)}</h${title[1].length}>`); index++; continue; }
    if (rule(line)) { output.push('<hr>'); index++; continue; }
    if (/^ {0,3}>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^ {0,3}>/.test(lines[index])) quote.push(lines[index++].replace(/^ {0,3}> ?/, ''));
      output.push(`<blockquote>${blocks(quote, depth + 1, locale, images)}</blockquote>`); continue;
    }
    if (tableAt(lines, index)) {
      const headers = cells(line), rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes('|')) {
        const row = cells(lines[index++]);
        rows.push(`<tr>${headers.map((_, column) => `<td>${inline(row[column] ?? '', 0, images)}</td>`).join('')}</tr>`);
      }
      output.push(`<div class="table-scroll"><table><thead><tr>${headers.map(value => `<th scope="col">${inline(value, 0, images)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`);
      continue;
    }
    const first = item(line);
    if (first) {
      const indentation = first[1].length, ordered = /^\d/.test(first[2]), tag = ordered ? 'ol' : 'ul';
      const start = ordered && Number.parseInt(first[2], 10) !== 1 ? ` start="${Number.parseInt(first[2], 10)}"` : '';
      const items = [];
      while (index < lines.length) {
        const next = item(lines[index]);
        if (!next || next[1].length !== indentation || /^\d/.test(next[2]) !== ordered) break;
        const contentIndent = lines[index].length - next[3].length, content = [next[3]];
        index++;
        while (index < lines.length) {
          if (!lines[index].trim()) { content.push(''); index++; continue; }
          const nested = item(lines[index]);
          if (nested && nested[1].length <= indentation) break;
          if (lines[index].match(/^ */)[0].length <= indentation) break;
          content.push(lines[index].slice(Math.min(contentIndent, lines[index].match(/^ */)[0].length))); index++;
        }
        const task = /^\[([ xX])\]\s+/.exec(content[0]);
        let marker = '';
        if (task) {
          content[0] = content[0].slice(task[0].length);
          const complete = task[1] !== ' ';
          const label = locale === 'en' ? (complete ? 'Complete' : 'Incomplete') : (complete ? '완료' : '미완료');
          marker = `<span class="checkmark" aria-label="${label}">${complete ? '☑' : '☐'}</span>`;
        }
        items.push(`<li${task ? ' class="task-item"' : ''}>${marker}${blocks(content, depth + 1, locale, images)}</li>`);
      }
      output.push(`<${tag}${start}>${items.join('')}</${tag}>`); continue;
    }
    const paragraph = [line.trim()]; index++;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) paragraph.push(lines[index++].trim());
    output.push(`<p>${inline(paragraph.join(' '), 0, images)}</p>`);
  }
  return output.join('');
}

/** Render the guide's Markdown subset to a fully escaped, self-contained HTML document. */
export function renderOfflineGuide(title, markdown, { locale = 'ko', kind = 'setup', images = {} } = {}) {
  if (typeof title !== 'string' || typeof markdown !== 'string') throw new TypeError('Guide title and Markdown must be strings.');
  if (!['ko', 'en'].includes(locale)) throw new TypeError('Unsupported guide locale.');
  if (!['setup', 'user'].includes(kind)) throw new TypeError('Unsupported guide kind.');
  for (const [reference, data] of Object.entries(images)) {
    if (!/^images\/[a-z.-]+\.png$/.test(reference) || typeof data !== 'string'
      || data.length > 1_400_000 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw new TypeError('Only bounded bundled PNG images are allowed in offline guides.');
    }
  }
  const eyebrow = locale === 'en' ? (kind === 'user' ? 'Offline user guide' : 'Offline setup guide') : (kind === 'user' ? '오프라인 사용 가이드' : '오프라인 설치 안내');
  const footer = locale === 'en' ? 'Links are shown as reference text. Open guides from the Bridge menu. This window does not open external sites or fetch external content.' : '링크는 참고용 텍스트입니다. 다른 가이드는 브리지 메뉴에서 여세요. 이 창에서는 외부 사이트로 이동하거나 외부 자료를 불러오지 않습니다.';
  const content = blocks(markdown.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n'), 0, locale, images);
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escape(title)}</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;color:#202533;background:#f4f6fa;font-size:16px;line-height:1.8}
*{box-sizing:border-box}body{margin:0;padding:40px 24px 64px}main{max-width:960px;margin:0 auto;padding:44px 52px;background:#fff;border:1px solid #e1e6ef;border-radius:16px}
.eyebrow{margin:0 0 20px;color:#4d6186;font-size:.8rem;font-weight:700;letter-spacing:.08em}h1,h2,h3,h4,h5,h6{line-height:1.4;letter-spacing:-.025em;overflow-wrap:anywhere}h1{font-size:2rem;margin:0 0 28px}h2{font-size:1.45rem;margin:48px 0 18px;padding-top:24px;border-top:1px solid #e4e9f0}h3{font-size:1.12rem;margin:28px 0 12px}p{margin:12px 0;word-break:keep-all;overflow-wrap:anywhere}
strong{font-weight:700;color:#172743}ul,ol{padding-left:1.65rem;margin:16px 0}li{padding-left:.3rem;margin:10px 0}li>p{margin:5px 0}li>ul,li>ol{margin:8px 0}.task-item{list-style:none}.task-item>p:first-of-type{display:inline}.checkmark{display:inline-block;margin-left:-1.5rem;margin-right:.55rem;color:#3d5e96}
blockquote{margin:24px 0;padding:12px 20px;background:#eef3fb;border-left:4px solid #6482b5;border-radius:0 8px 8px 0;color:#3d4f6d}blockquote p{margin:6px 0}
code{font: .88em/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:#f0f3f8;border:1px solid #e4e8f0;border-radius:4px;padding:2px 5px;overflow-wrap:anywhere}pre{padding:20px;background:#f3f5f9;border:1px solid #dfe5ee;border-radius:10px;white-space:pre-wrap;overflow-wrap:anywhere}pre code{padding:0;border:0;background:none;white-space:inherit}
.table-scroll{overflow-x:auto;margin:20px 0;border:1px solid #dfe5ee;border-radius:8px}table{border-collapse:collapse;width:100%;min-width:520px;font-size:.92rem}th,td{text-align:left;vertical-align:top;padding:12px 16px;border-bottom:1px solid #e4e9f0;overflow-wrap:anywhere}th{background:#f1f4f9;font-weight:700}td:first-child{min-width:9rem}tr:last-child td{border-bottom:0}.guide-image{display:block;width:auto;max-width:100%;height:auto;border:1px solid #dfe5ee;border-radius:8px;margin:20px 0}.reference-url{font-size:.88em;color:#536783;overflow-wrap:anywhere}hr{border:0;border-top:1px solid #e4e9f0;margin:28px 0}.offline-note{max-width:960px;margin:20px auto;color:#667085;font-size:.85rem}
@media(max-width:640px){body{padding:16px 10px 32px}main{padding:26px 20px;border-radius:10px}h1{font-size:1.55rem}h2{font-size:1.25rem}pre{padding:14px}th,td{padding:10px 12px}}
@media print{body{padding:0;background:#fff}main{padding:0;border:0;max-width:none}h2{break-after:avoid}.table-scroll{overflow:visible}pre,blockquote{break-inside:avoid}}
</style></head><body><main><div class="eyebrow">${eyebrow}</div>${content}</main>
<p class="offline-note">${footer}</p></body></html>`;
}
