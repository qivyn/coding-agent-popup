// Regenerates docs/preview.html — a static page showing the three popups side by side.
// Run with `npm run preview`. Only needed when editing the CSS in agent-popup.js.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'agent-popup.js'), 'utf8');
const M = new Function('require', src + '\n;return {buildHTML, STRINGS};')(require);

const T = M.STRINGS.en;
const now = Date.now();

const PAGES = {
  'Permission request': {
    mode: 'perm', project: 'my-webapp', tool: 'Bash', agent: { name: 'Claude', icon: 'spark' },
    verb: 'run a command', desc: 'Install dependencies and run the test suite',
    detail: 'npm install && npm test -- --coverage',
  },
  'Multiple-choice question': {
    mode: 'ask', project: 'my-webapp', agent: { name: 'Claude', icon: 'spark' },
    questions: [{
      header: 'Database', question: 'Which database should this project use?', multiSelect: false,
      options: [
        { label: 'PostgreSQL', description: 'Relational, great for structured data and complex queries' },
        { label: 'SQLite', description: 'Zero config, single file, good for prototypes' },
        { label: 'MongoDB', description: 'Document store with a flexible schema' },
      ],
    }],
  },
  'Task complete (merged)': {
    mode: 'done', agent: { name: 'Claude', icon: 'spark' },
    items: [
      { id: '1', project: 'blog', time: now - 60000, agent: { name: 'Claude', icon: 'spark' },
        message: 'Draft is ready in posts/agent-popup.md.' },
      { id: '2', project: 'data-pipeline', time: now - 240000, agent: { name: 'Codex', icon: 'term' },
        message: 'Added retries with exponential backoff (max 5). Also fixed a timezone bug where jobs after midnight were counted on the previous day.' },
      { id: '3', project: 'my-webapp', time: now - 600000, agent: { name: 'Claude', icon: 'spark' },
        message: 'The login page is fixed and all tests pass.' },
      { id: '4', project: 'blog', time: now - 900000, agent: { name: 'Claude', icon: 'spark' },
        message: 'Outlined the post and collected the screenshots.' },
    ],
  },
  'Several approvals at once': {
    mode: 'perm', items: [
      { id: 'a', time: 1, project: 'my-webapp', tool: 'Bash', agent: { name: 'Claude', icon: 'spark' },
        verb: 'run a command', desc: 'Run the test suite', detail: 'npm test -- --coverage' },
      { id: 'b', time: 2, project: 'data-pipeline', tool: 'Bash', agent: { name: 'Codex', icon: 'term', theme: 'codex' },
        verb: 'run a command', desc: 'Needs network access', detail: 'pnpm install --frozen-lockfile' },
    ],
  },
  'Codex still waiting (you left Codex)': {
    mode: 'perm', items: [{ id: 'r', time: 1, kind: 'remind', project: 'data-pipeline', tool: 'Bash',
      agent: { name: 'Codex', icon: 'term', theme: 'codex' }, verb: 'run a command', desc: '',
      detail: 'pnpm install --frozen-lockfile' }],
  },
  'Permission request (Codex)': {
    mode: 'perm', project: 'data-pipeline', tool: 'Bash', agent: { name: 'Codex', icon: 'term', theme: 'codex' },
    verb: 'run a command', desc: 'Needs network access to install dependencies',
    detail: 'pnpm install --frozen-lockfile',
  },
  'Task complete (Codex only)': {
    mode: 'done', agent: { name: 'Codex', icon: 'term', theme: 'codex' },
    items: [
      { id: '1', project: 'data-pipeline', time: now - 60000, agent: { name: 'Codex', icon: 'term', theme: 'codex' },
        message: 'Added retries with exponential backoff (max 5).\nAlso fixed a timezone bug in the nightly job.' },
      { id: '2', project: 'api', time: now - 300000, agent: { name: 'Codex', icon: 'term', theme: 'codex' },
        message: 'Integration tests pass against the local Postgres.' },
    ],
  },
};

const HEIGHTS = { 'Several approvals at once': 560, 'Permission request': 262, 'Multiple-choice question': 500, 'Task complete (merged)': 486,
  'Permission request (Codex)': 262, 'Task complete (Codex only)': 380 };

const inner = Object.keys(PAGES).map(function (label) {
  const payload = JSON.parse(JSON.stringify(PAGES[label]));
  payload.t = T;
  const html = M.buildHTML(payload);
  return '<figure class="card">\n  <figcaption>' + label + '</figcaption>\n  <iframe title="' +
    label.replace(/"/g, '') + '" srcdoc="' + html.replace(/&/g, '&amp;').replace(/"/g, '&quot;') +
    '" height="' + HEIGHTS[label] + '" onload="var d=this.contentDocument,a=d&&d.getElementById(\'app\');' +
    'if(a)this.height=Math.ceil(a.getBoundingClientRect().height)"></iframe>\n</figure>';   // fit the content
}).join('\n');

const out = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<title>agent-popup — what the popups look like</title>\n<style>\n' +
  ':root{--muted:#73726C}\n' +
  'body{margin:0;background:#E9E7E0;color:#141413;padding:32px 20px;\n' +
  '  font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Helvetica Neue",sans-serif}\n' +
  'code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace}\n' +
  'h1{font-family:"Tiempos Text",Charter,Georgia,serif;font-weight:500;font-size:22px;margin:0 0 6px}\n' +
  'p.lead{color:var(--muted);margin:0 0 26px;font-size:13px;max-width:640px}\n' +
  '.grid{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}\n' +
  'figure.card{margin:0;background:transparent}\n' +
  'figcaption{font-size:12px;color:var(--muted);margin-bottom:8px}\n' +
  'iframe{width:400px;max-width:100%;border:0;border-radius:12px;background:#FAF9F5;\n' +
  '  box-shadow:0 10px 30px rgba(0,0,0,.12),0 0 0 1px rgba(0,0,0,.06)}\n' +
  '</style>\n</head>\n<body>\n<h1>agent-popup</h1>\n' +
  '<p class="lead">The popups, rendered from the real <code>agent-popup.js</code>: Claude style, and ' +
  'Codex style for popups that only involve Codex. ' +
  'This page is a design preview — running <code>agent-popup.js demo</code> on a Mac shows the ' +
  'actual floating windows.</p>\n<div class="grid">\n' + inner + '\n</div>\n</body>\n</html>\n';

fs.writeFileSync(path.join(__dirname, '..', 'docs', 'preview.html'), out);
console.log('wrote docs/preview.html');
