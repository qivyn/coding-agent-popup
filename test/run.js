// Tests for coding-agent-popup.js — run on any machine with Node, no macOS needed.
// Native pieces (NSWindow, WKWebView, osascript) are stubbed; the popup UI runs in jsdom
// and the queue/lock logic runs against a temp directory.
//
//   npm install && npm test

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'coding-agent-popup.js'), 'utf8');
const EXPORTS = '{buildHTML, STRINGS, mergeHooks, hookCommand, plainText}';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) {
    failed++;
    console.log('  ✗ ' + name + '\n      ' + String((e && e.stack) || e).split('\n').slice(0, 3).join('\n      '));
  }
}
function eq(a, b, msg) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((msg || 'not equal') + ':\n      got      ' + A + '\n      expected ' + B);
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

// Load the script with extra code appended, so later declarations override the native stubs.
function load(extra, exports) {
  return new Function('require', SRC + '\n' + (extra || '') + '\n;return ' + (exports || EXPORTS) + ';')(require);
}

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
let JSDOM = null;
try { ({ JSDOM } = require('jsdom')); } catch (e) { /* optional */ }

function page(payload) {
  const M = load();
  payload.t = payload.t || M.STRINGS.en;
  const dom = new JSDOM(M.buildHTML(payload), { runScripts: 'dangerously' });
  const doc = dom.window.document;
  return {
    dom, doc,
    key: (k, extra) => doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true }, extra || {}))),
    state: () => JSON.parse(doc.title || '{}'),
  };
}

const ASK = {
  mode: 'ask', project: 'my-webapp', agent: { name: 'Claude', icon: 'spark' }, questions: [
    { header: 'DB', question: 'Which database?', multiSelect: false, options: [
      { label: 'PostgreSQL', description: 'relational' }, { label: 'SQLite', description: '' }, { label: 'MongoDB', description: '' }] },
    { header: 'Scope', question: 'Which features?', multiSelect: true, options: [
      { label: 'Sign-in', description: '' }, { label: 'Export', description: '' }, { label: 'Dark mode', description: '' }] }]
};
const PERM = { mode: 'perm', project: 'x', tool: 'Bash', agent: { name: 'Codex', icon: 'term' }, verb: 'run a command', desc: '', detail: 'ls -la' };

