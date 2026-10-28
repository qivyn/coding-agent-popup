// coding-agent-popup — hard-to-miss, Claude-styled popups for AI coding agents on macOS.
// https://github.com/qivyn/coding-agent-popup   (MIT License)
//
// Supports Claude Code (CLI & desktop) and OpenAI Codex (CLI & desktop) through their
// hook systems, plus any agent that speaks the same hook JSON.
//
// Usage (run with macOS's built-in JavaScript for Automation, no dependencies):
//   osascript -l JavaScript coding-agent-popup.js install [claude] [codex]   install + wire up hooks
//   osascript -l JavaScript coding-agent-popup.js uninstall                  remove hooks + files
//   osascript -l JavaScript coding-agent-popup.js check-updates              check the latest release
//   osascript -l JavaScript coding-agent-popup.js demo [ask|perm|done|codex] preview the popups
//   osascript -l JavaScript coding-agent-popup.js <agent>                    hook mode (JSON on stdin)
//
// Hook mode handles:
//   PermissionRequest / AskUserQuestion -> choice popup (allow / deny, or pick options)
//   PermissionRequest / anything else   -> permission popup
//   Stop                                -> "task complete" popup; notifications from all
//                                          sessions and agents merge into one window
// Anything you dismiss, ignore, or that fails falls back to the agent's normal UI.

if (typeof ObjC !== 'undefined') { ObjC.import('Foundation'); }

var VERSION = '0.2.0';

// ----------------------------------------------------------------------------
// Settings — edit these if you like
// ----------------------------------------------------------------------------
var TIMEOUT_SEC = 180;        // choice / permission popups: hand back to the app after this long
var DONE_TIMEOUT_SEC = 600;   // "task complete" window: auto-close after this long without activity
var WIN_WIDTH = 400;          // popup width in points: a tall, narrow card
var STAGGER_PX = 28;          // offset between stacked popups
var STALE_MS = 6000;          // a popup whose heartbeat is older than this is considered dead
var GRACE_MS = 1000;          // Codex and others: wait this long before a permission popup, in case it's settled anyway
var PROMPT_WAIT_SEC = 30;     // Claude Code: show anyway if its "needs your permission" notification never comes
var UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // background release checks: at most once a day
// Set AGENT_POPUP_CHECK_UPDATES=0 in the agent's environment to disable automatic checks.
// Language: follows macOS (Chinese if your first preferred language is Chinese, else English).
// Override with the AGENT_POPUP_LANG environment variable: "en" or "zh".

// ----------------------------------------------------------------------------
// Strings
// ----------------------------------------------------------------------------
var STRINGS = {
  en: {
    single: 'Choose one', multi: 'Select all that apply', other: 'Other — type your own…',
    keySelect: 'select', keyToggle: 'toggle', next: 'Next', submit: 'Submit', back: 'Back',
    handOff: 'Answer in app', handOffShort: 'answer in app',
    permTitle: '{agent} wants to {verb}', allow: 'Allow', deny: 'Deny',
    denyMessage: 'The user denied this in coding-agent-popup.',
    done: 'Task complete', doneN: '{n} tasks complete', gotIt: 'Got it', dismissAll: 'Dismiss all',
    open: 'Open {agent}', dismissOne: 'Dismiss', fallbackMsg: '{agent} finished the task.',
    otherNative: 'Other… (answer in app)', ok: 'OK',
    permN: '{n} requests need your approval', allowTop: 'allow the first', handOffAll: 'All to app',
    collapse: 'Collapse', expand: 'Click to open', pillPerm: '{n} waiting for approval', pillAsk: 'Question for you',
    clickFirst: 'click, then', close: 'Close', nUpdates: '{n} updates',
    remindTitle: '{agent} is still waiting for your approval', remindSub: 'Answer it in {agent}.',
    updateTitle: 'A new version is available', updateVersions: 'Installed {current} → latest {latest}',
    updateBody: 'View the release notes and installation instructions on GitHub.',
    viewRelease: 'View release', later: 'Dismiss',
    updateAvailable: 'coding-agent-popup {latest} is available (installed: {current}).',
    upToDate: 'coding-agent-popup {current} is up to date.', noRelease: 'No stable release has been published yet.',
    updateFailed: 'Could not check for updates. Try again later.', updateBusy: 'An update check is already running.',
    verbs: { Bash: 'run a command', Edit: 'edit a file', MultiEdit: 'edit a file', Write: 'write a file',
      Read: 'read a file', NotebookEdit: 'edit a notebook', WebFetch: 'fetch a web page',
      WebSearch: 'search the web', Glob: 'find files', Grep: 'search file contents',
      apply_patch: 'edit files', _default: 'use {tool}' }
  },
  zh: {
    single: '选择一项', multi: '可多选', other: '其他，自己输入…',
    keySelect: '选择', keyToggle: '勾选', next: '下一步', submit: '提交', back: '上一步',
    handOff: '去应用里处理', handOffShort: '去应用',
    permTitle: '{agent} 想要{verb}', allow: '允许', deny: '拒绝',
    denyMessage: '用户在弹窗中拒绝了此操作',
    done: '任务完成', doneN: '{n} 个任务完成', gotIt: '知道了', dismissAll: '全部知道了',
    open: '打开 {agent}', dismissOne: '关闭这条', fallbackMsg: '{agent} 已完成当前任务。',
    otherNative: '其他…（去应用里自己输入）', ok: '确定',
    permN: '{n} 个请求等你审批', allowTop: '允许第一条', handOffAll: '全部去应用里处理',
    collapse: '收起', expand: '点击展开', pillPerm: '{n} 个审批待处理', pillAsk: '有问题等你回答',
    clickFirst: '点一下弹窗后', close: '关闭', nUpdates: '{n} 条更新',
    remindTitle: '{agent} 还在等你审批', remindSub: '请到 {agent} 里处理。',
    updateTitle: '发现新版本', updateVersions: '当前 {current} → 最新 {latest}',
    updateBody: '前往 GitHub 查看更新说明和安装方法。', viewRelease: '查看新版本', later: '关闭',
    updateAvailable: 'coding-agent-popup 有新版本 {latest}（当前：{current}）。',
    upToDate: 'coding-agent-popup {current} 已是最新版本。', noRelease: '暂时还没有发布正式版本。',
    updateFailed: '检查更新失败，请稍后重试。', updateBusy: '正在检查更新，请稍后重试。',
    verbs: { Bash: '运行命令', Edit: '修改文件', MultiEdit: '修改文件', Write: '写入文件',
      Read: '读取文件', NotebookEdit: '修改笔记本', WebFetch: '访问网页',
      WebSearch: '搜索网页', Glob: '查找文件', Grep: '搜索文件内容',
      apply_patch: '修改文件', _default: '使用 {tool}' }
  }
};

function fmt(s, vars) {
  return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? vars[k] : m; });
}

function envVar(name) {
  try { return ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey(name)) || ''; } catch (e) { return ''; }
}

function detectLang() {
  try {
    var env = envVar('AGENT_POPUP_LANG');
    if (STRINGS[env]) return env;
    var langs = ObjC.deepUnwrap($.NSLocale.preferredLanguages) || [];
    return String(langs[0] || '').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
  } catch (e) { return 'en'; }
}

var _str = null;
function S() { if (!_str) _str = STRINGS[detectLang()]; return _str; }

// ----------------------------------------------------------------------------
// Agents
// ----------------------------------------------------------------------------
// The first command-line argument names the agent. Unknown names still work (generic icon).
var AGENTS = {
  claude: { name: 'Claude', icon: 'spark', app: ['Claude'] },
  codex:  { name: 'Codex',  icon: 'term',  app: ['Codex', 'ChatGPT'], theme: 'codex' }
};

function agentInfo(key) {
  key = String(key || 'claude').trim();
  var base = AGENTS[key.toLowerCase()] ||
    { name: key.charAt(0).toUpperCase() + key.slice(1), icon: 'term', app: [key] };
  var a = { key: key.toLowerCase(), name: base.name, icon: base.icon, theme: base.theme || '', app: base.app, host: '' };
  // The app that launched the agent (terminal, editor, desktop app) — "Open" jumps back to it.
  try {
    a.host = ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('__CFBundleIdentifier')) || '';
  } catch (e) {}
  return a;
}

// =============================================================================
// UI (HTML / CSS / JS rendered in a WKWebView)
// =============================================================================

var CSS = `
:root{
  --bg:#FAF9F5; --card:#FFFFFF; --text:#141413; --muted:#73726C; --faint:#A3A199;
  --border:#E8E6DC; --hover:#F0EEE6; --accent:#C96442; --accent-h:#B4552F;
  --accent-soft:#F7EDE7; --code:#F3F1EA;
}
@media (prefers-color-scheme: dark){
  :root{
    --bg:#262624; --card:#30302E; --text:#F5F4EE; --muted:#A6A39A; --faint:#7A786F;
    --border:#3E3D38; --hover:#383733; --accent:#D97757; --accent-h:#E38A6C;
    --accent-soft:#3D2C25; --code:#1F1E1C;
  }
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);
  font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif;
  -webkit-font-smoothing:antialiased;-webkit-user-select:none;cursor:default;overflow:hidden}
#app{padding:32px 20px 18px}
.top{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin-bottom:16px}
.spark{display:flex;color:var(--text)}
.brand{font-weight:600;color:var(--text)}
.sep{color:var(--faint);margin:0 -2px}
.chip{background:var(--hover);border-radius:6px;padding:1px 8px}
.chip.agent{font-weight:600;color:var(--text)}
.chip.agent.claude{background:var(--accent-soft);color:var(--accent)}
.chip.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.step{margin-left:auto;font-variant-numeric:tabular-nums}
.header{display:inline-block;font-size:11.5px;font-weight:600;letter-spacing:.02em;color:var(--accent);
  background:var(--accent-soft);border-radius:5px;padding:1px 7px;margin-bottom:8px}
h1{font-family:"Tiempos Text",Charter,Georgia,"Songti SC",serif;font-weight:500;font-size:19px;
  line-height:1.45;margin:0;letter-spacing:-.005em}
.sub{color:var(--muted);font-size:13px;margin-top:4px}
.opts{display:flex;flex-direction:column;gap:6px;margin:16px 0 18px}
.opt{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border:1px solid var(--border);
  border-radius:10px;background:var(--card);transition:border-color .12s,background .12s}
.opt:hover{background:var(--hover)}
.opt.cursor{border-color:var(--faint)}
.opt.sel{border-color:var(--accent);background:var(--accent-soft)}
.num{flex:none;width:22px;height:22px;border-radius:6px;background:var(--hover);
  color:var(--muted);font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center}
.opt.sel .num{background:var(--accent);color:#fff}
.body{flex:1;min-width:0;padding-top:1px}
.label{font-weight:500}
.desc{color:var(--muted);font-size:13px;margin-top:2px;line-height:1.45}
.check{flex:none;width:18px;height:18px;margin-top:2px;border-radius:5px;border:1.5px solid var(--faint);
  display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px}
.opt.sel .check{background:var(--accent);border-color:var(--accent)}
.opt.sel .check::after{content:"✓"}
.other-input{width:100%;border:none;outline:none;background:transparent;font:inherit;color:inherit;
  padding:0;-webkit-user-select:text;cursor:text}
.other-input::placeholder{color:var(--faint)}
pre.code{font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);
  border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin:14px 0 18px;
  white-space:pre-wrap;word-break:break-all;max-height:300px;overflow:auto;-webkit-user-select:text;cursor:text}
.done-mark{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;
  background:var(--accent-soft);color:var(--accent);font-size:13px;font-weight:700;margin-right:8px;vertical-align:2px}
.cards{display:flex;flex-direction:column;gap:8px;margin:14px 0 18px;max-height:520px;overflow:auto}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:9px 14px 12px}
.card.fresh{animation:fresh 1.6s ease-out}
@keyframes fresh{0%{border-color:var(--accent);background:var(--accent-soft)}100%{border-color:var(--border);background:var(--card)}}
.card-h{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted);margin-bottom:5px}
.card-h .time{font-variant-numeric:tabular-nums}
.card-h .x{margin-left:auto;width:22px;height:22px;border:none;border-radius:6px;background:transparent;
  color:var(--faint);font-size:15px;line-height:1;display:flex;align-items:center;justify-content:center}
.card-h .x:hover{background:var(--hover);color:var(--text)}
.cards,.card{min-width:0}
.msg{min-width:0;max-width:100%;overflow-wrap:anywhere;line-height:1.6;-webkit-user-select:text;cursor:text}
.cards.single .msg{max-height:360px;overflow:auto}
.cards.multi .msg.clamp{max-height:6.4em;overflow:hidden;cursor:pointer;
  -webkit-mask-image:linear-gradient(to bottom,#000 70%,transparent)}
.md > :first-child{margin-top:0}
.md > :last-child{margin-bottom:0}
.md p{margin:0 0 6px}
.md .md-h{font-weight:600;margin:8px 0 4px}
.md ul,.md ol{margin:2px 0 6px;padding-left:20px}
.md li{margin:1px 0}
.md blockquote{margin:4px 0 6px;padding:2px 0 2px 10px;border-left:3px solid var(--border);color:var(--muted)}
.md code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);border-radius:4px;padding:1px 4px}
.md pre.md-code{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);border:1px solid var(--border);
  border-radius:8px;padding:8px 10px;margin:4px 0 8px;white-space:pre-wrap;word-break:break-all}
.md hr{border:none;border-top:1px solid var(--border);margin:8px 0}
.md .md-link{text-decoration:underline;text-decoration-color:var(--faint)}
.md .md-table{max-width:100%;overflow-x:auto;margin:4px 0 8px}
.md th,.md td{overflow-wrap:normal;word-break:normal;min-width:3em}
.md table{border-collapse:collapse;font-size:12.5px;width:100%}
.md th,.md td{border:1px solid var(--border);padding:4px 7px;text-align:left;vertical-align:top}
.md th{background:var(--hover);font-weight:600}
.entry + .entry{border-top:1px dashed var(--border);margin-top:8px;padding-top:8px}
.entry-time{font-size:11px;color:var(--faint);font-variant-numeric:tabular-nums;margin-bottom:2px}
.card-h .count{color:var(--faint)}
.card-actions{display:flex;justify-content:flex-end;margin-top:8px}
.footer{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px}
.keys{order:2;flex-basis:100%;color:var(--faint);font-size:12px;white-space:nowrap;margin-top:2px}
kbd{font:11px ui-monospace,Menlo,monospace;color:var(--muted);border:1px solid var(--border);
  border-bottom-width:2px;border-radius:4px;padding:0 4px;margin:0 1px;background:var(--card)}
.btn{font:inherit;font-size:13px;font-weight:500;border-radius:8px;padding:6px 14px;
  border:1px solid var(--border);background:var(--card);color:var(--text);cursor:default}
.btn:hover{background:var(--hover)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff}
.btn.primary:hover{background:var(--accent-h);border-color:var(--accent-h)}
.btn.ghost{background:transparent;border-color:transparent;color:var(--muted)}
.btn.ghost:hover{background:var(--hover)}
.btn:disabled{opacity:.4;pointer-events:none}
.btn.small{font-size:12px;padding:4px 11px}
.fold{margin-left:auto;width:22px;height:22px;flex:none;border:none;border-radius:6px;background:transparent;
  color:var(--faint);display:flex;align-items:center;justify-content:center}
.step ~ .fold{margin-left:6px}
.fold:hover{background:var(--hover);color:var(--text)}
.card.req{padding:10px 14px 12px}
.req-title{font-weight:600;margin:2px 0 0}
pre.code.small{font-size:12px;padding:8px 11px;margin:8px 0 10px;max-height:120px}
.req-actions{display:flex;justify-content:flex-end;gap:6px}
#pill{display:none;align-items:center;gap:7px;height:38px;padding:0 16px;white-space:nowrap;
  font-size:13px;font-weight:500;color:var(--text);background:var(--bg);cursor:pointer;width:max-content}
#pill .spark{display:flex}
.collapsed #app{display:none}
.collapsed #pill{display:inline-flex}

/* Codex theme: used when every agent in the popup is Codex. Neutral greys, sans-serif
   headings, and a black (in dark mode, white) primary button. */
.theme-codex{
  --bg:#FFFFFF; --card:#FFFFFF; --text:#0D0D0D; --muted:#5D5D5D; --faint:#9B9B9B;
  --border:#E5E5E5; --hover:#F3F3F3; --accent:#0D0D0D; --accent-h:#2F2F2F;
  --accent-soft:#F0F0F0; --code:#F7F7F8; --on-accent:#FFFFFF;
}
@media (prefers-color-scheme: dark){
  .theme-codex{
    --bg:#181818; --card:#212121; --text:#ECECEC; --muted:#A3A3A3; --faint:#6E6E6E;
    --border:#2F2F2F; --hover:#2A2A2A; --accent:#ECECEC; --accent-h:#FFFFFF;
    --accent-soft:#2F2F2F; --code:#111111; --on-accent:#0D0D0D;
  }
}
.theme-codex h1{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC","Helvetica Neue",sans-serif;
  font-weight:600;font-size:17px;letter-spacing:-.01em}
.theme-codex .btn{border-radius:999px;padding:6px 16px}
.theme-codex .btn.primary,.theme-codex .opt.sel .num,.theme-codex .opt.sel .check{color:var(--on-accent)}
.theme-codex .spark{color:var(--text)}
.theme-codex .header{color:var(--text)}
.theme-codex .opt.sel{border-color:var(--text)}
.theme-codex .done-mark{background:var(--text);color:var(--on-accent);font-size:12px}
.theme-codex .chip.mono{border-radius:999px}`;

