// Small, safe Markdown renderer for companion replies (escapes all HTML first).
(function () {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = esc(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" data-link="$2">$1</a>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[i])}</code>`);
  }

  window.renderMarkdown = function (src) {
    const lines = src.replace(/\r/g, '').split('\n');
    let html = '', i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const fence = line.match(/^```(\w*)/);
      if (fence) {
        const buf = []; i++;
        while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
        i++;
        html += `<pre><button class="copy">Copy</button><code>${esc(buf.join('\n'))}</code></pre>`;
        continue;
      }
      const h = line.match(/^(#{1,3})\s+(.*)/);
      if (h) { html += `<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`; i++; continue; }
      if (/^\s*[-*]\s+/.test(line)) {
        html += '<ul>';
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) html += `<li>${inline(lines[i++].replace(/^\s*[-*]\s+/, ''))}</li>`;
        html += '</ul>'; continue;
      }
      if (/^\s*\d+[.)]\s+/.test(line)) {
        html += '<ol>';
        while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) html += `<li>${inline(lines[i++].replace(/^\s*\d+[.)]\s+/, ''))}</li>`;
        html += '</ol>'; continue;
      }
      if (/^\|.*\|\s*$/.test(line)) {
        const rows = [];
        while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        const cells = (r) => r.trim().slice(1, -1).split('|').map((c) => c.trim());
        const body = rows.filter((r) => !/^\|[\s:-|]+\|$/.test(r.trim()));
        html += '<table>' + body.map((r, ri) => '<tr>' + cells(r).map((c) => ri === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</table>';
        continue;
      }
      if (line.startsWith('> ')) {
        const buf = [];
        while (i < lines.length && lines[i].startsWith('> ')) buf.push(lines[i++].slice(2));
        html += `<blockquote>${inline(buf.join(' '))}</blockquote>`; continue;
      }
      if (!line.trim()) { i++; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,3}\s|\s*[-*]\s|\s*\d+[.)]\s|> |\|)/.test(lines[i])) buf.push(lines[i++]);
      if (!buf.length) buf.push(lines[i++]);
      html += `<p>${buf.map(inline).join('<br>')}</p>`;
    }
    return html;
  };
})();