console.log('UI');
if (!JSDOM) {
  console.log('  - skipped (run `npm install` first to get jsdom)');
} else {
  test('ask: number keys walk through questions, answers use option labels', () => {
    const p = page(JSON.parse(JSON.stringify(ASK)));
    p.key('Enter');
    eq(p.state().result, undefined, 'Enter with nothing selected does nothing');
    p.key('2'); p.key('Enter');
    eq(p.doc.querySelector('h1').textContent, 'Which features?');
    p.key('1'); p.key('3'); p.key('Enter');
    eq(p.state().result, { action: 'submit', answers: { 'Which database?': 'SQLite', 'Which features?': 'Sign-in, Dark mode' } });
  });

  test('ask: "Other" takes free text', () => {
    const p = page(JSON.parse(JSON.stringify(ASK)));
    p.key('4');
    const inp = p.doc.querySelector('.other-input');
    ok(p.doc.activeElement === inp, 'other input is focused');
    inp.value = 'Redis';
    inp.dispatchEvent(new p.dom.window.Event('input', { bubbles: true }));
    inp.dispatchEvent(new p.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    p.key('2'); p.key('Enter');
    eq(p.state().result.answers['Which database?'], 'Redis');
  });

  test('ask: Esc hands the question back to the app', () => {
    const p = page(JSON.parse(JSON.stringify(ASK)));
    p.key('Escape');
    eq(p.state().result, { action: 'app' });
  });

  test('perm: Enter allows (keys only reach the popup after you click it), Esc hands back', () => {
    const p = page(JSON.parse(JSON.stringify(PERM)));
    eq(p.doc.querySelector('h1').textContent, 'Codex wants to run a command');
    p.key('Enter');
    eq(p.state().result.action, 'allow');
    eq(p.state().answers.length, 1, 'the answer is also reported per request');
    const q = page(JSON.parse(JSON.stringify(PERM)));
    q.key('Escape');
    eq(q.state().result.action, 'app');
  });

  test('Chinese UI', () => {
    const M = load();
    const p = page(Object.assign(JSON.parse(JSON.stringify(PERM)), { t: M.STRINGS.zh, verb: '运行命令', agent: { name: 'Claude', icon: 'spark' } }));
    eq(p.doc.querySelector('h1').textContent, 'Claude 想要运行命令');
    eq(p.doc.querySelector('[data-a=allow]').textContent, '允许');
    eq(p.doc.querySelector('[data-a=deny]').textContent, '拒绝');
  });

  test('done: one card per agent + project, newest first, each with its own Open', () => {
    const now = Date.now(), claude = { name: 'Claude', icon: 'spark' }, codex = { name: 'Codex', icon: 'term' };
    const p = page({ mode: 'done', items: [
      { id: 'a', project: 'web', time: now - 4000, message: 'A', agent: claude },
      { id: 'b', project: 'api', time: now - 3000, message: 'B', agent: codex },
      { id: 'c', project: 'web', time: now - 1000, message: 'C', agent: claude }] });
    eq(p.doc.querySelector('h1').textContent, '✓3 tasks complete');
    eq(p.doc.querySelectorAll('.card').length, 2, 'the two "web" messages share a card');
    eq([...p.doc.querySelectorAll('.card')].map(c => [...c.querySelectorAll('.msg')].map(m => m.textContent).join('')), ['CA', 'B']);
    eq(p.doc.querySelector('.card .count').textContent, '2 updates');
    eq([...p.doc.querySelectorAll('[data-open]')].map(b => b.textContent), ['Open Claude', 'Open Codex']);
    eq(p.doc.querySelector('[data-a=open]'), null, 'no single Open in the footer when projects are mixed');
    p.doc.querySelectorAll('[data-open]')[1].click();
    eq(p.state().opened, ['b'], 'opens that card\'s session');
    eq(p.state().result, undefined, 'the rest of the window stays');
    eq(p.doc.querySelectorAll('.card').length, 1);
    eq(p.doc.querySelector('[data-a=open]').textContent, 'Open Claude', 'one project left: Open moves to the footer');
    p.doc.querySelector('[data-a=ok]').click();
    eq(p.state().result, { action: 'ok' });
  });

  test('done: live insert joins its card; a single project keeps Open in the footer', () => {
    const claude = { name: 'Claude', icon: 'spark' };
    const p = page({ mode: 'done', items: [{ id: 'x', project: 'web', time: 1, message: 'old', agent: claude }] });
    eq(p.doc.querySelector('[data-a=open]').textContent, 'Open Claude');
    p.dom.window.__add([{ id: 'y', project: 'web', time: 2, message: 'new', agent: claude }]);
    eq(p.doc.querySelectorAll('.card').length, 1);
    ok(p.doc.querySelector('.card').classList.contains('fresh'), 'updated card is highlighted');
    p.doc.querySelector('[data-a=open]').click();
    eq(p.state().result, { action: 'open', id: 'y' });
  });

  test('Codex-only popups take the Codex look; Claude and mixed ones keep Claude\'s', () => {
    const codex = { name: 'Codex', icon: 'term', theme: 'codex' }, claude = { name: 'Claude', icon: 'spark' };
    eq(page(Object.assign(JSON.parse(JSON.stringify(PERM)), { agent: codex })).doc.documentElement.className, 'theme-codex');
    eq(page(JSON.parse(JSON.stringify(ASK))).doc.documentElement.className, '');
    const p = page({ mode: 'done', items: [{ id: 'a', time: 1, message: 'A', agent: codex }] });
    eq(p.doc.documentElement.className, 'theme-codex');
    p.dom.window.__add([{ id: 'b', time: 2, message: 'B', agent: claude }]);
    eq(p.doc.documentElement.className, '', 'a Claude message joins: back to the shared look');
  });

  test('perm: several requests share one window, each answered on its own', () => {
    const req = (id, cmd, agent) => ({ id, time: id === 'a' ? 1 : 2, project: 'p-' + id, tool: 'Bash', verb: 'run a command',
      desc: '', detail: cmd, agent: agent || { name: 'Claude', icon: 'spark' } });
    const p = page({ mode: 'perm', items: [req('a', 'npm test'), req('b', 'rm -rf dist')] });
    eq(p.doc.querySelector('h1').textContent, '2 requests need your approval');
    eq(p.doc.querySelectorAll('.card.req').length, 2);
    p.doc.querySelector('[data-a=deny][data-id=b]').click();
    eq(p.state().answers, [{ id: 'b', action: 'deny' }]);
    eq(p.state().result, undefined, 'one left: window stays');
    eq(p.doc.querySelector('h1').textContent, 'Claude wants to run a command', 'back to the single-request layout');
    p.dom.window.__add([req('c', 'git push', { name: 'Codex', icon: 'term', theme: 'codex' })]);
    eq(p.doc.querySelectorAll('.card.req').length, 2, 'a new request joins as a card');
    eq(p.doc.documentElement.className, '', 'mixed agents keep the shared look');
    p.dom.window.__remove(['a']);
    p.key('Escape');
    eq(p.state().answers.slice(1), [{ id: 'c', action: 'app' }]);
    eq(p.state().result.action, 'app');
  });

  test('every popup collapses to a capsule and opens again', () => {
    const p = page(JSON.parse(JSON.stringify(PERM)));
    p.doc.querySelector('[data-fold]').click();
    eq(p.state().collapsed, true);
    ok(p.doc.documentElement.classList.contains('collapsed'));
    eq(p.doc.querySelector('#pill .pill-text').textContent, '1 waiting for approval');
    p.key('Enter', { metaKey: true });
    eq(p.state().result, undefined, 'keys do nothing while collapsed');
    p.dom.window.__expand();
    eq(p.state().collapsed, false);
  });

  test('a request arriving while collapsed stays a capsule (the theme never drops "collapsed")', () => {
    // The window is resized from what the page reports: opening it while the page still says
    // collapsed leaves the popup cut off inside a capsule-sized window, with no capsule to click.
    const req = (id, agent) => ({ id, time: +id.slice(1), project: 'p', tool: 'Bash', verb: 'run a command',
      desc: '', detail: 'cmd ' + id, agent });
    const claude = { name: 'Claude', icon: 'spark' }, codex = { name: 'Codex', icon: 'term', theme: 'codex' };
    const p = page({ mode: 'perm', items: [req('r1', claude)] });
    p.doc.querySelector('[data-fold]').click();
    ok(p.doc.documentElement.classList.contains('collapsed'));
    p.dom.window.__add([req('r2', codex)]);
    ok(p.doc.documentElement.classList.contains('collapsed'), 'still collapsed after the new request');
    eq(p.state().collapsed, true);
    eq(p.doc.querySelector('#pill .pill-text').textContent, '2 waiting for approval');
    eq(p.doc.documentElement.classList.contains('theme-codex'), false, 'adding another agent drops the Codex theme');
    p.dom.window.__expand();
    ok(!p.doc.documentElement.classList.contains('collapsed'));
    eq(p.doc.querySelectorAll('.card.req').length, 2, 'both requests are there when it opens');
  });

  test('done: replies render as Markdown (tables, lists, code, emphasis)', () => {
    const md = [
      '支持。**命令行版**用的是同一份配置（`~/.claude/settings.json`）：',
      '',
      '| 功能 | 桌面版 | 命令行版 |',
      '|---|---|---|',
      '| 审批弹窗 | ✅ | ✅ 一样 |',
      '',
      '- 第一点 *重要*',
      '- 第二点',
      '',
      '1. 步骤一',
      '2. 步骤二',
      '',
      '> 引用一句',
      '',
      '```bash',
      'npm test && ./install.sh',
      '```',
      '## 小标题',
      '见 [文档](http://example.com)。',
    ].join('\n');
    const p = page({ mode: 'done', items: [{ id: 'a', project: 'p', time: 1, message: 'plain', markdown: md, agent: { name: 'Claude', icon: 'spark' } }] });
    const m = p.doc.querySelector('.msg');
    eq(m.querySelector('strong').textContent, '命令行版');
    eq(m.querySelector('p code').textContent, '~/.claude/settings.json');
    eq([...m.querySelectorAll('th')].map(e => e.textContent), ['功能', '桌面版', '命令行版']);
    eq([...m.querySelectorAll('td')].map(e => e.textContent), ['审批弹窗', '✅', '✅ 一样']);
    eq([...m.querySelectorAll('ul li')].map(e => e.textContent), ['第一点 重要', '第二点']);
    eq(m.querySelector('ul em').textContent, '重要');
    eq([...m.querySelectorAll('ol li')].map(e => e.textContent), ['步骤一', '步骤二']);
    eq(m.querySelector('blockquote').textContent, '引用一句');
    eq(m.querySelector('pre.md-code').textContent, 'npm test && ./install.sh');
    eq(m.querySelector('.md-h').textContent, '小标题');
    eq(m.querySelector('a'), null, 'links show as text, never as clickable links');
    eq(m.querySelector('.md-link').textContent, '文档');
  });

  test('done: Markdown never lets HTML from a reply through', () => {
    const evil = 'hi <img src=x onerror=alert(1)> **<b id=bold>x</b>**\n\n| <i id=cell>c</i> | d |\n|---|---|\n| `<script>` | [<u id=lnk>l</u>](javascript:alert(1)) |\n\n```\n</pre><b id=code>y</b>\n```';
    const p = page({ mode: 'done', items: [{ id: 'a', project: 'p', time: 1, message: 'x', markdown: evil, agent: { name: 'Claude', icon: 'spark' } }] });
    const d = p.doc;
    ['bold', 'cell', 'lnk', 'code'].forEach(id => ok(!d.getElementById(id), 'no injected #' + id));
    eq(d.querySelectorAll('.msg img, .msg script, .msg a').length, 0);
    ok(d.querySelector('.msg').textContent.includes('<img src=x onerror=alert(1)>'), 'shown as text');
  });

  test('untrusted text is escaped, never rendered as HTML', () => {
    const p = page({ mode: 'perm', project: 'x', tool: 'Bash', agent: { name: 'Claude', icon: 'spark' }, verb: 'v', desc: '', detail: '</script><b id=pwn>x</b>' });
    ok(!p.doc.getElementById('pwn'), 'no injected element');
    eq(p.doc.querySelector('pre.code').textContent, '</script><b id=pwn>x</b>');
  });
}

// ---------------------------------------------------------------------------
// Task-complete queue + window-owner lock
// ---------------------------------------------------------------------------
console.log('Queue & lock');

const TMP = path.join(os.tmpdir(), 'coding-agent-popup-test-' + process.pid);
const QDIR = TMP + '/done-queue/';
const LOCK = TMP + '/done-owner';
const CLAUDE = { name: 'Claude', icon: 'spark', app: ['Claude'], host: '' };

const FS_SHIM = `
var __fs = require('fs'), __base = ${JSON.stringify(TMP + '/')}, __script = null;
function baseDir(){ __fs.mkdirSync(__base, {recursive:true}); return __base; }
function ensureDir(p){ __fs.mkdirSync(p, {recursive:true}); }
function fileExists(p){ return __fs.existsSync(p); }
function readText(p){ try { return __fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }
function writeText(p, s){ __fs.writeFileSync(p, s); return true; }
function removePath(p){ __fs.rmSync(p, {recursive:true, force:true}); }
function listDir(p){ try { return __fs.readdirSync(p); } catch (e) { return []; } }
function mtimeMs(p){ try { return __fs.statSync(p).mtimeMs; } catch (e) { return 0; } }
function fm(){ return { createDirectoryAtPathWithIntermediateDirectoriesAttributesError: function(p, inter){
  try { __fs.mkdirSync(p, {recursive: !!inter}); return true; } catch (e) { return false; } } }; }
function $(x){ return x; }
var ObjC = { unwrap: function(x){ return x; } };
function S(){ return STRINGS.en; }
function showWebWindow(payload, opts){ return __script(payload, opts); }
var __jumps = [];
function activateHost(it){ __jumps.push(it); }
function readFrom(p, off, len){ try { var b = __fs.readFileSync(p).subarray(off); return (len ? b.subarray(0, len) : b).toString('utf8'); } catch (e) { return ''; } }
function fileSize(p){ try { return __fs.statSync(p).size; } catch (e) { return 0; } }
var __onDelay = null, __notify = false, __front = false, __spawn = false, __daemon = true;
// The shared approval window runs "in the background" on the requester's next wait.
function delay(){ if (__spawn && __daemon) { __spawn = false; runPermWindow(); } if (__onDelay) __onDelay(); }
function spawnPermWindow(){ __spawn = true; return true; }
function hostFrontmost(){ return typeof __front === 'function' ? __front() : __front; }
var __reminders = [];
function spawnReminder(data, agent, p){ __reminders.push(p); }
function envVar(){ return ''; }
function processTable(){ return ''; }
function ownPid(){ return 0; }
function promptNotifyInstalled(){ return __notify; }
`;

function queueModule() {
  fs.rmSync(TMP, { recursive: true, force: true });
  return new Function('require', SRC + '\n' + FS_SHIM +
    '\n;return {handleDone: handleDone, readQueue: readQueue, setScript: function(f){ __script = f; },' +
    ' front: function(v){ __front = v; }};')(require);
}
function holdLock(staleMs) {
  fs.mkdirSync(LOCK, { recursive: true });
  fs.writeFileSync(LOCK + '/hb', String(Date.now() - (staleMs || 0)));
}

test('a second session joins the open window instead of opening another', () => {
  const M = queueModule();
  const rounds = [], injected = [];
  M.setScript((payload, opts) => {
    rounds.push(payload.items.map(i => i.project));
    if (rounds.length === 1) {
      eq(M.handleDone({ last_assistant_message: 'B' }, 'projB', CLAUDE), '', 'B returns at once');
      opts.onTick({ evalJS: js => injected.push(js), front: () => {}, touch: () => {} });
    }
    return { action: 'ok' };
  });
  M.handleDone({ last_assistant_message: 'A' }, 'projA', CLAUDE);
  eq(rounds, [['projA']]);
  ok(injected.length === 1 && injected[0].includes('projB'), 'B was pushed into the open window');
  eq(M.readQueue(QDIR).length, 0, 'queue drained');
  ok(!fs.existsSync(LOCK), 'lock released');
});

test('a message arriving while the window closes still gets shown', () => {
  const M = queueModule();
  const rounds = [];
  M.setScript((payload) => {
    rounds.push(payload.items.map(i => i.project));
    if (rounds.length === 1) M.handleDone({ last_assistant_message: 'C' }, 'projC', CLAUDE);   // lock still held
    return { action: 'ok' };
  });
  M.handleDone({ last_assistant_message: 'A' }, 'projA', CLAUDE);
  eq(rounds, [['projA'], ['projC']]);
});

test('a stale lock from a crashed window is taken over', () => {
  const M = queueModule();
  holdLock(60000);
  let shown = 0;
  M.setScript(() => { shown++; return { action: 'ok' }; });
  M.handleDone({ last_assistant_message: 'D' }, 'projD', CLAUDE);
  eq(shown, 1);
});

test('a live lock means: queue the message, do not open a window', () => {
  const M = queueModule();
  holdLock(0);
  let shown = 0;
  M.setScript(() => { shown++; return { action: 'ok' }; });
  M.handleDone({ last_assistant_message: 'E' }, 'projE', CLAUDE);
  eq(shown, 0);
  eq(M.readQueue(QDIR).length, 1);
});

test('dismissing one card deletes only that message', () => {
  const M = queueModule();
  holdLock(0);
  M.handleDone({ last_assistant_message: 'E' }, 'projE', CLAUDE);   // queued behind a live window
  fs.rmSync(LOCK, { recursive: true });
  M.setScript((payload, opts) => {
    eq(payload.items.length, 2, 'both messages shown together');
    const id = payload.items[0].id;
    opts.onState({ dismissed: [id] });
    const left = M.readQueue(QDIR);
    ok(left.length === 1 && left[0].id !== id, 'only the dismissed file was removed');
    return { action: 'ok' };
  });
  M.handleDone({ last_assistant_message: 'F' }, 'projF', CLAUDE);
});

test('background turns (auto-review threads, JSON suggestions, subagents) never notify', () => {
  const M = queueModule();
  let shown = 0;
  M.setScript(() => { shown++; return { action: 'ok' }; });
  const rollout = TMP + '/rollout.jsonl';
  fs.mkdirSync(TMP, { recursive: true });
  const meta = (payload) => JSON.stringify({ type: 'session_meta', payload }) + '\n' + JSON.stringify({ type: 'event_msg', payload: {} }) + '\n';
  fs.writeFileSync(rollout, meta({ thread_source: 'guardian_review', source: { subagent: { other: 'guardian' } } }));
  M.handleDone({ last_assistant_message: 'Looks safe.', transcript_path: rollout }, 'p', CLAUDE);
  M.handleDone({ last_assistant_message: '{"suggestions":[{"title":"Next step","prompt":"Add tests"}]}' }, 'p', CLAUDE);
  M.handleDone({ last_assistant_message: 'done', agent_id: 'a1', agent_type: 'Explore' }, 'p', CLAUDE);
  eq(shown, 0);
  eq(M.readQueue(QDIR).length, 0, 'nothing queued');
  fs.writeFileSync(rollout, meta({ thread_source: 'user', source: 'vscode' }));
  M.handleDone({ last_assistant_message: 'Fixed the login page. {"ok": true} is now returned.', transcript_path: rollout }, 'p', CLAUDE);
  eq(shown, 1, 'a real task still notifies, even with JSON inside the text');
});

test('no task-complete popup while you are in the agent\'s app', () => {
  const M = queueModule();
  let shown = 0;
  M.setScript(() => { shown++; return { action: 'ok' }; });
  M.front(true);
  M.handleDone({ last_assistant_message: 'Done.' }, 'p', CLAUDE);
  eq(shown, 0);
  eq(M.readQueue(QDIR).length, 0);
  M.front(false);
});

// ---------------------------------------------------------------------------
// Permission requests the agent settles by itself
// ---------------------------------------------------------------------------
console.log('Settled elsewhere');

function hookModule() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  return new Function('require', SRC + '\n' + FS_SHIM +
    '\n;return {handleHook: handleHook, commandRunning: commandRunning, runPermWindow: runPermWindow, dragHit: dragHit,' +
    ' trackDrag: trackDrag,' +
    ' setScript: function(f){ __script = f; }, onDelay: function(f){ __onDelay = f; },' +
    ' notifyInstalled: function(v){ __notify = v; }, front: function(v){ __front = v; }, daemon: function(v){ __daemon = v; },' +
    ' jumps: function(){ return __jumps; }, reminders: function(){ return __reminders; }};')(require);
}
const TRANSCRIPT = TMP + '/session.jsonl';
const jl = (...rows) => rows.map(r => JSON.stringify(r) + '\n').join('');
const toolUse = (id, name, input) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
const toolResult = (id) => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const permEvent = (extra) => Object.assign({ hook_event_name: 'PermissionRequest', cwd: '/a/proj', transcript_path: TRANSCRIPT,
  tool_name: 'Bash', tool_input: { description: 'Run tests', command: 'npm test' } }, extra || {});