// Page -> native: the whole state object is written to document.title and polled by the native
//   side, so no message is ever lost: { n, h: content height, w: capsule width, collapsed,
//   dismissed: [ids], answers: [{id, action}], result }
// Native -> page: window.__add(items) adds notifications or requests, window.__remove(ids) drops
//   requests settled elsewhere, window.__expand() opens the window back up from its capsule.
var PAGE_JS = `
(function(){
  var D = window.__DATA__, T = D.t, app = document.getElementById('app'), done = false;
  var lastH = 0, lastW = 0, lastC = false, COLLAPSED = false;
  var STATE = { n: 0, dismissed: [] };
  var pill = document.createElement('div');
  pill.id = 'pill';
  document.body.appendChild(pill);

  function post(o){ for (var k in o) STATE[k] = o[k]; STATE.n++; document.title = JSON.stringify(STATE); }
  function finish(o){ if (done) return; done = true; post({ result: o }); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function fmt(s, v){ return String(s).replace(/\\{(\\w+)\\}/g, function(m, k){ return v && v[k] != null ? v[k] : m; }); }

  // A small Markdown renderer for agent replies: paragraphs, headings, lists, quotes, tables,
  // code, bold, italic, strikethrough, inline code and link text. Every piece of text goes through
  // esc() before any tag is added, so nothing in a reply can become live HTML. Links show as text.
  function mdInline(s){
    var codes = [];
    s = esc(s).replace(/\\x60([^\\x60]+)\\x60/g, function(m, c){ codes.push(c); return '\\u0000' + (codes.length - 1) + '\\u0000'; });
    s = s.replace(/!\\[([^\\]]*)\\]\\([^)]*\\)/g, '$1')
      .replace(/\\[([^\\]]+)\\]\\([^)]*\\)/g, '<span class="md-link">$1</span>')
      .replace(/\\*\\*(.+?)\\*\\*|__(.+?)__/g, function(m, a, b){ return '<strong>' + (a || b) + '</strong>'; })
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/(^|[^*\\w])\\*(?!\\s)([^*\\n]+?)\\*(?!\\w)/g, '$1<em>$2</em>');
    return s.replace(/\\u0000(\\d+)\\u0000/g, function(m, i){ return '<code>' + codes[+i] + '</code>'; });
  }
  function md(src){
    var lines = String(src == null ? '' : src).replace(/\\r\\n?/g, '\\n').split('\\n'), out = [], i = 0;
    var isRow = function(l){ return /^\\s*\\|.*\\|\\s*$/.test(l); };
    var isSep = function(l){ return /^\\s*\\|?(\\s*:?-+:?\\s*\\|)+\\s*:?-*:?\\s*\\|?\\s*$/.test(l); };
    var cells = function(l){ return l.trim().replace(/^\\||\\|$/g, '').split('|').map(function(c){ return c.trim(); }); };
    var block = function(re){ return re.test(lines[i]); };
    while (i < lines.length) {
      var l = lines[i];
      if (!l.trim()) { i++; continue; }
      var fence = /^\\s*(\\x60\\x60\\x60|~~~)/.exec(l);
      if (fence) {
        var code = []; i++;
        while (i < lines.length && lines[i].trim().indexOf(fence[1]) !== 0) code.push(lines[i++]);
        i++;
        out.push('<pre class="md-code">' + esc(code.join('\\n')) + '</pre>');
        continue;
      }
      var hd = /^\\s*#{1,6}\\s+(.*)$/.exec(l);
      if (hd) { out.push('<div class="md-h">' + mdInline(hd[1]) + '</div>'); i++; continue; }
      if (/^\\s*(?:(?:-\\s*){3,}|(?:\\*\\s*){3,}|(?:_\\s*){3,})$/.test(l)) { out.push('<hr>'); i++; continue; }
      if (isRow(l) && i + 1 < lines.length && isSep(lines[i + 1])) {
        var head = cells(l), rows = []; i += 2;
        while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
        out.push('<div class="md-table"><table><thead><tr>' + head.map(function(c){ return '<th>' + mdInline(c) + '</th>'; }).join('')
          + '</tr></thead><tbody>' + rows.map(function(r){ return '<tr>' + r.map(function(c){ return '<td>' + mdInline(c) + '</td>'; }).join('') + '</tr>'; }).join('')
          + '</tbody></table></div>');
        continue;
      }
      if (block(/^\\s*>/)) {
        var q = [];
        while (i < lines.length && /^\\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\\s*>\\s?/, ''));
        out.push('<blockquote>' + md(q.join('\\n')) + '</blockquote>');
        continue;
      }
      var li = /^(\\s*)([-*+]|\\d+[.)])\\s+/;
      if (li.test(l)) {
        var ordered = /\\d/.test(li.exec(l)[2]), items = [];
        while (i < lines.length && (li.test(lines[i]) || (/^\\s{2,}\\S/.test(lines[i]) && items.length))) {
          var m = li.exec(lines[i]);
          if (m) items.push(lines[i].slice(m[0].length).replace(/^\\[[ xX]\\]\\s+/, ''));
          else items[items.length - 1] += ' ' + lines[i].trim();
          i++;
        }
        var tag = ordered ? 'ol' : 'ul';
        out.push('<' + tag + '>' + items.map(function(x){ return '<li>' + mdInline(x) + '</li>'; }).join('') + '</' + tag + '>');
        continue;
      }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^\\s*(\\x60\\x60\\x60|~~~|#{1,6}\\s|>)/.test(lines[i])
             && !li.test(lines[i]) && !(isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1]))) para.push(lines[i++]);
      out.push('<p>' + para.map(mdInline).join('<br>') + '</p>');
    }
    return out.join('');
  }

  function size(){
    var r = (COLLAPSED ? pill : app).getBoundingClientRect();
    var h = Math.ceil(r.height), w = COLLAPSED ? Math.ceil(r.width) : 0;
    if (h !== lastH || w !== lastW || COLLAPSED !== lastC){ lastH = h; lastW = w; lastC = COLLAPSED; post({ h: h, w: w, collapsed: COLLAPSED }); }
  }
  if (window.ResizeObserver) { var ro = new ResizeObserver(size); ro.observe(app); ro.observe(pill); }

  // Collapse to a small capsule and back. The native side moves and resizes the window.
  var pillLabel = '', pillAgents = [];
  function renderPill(){
    pill.innerHTML = uniqAgents(pillAgents).map(function(a){
      return '<span class="spark">' + (ICONS[a.icon] || ICONS.term) + '</span>'; }).join('')
      + '<span class="pill-text">' + esc(pillLabel) + '</span>';
    pill.title = T.expand;
  }
  function setPill(label, agents){ pillLabel = label; pillAgents = agents || []; if (COLLAPSED) { renderPill(); size(); } }
  function collapse(){
    if (done || COLLAPSED) return;
    COLLAPSED = true; renderPill();
    document.documentElement.classList.add('collapsed');
    size();
  }
  window.__expand = function(){
    if (!COLLAPSED) return;
    COLLAPSED = false;
    document.documentElement.classList.remove('collapsed');
    size();
  };
  pill.addEventListener('click', function(){ window.__expand(); });
  document.addEventListener('click', function(e){
    var t = e.target;
    while (t && t !== document) { if (t.hasAttribute && t.hasAttribute('data-fold')) { e.preventDefault(); collapse(); return; } t = t.parentNode; }
  });

  var ICONS = {
    spark: '<svg width="16" height="16" viewBox="0 0 24 24"><g stroke="#D97757" stroke-width="2.6" stroke-linecap="round">'
      + '<path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6L6 18"/></g></svg>',
    term: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" '
      + 'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3.5"/>'
      + '<path d="M7.5 9.5l3 2.5-3 2.5M13 15h3.5"/></svg>'
  };
  var DEFAULT_AGENT = { name: 'Claude', icon: 'spark' };
  function uniqAgents(list){
    var seen = {}, out = [];
    list.forEach(function(a){ a = a || DEFAULT_AGENT; if (!seen[a.name]) { seen[a.name] = 1; out.push(a); } });
    return out;
  }
  // A popup takes an agent's own look only when every agent in it shares that theme.
  // Only the theme class is ours: <html> also carries "collapsed" while the popup is a capsule,
  // so assigning className here would open the popup but leave the page thinking it's collapsed.
  var themeClass = '';
  function applyTheme(agents){
    var themes = uniqAgents(agents).map(function(a){ return a.theme || ''; });
    var th = themes.length && themes.every(function(t){ return t === themes[0]; }) ? themes[0] : '';
    var cls = th ? 'theme-' + th : '';
    if (cls === themeClass) return;
    [document.documentElement, document.body].forEach(function(el){
      if (!el) return;
      if (themeClass) el.classList.remove(themeClass);
      if (cls) el.classList.add(cls);
    });
    themeClass = cls;
  }
  function top(project, rightHtml, agents){
    agents = agents && agents.length ? agents : [D.agent || DEFAULT_AGENT];
    var brand = agents.map(function(a){
      return '<span class="spark">' + (ICONS[a.icon] || ICONS.term) + '</span><span class="brand">' + esc(a.name) + '</span>';
    }).join('<span class="sep">·</span>');
    return '<div class="top">' + brand
      + (project ? '<span class="chip">' + esc(project) + '</span>' : '')
      + (rightHtml ? '<span class="step">' + rightHtml + '</span>' : '')
      + '<button class="fold" data-fold title="' + esc(T.collapse) + '">' + FOLD_ICON + '</button></div>';
  }
  var FOLD_ICON = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2.5 6h7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

  if (D.mode === 'update') {
    var updateAgent = { name: 'coding-agent-popup', icon: 'term' };
    setPill(T.updateTitle, [updateAgent]);
    app.innerHTML = top('', '', [updateAgent]) + '<h1>' + esc(T.updateTitle) + '</h1>'
      + '<div class="card"><p>' + esc(fmt(T.updateVersions, { current: D.current, latest: D.latest }))
      + '</p><p>' + esc(T.updateBody) + '</p></div>'
      + '<div class="footer"><button class="btn" data-a="ok">' + esc(T.later) + '</button>'
      + '<button class="btn primary" data-a="open">' + esc(T.viewRelease) + '</button></div>';
    app.querySelector('[data-a=ok]').onclick = function(){ finish({ action: 'ok' }); };
    app.querySelector('[data-a=open]').onclick = function(){ finish({ action: 'open' }); };
    document.addEventListener('keydown', function(e){
      if (done || COLLAPSED) return;
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); finish({ action: 'ok' }); }
    });
    size();
  }

  // ------------------------------ question with options ------------------------------
  if (D.mode === 'ask') applyTheme([D.agent || DEFAULT_AGENT]);

  if (D.mode === 'ask') {
    var Q = D.questions, qi = 0;
    var sel = Q.map(function(){ return []; });
    var other = Q.map(function(){ return ''; });
    var cur = Q.map(function(){ return -1; });

    var count = function(q){ return q.options.length + 1; };          // last row is "Other"
    var otherIdx = function(q){ return q.options.length; };

    var ok = function(){
      var q = Q[qi], s = sel[qi];
      if (!s.length) return false;
      if (s.indexOf(otherIdx(q)) !== -1 && !other[qi].trim()) return false;
      return true;
    };

    var paint = function(){
      var s = sel[qi], q = Q[qi];
      Array.prototype.forEach.call(app.querySelectorAll('.opt'), function(el){
        var i = +el.getAttribute('data-i');
        el.classList.toggle('sel', s.indexOf(i) !== -1);
        el.classList.toggle('cursor', !!q.multiSelect && cur[qi] === i);
      });
      var nb = app.querySelector('[data-a=next]');
      if (nb) nb.disabled = !ok();
    };

    var focusOther = function(on){
      var inp = app.querySelector('.other-input');
      if (!inp) return;
      if (on) inp.focus(); else inp.blur();
    };

    var choose = function(i){
      var q = Q[qi], s = sel[qi];
      if (q.multiSelect) {
        var k = s.indexOf(i);
        if (k === -1) s.push(i); else s.splice(k, 1);
      } else {
        sel[qi] = [i];
      }
      cur[qi] = i;
      focusOther(i === otherIdx(q) && sel[qi].indexOf(i) !== -1);
      paint();
    };

    var ensureOther = function(){
      var q = Q[qi], oi = otherIdx(q);
      if (q.multiSelect) { if (sel[qi].indexOf(oi) === -1) sel[qi].push(oi); }
      else sel[qi] = [oi];
      cur[qi] = oi;
    };

    var submit = function(){
      var answers = {};
      Q.forEach(function(q, k){
        var labels = sel[k].slice().sort(function(a, b){ return a - b; }).map(function(i){
          return i === otherIdx(q) ? other[k].trim() : q.options[i].label;
        });
        answers[q.question] = labels.join(', ');
      });
      finish({ action: 'submit', answers: answers });
    };

    var next = function(){
      if (!ok()) return;
      if (qi < Q.length - 1) { qi++; render(); } else submit();
    };

    var render = function(){
      var q = Q[qi], n = count(q), oi = otherIdx(q), last = qi === Q.length - 1;
      var h = top(D.project, Q.length > 1 ? (qi + 1) + ' / ' + Q.length : '');
      if (q.header) h += '<div class="header">' + esc(q.header) + '</div>';
      h += '<h1>' + esc(q.question) + '</h1>';
      h += '<div class="sub">' + esc(q.multiSelect ? T.multi : T.single) + '</div>';
      h += '<div class="opts">';
      q.options.forEach(function(o, i){
        h += '<div class="opt" data-i="' + i + '"><span class="num">' + (i < 9 ? i + 1 : '·') + '</span>'
          + '<div class="body"><div class="label">' + esc(o.label) + '</div>'
          + (o.description ? '<div class="desc">' + esc(o.description) + '</div>' : '') + '</div>'
          + (q.multiSelect ? '<span class="check"></span>' : '') + '</div>';
      });
      h += '<div class="opt" data-i="' + oi + '"><span class="num">' + (oi < 9 ? oi + 1 : '·') + '</span>'
        + '<div class="body"><input class="other-input" placeholder="' + esc(T.other) + '" value="' + esc(other[qi]) + '"></div>'
        + (q.multiSelect ? '<span class="check"></span>' : '') + '</div>';
      h += '</div>';
      var range = n > 1 ? '<kbd>1</kbd>–<kbd>' + Math.min(n, 9) + '</kbd> ' : '';
      h += '<div class="footer"><div class="keys">' + range + esc(q.multiSelect ? T.keyToggle : T.keySelect)
        + ' · <kbd>↩</kbd> ' + esc(last ? T.submit : T.next) + '</div>'
        + '<button class="btn ghost" data-a="app">' + esc(T.handOff) + '</button>'
        + (qi > 0 ? '<button class="btn" data-a="prev">' + esc(T.back) + '</button>' : '')
        + '<button class="btn primary" data-a="next">' + esc(last ? T.submit : T.next) + '</button></div>';
      app.innerHTML = h;

      Array.prototype.forEach.call(app.querySelectorAll('.opt'), function(el){
        el.addEventListener('mousedown', function(e){
          var i = +el.getAttribute('data-i');
          if (e.target.classList && e.target.classList.contains('other-input')) { ensureOther(); paint(); return; }
          e.preventDefault();
          choose(i);
        });
      });
      var inp = app.querySelector('.other-input');
      inp.addEventListener('input', function(){ other[qi] = inp.value; ensureOther(); paint(); });
      app.querySelector('[data-a=app]').onclick = function(){ finish({ action: 'app' }); };
      var pv = app.querySelector('[data-a=prev]');
      if (pv) pv.onclick = function(){ qi--; render(); };
      app.querySelector('[data-a=next]').onclick = next;
      if (sel[qi].indexOf(oi) !== -1 && !q.multiSelect) inp.focus();
      paint();
      setPill(T.pillAsk, [D.agent || DEFAULT_AGENT]);
      size();
    };

    document.addEventListener('keydown', function(e){
      if (done || COLLAPSED) return;
      var q = Q[qi];
      var inInput = e.target && e.target.tagName === 'INPUT';
      if (e.key === 'Escape') { e.preventDefault(); finish({ action: 'app' }); return; }
      if (e.key === 'Enter') { e.preventDefault(); next(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        var c = cur[qi] + (e.key === 'ArrowDown' ? 1 : -1);
        c = Math.max(0, Math.min(count(q) - 1, c));
        cur[qi] = c;
        if (!q.multiSelect) sel[qi] = [c];
        focusOther(c === otherIdx(q));
        paint();
        return;
      }
      if (inInput) return;
      if (e.key === ' ' && q.multiSelect && cur[qi] >= 0) { e.preventDefault(); choose(cur[qi]); return; }
      if (/^[1-9]$/.test(e.key)) {
        var i = +e.key - 1;
        if (i < count(q)) { e.preventDefault(); choose(i); }
      }
    });

    render();
  }

  // ------------------------------ permission requests (mergeable) ------------------------------
  // One request shows as before. Requests that arrive while it's open join as cards, each with
  // its own buttons; every answer goes to the native side as STATE.answers [{id, action}].
  if (D.mode === 'perm') {
    var reqs = (D.items || [D]).map(function(it, i){ if (!it.id) it.id = 'req-' + i; return it; });
    var newReq = {};
    STATE.answers = [];

    var answer = function(id, action){
      if (done || !reqs.some(function(r){ return r.id === id; })) return;
      reqs = reqs.filter(function(r){ return r.id !== id; });
      STATE.answers.push({ id: id, action: action });
      post({});
      if (!reqs.length) finish({ action: action, id: id }); else renderPerm();
    };
    var answerAll = function(action){ reqs.slice().forEach(function(r){ answer(r.id, action); }); };
    var buttons = function(r, small){
      var c = small ? ' small' : '', id = esc(r.id);
      if (r.kind === 'remind') {               // already handed to the app: you can only go there
        return '<button class="btn' + c + '" data-a="app" data-id="' + id + '">' + esc(T.close) + '</button>'
          + '<button class="btn primary' + c + '" data-a="open" data-id="' + id + '">'
          + esc(fmt(T.open, { agent: (r.agent || DEFAULT_AGENT).name })) + '</button>';
      }
      return '<button class="btn ghost' + c + '" data-a="app" data-id="' + id + '">' + esc(T.handOff) + '</button>'
        + '<button class="btn' + c + '" data-a="deny" data-id="' + id + '">' + esc(T.deny) + '</button>'
        + '<button class="btn primary' + c + '" data-a="allow" data-id="' + id + '">' + esc(T.allow) + '</button>';
    };
    var title = function(r){
      var ag = (r.agent || DEFAULT_AGENT).name;
      return r.kind === 'remind' ? fmt(T.remindTitle, { agent: ag }) : fmt(T.permTitle, { agent: ag, verb: r.verb });
    };

    var renderPerm = function(){
      var agents = uniqAgents(reqs.map(function(r){ return r.agent; }));
      applyTheme(agents);
      var h;
      if (reqs.length === 1) {
        var r = reqs[0];
        h = top(r.project, '<span class="chip mono">' + esc(r.tool) + '</span>', [r.agent || DEFAULT_AGENT]);
        h += '<h1>' + esc(title(r)) + '</h1>';
        h += '<div class="sub">' + esc(r.kind === 'remind' ? fmt(T.remindSub, { agent: (r.agent || DEFAULT_AGENT).name }) : r.desc) + '</div>';
        h += '<pre class="code">' + esc(r.detail) + '</pre>';
        h += '<div class="footer"><div class="keys">' + esc(T.clickFirst) + ' · <kbd>↩</kbd> '
          + esc(r.kind === 'remind' ? fmt(T.open, { agent: (r.agent || DEFAULT_AGENT).name }) : T.allow)
          + ' · <kbd>esc</kbd> ' + esc(r.kind === 'remind' ? T.close : T.handOffShort) + '</div>' + buttons(r) + '</div>';
      } else {
        var mixed = agents.length > 1;
        h = top('', '', agents);
        h += '<h1>' + esc(fmt(T.permN, { n: reqs.length })) + '</h1>';
        h += '<div class="cards">';
        reqs.forEach(function(r){
          var ag = r.agent || DEFAULT_AGENT;
          h += '<div class="card req' + (newReq[r.id] ? ' fresh' : '') + '">'
            + '<div class="card-h">'
            + (mixed ? '<span class="chip agent ' + (ag.icon === 'spark' ? 'claude' : '') + '">' + esc(ag.name) + '</span>' : '')
            + (r.project ? '<span class="chip">' + esc(r.project) + '</span>' : '')
            + '<span class="chip mono">' + esc(r.tool) + '</span></div>'
            + '<div class="req-title">' + esc(title(r)) + '</div>'
            + (r.desc && r.kind !== 'remind' ? '<div class="sub">' + esc(r.desc) + '</div>' : '')
            + '<pre class="code small">' + esc(r.detail) + '</pre>'
            + '<div class="req-actions">' + buttons(r, true) + '</div></div>';
        });
        h += '</div>';
        h += '<div class="footer"><div class="keys">' + esc(T.clickFirst) + ' · <kbd>↩</kbd> ' + esc(T.allowTop)
          + ' · <kbd>esc</kbd> ' + esc(T.handOffShort) + '</div>'
          + '<button class="btn ghost" data-all="app">' + esc(T.handOffAll) + '</button></div>';
      }
      app.innerHTML = h;
      newReq = {};
      Array.prototype.forEach.call(app.querySelectorAll('[data-a]'), function(b){
        b.onclick = function(){ answer(b.getAttribute('data-id'), b.getAttribute('data-a')); };
      });
      var all = app.querySelector('[data-all]');
      if (all) all.onclick = function(){ answerAll('app'); };
      setPill(fmt(T.pillPerm, { n: reqs.length }), agents);
      size();
    };

    window.__add = function(arr){
      if (done) return;
      (arr || []).forEach(function(it){
        if (reqs.some(function(r){ return r.id === it.id; })) return;
        reqs.push(it);
        newReq[it.id] = true;
      });
      reqs.sort(function(a, b){ return (a.time || 0) - (b.time || 0); });   // oldest first: ↩ answers it
      renderPerm();
    };
    window.__remove = function(ids){           // settled elsewhere or timed out
      if (done) return;
      reqs = reqs.filter(function(r){ return (ids || []).indexOf(r.id) === -1; });
      if (!reqs.length) finish({ action: 'empty' }); else renderPerm();
    };

    // Keys reach the popup only after you click it (it never takes focus by itself), so ↩ is safe.
    document.addEventListener('keydown', function(e){
      if (done || COLLAPSED) return;
      if (e.key === 'Escape') { e.preventDefault(); answerAll('app'); }
      else if (e.key === 'Enter') { e.preventDefault(); answer(reqs[0].id, reqs[0].kind === 'remind' ? 'open' : 'allow'); }
    });
    renderPerm();
  }

  // ------------------------------ task complete (mergeable) ------------------------------
  if (D.mode === 'done') {
    var items = [];            // newest first
    var expanded = {};
    var fresh = {};

    var hhmm = function(t){
      var d = new Date(t || Date.now());
      return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    };

    // Notifications from the same agent and project share one card; each card opens its own session.
    var groupsOf = function(){
      var by = {}, out = [];
      items.forEach(function(it){                      // items are newest first
        var ag = it.agent || DEFAULT_AGENT, key = ag.name + '\u0000' + (it.project || '');
        if (!by[key]) { by[key] = { key: key, agent: ag, project: it.project || '', items: [] }; out.push(by[key]); }
        by[key].items.push(it);
      });
      return out;
    };
    var dropGroup = function(g){
      var ids = g.items.map(function(it){ return it.id; });
      items = items.filter(function(it){ return ids.indexOf(it.id) === -1; });
      ids.forEach(function(id){ STATE.dismissed.push(id); });
    };

    var renderDone = function(){
      if (!items.length) { finish({ action: 'ok' }); return; }
      var groups = groupsOf(), multi = items.length > 1, oneGroup = groups.length === 1;
      var agents = uniqAgents(items.map(function(it){ return it.agent; }));
      applyTheme(agents);
      setPill(multi ? fmt(T.doneN, { n: items.length }) : T.done, agents);
      var mixed = agents.length > 1;
      var h = top('', '', agents);
      h += '<h1><span class="done-mark">✓</span>' + esc(multi ? fmt(T.doneN, { n: items.length }) : T.done) + '</h1>';
      h += '<div class="cards ' + (oneGroup && !multi ? 'single' : 'multi') + '">';
      groups.forEach(function(g, gi){
        var ag = g.agent;
        h += '<div class="card' + (g.items.some(function(it){ return fresh[it.id]; }) ? ' fresh' : '') + '" data-g="' + gi + '">'
          + '<div class="card-h">'
          + (mixed ? '<span class="chip agent ' + (ag.icon === 'spark' ? 'claude' : '') + '">' + esc(ag.name) + '</span>' : '')
          + (g.project ? '<span class="chip">' + esc(g.project) + '</span>' : '')
          + (g.items.length > 1 ? '<span class="count">' + esc(fmt(T.nUpdates, { n: g.items.length })) + '</span>' : '<span class="time">' + hhmm(g.items[0].time) + '</span>')
          + (oneGroup ? '' : '<button class="x" title="' + esc(T.dismissOne) + '" data-x="' + gi + '">×</button>') + '</div>';
        g.items.forEach(function(it){
          var clamp = multi && !expanded[it.id];
          h += '<div class="entry">'
            + (g.items.length > 1 ? '<div class="entry-time">' + hhmm(it.time) + '</div>' : '')
            + '<div class="msg md' + (clamp ? ' clamp' : '') + '" data-id="' + esc(it.id) + '">'
            + (it.markdown ? md(it.markdown) : '<p>' + esc(it.message).replace(/\\n/g, '<br>') + '</p>') + '</div></div>';
        });
        if (!oneGroup) h += '<div class="card-actions"><button class="btn small" data-open="' + gi + '">'
          + esc(fmt(T.open, { agent: ag.name })) + '</button></div>';
        h += '</div>';
      });
      h += '</div>';
      h += '<div class="footer"><div class="keys"><kbd>↩</kbd> ' + esc(multi ? T.dismissAll : T.gotIt) + '</div>'
        + (oneGroup ? '<button class="btn" data-a="open">' + esc(fmt(T.open, { agent: groups[0].agent.name })) + '</button>' : '')
        + '<button class="btn primary" data-a="ok">' + esc(multi ? T.dismissAll : T.gotIt) + '</button></div>';
      app.innerHTML = h;
      fresh = {};

      var openBtn = app.querySelector('[data-a=open]');
      if (openBtn) openBtn.onclick = function(){ finish({ action: 'open', id: items[0].id }); };
      app.querySelector('[data-a=ok]').onclick = function(){ finish({ action: 'ok' }); };
      Array.prototype.forEach.call(app.querySelectorAll('[data-x]'), function(b){
        b.onclick = function(e){ e.stopPropagation(); dropGroup(groups[+b.getAttribute('data-x')]); post({}); renderDone(); };
      });
      Array.prototype.forEach.call(app.querySelectorAll('[data-open]'), function(b){
        b.onclick = function(){                        // open that session, keep the rest of the window
          var g = groups[+b.getAttribute('data-open')];
          STATE.opened = (STATE.opened || []).concat([g.items[0].id]);
          dropGroup(g); post({}); renderDone();
        };
      });
      Array.prototype.forEach.call(app.querySelectorAll('.cards.multi .msg'), function(m){
        m.onclick = function(){
          var id = m.getAttribute('data-id');
          if (window.getSelection && String(window.getSelection())) return;   // selecting text
          expanded[id] = !expanded[id];
          renderDone();
        };
      });
      size();
    };

    window.__add = function(arr){
      if (done) return;
      (arr || []).forEach(function(it){
        if (items.some(function(x){ return x.id === it.id; })) return;
        items.unshift(it);
        fresh[it.id] = true;
      });
      items.sort(function(a, b){ return (b.time || 0) - (a.time || 0); });
      renderDone();
    };

    document.addEventListener('keydown', function(e){
      if (done || COLLAPSED) return;
      if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); finish({ action: 'ok' }); }
    });

    items = (D.items || []).slice().sort(function(a, b){ return (b.time || 0) - (a.time || 0); });
    renderDone();
  }
})();
`;

