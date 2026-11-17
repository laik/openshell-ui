// Functional regression sweep for the openshell-ui bridge.
// Requires a running bridge and a reachable gateway; mutations use disposable
// sandboxes named ui-sweep and clean up after themselves.
//   SWEEP_BRIDGE=http://127.0.0.1:8787 SWEEP_GATEWAY=openshell node scripts/sweep.mjs
import WebSocket from 'ws';
import { stringify as yamlStringify } from 'yaml';
const B = process.env.SWEEP_BRIDGE ?? 'http://127.0.0.1:8787';
const G = process.env.SWEEP_GATEWAY ?? 'openshell';
const scope = `gateway=${G}`;
let pass = 0, fail = 0;
const failures = [];
async function req(method, path, body) {
  const res = await fetch(B + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, text };
}
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`PASS ${name}`); }
  else { fail++; failures.push(name + (detail ? ` :: ${detail}` : '')); console.log(`FAIL ${name} :: ${detail}`); }
}
const SB = 'ui-sweep';

// context & gateways
let r = await req('GET', `/api/context?${scope}`);
check('context scoped', r.status === 200 && r.json?.status?.status === 'connected', r.text.slice(0, 120));
r = await req('GET', '/api/context');
check('context unscoped returns gateways', r.status === 200 && Array.isArray(r.json?.gateways), r.text.slice(0, 120));
r = await req('GET', '/api/gateways');
check('gateways list', r.status === 200 && r.json.length >= 1);
r = await req('GET', `/api/gateways/${G}/health`);
check('gateway health ok', r.status === 200 && r.json.ok === true, r.text.slice(0, 120));
r = await req('GET', '/api/gateways/plane-a/health');
check('gateway health unreachable', r.status === 200 && r.json.ok === false);
r = await req('GET', `/api/gateways/${G}`);
check('gateway metadata', r.status === 200 && r.json?.metadata?.auth_mode === 'mtls');

// workspaces / settings / templates / profiles / providers reads
r = await req('GET', `/api/workspaces?${scope}`);
check('workspaces', r.status === 200 && Array.isArray(r.json?.workspaces));
r = await req('GET', `/api/templates?${scope}`);
check('templates list', r.status === 200);
r = await req('GET', `/api/profiles?${scope}`);
check('profiles list', r.status === 200 && Array.isArray(r.json) && r.json.length > 0);
const profileId = r.json?.[0]?.id;
r = await req('GET', `/api/profiles/${profileId}?${scope}`);
check('profile describe', r.status === 200 && r.json?.id === profileId);
r = await req('GET', `/api/profiles/${profileId}/export?${scope}&format=yaml`);
check('profile export yaml', r.status === 200 && typeof r.json === 'string' && r.json.includes('id:'));
r = await req('GET', `/api/providers?${scope}`);
check('providers list', r.status === 200 && Array.isArray(r.json?.providers));

// sandbox lifecycle
await req('DELETE', `/api/sandboxes/${SB}?${scope}`);
r = await req('POST', `/api/sandboxes?${scope}`, { name: SB, command: 'sleep 30000', detach: true, cpu: '500m', memory: '512Mi' });
check('sandbox create', r.status === 200 && r.json?.name === SB, r.text.slice(0, 160));
for (let i = 0; i < 30; i++) {
  r = await req('GET', `/api/sandboxes/${SB}?${scope}`);
  if (r.json?.sandbox?.phase === 'Ready') break;
  await new Promise((res) => setTimeout(res, 2000));
}
check('sandbox reaches Ready', r.json?.sandbox?.phase === 'Ready', r.json?.sandbox?.phase);
r = await req('GET', `/api/sandboxes?${scope}`);
check('sandbox list contains', r.json?.sandboxes?.some((s) => s.name === SB));
r = await req('GET', `/api/sandboxes/${SB}?${scope}`);
check('sandbox detail policy+providers+services keys', r.json && 'policy' in r.json && 'providers' in r.json && 'services' in r.json);
r = await req('POST', `/api/sandboxes/${SB}/exec?${scope}`, { command: 'echo sweep_ok' });
check('exec plain', r.status === 200 && r.json?.ok && r.json.stdout.includes('sweep_ok'), r.text.slice(0, 160));
r = await req('POST', `/api/sandboxes/${SB}/exec?${scope}`, { command: 'echo a && echo b | tr a-z A-Z' });
check('exec shell syntax', r.json?.ok && r.json.stdout.includes('a\nB'), r.text.slice(0, 160));
r = await req('POST', `/api/sandboxes/${SB}/exec?${scope}`, { command: 'exit 7' });
check('exec exit code propagated', r.json?.ok === false && r.json?.exit_code === 7, r.text.slice(0, 160));
r = await req('POST', `/api/sandboxes/${SB}/run?${scope}`, { command: 'pwd', start: false });
check('run no-start', r.json?.ok && r.json.started === false, r.text.slice(0, 160));
r = await req('GET', `/api/sandboxes/${SB}/logs?${scope}&lines=20`);
check('logs parse', r.status === 200 && Array.isArray(r.json?.lines));
r = await req('GET', `/api/sandboxes/${SB}/ssh?${scope}`);
check('ssh config', r.status === 200 && String(r.json).includes('ProxyCommand'));
r = await req('GET', `/api/sandboxes/${SB}/policy?${scope}`);
check('policy history', r.status === 200 && Array.isArray(r.json?.revisions));
r = await req('GET', `/api/sandboxes/${SB}/startup?${scope}`);
check('startup command observed', r.json?.command?.includes('sleep 30000'), r.text.slice(0, 160));