const ALLOW = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });

test('a call the agent already ran never opens a popup', () => {
  const H = hookModule();
  fs.writeFileSync(TRANSCRIPT, jl(toolUse('t1', 'Bash', { command: 'npm test', description: 'Run tests' }), toolResult('t1')));
  let shown = 0;
  H.setScript(() => { shown++; return { action: 'allow' }; });
  eq(H.handleHook(permEvent(), CLAUDE), '', 'no decision: the agent handles it');
  eq(shown, 0);
});

test('Codex: a command that finishes while the popup is open withdraws the request', () => {
  const H = hookModule();
  H.daemon(false);                                          // the window never answers
  const finished = (cmd) => ({ type: 'event_msg', payload: { type: 'item_completed',
    item: { type: 'CommandExecution', id: 'exec-1', command: ['/bin/zsh', '-lc', cmd] } } });
  fs.writeFileSync(TRANSCRIPT, jl(finished('npm test')));   // an earlier run must not count
  let waits = 0;
  H.onDelay(() => { if (++waits === 8) fs.appendFileSync(TRANSCRIPT, jl(finished('npm test'))); });
  eq(H.handleHook(permEvent({ tool_input: { command: 'npm test' } }), { key: 'codex', name: 'Codex', icon: 'term', app: [], host: '' }), '');
  ok(waits >= 8, 'the earlier run did not settle it');
  eq(fs.readdirSync(TMP + '/perm/queue/').length, 0, 'request withdrawn from the shared window');
});