function buildHTML(payload) {
  var data = JSON.stringify(payload)
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return '<!doctype html><html><head><meta charset="utf-8"><title></title><style>' + CSS +
    '</style></head><body><div id="app"></div><script>window.__DATA__=' + data + ';</script><script>' +
    PAGE_JS + '</script></body></html>';
}

// =============================================================================
// File helpers: locks, heartbeats, queue (kept in the per-user temp directory)
// =============================================================================

function fm() { return $.NSFileManager.defaultManager; }
function homeDir() { return ObjC.unwrap($.NSHomeDirectory()); }

function baseDir() {
  var d = ObjC.unwrap($.NSTemporaryDirectory()) || '/tmp/';
  if (d.slice(-1) !== '/') d += '/';
  d += 'coding-agent-popup/';
  ensureDir(d);
  return d;
}

// Pass $() (nil) for optional object arguments: on recent macOS, JXA turns a JS null into an
// NSNull object, which Cocoa then calls methods on and crashes. Error out-params take null fine.
function ensureDir(p) {
  fm().createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(p), true, $(), null);
}

function fileExists(p) { return !!fm().fileExistsAtPath($(p)); }

function readText(p) {
  var s = $.NSString.stringWithContentsOfFileEncodingError($(p), $.NSUTF8StringEncoding, null);
  return ObjC.unwrap(s) || '';
}