// policy dynamic updates
r = await req('POST', `/api/sandboxes/${SB}/policy/update?${scope}`, { addEndpoints: ['api.example.com:443:read-only:rest:enforce'], dryRun: true });
check('policy dry-run', r.status === 200 && r.json?.output?.includes('api.example.com'), r.text.slice(0, 160));
r = await req('POST', `/api/sandboxes/${SB}/policy/update?${scope}`, { addEndpoints: ['api.github.com:443:read-only:rest:enforce'], ruleName: 'sweep', binaries: ['/usr/bin/git'], addAllow: ['api.github.com:443:GET:/**'], wait: true });
check('policy two-step apply', r.status === 200 && r.json?.steps?.length === 2, r.text.slice(0, 200));
r = await req('GET', `/api/sandboxes/${SB}?${scope}`);
check('policy network rule visible', Boolean(r.json?.sandbox?.policy?.network_policies?.sweep), JSON.stringify(Object.keys(r.json?.sandbox?.policy?.network_policies ?? {})));
r = await req('GET', `/api/sandboxes/${SB}?${scope}`);
const curPolicy = r.json?.sandbox?.policy ?? {};
const fsDoc = {
  ...curPolicy,
  filesystem_policy: {
    include_workdir: curPolicy.filesystem_policy?.include_workdir ?? true,
    read_only: curPolicy.filesystem_policy?.read_only ?? [],
    read_write: [...(curPolicy.filesystem_policy?.read_write ?? []), '/var/tmp'],
  },
};
r = await req('POST', `/api/sandboxes/${SB}/policy/set?${scope}`, { yaml: yamlStringify(fsDoc) });
check('policy set filesystem', r.status === 200, r.text.slice(0, 200));
r = await req('GET', `/api/sandboxes/${SB}?${scope}`);
check('filesystem change visible', r.json?.sandbox?.policy?.filesystem_policy?.read_write?.includes('/var/tmp'), r.text.slice(0, 160));
r = await req('POST', `/api/sandboxes/${SB}/policy/update?${scope}`, { addEndpoints: ['x.com:443'], addAllow: ['x.com:443:GET:/**'] });
check('policy validation rejects missing rule name', r.status === 400, r.text.slice(0, 160));

// approvals: enable proposals, trigger denial, approve/reject/clear/history
r = await req('GET', `/api/settings/${SB}?${scope}`);
check('settings get', r.status === 200 && String(r.json).includes('proposal_approval_mode'));
r = await req('POST', `/api/sandboxes/${SB}/settings?${scope}`, { key: 'agent_policy_proposals_enabled', value: 'true' });
check('settings set', r.status === 200, r.text.slice(0,160));
// enable via settings set is not exposed; use exec? settings set route missing -> check
r = await req('POST', `/api/sandboxes/${SB}/exec?${scope}`, { command: 'exec 3<>/dev/tcp/example.com/443 || true' });
let pendingRule = null;
for (let i = 0; i < 8; i++) {
  await new Promise((res) => setTimeout(res, 2500));
  r = await req('GET', `/api/sandboxes/${SB}/rules?${scope}&status=pending`);
  pendingRule = r.json?.rules?.[0];
  if (pendingRule) break;
}
check('rules pending observed', Boolean(pendingRule), r.text.slice(0, 160));
if (pendingRule) {
  r = await req('POST', `/api/sandboxes/${SB}/rules/${pendingRule.chunk_id}/approve?${scope}`);
  check('rule approve', r.status === 200, r.text.slice(0, 160));
}
r = await req('GET', `/api/sandboxes/${SB}/rules/history?${scope}`);
check('rule history', r.status === 200 && Array.isArray(r.json?.entries) && r.json.entries.length > 0, r.text.slice(0, 160));
r = await req('GET', `/api/rules?${scope}&status=pending`);
check('all-rules scan', r.status === 200 && Array.isArray(r.json?.rules));