test('the request is withdrawn once the agent settles the call', () => {
  const H = hookModule();
  H.daemon(false);
  fs.writeFileSync(TRANSCRIPT, jl(toolUse('t1', 'Bash', { command: 'npm test', description: 'Run tests' })));
  let waits = 0;
  H.onDelay(() => { if (++waits === 20) fs.appendFileSync(TRANSCRIPT, jl(toolResult('t1'))); });
  eq(H.handleHook(permEvent(), CLAUDE), '');
  ok(waits >= 20 && waits < 30, 'noticed soon after the result arrived');
  eq(fs.readdirSync(TMP + '/perm/queue/').length, 0);
});

test('a pending call still gets the popup, even if the same command ran before', () => {
  const H = hookModule();
  fs.writeFileSync(TRANSCRIPT, jl(
    toolUse('old', 'Bash', { command: 'npm test', description: 'Run tests' }), toolResult('old'),
    toolUse('new', 'Bash', { command: 'npm test', description: 'Run tests' })));
  let shown = 0;
  H.setScript(() => { shown++; return { action: 'allow' }; });
  eq(H.handleHook(permEvent(), CLAUDE), ALLOW);
  eq(shown, 1);
});

test('no transcript: popup behaves as before', () => {
  const H = hookModule();
  H.setScript(() => ({ action: 'allow' }));
  eq(H.handleHook(permEvent({ transcript_path: '' }), CLAUDE), ALLOW);
});

test('Codex rollout: a shell call with output is recognised by its command', () => {
  const H = hookModule();
  fs.writeFileSync(TRANSCRIPT, jl(
    { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: JSON.stringify({ cmd: 'npm test' }), call_id: 'c1' } },
    { type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: 'ok' } }));
  let shown = 0;
  H.setScript(() => { shown++; return { action: 'allow' }; });
  eq(H.handleHook(permEvent({ tool_input: { command: 'npm test' } }), { name: 'Codex', icon: 'term', app: [], host: '' }), '');
  eq(shown, 0);
});

test('dontAsk mode never shows a popup', () => {
  const H = hookModule();
  let shown = 0;
  H.setScript(() => { shown++; return { action: 'allow' }; });
  eq(H.handleHook(permEvent({ permission_mode: 'dontAsk', transcript_path: '' }), CLAUDE), '');
  eq(shown, 0);
});