function writeText(p, s) {
  return !!$(s).writeToFileAtomicallyEncodingError($(p), true, $.NSUTF8StringEncoding, null);
}

function removePath(p) {
  try { fm().removeItemAtPathError($(p), null); } catch (e) {}
}

function listDir(p) {
  try { return ObjC.deepUnwrap(fm().contentsOfDirectoryAtPathError($(p), null)) || []; } catch (e) { return []; }
}

function mtimeMs(p) {
  try {
    var a = fm().attributesOfItemAtPathError($(p), null);
    if (!a || a.isNil()) return 0;
    return a.fileModificationDate.timeIntervalSince1970 * 1000;
  } catch (e) { return 0; }
}

function heartbeat(lockPath) { writeText(lockPath + '/hb', String(Date.now())); }

// Creating a directory is atomic, so it works as a lock. The owner refreshes a heartbeat;
// a lock with a stale heartbeat (crashed owner) is taken over.
function tryLock(lockPath) {
  for (var attempt = 0; attempt < 2; attempt++) {
    if (fm().createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(lockPath), false, $(), null)) {
      heartbeat(lockPath);
      return true;
    }
    var hb = parseInt(readText(lockPath + '/hb'), 10);
    var last = isNaN(hb) ? mtimeMs(lockPath) : hb;
    if (last && Date.now() - last > STALE_MS) { removePath(lockPath); continue; }
    return false;
  }
  return false;
}

// Claim a screen "slot" so simultaneous popups are staggered instead of stacked exactly.
function claimSlot() {
  var dir = baseDir() + 'slots/';
  ensureDir(dir);
  for (var i = 0; i < 12; i++) {
    var p = dir + 'slot-' + i;
    if (tryLock(p)) return { index: i, path: p };
  }
  return { index: 0, path: null };
}

// =============================================================================
// Native window (NSWindow + WKWebView)
// opts: { timeoutSec, onTick(ctx), onState(state), onBeat() }   onBeat keeps the caller's locks alive
// Returns {action: ...}, or null if the web UI failed to load (caller falls back to a native dialog).
// =============================================================================

// The popup isn't the key window until you click it, and a plain WKWebView swallows that first
// click. This subclass lets the first click land on the button under it.
function firstClickWebView() {
  var name = 'AgentPopupWebView';
  if ($[name] === undefined) {
    try {
      ObjC.registerSubclass({ name: name, superclass: 'WKWebView',
        methods: { 'acceptsFirstMouse:': { types: ['bool', ['id']], implementation: function () { return true; } } } });
    } catch (e) { return 'WKWebView'; }
  }
  return $[name] === undefined ? 'WKWebView' : name;
}

// Where a mouse-down starts a drag: the capsule anywhere, the popup from its top strip (the
// corners are left to the page: the fold button on the right, the window edge on the left).
function dragHit(collapsed, p, size) {
  if (collapsed) return true;
  var fromTop = size.height - p.y;
  return fromTop < 56 && p.x < size.width - 52;
}

// A drag runs its own event loop until the mouse goes up, so the main loop's ticks stop meanwhile.
// keepAlive() still runs every half second: a lock whose heartbeat stops looks crashed after
// STALE_MS, and another process would take it over and open a second window.
// step() handles one event and returns 'up' on mouse-up. now() is there for the tests.
function trackDrag(step, keepAlive, now) {
  now = now || Date.now;
  var until = now() + 60000, beat = now();
  while (now() < until) {
    if (now() - beat >= 500) { beat = now(); keepAlive(); }
    if (step() === 'up') return;
  }
}

function showWebWindow(payload, opts) {
  opts = opts || {};
  var timeoutSec = opts.timeoutSec || TIMEOUT_SEC;
  payload.t = payload.t || S();

  ObjC.import('Cocoa');
  ObjC.import('WebKit');

  var NSApp = $.NSApplication.sharedApplication;
  NSApp.setActivationPolicy(1);            // accessory: no Dock icon
  NSApp.finishLaunching;

  var slot = claimSlot();
  var offset = slot.index * STAGGER_PX;

  var W = WIN_WIDTH, H0 = 420;
  var rect = $.NSMakeRect(0, 0, W, H0);
  // A non-activating panel: it floats on top but never takes the keyboard from whatever you're
  // typing in. Clicking it makes it key (so its keys and text field work) without activating us.
  var styleMask = 1 | 2 | 128 | 32768;     // titled | closable | non-activating | full-size content view
  var win = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(rect, styleMask, 2, false);
  win.setReleasedWhenClosed(false);
  try { win.setFloatingPanel(true); win.setHidesOnDeactivate(false); win.setBecomesKeyOnlyIfNeeded(false); } catch (e) {}
  win.setTitlebarAppearsTransparent(true);
  win.setTitleVisibility(1);
  [0, 1, 2].forEach(function (b) {         // hide traffic lights
    try { var x = win.standardWindowButton(b); if (x && !x.isNil()) x.setHidden(true); } catch (e) {}
  });
  win.setLevel(3);                         // floating
  try { win.setCollectionBehavior(1 | 256); } catch (e) {}   // all Spaces + over full-screen apps

  var cfg = $.WKWebViewConfiguration.alloc.init;
  var web = $[firstClickWebView()].alloc.initWithFrameConfiguration(rect, cfg);
  web.setAutoresizingMask(18);
  win.setContentView(web);
  web.loadHTMLStringBaseURL($(buildHTML(payload)), $());

  // Every event type, as a plain number. Don't use $.NSEventMaskAny: JXA can hand it back as the
  // string "9223372036854775807", which matches no events, so clicks and keys never arrive.
  var mask = 0x1FFFFFFFFFFFFF;

  var start = Date.now(), lastActive = Date.now(), lastTick = 0;
  var lastTitle = '', shown = false, result = null, forced = null;
  var collapsed = false, pillW = 200, pillH = 38, pageH = 0;   // pageH: the popup's current height
  var spot = loadWindowSpots();            // where you last left the popup and the capsule

  function bringFront() {                  // show on top, leave focus where it is
    win.orderFrontRegardless;
    win.makeFirstResponder(web);
  }

  // Positions are the window's bottom-left corner in screen points (as in Cocoa), so a window
  // that grows keeps its bottom edge and extends upward.
  function visibleFrames() {
    var out = [];
    try { var s = $.NSScreen.screens; for (var i = 0; i < s.count; i++) out.push(s.objectAtIndex(i).visibleFrame); } catch (e) {}
    return out;
  }
  function frameAt(x, y) {
    var fs = visibleFrames();
    for (var i = 0; i < fs.length; i++) {
      var f = fs[i];
      if (x >= f.origin.x && x < f.origin.x + f.size.width && y >= f.origin.y && y < f.origin.y + f.size.height) return f;
    }
    return null;
  }
  function corner() { var fr = win.frame; return { x: fr.origin.x, y: fr.origin.y }; }
  function maxHeight(c) {
    var f = frameAt(c.x + 20, c.y + 5);
    return f ? Math.max(200, f.size.height - 24) : 760;
  }
  function setFrame(c, w, h) {
    var f = frameAt(c.x + 20, c.y + 5) || frameAt(c.x + w - 20, c.y + 5);
    var x = c.x, y = c.y;
    if (f) {                                // keep it fully on that screen
      h = Math.min(h, f.size.height);
      x = Math.max(f.origin.x, Math.min(x, f.origin.x + f.size.width - w));
      y = Math.max(f.origin.y, Math.min(y, f.origin.y + f.size.height - h));
    }
    win.setFrameDisplay($.NSMakeRect(Math.round(x), Math.round(y), w, h), true);
  }
  var MARGIN = 16;
  function firstSpot() {
    if (spot.popupBL && frameAt(spot.popupBL.x + 20, spot.popupBL.y + 5)) {
      return { x: spot.popupBL.x + offset, y: spot.popupBL.y + offset };
    }
    // Bottom-left corner of the screen that has the mouse; extra popups step up and right.
    var m = $.NSEvent.mouseLocation, f = frameAt(m.x, m.y) || visibleFrames()[0];
    if (!f) return { x: 40 + offset, y: 40 + offset };
    return { x: f.origin.x + MARGIN + offset, y: f.origin.y + MARGIN + offset };
  }
  function capsuleSpot() {
    if (spot.pillBL && frameAt(spot.pillBL.x + 10, spot.pillBL.y + 5)) return spot.pillBL;
    var c = corner(), f = frameAt(c.x + 20, c.y + 5) || visibleFrames()[0];
    return f ? { x: f.origin.x + MARGIN, y: f.origin.y + MARGIN } : c;
  }

  function layout(st) {
    var want = st.h || pageH || 420;
    if (st.collapsed) { pillW = Math.max(120, st.w || pillW); pillH = Math.max(28, st.h || pillH); }
    if (!shown) {
      var c0 = firstSpot();
      pageH = Math.max(140, Math.min(maxHeight(c0), want));
      setFrame(c0, W, pageH);
      bringFront();
      shown = true;
    } else if (st.collapsed && !collapsed) {          // popup -> capsule
      expandedAt = corner();
      setFrame(capsuleSpot(), pillW, pillH);
    } else if (!st.collapsed && collapsed) {          // capsule -> popup
      var c1 = expandedAt || corner();
      pageH = Math.max(140, Math.min(maxHeight(c1), want));
      setFrame(c1, W, pageH);
    } else if (st.collapsed) {
      setFrame(corner(), pillW, pillH);
    } else {
      pageH = Math.max(140, Math.min(maxHeight(corner()), want));
      setFrame(corner(), W, pageH);
    }
    collapsed = !!st.collapsed;
  }
  var expandedAt = null;

  // WKWebView keeps mouse drags to itself, so the window moves only when we drag it: from the
  // capsule (a click without moving opens it again) or from the top strip of the popup.
  // A click on the popup means you want to use it: only then take the keyboard, so its keys
  // (↩, esc, 1–9) and text field work. It never takes focus just by appearing.
  function takeKeyboard() {
    if (win.isKeyWindow) return;
    try { NSApp.activateIgnoringOtherApps(true); } catch (e) {}
    win.makeKeyAndOrderFront($());
    win.makeFirstResponder(web);
  }

  // WKWebView keeps mouse drags to itself, so we move the window ourselves: drag the top strip of
  // the popup, or the capsule (a click without moving opens it again). Where you leave it is kept.
  function onMouseDown(ev) {
    if (!ev || ev.isNil() || Number(ev.type) !== 1 || ev.windowNumber !== win.windowNumber) return false;
    if (!collapsed) takeKeyboard();
    if (!dragHit(collapsed, ev.locationInWindow, win.frame.size)) return false;
    var lastX = 0, lastY = 0;
    // Screen coordinates, not window coordinates: the pointer's position inside the window changes
    // as the window moves, which would fight the drag and make it jitter.
    var p = ev.locationInWindow, start = $.NSEvent.mouseLocation, from = corner(), moved = false;
    trackDrag(function () {
      var e = NSApp.nextEventMatchingMaskUntilDateInModeDequeue(
        (1 << 2) | (1 << 6), $.NSDate.dateWithTimeIntervalSinceNow(0.05), $.NSDefaultRunLoopMode, true);
      if (!e || e.isNil()) return;
      if (Number(e.type) === 2) return 'up';
      var m = $.NSEvent.mouseLocation;
      var dx = Math.round(m.x - start.x), dy = Math.round(m.y - start.y);
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (moved && dx === lastX && dy === lastY) return;            // nothing new: don't touch the frame
      moved = true; lastX = dx; lastY = dy;
      setFrame({ x: from.x + dx, y: from.y + dy }, win.frame.size.width, win.frame.size.height);
    }, keepAlive);
    if (moved) {
      var at = corner();
      if (collapsed) spot.pillBL = at; else spot.popupBL = { x: at.x - offset, y: at.y - offset };
      saveWindowSpots(spot);
    } else if (collapsed) {
      ctx.evalJS('window.__expand()');
    } else {
      NSApp.sendEvent(ev);                  // a plain click on the strip: let the page have it
      var up = $.NSEvent.mouseEventWithTypeLocationModifierFlagsTimestampWindowNumberContextEventNumberClickCountPressure(
        2, p, 0, 0, win.windowNumber, $(), 0, 1, 0);
      NSApp.sendEvent(up);
    }
    return true;
  }

  var hidden = false;
  function setHidden(h) {                   // step aside while you're in the agent's app
    if (h === hidden) return;
    hidden = h;
    if (h) win.orderOut($()); else bringFront();
  }

  // Our slot lock, plus whatever the caller's window holds (the approval queue lock, the
  // done-queue lock). The main loop refreshes it every 500 ms; a drag goes through trackDrag.
  function keepAlive() {
    if (slot.path) heartbeat(slot.path);
    if (opts.onBeat) opts.onBeat();
  }

  var ctx = {
    // The completion handler must be a real function: WebKit calls it, and null or nil crash the process.
    evalJS: function (js) { web.evaluateJavaScriptCompletionHandler($(js), function () {}); },
    front: bringFront,
    hide: setHidden,
    touch: function () { lastActive = Date.now(); },
    finish: function (r) { forced = r; }     // close the window from onTick with this result
  };

  try {
    while (true) {
      var ev = NSApp.nextEventMatchingMaskUntilDateInModeDequeue(
        mask, $.NSDate.dateWithTimeIntervalSinceNow(0.03), $.NSDefaultRunLoopMode, true);
      if (ev && !ev.isNil() && !(shown && onMouseDown(ev))) NSApp.sendEvent(ev);

      var t = ObjC.unwrap(web.title) || '';
      if (t && t !== lastTitle) {
        lastTitle = t;
        var st = null;
        try { st = JSON.parse(t); } catch (e) {}
        if (st) {
          lastActive = Date.now();
          if (st.h) layout(st);
          if (opts.onState) opts.onState(st);
          if (st.result) { result = st.result; break; }
        }
      }

      var now = Date.now();
      if (now - lastTick > 500) {
        lastTick = now;
        keepAlive();
        if (shown && opts.onTick) opts.onTick(ctx);
        if (forced) { result = forced; break; }
      }

      if (!shown && now - start > 4000) break;                              // web UI never loaded
      if (shown && !hidden && !win.isVisible) { result = { action: 'app' }; break; }
      if (now - lastActive > timeoutSec * 1000) { result = { action: 'timeout' }; break; }
    }
  } finally {
    try { win.orderOut(null); win.close; } catch (e) {}
    if (slot.path) removePath(slot.path);
  }
  return shown ? result : null;
}

