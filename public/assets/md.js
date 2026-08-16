// 轻量安全的 Markdown 渲染器（前台详情与后台预览共用）
// 支持子集：标题 #~####、加粗 **、斜体 *、行内代码 `、链接 []()、图片 ![]()、
// 无序/有序列表、引用 >、分隔线 ---、代码块 ```、换行。
// 安全策略：先整体 HTML 转义，再仅生成受限标签；链接/图片仅允许 http(s) 与站内 / 开头路径。
(function (global) {
  'use strict';

  function escHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function safeUrl(u) {
    u = String(u || '').trim();
    if (/^https?:\/\//i.test(u) || u.charAt(0) === '/') return u;
    return null;
  }

  // 行内语法：图片/链接/行内代码先抽成占位符 \x00N\x00，避免其内容被后续语法处理
  function renderInline(text, stash) {
    function token(html) { return '\x00' + (stash.push(html) - 1) + '\x00'; }

    var s = escHtml(text);

    // 行内代码 `code`
    s = s.replace(/`([^`\n]+)`/g, function (m, code) {
      return token('<code>' + code + '</code>');
    });

    // 图片 ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (m, alt, url) {
      var u = safeUrl(url);
      return u ? token('<img src="' + u + '" alt="' + alt + '" loading="lazy">') : m;
    });

    // 链接 [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, txt, url) {
      var u = safeUrl(url);
      return u ? token('<a href="' + u + '" target="_blank" rel="noopener">' + txt + '</a>') : m;
    });

    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

    // 还原占位符
    s = s.replace(/\x00(\d+)\x00/g, function (m, i) { return stash[+i] || ''; });
    return s;
  }

  function renderMarkdown(md) {
    var lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;
    var stash = [];

    while (i < lines.length) {
      var line = lines[i];

      // 空行
      if (!line.trim()) { i++; continue; }

      // 代码块 ```
      if (/^```/.test(line.trim())) {
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
        i++; // 跳过结尾 ```
        out.push('<pre><code>' + escHtml(buf.join('\n')) + '</code></pre>');
        continue;
      }

      // 分隔线
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // 标题
      var h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        var level = h[1].length;
        out.push('<h' + (level + 2) + '>' + renderInline(h[2], stash) + '</h' + (level + 2) + '>');
        i++;
        continue;
      }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          q.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + renderInline(q.join(' '), stash) + '</blockquote>');
        continue;
      }

      // 无序列表
      if (/^\s*[-*]\s+/.test(line)) {
        var items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
          items.push('<li>' + renderInline(lines[i].replace(/^\s*[-*]\s+/, ''), stash) + '</li>');
          i++;
        }
        out.push('<ul>' + items.join('') + '</ul>');
        continue;
      }

      // 有序列表
      if (/^\s*\d+[.、]\s+/.test(line)) {
        var ol = [];
        while (i < lines.length && /^\s*\d+[.、]\s+/.test(lines[i])) {
          ol.push('<li>' + renderInline(lines[i].replace(/^\s*\d+[.、]\s+/, ''), stash) + '</li>');
          i++;
        }
        out.push('<ol>' + ol.join('') + '</ol>');
        continue;
      }

      // 段落：连续非空行合并，段内单换行转 <br>
      var para = [];
      while (i < lines.length && lines[i].trim() &&
             !/^(#{1,4})\s/.test(lines[i]) &&
             !/^\s*[-*]\s+/.test(lines[i]) &&
             !/^\s*\d+[.、]\s+/.test(lines[i]) &&
             !/^\s*>/.test(lines[i]) &&
             !/^```/.test(lines[i].trim())) {
        para.push(lines[i]);
        i++;
      }
      out.push('<p>' + renderInline(para.join('\n'), stash).replace(/\n/g, '<br>') + '</p>');
    }

    return out.join('\n');
  }

  // 纯文本摘要：给商品卡片两行简介用（去掉图片/链接/标记语法）
  function markdownExcerpt(md, maxLen) {
    var s = String(md || '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')   // 图片
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // 链接保留文字
      .replace(/^#{1,4}\s+/gm, '')             // 标题标记
      .replace(/^\s*[-*]{3,}\s*$/gm, '')       // 分隔线
      .replace(/^\s*[-*]\s+/gm, '')            // 列表标记
      .replace(/^\s*\d+[.、]\s+/gm, '')        // 有序列表标记
      .replace(/^\s*>\s?/gm, '')               // 引用标记
      .replace(/[*`>]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (maxLen && s.length > maxLen) s = s.slice(0, maxLen) + '…';
    return s;
  }

  global.MD = { render: renderMarkdown, excerpt: markdownExcerpt };
})(window);