const CLAUDE_KEYED = Object.assign({ key: 'claude' }, CLAUDE);
const promptNote = (session) => ({ hook_event_name: 'Notification', notification_type: 'permission_prompt', session_id: session });

test('Claude Code: an auto-approved request never pops up, even when approval takes seconds', () => {
  const H = hookModule();
  H.notifyInstalled(true);
  fs.writeFileSync(TRANSCRIPT, jl(toolUse('t1', 'Bash', { command: 'npm test', description: 'Run tests' })));
  let waits = 0, shown = 0;
  H.onDelay(() => { if (++waits === 40) fs.appendFileSync(TRANSCRIPT, jl(toolResult('t1'))); });   // ~6 s in
  H.setScript(() => { shown++; return { action: 'allow' }; });
  eq(H.handleHook(permEvent({ session_id: 's1' }), CLAUDE_KEYED), '');
  eq(shown, 0);
});

test('Claude Code: the popup shows once Claude Code says it is waiting on you', () => {
  const H = hookModule();
  H.notifyInstalled(true);
  fs.writeFileSync(TRANSCRIPT, jl(toolUse('t1', 'Bash', { command: 'npm test', description: 'Run tests' })));
  let waits = 0, shownAt = -1;
  H.onDelay(() => {
    waits++;
    if (waits === 5) H.handleHook(promptNote('other-session'), CLAUDE_KEYED);   // not ours
    if (waits === 40) H.handleHook(promptNote('s1'), CLAUDE_KEYED);
  });
  H.setScript(() => { shownAt = waits; return { action: 'allow' }; });
  eq(H.handleHook(permEvent({ session_id: 's1' }), CLAUDE_KEYED), ALLOW);
  eq(shownAt, 40, 'shown right after the notification, not before');
});

test('Claude Code: without a notification the popup still shows after PROMPT_WAIT_SEC', () => {
  const H = hookModule();
  H.notifyInstalled(true);
  fs.writeFileSync(TRANSCRIPT, jl(toolUse('t1', 'Bash', { command: 'npm test', description: 'Run tests' })));
  let waits = 0, shownAt = -1;
  H.onDelay(() => { waits++; });
  H.setScript(() => { shownAt = waits; return { action: 'allow' }; });
  eq(H.handleHook(permEvent({ session_id: 's1' }), CLAUDE_KEYED), ALLOW);
  eq(shownAt, 200, '30 s of 150 ms waits');
});

test('Claude Code: questions, and setups without the Notification hook, show without waiting', () => {
  const H = hookModule();
  let waits = 0, shownAt = -1;
  H.onDelay(() => { waits++; });
  H.setScript(() => { shownAt = waits; return { action: 'allow' }; });
  eq(H.handleHook(permEvent({ session_id: 's1', transcript_path: '' }), CLAUDE_KEYED), ALLOW);
  eq(shownAt, 10, 'only the short grace period');
  H.notifyInstalled(true);
  waits = 0;
  H.setScript(() => ({ action: 'submit', answers: { 'Q?': 'A' } }));
  H.handleHook(permEvent({ session_id: 's1', transcript_path: '', tool_name: 'AskUserQuestion',
    tool_input: { questions: [{ question: 'Q?', options: [{ label: 'A' }] }] } }), CLAUDE_KEYED);
  eq(waits, 10, 'questions skip the notification wait');
});

const CODEX_KEYED = { key: 'codex', name: 'Codex', icon: 'term', app: [], host: '' };
const reviewer = (r) => ({ type: 'event_msg', payload: { type: 'thread_settings_applied',
  thread_settings: { approval_policy: 'on-request', approvals_reviewer: r } } });

test('Codex: with the auto-reviewer in charge, no popup at all', () => {
  const H = hookModule();
  fs.writeFileSync(TRANSCRIPT, jl(reviewer('user'), reviewer('auto_review')));   // latest setting wins
  let shown = 0, waits = 0;
  H.onDelay(() => { waits++; });
  H.setScript(() => { shown++; return { action: 'allow' }; });
  eq(H.handleHook(permEvent({ tool_input: { command: 'pnpm test' } }), CODEX_KEYED), '');
  eq(shown, 0);
  eq(waits, 0, 'returns at once so the reviewer is not held up');
});

test('Codex: when it asks you, the popup shows without making the agent wait', () => {
  const H = hookModule();
  fs.writeFileSync(TRANSCRIPT, jl(reviewer('auto_review'), reviewer('user')));
  let waits = 0, shownAt = -1;
  H.onDelay(() => { waits++; });
  H.setScript(() => { shownAt = waits; return { action: 'allow' }; });
  eq(H.handleHook(permEvent({ tool_input: { command: 'pnpm test' } }), CODEX_KEYED), ALLOW);
  eq(shownAt, 0, 'no grace period: Codex decides on the hook first');
});

test('the shared window adds, withdraws and answers requests across sessions', () => {
  const H = hookModule();
  const Q = TMP + '/perm/queue/', A = TMP + '/perm/answers/';
  fs.mkdirSync(Q, { recursive: true }); fs.mkdirSync(A, { recursive: true });
  const file = (id, time) => fs.writeFileSync(Q + id + '.json', JSON.stringify({ id, time, mode: 'perm', tool: 'Bash',
    verb: 'run a command', detail: 'cmd ' + id, agent: { name: 'Claude', icon: 'spark' }, deadline: Date.now() + 60000 }));
  file('a', 1); file('b', 2);
  const js = [];
  H.setScript((payload, opts) => {
    eq(payload.items.map(i => i.id), ['a', 'b'], 'both waiting requests in one window');
    const ctx = { evalJS: (s) => js.push(s), front: () => {}, touch: () => {}, finish: () => {} };
    file('c', 3);                                  // another session asks meanwhile
    fs.rmSync(Q + 'b.json');                       // b was settled elsewhere
    opts.onTick(ctx);
    opts.onState({ answers: [{ id: 'a', action: 'allow' }] });
    return { action: 'empty' };
  });
  H.runPermWindow();
  ok(js.some(s => s.includes('__add') && s.includes('"c"')), 'c joined the open window');
  ok(js.some(s => s.includes('__remove') && s.includes('"b"')), 'b left it');
  eq(JSON.parse(fs.readFileSync(A + 'a.json', 'utf8')), { action: 'allow' });
  eq(JSON.parse(fs.readFileSync(A + 'c.json', 'utf8')), { action: 'app' }, 'still open when it closed: back to the app');
  ok(!fs.existsSync(A + 'b.json'), 'no answer for a withdrawn request');
});