// Where you last dragged the popup and its capsule, kept next to the installed script.
function windowSpotsPath() { return homeDir() + '/' + INSTALL_DIR_REL + '/window.json'; }
function loadWindowSpots() {
  try { var s = JSON.parse(readText(windowSpotsPath()) || '{}'); return s && typeof s === 'object' ? s : {}; } catch (e) { return {}; }
}
function saveWindowSpots(s) {
  try { ensureDir(homeDir() + '/' + INSTALL_DIR_REL); writeText(windowSpotsPath(), JSON.stringify(s)); } catch (e) {}
}

// =============================================================================
// Native dialogs (fallback when the web UI can't load)
// =============================================================================

function clip(s, n) {
  s = String(s || '').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > n ? s.slice(0, n) + ' …' : s;
}

function nativeQuestions(questions, agent) {
  var T = S();
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;
  var answers = {};
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i], items = [], map = {};
    (q.options || []).forEach(function (o) {
      var it = o.description ? (o.label + '  —  ' + o.description) : o.label;
      items.push(it); map[it] = o.label;
    });
    items.push(T.otherNative);
    app.activate();
    var picked = app.chooseFromList(items, {
      withTitle: agent.name,
      withPrompt: (q.header ? '[' + q.header + '] ' : '') + clip(q.question, 400),
      okButtonName: T.ok, cancelButtonName: T.handOff,
      multipleSelectionsAllowed: !!q.multiSelect, emptySelectionAllowed: false
    });
    if (!picked || !picked.length || picked.indexOf(T.otherNative) !== -1) return null;
    answers[q.question] = picked.map(function (p) { return map[p]; }).join(', ');
  }
  return { action: 'submit', answers: answers };
}

function nativePermission(p) {
  var T = S();
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;
  app.activate();
  var r;
  try {
    r = app.displayDialog(fmt(T.permTitle, { agent: p.agent.name, verb: p.verb }) + ' (' + p.tool + ')\n\n' +
      (p.desc ? p.desc + '\n\n' : '') + clip(p.detail, 600), {
      withTitle: p.agent.name + (p.project ? ' · ' + p.project : ''),
      buttons: [T.handOff, T.deny, T.allow], cancelButton: T.handOff, givingUpAfter: TIMEOUT_SEC
    });
  } catch (e) { return { action: 'app' }; }
  if (r.gaveUp) return { action: 'app' };
  if (r.buttonReturned === T.allow) return { action: 'allow' };
  if (r.buttonReturned === T.deny) return { action: 'deny' };
  return { action: 'app' };
}

function nativeDone(items) {
  var T = S();
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;
  app.activate();
  var text = items.map(function (it) {
    var tag = [it.agent && it.agent.name, it.project].filter(Boolean).join(' · ');
    return (tag ? '[' + tag + '] ' : '') + clip(it.message, 300);
  }).join('\n\n');
  var openLabel = fmt(T.open, { agent: (items[0] && items[0].agent && items[0].agent.name) || 'Claude' });
  var okLabel = items.length > 1 ? T.dismissAll : T.gotIt;
  try {
    var d = app.displayDialog((items.length > 1 ? fmt(T.doneN, { n: items.length }) : T.done) + '\n\n' + clip(text, 1200), {
      withTitle: 'coding-agent-popup', buttons: [openLabel, okLabel], defaultButton: okLabel,
      givingUpAfter: DONE_TIMEOUT_SEC });
    return { action: d.buttonReturned === openLabel ? 'open' : 'ok' };
  } catch (e) { return { action: 'ok' }; }
}

// =============================================================================
// Task complete (Stop): every session's notification merges into one window.
// Flow: write the message to the queue -> try to become the window owner ->
//       the owner shows the window; everyone else just exits.
//       After closing, the owner releases the lock *then* re-checks the queue,
//       so a message that arrives during closing is never lost.
// =============================================================================

function expandPath(p) {
  try { return ObjC.unwrap($(p).stringByExpandingTildeInPath) || p; } catch (e) { return p; }
}

function lastAssistantText(path) {
  if (!path) return '';
  var txt = readText(expandPath(path));
  if (!txt) return '';
  var lines = txt.split('\n');
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].trim();
    if (!line) continue;
    var o;
    try { o = JSON.parse(line); } catch (e) { continue; }
    if (o.type !== 'assistant' || !o.message) continue;
    var c = o.message.content;
    if (typeof c === 'string' && c.trim()) return c.trim();
    if (Array.isArray(c)) {
      var t = c.filter(function (x) { return x && x.type === 'text'; })
               .map(function (x) { return x.text; }).join('\n').trim();
      if (t) return t;
    }
  }
  return '';
}

// Turn a Markdown reply into compact plain text for a notification card: no code blocks, quote
// or heading markers, table pipes or blank lines, so the first few lines carry the message.
function plainText(md) {
  var out = [], fence = false;
  String(md || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (line) {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
    if (fence) return;
    line = line.replace(/^\s*(>\s?)+/, '')                     // blockquote
      .replace(/^\s*#{1,6}\s+/, '');                            // heading
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return;      // horizontal rule
    if (/^\s*\|?(\s*:?-+:?\s*\|)+\s*:?-*:?\s*$/.test(line)) return;   // table separator
    if (/^\s*\|.*\|\s*$/.test(line)) {                          // table row
      line = line.trim().replace(/^\||\|$/g, '').split('|')
        .map(function (c) { return c.trim(); }).filter(Boolean).join(' · ');
    }
    line = line.replace(/^(\s*)[-*+]\s+(\[[ xX]\]\s+)?/, '$1• ')   // bullets and task lists
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')                // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                 // links
      .replace(/\*\*(.+?)\*\*|__(.+?)__/g, '$1$2')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, '$1$2')  // *italic*
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\s+$/, '');
    if (line.trim()) out.push(line);
  });
  return out.join('\n');
}

function readQueue(qdir) {
  var out = [];
  listDir(qdir).forEach(function (name) {
    if (!/\.json$/.test(name)) return;
    try { var it = JSON.parse(readText(qdir + name)); if (it && it.id) out.push(it); }
    catch (e) { removePath(qdir + name); }
  });
  return out;
}

function enqueueDone(qdir, item) {
  item.id = item.id || (Date.now() + '-' + Math.floor(Math.random() * 1e9));
  item.time = item.time || Date.now();
  writeText(qdir + item.id + '.json', JSON.stringify(item));
  return item;
}

// Jump back to where the notification came from: the launching app (terminal, editor,
// desktop app) first, then the agent's own app name(s).
function activateHost(it) {
  if (!it) return;
  if (openSessionLink(it)) return;
  var targets = [it.host].concat(it.appName).filter(Boolean);
  for (var i = 0; i < targets.length; i++) {
    try { Application(targets[i]).activate(); return; } catch (e) {}
  }
}

// The desktop apps can open one conversation directly:
//   Codex:  codex://threads/<thread id>   (the hook's session_id is the thread id)
//   Claude: claude://claude.ai/epitaxy/<local session id>, where the app's own session record
//           lists the CLI session id the hook gets as "cliSessionId".
// Agents running in a terminal have no such link; the terminal is brought forward instead.
var CODEX_BUNDLE = 'com.openai.codex', CLAUDE_BUNDLE = 'com.anthropic.claudefordesktop';

function claudeDesktopSession(cliId) {
  if (!/^[\w-]+$/.test(cliId || '')) return '';
  var support = homeDir() + '/Library/Application Support/';
  var dirs = ['Claude-3p', 'Claude'].map(function (d) { return support + d + '/claude-code-sessions'; }).filter(fileExists);
  if (!dirs.length) return '';
  var found = '';
  try {
    var app = Application.currentApplication();
    app.includeStandardAdditions = true;
    found = app.doShellScript('/usr/bin/grep -rlF --include=' + shellQuote('local_*.json') + ' -e ' + shellQuote(cliId) + ' ' +
      dirs.map(shellQuote).join(' ') + ' 2>/dev/null | /usr/bin/head -5 || true');
  } catch (e) { return ''; }
  var files = String(found || '').split(/[\r\n]+/).filter(Boolean);
  for (var i = 0; i < files.length; i++) {
    try {
      var rec = JSON.parse(readText(files[i]));
      if (rec.cliSessionId === cliId && /^local_[\w-]+$/.test(rec.sessionId || '')) return rec.sessionId;
    } catch (e) {}
  }
  return '';
}

function sessionLink(it) {
  var id = String(it && it.sessionId || '');
  if (!id) return '';
  if (it.host === CODEX_BUNDLE) return 'codex://threads/' + encodeURIComponent(id);
  if (it.host === CLAUDE_BUNDLE) { var local = claudeDesktopSession(id); return local ? 'claude://claude.ai/epitaxy/' + local : ''; }
  return '';
}

// "Answer in app" on several requests at once: only the first one switches the app over.
function jumpToSession(agent, data) {
  var mark = baseDir() + 'last-jump', last = parseInt(readText(mark), 10);
  if (!isNaN(last) && Date.now() - last < 2000) return;
  writeText(mark, String(Date.now()));
  activateHost({ host: agent.host, appName: agent.app, sessionId: data.session_id || '' });
}

function openSessionLink(it) {
  var url = sessionLink(it);
  if (!url) return false;
  try { return !!$.NSWorkspace.sharedWorkspace.openURL($.NSURL.URLWithString($(url))); } catch (e) { return false; }
}

function runDoneOwner(qdir, lockPath) {
  var known = {};
  var items = readQueue(qdir);
  items.forEach(function (it) { known[it.id] = it; });
  if (!items.length) return null;

  var dropItem = function (id) { removePath(qdir + id + '.json'); };
  var opened = 0;                         // "Open" on a card: that session, the window stays

  var r = null;
  try {
    r = showWebWindow({ mode: 'done', items: items }, {
      timeoutSec: DONE_TIMEOUT_SEC,
      onBeat: function () { heartbeat(lockPath); },
      onTick: function (ctx) {
        var fresh = readQueue(qdir).filter(function (it) { return !known[it.id]; });
        if (fresh.length) {
          fresh.forEach(function (it) { known[it.id] = it; });
          ctx.evalJS('window.__add(' + JSON.stringify(fresh) + ')');
          ctx.front();
          ctx.touch();
        }
      },
      onState: function (st) {
        (st.dismissed || []).forEach(dropItem);
        for (; opened < (st.opened || []).length; opened++) activateHost(known[st.opened[opened]]);
      }
    });
  } catch (e) { r = null; }

  if (r === null) {
    var all = readQueue(qdir);
    all.forEach(function (it) { known[it.id] = it; });
    all.sort(function (a, b) { return (b.time || 0) - (a.time || 0); });
    r = nativeDone(all);
    if (r && r.action === 'open' && all.length) r.id = all[0].id;
  }

  Object.keys(known).forEach(dropItem);   // everything shown is cleared
  if (r && r.action === 'open') activateHost(known[r.id]);
  return r;
}

// Turns that aren't a task you gave the agent: Codex's auto-review and other background threads
// (marked as subagents, or with a thread_source other than "user" in the rollout's first line),
// and replies that are pure JSON meant for the app, such as review verdicts and input-box suggestions.
function backgroundTurn(data, msg) {
  if (data.agent_id || data.agent_type) return 'subagent';
  var t = String(msg || '').trim();
  if (/^[\[{]/.test(t)) { try { JSON.parse(t); return 'json reply'; } catch (e) {} }
  if (!data.transcript_path) return '';
  var first = readFrom(expandPath(String(data.transcript_path)), 0, 64 * 1024).split('\n')[0], meta;
  try { meta = JSON.parse(first); } catch (e) { return ''; }
  var p = meta && meta.type === 'session_meta' && meta.payload;
  if (!p) return '';
  if (p.source && typeof p.source === 'object' && p.source.subagent) return 'subagent';
  if (p.thread_source && p.thread_source !== 'user') return String(p.thread_source);
  return '';
}

function handleDone(data, project, agent, always) {
  var msg = data.last_assistant_message || '';
  if (!msg) { try { msg = lastAssistantText(data.transcript_path); } catch (e) { msg = ''; } }
  var skip = backgroundTurn(data, msg) || (!always && hostFrontmost(agent) ? 'in app' : '');
  if (skip) { debugLog(data, 'skip done: ' + skip); return ''; }
  var markdown = clip(msg, 4000);
  msg = clip(plainText(msg), 1200) || fmt(S().fallbackMsg, { agent: agent.name });

  var base = baseDir(), qdir = base + 'done-queue/', lockPath = base + 'done-owner';
  ensureDir(qdir);
  enqueueDone(qdir, {
    project: project, message: msg, markdown: markdown,
    agent: { name: agent.name, icon: agent.icon, theme: agent.theme }, appName: agent.app, host: agent.host,
    sessionId: data.session_id || ''
  });

  var last = null;
  for (var round = 0; round < 20; round++) {
    if (!tryLock(lockPath)) return '';          // a window is already open; it will pick this up
    try { last = runDoneOwner(qdir, lockPath); }
    finally { removePath(lockPath); }
    if (!readQueue(qdir).length) break;         // re-check after releasing the lock
  }
  return '';
}

// =============================================================================
// Requests the agent settles without us
// A PermissionRequest hook can run while the agent is still deciding on its own: an
// auto-approval, a permission rule, or you answering in the app. So find the pending call in
// the transcript and watch it; once it has started or finished, there is nothing left to ask.
// =============================================================================

var TAIL_BYTES = 512 * 1024;   // the pending call is near the end of the transcript

function fileSize(p) {
  try {
    var a = fm().attributesOfItemAtPathError($(p), null);
    if (!a || a.isNil()) return 0;
    return Number(a.fileSize) || 0;
  } catch (e) { return 0; }
}

function readFrom(p, offset, length) {
  // A byte offset (or a length) can cut a multi-byte character; shift by a byte until it decodes.
  for (var k = 0; k < 4; k++) {
    try {
      var h = $.NSFileHandle.fileHandleForReadingAtPath($(p));
      if (!h || h.isNil()) return '';
      h.seekToFileOffset(length ? offset : offset + k);
      var d = length ? h.readDataOfLength(Math.max(1, length - k)) : h.readDataToEndOfFile;
      h.closeFile;
      var s = $.NSString.alloc.initWithDataEncoding(d, $.NSUTF8StringEncoding);
      if (s && !s.isNil()) return ObjC.unwrap(s);
    } catch (e) { return ''; }
  }
  return '';
}

function stableJSON(v) {
  if (Array.isArray(v)) return '[' + v.map(stableJSON).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + stableJSON(v[k]); }).join(',') + '}';
  }
  return JSON.stringify(v);
}