// services & forwards
r = await req('POST', `/api/services?${scope}`, { sandbox: SB, port: '8080', service: 'sweepsvc' });
check('service expose', r.status === 200, r.text.slice(0, 160));
r = await req('GET', `/api/services?${scope}`);
check('service listed', r.json?.services?.some((s) => s.service === 'sweepsvc'), r.text.slice(0, 160));
r = await req('DELETE', `/api/services/${SB}/sweepsvc?${scope}`);
check('service delete', r.status === 200, r.text.slice(0, 160));
r = await req('POST', `/api/forwards?${scope}`, { port: '18099', sandbox: SB });
check('forward start', r.status === 200, r.text.slice(0, 160));
r = await req('GET', `/api/forwards?${scope}`);
check('forward listed', r.status === 200, r.text.slice(0, 160));
r = await req('DELETE', `/api/forwards/18099/${SB}?${scope}`);
check('forward stop', r.status === 200, r.text.slice(0, 160));

// templates & providers mutations
r = await req('POST', `/api/templates?${scope}`, { name: 'sweep-tpl', image: 'nvcr.io/nvidia/base/ubuntu:24.04', cpu: '1', memory: '1Gi' });
check('template create', r.status === 200, r.text.slice(0, 160));
r = await req('DELETE', `/api/templates/sweep-tpl?${scope}`);
check('template delete', r.status === 200, r.text.slice(0, 160));
r = await req('POST', `/api/providers?${scope}`, { name: 'sweep-prov', type: 'github', credentials: ['GITHUB_TOKEN=dummy-sweep'] });
check('provider create', r.status === 200, r.text.slice(0, 160));
r = await req('PATCH', `/api/providers/sweep-prov?${scope}`, { credentials: ['GITHUB_TOKEN=dummy-sweep-2'] });
check('provider update', r.status === 200, r.text.slice(0, 160));
r = await req('DELETE', `/api/providers/sweep-prov?${scope}`);
check('provider delete', r.status === 200, r.text.slice(0, 160));
r = await req('GET', `/api/profiles/${profileId}/export?${scope}&format=yaml`);
const lintYaml = String(r.json).replace(/^id: .*$/m, 'id: sweep-prof');
r = await req('POST', `/api/profiles/lint?${scope}`, { content: lintYaml });
check('profile lint', r.status === 200, r.text.slice(0, 160));

// lifecycle actions
r = await req('POST', `/api/sandboxes/${SB}/stop?${scope}`);
check('sandbox stop', r.status === 200, r.text.slice(0, 160));
for (let i = 0; i < 20; i++) {
  r = await req('GET', `/api/sandboxes/${SB}?${scope}`);
  if (r.json?.sandbox?.phase === 'Stopped') break;
  await new Promise((res) => setTimeout(res, 1500));
}
check('sandbox stopped', r.json?.sandbox?.phase === 'Stopped', r.json?.sandbox?.phase);
r = await req('POST', `/api/sandboxes/${SB}/run?${scope}`, { command: 'echo resumed_ok', start: true });
check('run auto-start', r.json?.ok && r.json?.started === true && r.json.stdout.includes('resumed_ok'), r.text.slice(0, 200));
r = await req('POST', `/api/sandboxes/${SB}/suspend?${scope}`);
check('sandbox suspend (or driver unsupported)', r.status === 200 || /does not support/.test(r.text), r.text.slice(0, 160));
r = await req('POST', `/api/sandboxes/${SB}/resume?${scope}`);
check('sandbox resume (or driver unsupported)', r.status === 200 || /does not support/.test(r.text), r.text.slice(0, 160));
// terminal websocket (shell mode)
await new Promise((resolve) => {
  const ws = new WebSocket(`${B.replace(/^http/, 'ws')}/api/terminal?name=${SB}&mode=shell&cols=100&rows=30&${scope}`);
  let got = '';
  const timer = setTimeout(() => { check('terminal ws shell echo', got.includes('ws_sweep_ok'), got.slice(0, 120)); ws.close(); resolve(); }, 12000);
  ws.on('open', () => setTimeout(() => ws.send(JSON.stringify({ type: 'input', data: 'echo ws_sweep_ok\n' })), 1200));
  ws.on('message', (d) => {
    try {
      const m = JSON.parse(String(d));
      if (m.type === 'data') got += m.data;
      if (got.includes('ws_sweep_ok') && got.split('ws_sweep_ok').length > 2) {
        clearTimeout(timer);
        check('terminal ws shell echo', true);
        ws.close();
        resolve();
      }
    } catch {}
  });
  ws.on('error', (e) => { clearTimeout(timer); check('terminal ws shell echo', false, String(e)); resolve(); });
});

r = await req('DELETE', `/api/sandboxes/${SB}?${scope}`);
check('sandbox delete', r.status === 200, r.text.slice(0, 160));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
if (failures.length) console.log(failures.join('\n'));