test('in the agent\'s app: Codex gets its own prompt plus a reminder; Claude waits until you leave', () => {
  const H = hookModule();
  let shown = 0;
  H.setScript(() => { shown++; return { action: 'allow' }; });
  H.front(true);
  eq(H.handleHook(permEvent({ transcript_path: '' }), CODEX_KEYED), '', 'Codex: its own prompt takes over');
  eq(H.reminders().length, 1, 'a reminder watches in case you leave Codex without answering');
  let calls = 0;
  H.front(() => ++calls <= 6);                     // looking at the app for a while, then away
  eq(H.handleHook(permEvent({ transcript_path: '' }), CLAUDE_KEYED), ALLOW);
  eq(shown, 1);
  ok(calls > 6, 'shown only after you left the app');
});

test('Claude: a request that is still waiting comes back when you leave the app again', () => {
  const H = hookModule();
  H.daemon(false);
  const Q = TMP + '/perm/queue/';
  const seq = [false, false, false, false, true, true, true, true, true, true, true, true, true, true, true, true];
  let i = 0, log = [];
  H.front(() => seq[Math.min(i++, seq.length - 1)] && i < 60 ? seq[Math.min(i - 1, seq.length - 1)] : false);
  H.onDelay(() => { log.push(fs.existsSync(Q) ? fs.readdirSync(Q).length : 0); if (log.length > 240) fs.writeFileSync(Q + 'stop', ''); });
  H.handleHook(permEvent({ transcript_path: '' }), CLAUDE_KEYED);
  const s = log.join('');
  ok(/1+0+1+/.test(s), 'shown, withdrawn while in the app, shown again: ' + s.slice(0, 80));
});

test('"Answer in app" takes you to that session, once even for several requests', () => {
  const H = hookModule();
  H.setScript(() => ({ action: 'app' }));
  const codex = Object.assign({}, CODEX_KEYED, { host: 'com.openai.codex', app: ['Codex'] });
  eq(H.handleHook(permEvent({ transcript_path: '', session_id: 'thread-1' }), codex), '');
  eq(H.handleHook(permEvent({ transcript_path: '', session_id: 'thread-2' }), codex), '');
  eq(H.jumps().map(j => j.sessionId), ['thread-1'], 'the second hand-off right after does not jump again');
});

test('drag starts from the top strip (or anywhere on the capsule), not from the buttons', () => {
  const H = hookModule();
  const size = { width: 400, height: 466 };
  ok(H.dragHit(false, { x: 200, y: 440 }, size), 'top strip');
  ok(!H.dragHit(false, { x: 200, y: 300 }, size), 'body: a click, not a drag');
  ok(!H.dragHit(false, { x: 380, y: 450 }, size), 'the fold button corner is left to the page');
  ok(H.dragHit(true, { x: 10, y: 10 }, { width: 155, height: 38 }), 'capsule: anywhere');
});

test('a long drag keeps refreshing the window lock instead of letting it look crashed', () => {
  // A drag spins its own event loop for up to a minute; the locks must stay fresh, or another
  // process treats the window as crashed after STALE_MS (6 s) and opens a second one.
  const H = hookModule();
  let t = 0, beats = [], events = 0;
  const now = () => t;
  H.trackDrag(() => { events++; t += 50; return t > 10000 ? 'up' : undefined; },   // 10 s, then mouse-up
    () => beats.push(t), now);
  eq(events, 201, 'read events until the mouse went up');
  ok(beats.length >= 19 && beats.length <= 21, 'about two beats a second: ' + beats.length);
  ok(beats[beats.length - 1] >= 9500, 'still beating half a second before the mouse-up: ' + beats[beats.length - 1]);
});

test('a drag that ends at once (a plain click) does not heartbeat or move the window', () => {
  const H = hookModule();
  let beats = 0;
  H.trackDrag(() => 'up', () => beats++, () => 0);
  eq(beats, 0);
});

test('a running copy of the command means the agent approved it', () => {
  const H = hookModule();
  const table = [
    '  100     1 /Applications/Claude.app/Contents/MacOS/claude --output-format stream-json',
    '  200   100 /bin/sh -c osascript -l JavaScript "$HOME/.coding-agent-popup/coding-agent-popup.js" claude',
    '  201   200 osascript -l JavaScript /Users/me/.coding-agent-popup/coding-agent-popup.js claude',
    '  202   201 /bin/zsh -lc /bin/ps -axww -o pid=,ppid=,command=',
    "  300   100 /bin/zsh -c source /x/snapshot.sh && eval 'npm test -- --grep '\"'\"'login'\"'\"'' < /dev/null && pwd -P",
    '  400   100 /bin/zsh -lc cargo build --release',
    "  500     1 /bin/zsh -c eval 'make deploy'",
  ].join('\n');
  ok(H.commandRunning(table, 201, "npm test -- --grep 'login'"), 'Claude Code shell, quotes escaped');
  ok(H.commandRunning(table, 201, 'cargo build --release\necho done'), 'Codex shell, first line');
  ok(!H.commandRunning(table, 201, 'npm run build'), 'a different command');
  ok(!H.commandRunning(table, 201, 'make deploy'), 'not under this agent');
  ok(!H.commandRunning(table, 201, '/bin/ps -axww -o pid=,ppid=,command='), 'our own children do not count');
});

console.log('Session links');

test('links open the exact Codex thread or Claude desktop session', () => {
  const home = path.join(os.tmpdir(), 'coding-agent-popup-links-' + process.pid);
  const dir = home + '/Library/Application Support/Claude-3p/claude-code-sessions/acct/org';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + '/local_abc-123.json', JSON.stringify({ sessionId: 'local_abc-123', cliSessionId: 'cli-9' }));
  const L = new Function('require', SRC + `
    function homeDir(){ return ${JSON.stringify(home)}; }
    function fileExists(p){ return require('fs').existsSync(p); }
    function readText(p){ try { return require('fs').readFileSync(p, 'utf8'); } catch (e) { return ''; } }
    var Application = { currentApplication: function(){ return { doShellScript: function(cmd){
      return require('child_process').execSync(cmd, { shell: '/bin/sh' }).toString(); } }; } };
    ;return { sessionLink: sessionLink };`)(require);
  eq(L.sessionLink({ host: 'com.openai.codex', sessionId: '01a1-thread' }), 'codex://threads/01a1-thread');
  eq(L.sessionLink({ host: 'com.anthropic.claudefordesktop', sessionId: 'cli-9' }), 'claude://claude.ai/epitaxy/local_abc-123');
  eq(L.sessionLink({ host: 'com.anthropic.claudefordesktop', sessionId: 'unknown' }), '', 'no record: just bring the app forward');
  eq(L.sessionLink({ host: 'com.apple.Terminal', sessionId: 'cli-9' }), '', 'terminals have no session link');
  fs.rmSync(home, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// install / uninstall config merging
// ---------------------------------------------------------------------------
console.log('Install');
const M = load();

test('install into an empty Claude config', () => {
  const cfg = M.mergeHooks({}, 'claude', false);
  eq(Object.keys(cfg.hooks).sort(), ['Notification', 'PermissionRequest', 'Stop']);
  ok(/coding-agent-popup\.js" claude$/.test(cfg.hooks.PermissionRequest[0].hooks[0].command), 'command points at our script');
  eq(cfg.hooks.PermissionRequest[0].matcher, '');
  eq(cfg.hooks.Notification[0].matcher, 'permission_prompt');
  ok(/coding-agent-popup\.js" claude$/.test(cfg.hooks.Notification[0].hooks[0].command), 'notification hook runs in the foreground');
  eq(M.mergeHooks({}, 'codex', false).hooks.Notification, undefined, 'Codex has no Notification event');
});

test('install is idempotent and keeps unrelated settings and hooks', () => {
  const mine = {
    model: 'opus',
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'lint.sh' }] }]
    }
  };
  const once = M.mergeHooks(mine, 'claude', false);
  eq(M.mergeHooks(once, 'claude', false), once, 'second install changes nothing');
  eq(once.model, 'opus');
  eq(once.hooks.PreToolUse, mine.hooks.PreToolUse);
  eq(once.hooks.Stop.length, 2);
  eq(once.hooks.Stop[0].hooks[0].command, 'say done', 'existing hook kept first');
});