function codexArgs(p) {
  if (typeof p.arguments === 'string') { try { return JSON.parse(p.arguments); } catch (e) { return p.arguments; } }
  return p.input != null ? p.input : (p.action || {});
}

// Tool calls in a Claude Code transcript or a Codex rollout, oldest first.
// A call is "settled" once it has a result.
function transcriptCalls(text) {
  var calls = [], byId = {};
  var add = function (id, name, input) {
    if (id && !byId[id]) { byId[id] = { id: id, name: name, input: input, settled: false }; calls.push(byId[id]); }
  };
  var settle = function (id) { if (id && byId[id]) byId[id].settled = true; };
  text.split('\n').forEach(function (line) {
    var o;
    try { o = JSON.parse(line); } catch (e) { return; }   // also skips the partial first line
    var c = o && o.message && o.message.content;           // Claude Code
    if (Array.isArray(c)) c.forEach(function (x) {
      if (x && x.type === 'tool_use') add(x.id, x.name, x.input);
      else if (x && x.type === 'tool_result') settle(x.tool_use_id);
    });
    var p = o && o.payload;                                 // Codex
    if (p && (o.type === 'response_item' || o.type === 'event_msg')) {
      if (/^(function_call|custom_tool_call|local_shell_call)$/.test(p.type)) add(p.call_id, p.name, codexArgs(p));
      else if (/_output$|^(exec_command|patch_apply)_(begin|end)$/.test(p.type)) settle(p.call_id);
    }
  });
  return calls;
}

function commandForms(v) {
  if (Array.isArray(v)) return v.length ? [v.join(' '), String(v[v.length - 1])] : [];
  return v == null || v === '' ? [] : [String(v)];
}

function sameCall(call, tool, input) {
  if (call.name === tool && stableJSON(call.input) === stableJSON(input)) return true;
  // Codex logs shell calls under its own tool names, so compare the command itself.
  var want = commandForms(input && input.command);
  var got = call.input && typeof call.input === 'object' ? commandForms(call.input.command || call.input.cmd) : [];
  return want.some(function (w) { return got.indexOf(w) !== -1; });
}

// The newest call matching this request. A loose match by tool name only counts while unsettled.
function findPendingCall(path, tool, input, id) {
  if (!path) return null;
  var offset = Math.max(0, fileSize(path) - TAIL_BYTES);
  var calls = transcriptCalls(readFrom(path, offset)), i;
  if (id) {
    for (i = 0; i < calls.length; i++) if (calls[i].id === id) return { id: id, offset: offset };
    return null;
  }
  for (i = calls.length - 1; i >= 0; i--) if (sameCall(calls[i], tool, input)) return { id: calls[i].id, offset: offset };
  for (i = calls.length - 1; i >= 0; i--) if (!calls[i].settled && calls[i].name === tool) return { id: calls[i].id, offset: offset };
  return null;
}

function callSettled(path, call) {
  var lines = readFrom(path, call.offset).split('\n').filter(function (l) { return l.indexOf(call.id) !== -1; });
  return transcriptCalls(lines.join('\n')).some(function (c) { return c.id === call.id && c.settled; });
}

// Codex logs a shell command only once it has finished, so look for one that finished after the hook started.
function commandFinishedSince(path, offset, input) {
  var want = commandForms(input && input.command);
  if (!want.length) return false;
  return readFrom(path, offset).split('\n').some(function (line) {
    if (line.indexOf('CommandExecution') === -1) return false;
    var it;
    try { it = JSON.parse(line).payload.item; } catch (e) { return false; }
    return !!it && it.type === 'CommandExecution' && commandForms(it.command).some(function (f) { return want.indexOf(f) !== -1; });
  });
}

function processTable() {
  try {
    var app = Application.currentApplication();
    app.includeStandardAdditions = true;
    return app.doShellScript('/bin/ps -axww -o pid=,ppid=,command=', { alteringLineEndings: false });
  } catch (e) { return ''; }
}

function ownPid() {
  try { return Number($.NSProcessInfo.processInfo.processIdentifier) || 0; } catch (e) { return 0; }
}

// Is the agent already running this shell command? It only does once the call is approved, often
// long before the command finishes and its result reaches the transcript. Claude Code runs
// `zsh -c … eval '<command>'` and Codex `zsh -lc <command>`, under the agent process: our nearest
// ancestor that isn't osascript or a shell.
function commandRunning(table, myPid, command) {
  var first = String(command || '').split('\n')[0].trim();
  if (!first || !myPid) return false;
  var procs = {}, list = [];
  String(table || '').split('\n').forEach(function (line) {
    var m = /^\s*(\d+)\s+(\d+)\s(.*)$/.exec(line);
    if (m) { var p = { pid: +m[1], ppid: +m[2], cmd: m[3] }; procs[p.pid] = p; list.push(p); }
    else if (list.length) list[list.length - 1].cmd += '\n' + line;   // an argument with a newline
  });
  var isWrapper = function (p) { return /^(osascript|sh|bash|zsh|dash)$/.test(p.cmd.split(' ')[0].split('/').pop()); };
  var mine = {}, agent = myPid;
  while (procs[agent] && (agent === myPid || isWrapper(procs[agent]))) { mine[agent] = true; agent = procs[agent].ppid; }
  if (!procs[agent] || agent <= 1) return false;

  var needles = ["eval '" + first.replace(/'/g, "'\"'\"'"), '-lc ' + first];
  var kids = {};
  list.forEach(function (p) { (kids[p.ppid] = kids[p.ppid] || []).push(p); });
  var stack = (kids[agent] || []).slice();
  while (stack.length) {
    var p = stack.pop();
    if (mine[p.pid]) continue;
    if (needles.some(function (n) { return p.cmd.indexOf(n) !== -1; })) return true;
    stack = stack.concat(kids[p.pid] || []);
  }
  return false;
}

// Returns a check that is true once the agent has settled this request by itself.
function settledWatcher(data) {
  var path = data.transcript_path ? expandPath(String(data.transcript_path)) : '';
  var start = path ? fileSize(path) : 0, call = null;
  var tool = data.tool_name || '', input = data.tool_input || {};
  return function () {
    if (tool === 'Bash' && input.command && commandRunning(processTable(), ownPid(), input.command)) return true;
    if (!path) return false;
    if (!call) call = findPendingCall(path, tool, input, data.tool_use_id);
    if (call && callSettled(path, call)) return true;
    return commandFinishedSince(path, start, input);
  };
}

function settledSoon(settled) {
  var start = Date.now();
  for (var i = 0; i < Math.ceil(GRACE_MS / 100) && Date.now() - start < GRACE_MS; i++) {
    if (settled()) return true;
    delay(0.1);
  }
  return settled();
}

// =============================================================================
// When Claude Code really needs you
// Claude Code fires PermissionRequest the moment it might ask, while its auto-mode classifier can
// still approve the call. It sends a permission_prompt notification only once a request has gone
// unanswered for about six seconds, so our Notification hook records that, and a waiting
// PermissionRequest popup shows only then.
// =============================================================================

function promptFile(sessionId) {
  return baseDir() + 'prompts/' + String(sessionId || 'none').replace(/[^\w-]/g, '_');
}

function notePromptWaiting(sessionId) {
  var dir = baseDir() + 'prompts/', now = Date.now();
  ensureDir(dir);
  listDir(dir).forEach(function (n) { if (now - mtimeMs(dir + n) > 86400000) removePath(dir + n); });
  writeText(promptFile(sessionId), String(now));
}

function promptWaitingSince(sessionId, since) {
  var t = parseInt(readText(promptFile(sessionId)), 10);
  return !isNaN(t) && t >= since;
}

// Without our Notification hook (or with Claude Code told not to send it), there's nothing to wait for.
function promptNotifyInstalled() {
  if (envVar('CLAUDE_CODE_DISABLE_PERMISSION_PROMPT_NOTIFY_HOOKS')) return false;
  try {
    var groups = ((JSON.parse(readText(configPathFor('claude')) || '{}').hooks || {}).Notification) || [];
    return groups.some(function (g) {
      return (g.hooks || []).some(function (h) { return OUR_SCRIPT_RE.test(h.command || ''); });
    });
  } catch (e) { return false; }
}

// 'settled' if Claude Code handled the request itself, 'notified' once it says it's waiting on you,
// 'fallback' if neither happened within PROMPT_WAIT_SEC.
function waitForPrompt(sessionId, settled) {
  var since = Date.now(), limit = PROMPT_WAIT_SEC * 1000;
  for (var i = 0; i < Math.ceil(limit / 150) && Date.now() - since < limit; i++) {
    if (i % 4 === 0 && settled()) return 'settled';   // the process check is slow-ish: not every round
    if (promptWaitingSince(sessionId, since)) return 'notified';
    delay(0.15);
  }
  return settled() ? 'settled' : 'fallback';
}

// =============================================================================
// Already looking at it?
// If the app the agent runs in (the terminal, editor or desktop app that started it) is the
// frontmost app, you see its prompt and its reply there, so a popup would only repeat it.
// =============================================================================

function hostFrontmost(agent) {
  try {
    ObjC.import('AppKit');
    var a = $.NSWorkspace.sharedWorkspace.frontmostApplication;
    if (!a || a.isNil()) return false;
    if (agent.host) return ObjC.unwrap(a.bundleIdentifier) === agent.host;
    return (agent.app || []).indexOf(ObjC.unwrap(a.localizedName)) !== -1;
  } catch (e) { return false; }
}

// Hold the popup back while you're in the agent's app. 'away' once you leave it,
// 'settled' if the request was handled meanwhile, 'in-app' if you stayed until `until`.
function waitUntilAway(agent, settled, until) {
  for (var i = 0; hostFrontmost(agent); i++) {
    if (i % 4 === 0 && settled()) return 'settled';
    if (Date.now() > until) return 'in-app';
    delay(0.15);
  }
  return 'away';
}

// =============================================================================
// Approvals share one window
// Each hook process files its request in a queue and waits for its answer. One background
// process ("perm-window") shows every waiting request in a single window and writes the answers.
// A request handled elsewhere (by the agent, or by you in its app) is withdrawn from the queue.
// =============================================================================

var HOOK_BUDGET_MS = 280000;   // the installed hooks get 300 s; answer before the agent gives up

function permDirs() {
  var b = baseDir() + 'perm/';
  ensureDir(b + 'queue/');
  ensureDir(b + 'answers/');
  return { q: b + 'queue/', a: b + 'answers/', lock: b + 'owner' };
}

function permWindowAlive(lock) {
  var hb = parseInt(readText(lock + '/hb'), 10);
  return !isNaN(hb) && Date.now() - hb < STALE_MS;
}

function shellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

function spawnPermWindow() {
  var self = selfPath();
  if (!self) return false;
  try {
    var app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('/usr/bin/nohup /usr/bin/osascript -l JavaScript ' + shellQuote(self) + ' perm-window >/dev/null 2>&1 &');
    return true;
  } catch (e) { return false; }
}

// Returns {action: allow|deny|app|open|timeout|settled|in-app}, or null if the shared window can't run.
// While you're in the agent's app its own prompt is in front of you, so the request steps aside:
// with stepAside 'hide' it leaves the window and comes back if you leave the app with it still
// unanswered; with 'return' the hook hands it to the app at once (Codex shows its prompt only then).
function requestApproval(p, agent, settled, deadline, stepAside) {
  var d = permDirs(), id = '', item = JSON.parse(JSON.stringify(p));
  item.time = Date.now(); item.deadline = deadline;
  var file = function () { return d.q + id + '.json'; };
  var post = function () {                    // a fresh id each time: the window shows it as new
    id = Date.now() + '-' + Math.floor(Math.random() * 1e9);
    item.id = id;
    writeText(file(), JSON.stringify(item));
  };
  var done = function (r) { if (id) { removePath(file()); removePath(d.a + id + '.json'); } return r; };
  if (stepAside === 'return' || !hostFrontmost(agent)) post();   // in the app already: wait until you leave
  var lastSpawn = 0, frontFor = 0, awayFor = 0;
  for (var i = 0; Date.now() < deadline + 10000; i++) {
    var ans = id ? readText(d.a + id + '.json') : '';
    if (ans) { try { return done(JSON.parse(ans)); } catch (e) { return done({ action: 'app' }); } }
    if (id && Date.now() - lastSpawn > 3000 && !permWindowAlive(d.lock)) {
      if (!spawnPermWindow()) return done(null);
      lastSpawn = Date.now();
    }
    if (i % 4 === 0) {
      if (settled()) return done({ action: 'settled' });
      var front = hostFrontmost(agent);
      frontFor = front ? frontFor + 1 : 0;
      awayFor = front ? 0 : awayFor + 1;
      if (id && frontFor >= 3) {
        if (stepAside === 'return') return done({ action: 'in-app' });
        done(); id = '';                      // out of the window while you're in the app
      } else if (!id && awayFor >= 2) {
        post();                               // you left with it unanswered: show it again
      }
    }
    delay(0.15);
  }
  return done({ action: 'timeout' });
}

// =============================================================================
// Codex prompts you left unanswered
// Codex shows its approval prompt only after our hook returns, so when you're in Codex the hook
// hands the request over at once. A small background process then watches: if you leave Codex
// while the prompt is still waiting, a reminder card ("Codex is still waiting") appears with a
// button that opens that thread. It goes away once Codex moves on.
// =============================================================================

function spawnReminder(data, agent, p) {
  var self = selfPath();
  if (!self || !data.transcript_path) return;
  var dir = baseDir() + 'remind/';
  ensureDir(dir);
  var f = dir + Date.now() + '-' + Math.floor(Math.random() * 1e9) + '.json';
  writeText(f, JSON.stringify({ data: data, agent: agent, p: p }));
  try {
    var app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('/usr/bin/nohup /usr/bin/osascript -l JavaScript ' + shellQuote(self) + ' remind ' + shellQuote(f) + ' >/dev/null 2>&1 &');
  } catch (e) { removePath(f); }
}

// Codex writes nothing to the rollout while a prompt waits; anything new means it has moved on.
function codexMovedOn(path, offset) {
  return /"type":"(item_completed|task_complete|turn_aborted|exec_command_end|patch_apply_end)"/.test(readFrom(path, offset));
}