test('install replaces pre-release claude-popup.js hooks', () => {
  const old = { hooks: { PermissionRequest: [{ matcher: '', hooks: [{ type: 'command', command: 'osascript -l JavaScript ~/.claude/hooks/claude-popup.js', timeout: 300 }] }] } };
  const cfg = M.mergeHooks(old, 'claude', false);
  eq(cfg.hooks.PermissionRequest.length, 1);
  ok(cfg.hooks.PermissionRequest[0].hooks[0].command.includes('.coding-agent-popup/coding-agent-popup.js'));
});

test('Codex hooks: no matcher, Stop prints {} with a short timeout', () => {
  const cfg = M.mergeHooks({ description: 'mine' }, 'codex', false);
  eq(cfg.description, 'mine', 'top-level metadata preserved');
  ok(/echo '\{\}'$/.test(cfg.hooks.Stop[0].hooks[0].command));
  eq(cfg.hooks.Stop[0].hooks[0].timeout, 10);
  eq(cfg.hooks.PermissionRequest[0].matcher, undefined);
});

test('uninstall removes only our hooks and drops emptied sections', () => {
  const mine = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
  eq(M.mergeHooks(M.mergeHooks(mine, 'codex', false), 'codex', true), mine);
  eq(M.mergeHooks(M.mergeHooks({}, 'claude', false), 'claude', true), {});
});

test('the Stop hook command really forwards stdin to the background process', () => {
  const sink = path.join(os.tmpdir(), 'coding-agent-popup-test-stdin.txt');
  fs.rmSync(sink, { force: true });
  const cmd = M.hookCommand('codex', 'Stop')
    .replace('osascript -l JavaScript "$HOME/.coding-agent-popup/coding-agent-popup.js" codex', 'cat > ' + JSON.stringify(sink));
  const out = execSync(cmd, { shell: '/bin/sh', input: '{"hook_event_name":"Stop"}' }).toString();
  eq(out.trim(), '{}', 'Codex gets valid JSON back');
  execSync('sleep 0.3');
  eq(fs.readFileSync(sink, 'utf8'), '{"hook_event_name":"Stop"}', 'event reached the background job');
  fs.rmSync(sink, { force: true });
});

// ---------------------------------------------------------------------------
// Hook entry point
// ---------------------------------------------------------------------------
console.log('Entry point');

function entry() {
  return load(`
    var __got = null, __count = 0;
    function handleHook(d, a){ __got = { d: d, a: a.name }; __count++; return ''; }
    function agentInfo(k){ return { name: k }; }
    function readStdin(){ throw new Error('must not read stdin in notify mode'); }
  `, '{run: run, got: function(){ return __got; }, count: function(){ return __count; }}');
}

test('Codex notify JSON (last argv) becomes a Stop event', () => {
  const X = entry();
  X.run(['codex', JSON.stringify({ type: 'agent-turn-complete', cwd: '/a/b/proj', 'last-assistant-message': 'hi', 'thread-id': 't-1' })]);
  eq(X.got(), { d: { hook_event_name: 'Stop', last_assistant_message: 'hi', cwd: '/a/b/proj', session_id: 't-1' }, a: 'codex' });
});

test('other notify event types are ignored', () => {
  const X = entry();
  X.run(['codex', JSON.stringify({ type: 'something-else' })]);
  eq(X.count(), 0);
});

test('Markdown is stripped from completion messages', () => {
  eq(M.plainText('## Done\n**Fixed** `login.tsx`, see [docs](http://x).'), 'Done\nFixed login.tsx, see docs.');
});

test('completion text drops blank lines, quote markers and code blocks so the card shows content', () => {
  eq(M.plainText('一般不用。文档原话是：\n\n> Direct edits are picked up by the file watcher.\n\n也就是说，`install.sh` 改完就生效。'),
    '一般不用。文档原话是：\nDirect edits are picked up by the file watcher.\n也就是说，install.sh 改完就生效。');
  eq(M.plainText('可以，直接运行就行：\n\n```bash\ncd /x && ./install.sh\n```\n\n它会做这些事：\n\n' +
    '- **复制脚本**：拷到 `~/.coding-agent-popup/`。\n* [x] done item\n\n| 常量 | 默认值 |\n|---|:---:|\n| `GRACE_MS` | `1000` |\n\n---\n\n1. 第一步 *重要*'),
    '可以，直接运行就行：\n它会做这些事：\n• 复制脚本：拷到 ~/.coding-agent-popup/。\n• done item\n常量 · 默认值\nGRACE_MS · 1000\n1. 第一步 重要');
  eq(M.plainText('keep set_setting, GRACE_MS and 2 * 3 * 4 as they are'), 'keep set_setting, GRACE_MS and 2 * 3 * 4 as they are');
});

test('optional Cocoa object arguments get nil, never null (JXA turns null into NSNull)', () => {
  ok(!/AttributesError\([^)]*,\s*null,\s*null\)/.test(SRC), 'createDirectory attributes');
  ok(!/loadHTMLStringBaseURL\([^;]*,\s*null\)/.test(SRC), 'loadHTMLString baseURL');
  ok(/evaluateJavaScriptCompletionHandler\([^;]*,\s*function\s*\(\)\s*\{\s*\}\)/.test(SRC), 'evaluateJavaScript gets a real completion function');
});

test('the event loop uses a numeric mask, not $.NSEventMaskAny (bridged as a string that matches nothing)', () => {
  ok(!/=\s*\$\.NS(EventMaskAny|AnyEventMask)/.test(SRC));
});

// ---------------------------------------------------------------------------
// install / uninstall against a fake home directory
// ---------------------------------------------------------------------------
console.log('Install files');