function runReminder(f) {
  var job;
  try { job = JSON.parse(readText(f)); } catch (e) { return ''; }
  removePath(f);
  if (!job || !job.data || !job.agent) return '';
  var path = expandPath(String(job.data.transcript_path)), start = fileSize(path);
  var settled = function () { return codexMovedOn(path, start); };
  var p = job.p;
  p.kind = 'remind';
  // Wait until you leave Codex; if Codex moves on first, there's nothing to remind you of.
  var until = Date.now() + TIMEOUT_SEC * 1000;
  for (var awayFor = 0; awayFor < 3; ) {
    if (Date.now() > until || settled()) return '';
    awayFor = hostFrontmost(job.agent) ? 0 : awayFor + 1;
    delay(0.4);
  }
  var r = requestApproval(p, job.agent, settled, until, 'hide');
  if (r && r.action === 'open') jumpToSession(job.agent, job.data);
  return '';
}

function runPermWindow() {
  var d = permDirs();
  for (var round = 0; round < 50; round++) {
    if (!tryLock(d.lock)) return '';          // another window is up; it picks the request up
    try { permWindowRound(d); } finally { removePath(d.lock); }
    var waiting = readQueue(d.q).filter(function (it) { return !fileExists(d.a + it.id + '.json'); });
    if (!waiting.length) break;               // re-check after releasing the lock
  }
  return '';
}

function permWindowRound(d) {
  var pending = function () {
    return readQueue(d.q).filter(function (it) { return !fileExists(d.a + it.id + '.json'); })
      .sort(function (a, b) { return a.time - b.time; });
  };
  var reply = function (id, action) {         // only if the requester is still waiting
    if (fileExists(d.q + id + '.json')) writeText(d.a + id + '.json', JSON.stringify({ action: action }));
  };
  var items = pending();
  if (!items.length) return;
  var shown = {}, handled = {}, seen = 0;
  items.forEach(function (it) { shown[it.id] = true; });

  var r = null;
  try {
    r = showWebWindow({ mode: 'perm', items: items }, {
      timeoutSec: TIMEOUT_SEC,
      onBeat: function () { heartbeat(d.lock); },
      onTick: function (ctx) {
        var now = pending(), present = {}, gone = [];
        now.forEach(function (it) { present[it.id] = true; });
        var fresh = now.filter(function (it) { return !shown[it.id]; });
        fresh.forEach(function (it) { shown[it.id] = true; });
        now.forEach(function (it) {
          if (!handled[it.id] && it.deadline && Date.now() > it.deadline) { handled[it.id] = true; reply(it.id, 'timeout'); gone.push(it.id); }
        });
        Object.keys(shown).forEach(function (id) {
          if (!present[id] && !handled[id]) { handled[id] = true; gone.push(id); }   // withdrawn
        });
        if (fresh.length) { ctx.evalJS('window.__add(' + JSON.stringify(fresh) + ')'); ctx.front(); ctx.touch(); }
        if (gone.length) ctx.evalJS('window.__remove(' + JSON.stringify(gone) + ')');
      },
      onState: function (st) {
        var a = st.answers || [];
        for (; seen < a.length; seen++) {
          if (!handled[a[seen].id]) { handled[a[seen].id] = true; reply(a[seen].id, a[seen].action); }
        }
      }
    });
  } catch (e) { r = null; }

  if (r === null) {                           // the web view didn't load: native dialogs, one by one
    pending().forEach(function (it) { if (shown[it.id] && !handled[it.id]) reply(it.id, nativePermission(it).action); });
    return;
  }
  var single = Object.keys(shown).length === 1;
  pending().forEach(function (it) {           // still open when the window closed
    if (!shown[it.id] || handled[it.id]) return;
    var picked = /^(allow|deny|app|open)$/.test(r.action) && (r.id === it.id || (!r.id && single));
    reply(it.id, picked ? r.action : (r.action === 'timeout' ? 'timeout' : 'app'));
  });
}

function codexReviewerOf(data) {
  return codexReviewer(data.transcript_path ? expandPath(String(data.transcript_path)) : '');
}

// Codex can hand approvals to its auto-reviewer instead of you: the session's settings then say
// "approvals_reviewer":"auto_review". The reviewer approves or rejects on its own and a rejection
// goes back to the model, so Codex never asks you and there is nothing to pop up. The latest
// setting in the rollout wins, since it can change mid-session.
function codexReviewer(path) {
  if (!path) return '';
  var size = fileSize(path), tail = 2 * 1024 * 1024;
  var last = function (text) {
    var m, found = '', re = /"approvals_reviewer":"([^"]*)"/g;
    while ((m = re.exec(text))) found = m[1];
    return found;
  };
  return last(readFrom(path, Math.max(0, size - tail))) || (size > tail ? last(readFrom(path, 0)) : '');
}

// =============================================================================
// Hook handling
// =============================================================================

function readStdin() {
  var data = $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile;
  var str = $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding);
  return ObjC.unwrap(str) || '';
}

function decision(d) {
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: d } });
}

// Set AGENT_POPUP_DEBUG=1 in the agent's environment to log each permission request and what
// happened to it (coding-agent-popup/debug.log in the per-user temp directory). Tool input is not logged.
function debugLog(data, outcome) {
  if (!envVar('AGENT_POPUP_DEBUG')) return;
  try {
    var p = baseDir() + 'debug.log', old = readText(p);
    writeText(p, (old.length > 200000 ? '' : old) + JSON.stringify({
      time: new Date().toISOString(), tool: data.tool_name || '', mode: data.permission_mode || '',
      subagent: data.agent_type || '', outcome: outcome }) + '\n');
  } catch (e) {}
}

function verbFor(tool) {
  var V = S().verbs;
  return V[tool] || fmt(V._default, { tool: tool.replace(/^mcp__/, '').replace(/__/g, ' · ') });
}

function permDetail(tool, input) {
  if (input.command) return String(input.command);
  if (input.file_path) {
    var body = input.new_string || input.content || '';
    return input.file_path + (body ? '\n\n' + clip(body, 800) : '');
  }
  if (input.url) return String(input.url);
  if (input.query) return String(input.query);
  if (input.pattern) return String(input.pattern) + (input.path ? '\n' + input.path : '');
  return JSON.stringify(input, null, 2);
}

function handleHook(data, agent) {
  var view = { name: agent.name, icon: agent.icon, theme: agent.theme };
  var project = String(data.cwd || '').split('/').filter(Boolean).pop() || '';

  if (data.hook_event_name === 'Stop') {
    try { maybeCheckUpdates(); } catch (e) {} // detached: never delay a task-complete popup with network I/O
    try { return handleDone(data, project, agent); } catch (e) { return ''; }
  }
  if (data.hook_event_name === 'Notification') {
    if (data.notification_type === 'permission_prompt') { try { notePromptWaiting(data.session_id); } catch (e) {} }
    return '';
  }
  if (data.hook_event_name !== 'PermissionRequest') return '';

  var tool = data.tool_name || '';
  var input = data.tool_input || {};
  var start = Date.now(), until = start + HOOK_BUDGET_MS;
  if (tool === 'ExitPlanMode') return '';   // plans are long; review them in the app
  if (data.permission_mode === 'dontAsk') { debugLog(data, 'skip: dontAsk'); return ''; }   // told not to ask
  var p = {
    mode: 'perm', project: project, tool: tool, agent: view,
    verb: verbFor(tool),
    desc: input.description ? clip(input.description, 200) : '',
    detail: clip(permDetail(tool, input), 2000)
  };
  if (agent.key === 'codex') {
    var reviewer = codexReviewerOf(data);
    if (reviewer && reviewer !== 'user') { debugLog(data, 'skip: codex ' + reviewer); return ''; }
    // Codex shows its own prompt only after this hook returns: if you're in Codex, let it, and
    // remind you if you leave Codex with it unanswered.
    if (hostFrontmost(agent)) { debugLog(data, 'skip: in app'); spawnReminder(data, agent, p); return ''; }
  }

  try {
    var settled = settledWatcher(data);
    // Questions always need you. Other Claude Code requests may still be auto-approved, so wait until
    // Claude Code says it's waiting on you. Codex reaching this point asks you directly, and its hook
    // decides before (or instead of) its own prompt, so answer at once rather than making it wait.
    if (agent.key === 'claude' && tool !== 'AskUserQuestion' && promptNotifyInstalled()) {
      var waited = waitForPrompt(data.session_id, settled);
      if (waited === 'settled') { debugLog(data, 'settled before popup'); return ''; }
      debugLog(data, 'popup: ' + waited);
    } else if (agent.key !== 'codex' && settledSoon(settled)) { debugLog(data, 'settled before popup'); return ''; }
    // While you're in the agent's app its own prompt is in front of you: the popup stays out of the
    // way, and shows (again) if you leave the app with the request still unanswered.
    var frontTicks = 0, awayTicks = 0;
    var watch = { onTick: function (ctx) {
      if (settled()) ctx.finish({ action: 'settled' });
      var front = hostFrontmost(agent);
      frontTicks = front ? frontTicks + 1 : 0;
      awayTicks = front ? 0 : awayTicks + 1;
      if (frontTicks >= 3) ctx.hide(true); else if (awayTicks >= 2) ctx.hide(false);
    } };

    if (tool === 'AskUserQuestion') {
      var away = waitUntilAway(agent, settled, until - 30000);
      if (away !== 'away') { debugLog(data, 'skip: ' + away); return ''; }
      var questions = (input.questions || []).map(function (q) {
        return { header: q.header || '', question: q.question || '', multiSelect: !!q.multiSelect,
                 options: (q.options || []).map(function (o) { return { label: o.label, description: o.description || '' }; }) };
      });
      if (!questions.length) return '';
      var r = null;
      try { r = showWebWindow({ mode: 'ask', project: project, agent: view, questions: questions }, watch); } catch (e) { r = null; }
      if (r === null) r = nativeQuestions(questions, agent);
      debugLog(data, r ? r.action : 'app');
      if (r && r.action === 'app') jumpToSession(agent, data);
      if (!r || r.action !== 'submit') return '';
      var updated = JSON.parse(JSON.stringify(input));
      updated.answers = r.answers;
      return decision({ behavior: 'allow', updatedInput: updated });
    }

    var res = requestApproval(p, agent, settled, Math.min(Date.now() + TIMEOUT_SEC * 1000, until),
      agent.key === 'codex' ? 'return' : 'hide');
    if (res && res.action === 'in-app' && agent.key === 'codex') spawnReminder(data, agent, p);
    if (res === null) {                       // no shared window: show this request on its own
      try { res = showWebWindow(p, watch); } catch (e) { res = null; }
      if (res === null) res = nativePermission(p);
    }
    debugLog(data, res.action);
    if (res.action === 'app') jumpToSession(agent, data);
    if (res.action === 'allow') return decision({ behavior: 'allow' });
    if (res.action === 'deny') return decision({ behavior: 'deny', message: S().denyMessage });
    return '';
  } catch (e) {
    return '';   // never break the agent's normal flow
  }
}

// =============================================================================
// install / uninstall
// =============================================================================

var INSTALL_DIR_REL = '.coding-agent-popup';
var SCRIPT_NAME = 'coding-agent-popup.js';
// Our hooks under every name the project has had: coding-agent-popup.js, agent-popup.js (the
// first builds) and claude-popup.js (pre-release). Installing replaces all of them, so nothing runs twice.
var OUR_SCRIPT_RE = /agent-popup\.js|claude-popup\.js/;
var OLD_INSTALL_DIR_REL = '.agent-popup';
var OLD_TEMP_NAME = 'agent-popup/';

function hookCommand(agent, event) {
  var base = 'osascript -l JavaScript "$HOME/' + INSTALL_DIR_REL + '/' + SCRIPT_NAME + '" ' + agent;
  if (event === 'PermissionRequest' || event === 'Notification') return base;
  // Stop: read the event first, then show the popup in the background so the agent isn't blocked.
  var bg = 'f=$(mktemp); cat > "$f"; (' + base + ' < "$f"; rm -f "$f") >/dev/null 2>&1 &';
  return agent === 'codex' ? bg + " echo '{}'" : bg;   // Codex expects JSON from Stop hooks
}

// Pure function: returns a new config object with our hooks removed (and re-added unless removing).
function mergeHooks(cfg, agent, remove) {
  cfg = JSON.parse(JSON.stringify(cfg || {}));
  var hooks = cfg.hooks && typeof cfg.hooks === 'object' ? cfg.hooks : {};
  Object.keys(hooks).forEach(function (ev) {
    if (!Array.isArray(hooks[ev])) return;
    var groups = hooks[ev].map(function (g) {
      var hs = (g && Array.isArray(g.hooks) ? g.hooks : []).filter(function (h) { return !OUR_SCRIPT_RE.test(h && h.command || ''); });
      var copy = {}; for (var k in g) copy[k] = g[k];
      copy.hooks = hs;
      return copy;
    }).filter(function (g) { return g.hooks.length; });
    if (groups.length) hooks[ev] = groups; else delete hooks[ev];
  });
  if (!remove) {
    var perm = { hooks: [{ type: 'command', command: hookCommand(agent, 'PermissionRequest'), timeout: 300 }] };
    if (agent === 'claude') perm = { matcher: '', hooks: perm.hooks };
    var stop = { hooks: [{ type: 'command', command: hookCommand(agent, 'Stop') }] };
    if (agent === 'codex') stop.hooks[0].timeout = 10;
    (hooks.PermissionRequest = hooks.PermissionRequest || []).push(perm);
    (hooks.Stop = hooks.Stop || []).push(stop);
    if (agent === 'claude') {   // tells a waiting permission popup that Claude Code really needs you
      (hooks.Notification = hooks.Notification || []).push({ matcher: 'permission_prompt',
        hooks: [{ type: 'command', command: hookCommand(agent, 'Notification'), timeout: 10 }] });
    }
  }
  if (Object.keys(hooks).length) cfg.hooks = hooks; else delete cfg.hooks;
  return cfg;
}

function configPathFor(agent) {
  var home = homeDir();
  if (agent === 'claude') return home + '/.claude/settings.json';
  var codexHome = envVar('CODEX_HOME');
  return (codexHome || home + '/.codex') + '/hooks.json';
}

function updateConfig(agent, remove, log) {
  var path = configPathFor(agent);
  var dir = path.replace(/\/[^\/]+$/, '');
  var cfg = {};
  if (fileExists(path)) {
    var raw = readText(path);
    if (raw.trim()) {
      try { cfg = JSON.parse(raw); }
      catch (e) { log.push('✗ ' + path + ' is not valid JSON — left untouched. Fix it and run again.'); return false; }
    }
    var stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeText(path + '.bak-' + stamp, raw);
    log.push('  backup: ' + path + '.bak-' + stamp);
  } else if (remove) {
    return true;
  }
  ensureDir(dir);
  if (!writeText(path, JSON.stringify(mergeHooks(cfg, agent, remove), null, 2) + '\n')) {
    log.push('✗ could not write ' + path);
    return false;
  }
  log.push((remove ? '✓ removed hooks from ' : '✓ hooks added to ') + path);
  return true;
}

function selfPath() {
  var args = ObjC.deepUnwrap($.NSProcessInfo.processInfo.arguments) || [];
  for (var i = 0; i < args.length; i++) {
    if (/\.js$/.test(args[i])) {
      var p = args[i];
      if (p.charAt(0) !== '/') p = ObjC.unwrap(fm().currentDirectoryPath) + '/' + p;
      return p;
    }
  }
  return '';
}

// =============================================================================
// Release checks — no downloads or code execution; the user opens the release page to update.
// =============================================================================

var RELEASES_URL = 'https://github.com/qivyn/coding-agent-popup/releases';
var LATEST_RELEASE_API = 'https://api.github.com/repos/qivyn/coding-agent-popup/releases/latest';

function parseVersion(value) {
  var m = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(String(value || ''));
  if (!m) return null;
  var pre = m[4] ? m[4].split('.') : [];
  if (pre.some(function (p) { return /^\d+$/.test(p) && p.length > 1 && p[0] === '0'; })) return null;
  return { parts: m.slice(1, 4), pre: pre };
}

function compareVersions(a, b) {
  a = parseVersion(a); b = parseVersion(b);
  if (!a || !b) return null;
  function numeric(x, y) { return x.length !== y.length ? (x.length > y.length ? 1 : -1) : x === y ? 0 : x > y ? 1 : -1; }
  for (var i = 0; i < 3; i++) { var n = numeric(a.parts[i], b.parts[i]); if (n) return n; }
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  for (var j = 0; j < Math.max(a.pre.length, b.pre.length); j++) {
    var x = a.pre[j], y = b.pre[j];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    if (x === y) continue;
    var nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    return nx && ny ? numeric(x, y) : nx !== ny ? (nx ? -1 : 1) : x > y ? 1 : -1;
  }
  return 0;
}

function updateStatePath() { return homeDir() + '/' + INSTALL_DIR_REL + '/updates.json'; }
function readUpdateState() {
  try { var s = JSON.parse(readText(updateStatePath()) || '{}'); return s && typeof s === 'object' && !Array.isArray(s) ? s : {}; }
  catch (e) { return {}; }
}
function updateCheckDue(state) {
  var last = state.checkedAt;
  return typeof last !== 'number' || !isFinite(last) || last <= 0 || Date.now() < last || Date.now() - last >= UPDATE_CHECK_INTERVAL_MS;
}

function maybeCheckUpdates() {
  if (envVar('AGENT_POPUP_CHECK_UPDATES') === '0' || !updateCheckDue(readUpdateState())) return;
  var script = homeDir() + '/' + INSTALL_DIR_REL + '/' + SCRIPT_NAME;
  if (!fileExists(script)) return;
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;
  app.doShellScript('/usr/bin/nohup /usr/bin/osascript -l JavaScript ' + shellQuote(script)
    + ' check-updates --background >/dev/null 2>&1 &');
}

function fetchLatestRelease() {
  var app = Application.currentApplication();
  app.includeStandardAdditions = true;
  var response = app.doShellScript('/usr/bin/curl -q --silent --show-error --connect-timeout 3 --max-time 12'
    + ' --max-filesize 1048576 --header ' + shellQuote('Accept: application/vnd.github+json')
    + ' --header ' + shellQuote('User-Agent: coding-agent-popup/' + VERSION)
    + ' --write-out ' + shellQuote('\n%{http_code}') + ' ' + shellQuote(LATEST_RELEASE_API));
  var status = /\s(\d{3})$/.exec(response);
  if (!status) throw new Error('Missing HTTP status');
  if (status[1] === '404') return null; // the repository has no published stable release yet
  if (status[1] !== '200') throw new Error('HTTP ' + status[1]);
  var release = JSON.parse(response.slice(0, status.index));
  var version = release && parseVersion(release.tag_name);
  if (!version || version.pre.length || release.draft || release.prerelease) throw new Error('Invalid stable release');
  return { version: release.tag_name.replace(/^v/, ''), url: RELEASES_URL + '/tag/' + encodeURIComponent(release.tag_name) };
}

function showUpdateNotice(release) {
  var r = showWebWindow({ mode: 'update', t: S(), current: VERSION, latest: release.version }, { timeoutSec: 60 });
  if (!r) return false; // retry on the next daily check if WebKit failed to load
  if (r.action === 'open') {
    var app = Application.currentApplication();
    app.includeStandardAdditions = true;
    app.doShellScript('/usr/bin/open ' + shellQuote(release.url));
  }
  return true;
}

function checkUpdates(background) {
  if (background && envVar('AGENT_POPUP_CHECK_UPDATES') === '0') return '';
  var lock = baseDir() + 'update-check.lock', acquired = false, release = null, notify = false;
  try {
    // Network calls can last 12 s, longer than the popup locks' 6 s stale threshold.
    if (fileExists(lock) && Date.now() - mtimeMs(lock) > 60000) removePath(lock);
    acquired = !!fm().createDirectoryAtPathWithIntermediateDirectoriesAttributesError($(lock), false, $(), null);
    if (!acquired) return background ? '' : S().updateBusy;
    var state = readUpdateState();
    if (background && !updateCheckDue(state)) return '';
    state.checkedAt = Date.now(); // failures are throttled too, including offline and rate-limit errors
    ensureDir(homeDir() + '/' + INSTALL_DIR_REL);
    if (!writeText(updateStatePath(), JSON.stringify(state))) throw new Error('Could not save update state');
    release = fetchLatestRelease();
    if (release && compareVersions(release.version, VERSION) > 0) {
      notify = background && state.notifiedVersion !== release.version;
      if (notify) {
        state.notifiedVersion = release.version; // claim before releasing the lock: one notice across all sessions
        if (!writeText(updateStatePath(), JSON.stringify(state))) throw new Error('Could not save update state');
      }
    }
  } catch (e) { return background ? '' : S().updateFailed; }
  finally { if (acquired) removePath(lock); }
  if (notify) {
    var shown = false;
    try { shown = showUpdateNotice(release); } catch (e) {}
    if (!shown) {
      var retry = readUpdateState();
      if (retry.notifiedVersion === release.version) { delete retry.notifiedVersion; writeText(updateStatePath(), JSON.stringify(retry)); }
    }
  }
  if (background) return '';
  if (!release) return S().noRelease;
  return compareVersions(release.version, VERSION) > 0
    ? fmt(S().updateAvailable, { current: VERSION, latest: release.version }) + '\n' + release.url
    : fmt(S().upToDate, { current: VERSION });
}

function install(args) {
  var log = [], home = homeDir();
  var dest = home + '/' + INSTALL_DIR_REL + '/' + SCRIPT_NAME;
  var src = selfPath();
  ensureDir(home + '/' + INSTALL_DIR_REL);
  if (!src && !fileExists(dest)) return '✗ could not find coding-agent-popup.js to install';
  if (src && src !== dest) {
    removePath(dest);
    if (!fm().copyItemAtPathToPathError($(src), $(dest), null)) return '✗ could not copy ' + src + ' to ' + dest;
  }
  log.push('✓ installed ' + dest);
  migrateOldInstall(log);

  var agents = args.filter(function (a) { return a === 'claude' || a === 'codex'; });
  if (!agents.length) {
    if (fileExists(home + '/.claude')) agents.push('claude');
    if (fileExists(home + '/.codex')) agents.push('codex');
    if (!agents.length) agents.push('claude');
  }
  agents.forEach(function (a) { updateConfig(a, false, log); });

  log.push('');
  if (agents.indexOf('claude') !== -1) log.push('Claude Code: start a new session (or restart the app) to pick up the hooks.');
  if (agents.indexOf('codex') !== -1) {
    log.push('Codex: hooks must be trusted once. Run `codex` in a terminal, type /hooks,');
    log.push('       trust the PermissionRequest and Stop hooks, then restart Codex (CLI or desktop app).');
  }
  log.push('Preview the popups any time:  osascript -l JavaScript ' + dest + ' demo');
  return log.join('\n');
}

// Earlier builds were called agent-popup and lived in ~/.agent-popup. Their hooks are
// replaced by updateConfig (OUR_SCRIPT_RE knows the old name); keep where you left the popup,
// then remove the old copy. The old temp directory is left alone: a popup from the old version
// may still be open and using it.
function migrateOldInstall(log) {
  var home = homeDir(), old = home + '/' + OLD_INSTALL_DIR_REL;
  if (!fileExists(old)) return;
  var spots = old + '/window.json';
  if (fileExists(spots) && !fileExists(windowSpotsPath())) writeText(windowSpotsPath(), readText(spots));
  removePath(old);
  log.push('✓ replaced the old install in ~/' + OLD_INSTALL_DIR_REL);
}

function oldTempDir() { return baseDir().replace(/[^\/]+\/$/, '') + OLD_TEMP_NAME; }

function uninstall() {
  var log = [];
  updateConfig('claude', true, log);
  updateConfig('codex', true, log);
  removePath(homeDir() + '/' + INSTALL_DIR_REL);
  removePath(homeDir() + '/' + OLD_INSTALL_DIR_REL);
  removePath(oldTempDir());
  removePath(baseDir());
  log.push('✓ removed ~/' + INSTALL_DIR_REL);
  return log.join('\n');
}

// =============================================================================
// demo
// =============================================================================

function demo(kind) {
  var T = S(), zh = T === STRINGS.zh, out = [];
  var claude = agentInfo('claude'), codex = agentInfo('codex');
  var show = function (k) { return !kind || kind === 'all' || kind === k; };

  if (show('perm')) {
    var p = { mode: 'perm', project: 'my-webapp', tool: 'Bash', agent: { name: 'Claude', icon: 'spark' },
      verb: verbFor('Bash'), desc: zh ? '安装依赖并运行测试' : 'Install dependencies and run the test suite',
      detail: 'npm install && npm test -- --coverage' };
    var r1 = showWebWindow(p);
    out.push('perm → ' + JSON.stringify(r1));
  }
  if (kind === 'codex') {   // only on request: the same permission popup in Codex's look
    var pc = { mode: 'perm', project: 'data-pipeline', tool: 'Bash', agent: { name: 'Codex', icon: 'term', theme: 'codex' },
      verb: verbFor('Bash'), desc: zh ? '需要联网安装依赖' : 'Needs network access to install dependencies',
      detail: 'pnpm install --frozen-lockfile' };
    out.push('codex → ' + JSON.stringify(showWebWindow(pc)));
  }
  if (show('ask')) {
    var qs = zh ? [
      { header: '数据库', question: '这个项目要用哪种数据库？', multiSelect: false, options: [
        { label: 'PostgreSQL', description: '关系型，适合结构化数据和复杂查询' },
        { label: 'SQLite', description: '零配置，单文件，适合原型' },
        { label: 'MongoDB', description: '文档型，schema 灵活' }] },
      { header: '功能', question: '第一版需要哪些功能？', multiSelect: true, options: [
        { label: '登录注册', description: '' }, { label: '数据导出', description: 'CSV / Excel' }, { label: '暗色模式', description: '' }] }
    ] : [
      { header: 'Database', question: 'Which database should this project use?', multiSelect: false, options: [
        { label: 'PostgreSQL', description: 'Relational, great for structured data and complex queries' },
        { label: 'SQLite', description: 'Zero config, single file, good for prototypes' },
        { label: 'MongoDB', description: 'Document store with a flexible schema' }] },
      { header: 'Scope', question: 'Which features go into v1?', multiSelect: true, options: [
        { label: 'Sign-in', description: '' }, { label: 'Data export', description: 'CSV / Excel' }, { label: 'Dark mode', description: '' }] }
    ];
    var r2 = showWebWindow({ mode: 'ask', project: 'my-webapp', agent: { name: 'Claude', icon: 'spark' }, questions: qs });
    out.push('ask  → ' + JSON.stringify(r2));
  }
  if (show('done')) {
    var qdir = baseDir() + 'done-queue/';
    ensureDir(qdir);
    var now = Date.now();
    enqueueDone(qdir, { project: 'data-pipeline', time: now - 90000, agent: { name: 'Codex', icon: 'term' },
      appName: codex.app, host: codex.host,
      message: zh ? '重试逻辑加好了：失败后指数退避，最多重试 5 次。顺手修了一个时区问题。'
                  : 'Added retries with exponential backoff (max 5). Also fixed a timezone bug in the nightly job.' });
    enqueueDone(qdir, { project: 'blog', time: now - 20000, agent: { name: 'Claude', icon: 'spark' },
      appName: claude.app, host: claude.host,
      message: zh ? '文章草稿写好了，保存在 posts/coding-agent-popup.md。' : 'Draft is ready in posts/coding-agent-popup.md.' });
    // The same project again: its two messages share one card, marked "2 updates".
    enqueueDone(qdir, { project: 'blog', time: now - 40000, agent: { name: 'Claude', icon: 'spark' },
      appName: claude.app, host: claude.host,
      message: zh ? '配图和截图都整理好了，目录结构也顺手理了一遍。'
                  : 'Screenshots and figures are collected, and the folder layout is tidied up.' });
    handleDone({ last_assistant_message: zh ? '登录页改好了，测试全部通过。' : 'The login page is fixed and all tests pass.' },
      'my-webapp', claude, true);
    out.push('done → closed');
  }
  return out.join('\n');
}

// =============================================================================
// Entry point
// =============================================================================

var HELP = [
  'coding-agent-popup ' + VERSION + ' — hard-to-miss popups for AI coding agents on macOS',
  '',
  '  osascript -l JavaScript coding-agent-popup.js install [claude] [codex]',
  '  osascript -l JavaScript coding-agent-popup.js uninstall',
  '  osascript -l JavaScript coding-agent-popup.js check-updates',
  '  osascript -l JavaScript coding-agent-popup.js demo [ask|perm|done|codex]',
  '  osascript -l JavaScript coding-agent-popup.js <agent>        hook mode, event JSON on stdin',
  '',
  'https://github.com/qivyn/coding-agent-popup'
].join('\n');

function run(argv) {
  argv = argv || [];
  var cmd = String(argv[0] || '').toLowerCase();
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') return HELP;
  if (cmd === 'version' || cmd === '--version') return VERSION;
  if (cmd === 'install') return install(argv.slice(1));
  if (cmd === 'uninstall') return uninstall();
  if (cmd === 'check-updates') return checkUpdates(argv[1] === '--background');
  if (cmd === 'demo') return demo(argv[1]);
  if (cmd === 'perm-window') return runPermWindow();
  if (cmd === 'remind') return runReminder(argv[1]);

  var data;
  // Codex `notify`: the event JSON arrives as the last command-line argument, not on stdin.
  var lastArg = argv.length > 1 ? String(argv[argv.length - 1]) : '';
  if (lastArg.trim().charAt(0) === '{') {
    var n;
    try { n = JSON.parse(lastArg); } catch (e) { return ''; }
    if (n.type !== 'agent-turn-complete') return '';
    data = { hook_event_name: 'Stop', last_assistant_message: n['last-assistant-message'] || '', cwd: n.cwd || '',
             session_id: n['thread-id'] || '' };
  } else {
    try { data = JSON.parse(readStdin()); } catch (e) { return ''; }
  }
  return handleHook(data, agentInfo(argv[0]));
}