const HOME = path.join(os.tmpdir(), 'coding-agent-popup-home-' + process.pid);
const HOME_SHIM = `
var __fs = require('fs'), __home = ${JSON.stringify(HOME)}, __tmp = ${JSON.stringify(HOME + '/tmp/')};
function homeDir(){ __fs.mkdirSync(__home, {recursive:true}); return __home; }
function baseDir(){ __fs.mkdirSync(__tmp, {recursive:true}); return __tmp; }
function ensureDir(p){ __fs.mkdirSync(p, {recursive:true}); }
function fileExists(p){ return __fs.existsSync(p); }
function readText(p){ try { return __fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }
function writeText(p, s){ __fs.writeFileSync(p, s); return true; }
function removePath(p){ __fs.rmSync(p, {recursive:true, force:true}); }
function listDir(p){ try { return __fs.readdirSync(p); } catch (e) { return []; } }
function mtimeMs(p){ try { return __fs.statSync(p).mtimeMs; } catch (e) { return 0; } }
function fm(){ return {
  createDirectoryAtPathWithIntermediateDirectoriesAttributesError: function(p, inter){
    try { __fs.mkdirSync(p, {recursive: !!inter}); return true; } catch (e) { return false; } },
  copyItemAtPathToPathError: function(src, dst){ try { __fs.copyFileSync(src, dst); return true; } catch (e) { return false; } }
}; }
function $(x){ return x; }
var ObjC = { unwrap: function(x){ return x; } };
function selfPath(){ return ${JSON.stringify(path.join(__dirname, '..', 'coding-agent-popup.js'))}; }
`;

function installerModule() {
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.mkdirSync(HOME, { recursive: true });
  return new Function('require', SRC + '\n' + HOME_SHIM +
    '\n;return {install: install, uninstall: uninstall};')(require);
}
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('install copies the script and writes hooks, keeping existing settings', () => {
  const I = installerModule();
  fs.mkdirSync(HOME + '/.claude', { recursive: true });
  fs.writeFileSync(HOME + '/.claude/settings.json', JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } }));
  const out = I.install(['claude']);
  ok(fs.existsSync(HOME + '/.coding-agent-popup/coding-agent-popup.js'), 'script copied to ~/.coding-agent-popup');
  const cfg = readJSON(HOME + '/.claude/settings.json');
  eq(cfg.model, 'opus');
  eq(cfg.hooks.Stop.length, 2, 'existing Stop hook kept, ours added');
  ok(cfg.hooks.PermissionRequest[0].hooks[0].command.includes('"$HOME/.coding-agent-popup/coding-agent-popup.js" claude'));
  ok(fs.readdirSync(HOME + '/.claude').some(f => f.startsWith('settings.json.bak-')), 'backup written');
  ok(!out.includes('trusted once'), 'no Codex instructions when only Claude is installed');
});

test('install claude + codex writes both configs', () => {
  const I = installerModule();
  I.install(['claude', 'codex']);
  const claude = readJSON(HOME + '/.claude/settings.json');
  const codex = readJSON(HOME + '/.codex/hooks.json');
  ok(claude.hooks.PermissionRequest.length === 1 && codex.hooks.PermissionRequest.length === 1);
  ok(codex.hooks.Stop[0].hooks[0].command.endsWith("echo '{}'"), 'Codex Stop hook emits JSON');
});

test('a broken config is left untouched and reported', () => {
  const I = installerModule();
  fs.mkdirSync(HOME + '/.claude', { recursive: true });
  fs.writeFileSync(HOME + '/.claude/settings.json', '{ not json');
  const out = I.install(['claude']);
  eq(fs.readFileSync(HOME + '/.claude/settings.json', 'utf8'), '{ not json');
  ok(out.includes('not valid JSON'), 'tells the user what to fix');
});

test('uninstall removes our hooks and the install dir, leaving your settings', () => {
  const I = installerModule();
  fs.mkdirSync(HOME + '/.claude', { recursive: true });
  fs.writeFileSync(HOME + '/.claude/settings.json', JSON.stringify({ model: 'opus' }));
  I.install(['claude', 'codex']);
  I.uninstall();
  eq(readJSON(HOME + '/.claude/settings.json'), { model: 'opus' });
  eq(readJSON(HOME + '/.codex/hooks.json'), {});
  ok(!fs.existsSync(HOME + '/.coding-agent-popup'), 'install dir removed');
});

test('upgrading from agent-popup swaps the hooks, keeps the popup position and drops ~/.agent-popup', () => {
  const I = installerModule();
  const oldCmd = 'osascript -l JavaScript "$HOME/.agent-popup/agent-popup.js" claude';
  fs.mkdirSync(HOME + '/.claude', { recursive: true });
  fs.writeFileSync(HOME + '/.claude/settings.json', JSON.stringify({ hooks: {
    PermissionRequest: [{ matcher: '', hooks: [{ type: 'command', command: oldCmd, timeout: 300 }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }, { type: 'command', command: oldCmd }] }] } }));
  fs.mkdirSync(HOME + '/.agent-popup', { recursive: true });
  fs.writeFileSync(HOME + '/.agent-popup/agent-popup.js', '// old');
  fs.writeFileSync(HOME + '/.agent-popup/window.json', '{"popupBL":{"x":900,"y":40}}');
  const out = I.install(['claude']);
  const cfg = readJSON(HOME + '/.claude/settings.json');
  const cmds = Object.values(cfg.hooks).flat().flatMap(g => g.hooks.map(h => h.command));
  ok(!cmds.some(c => c.includes('.agent-popup/agent-popup.js')), 'no old hook left to fire twice');
  eq(cfg.hooks.PermissionRequest.length, 1);
  eq(cfg.hooks.Stop[0].hooks.map(h => h.command), ['say done'], 'your own hook in the same group stays');
  ok(!fs.existsSync(HOME + '/.agent-popup'), 'old install dir removed');
  eq(fs.readFileSync(HOME + '/.coding-agent-popup/window.json', 'utf8'), '{"popupBL":{"x":900,"y":40}}', 'position kept');
  ok(out.includes('replaced the old install'), 'says what it did');
});

test('uninstall also cleans up an old agent-popup install', () => {
  const I = installerModule();
  fs.mkdirSync(HOME + '/.agent-popup', { recursive: true });
  fs.writeFileSync(HOME + '/.agent-popup/agent-popup.js', '// old');
  I.uninstall();
  ok(!fs.existsSync(HOME + '/.agent-popup'));
});

test('install.sh is executable and runs osascript with the install subcommand', () => {
  const sh = fs.readFileSync(path.join(__dirname, '..', 'install.sh'), 'utf8');
  ok(/osascript -l JavaScript "\$DIR\/coding-agent-popup\.js" install "\$@"/.test(sh));
  ok(/uname -s/.test(sh), 'refuses to run off macOS');
  ok((fs.statSync(path.join(__dirname, '..', 'install.sh')).mode & 0o111) !== 0, 'chmod +x set');
});

fs.rmSync(HOME, { recursive: true, force: true });

fs.rmSync(TMP, { recursive: true, force: true });
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
