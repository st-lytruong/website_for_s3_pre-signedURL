/* ── S3 Pre-signed URL Demo ─────────────── */

let dlPresignedUrl  = null;
let ulPresignedUrl  = null;
let selectedFile    = null;

/* ════════════════════════════════════════
   TAB SWITCH
   ════════════════════════════════════════ */
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab));
  document.getElementById('panel-download').classList.toggle('hidden', tab !== 'download');
  document.getElementById('panel-upload').classList.toggle('hidden', tab !== 'upload');
}

/* ════════════════════════════════════════
   DOWNLOAD — get pre-signed URL then auto-trigger
   ════════════════════════════════════════ */
async function doDownload() {
  const api = document.getElementById('dl-api').value.trim().replace(/\/$/, '');
  const key = document.getElementById('dl-key').value.trim();

  clearErr('dl-error');
  hideResult('dl-result');

  if (!api) return showErr('dl-error', 'Paste your API Gateway URL above.');
  if (!key) return showErr('dl-error', 'Enter the S3 Object Key of the file to download.');

  const btn = document.getElementById('dl-btn');
  setLoading(btn, true);

  try {
    const body = { key, expiresIn: 300 };
    const res  = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const raw  = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    logResponse('POST', api, body, res.status, data);

    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);

    const url = extractUrl(data);
    if (!url) throw new Error('Cannot find a URL in the response. Check Lambda output format.');

    dlPresignedUrl = url;
    renderResult('dl', url, data, key, 'GET');

  } catch (e) {
    showErr('dl-error', e.message);
  } finally {
    setLoading(btn, false);
  }
}

function triggerDownload() {
  if (!dlPresignedUrl) return;
  const a = document.createElement('a');
  a.href = dlPresignedUrl;
  a.download = '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ════════════════════════════════════════
   UPLOAD — get pre-signed URL
   ════════════════════════════════════════ */
async function doUpload() {
  const api = document.getElementById('ul-api').value.trim().replace(/\/$/, '');
  const key = document.getElementById('ul-key').value.trim();
  const ct  = document.getElementById('ul-ct').value;

  clearErr('ul-error');
  hideResult('ul-result');

  if (!api) return showErr('ul-error', 'Paste your API Gateway URL above.');
  if (!key) return showErr('ul-error', 'Enter the S3 Object Key (destination path).');

  const btn = document.getElementById('ul-btn');
  setLoading(btn, true);

  try {
    const body = { key, contentType: ct, expiresIn: 300 };
    const res  = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const raw  = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    logResponse('POST', api, body, res.status, data);

    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);

    const url = extractUrl(data);
    if (!url) throw new Error('Cannot find a URL in the response. Check Lambda output format.');

    ulPresignedUrl = url;

    // Update Postman hint
    document.getElementById('ul-ct-hint').textContent = ct;

    renderResult('ul', url, data, key, 'PUT');

    // Reset upload state
    selectedFile = null;
    document.getElementById('ul-file').value = '';
    document.getElementById('drop-text').textContent = 'Click or drag file here';
    document.getElementById('ul-send-btn').disabled = true;
    document.getElementById('ul-status').textContent = '';
    document.getElementById('ul-status').className = '';
    hide('progress-row');

  } catch (e) {
    showErr('ul-error', e.message);
  } finally {
    setLoading(btn, false);
  }
}

/* ════════════════════════════════════════
   RENDER RESULT + META
   ════════════════════════════════════════ */
function renderResult(prefix, url, data, key, method) {
  // Fill URL textarea
  document.getElementById(`${prefix}-url-box`).value = url;

  // Parse URL params
  const parsed  = parsePresignedUrl(url);
  const expSecs = parsed.expires ? parseInt(parsed.expires) : 300;
  const expMin  = Math.round(expSecs / 60);

  // Build meta items
  const meta = [
    { key: 'HTTP Method', val: method,                        cls: method === 'GET' ? 'blue' : 'green' },
    { key: 'Object Key',  val: key,                           cls: 'mono' },
    { key: 'Bucket',      val: parsed.bucket || extractBucket(url), cls: 'mono' },
    { key: 'Region',      val: parsed.region || '—',          cls: '' },
    { key: 'Algorithm',   val: parsed.algorithm || '—',       cls: 'mono' },
    { key: 'Expires In',  val: `${expSecs}s (${expMin} min)`, cls: 'orange' },
    { key: 'Credential',  val: parsed.credential ? truncate(parsed.credential, 28) : '—', cls: 'mono' },
    { key: 'Signed At',   val: parsed.date ? formatDate(parsed.date) : new Date().toLocaleTimeString(), cls: '' },
  ];

  const grid = document.getElementById(`${prefix}-meta`);
  grid.innerHTML = meta.map(m => `
    <div class="meta-item">
      <div class="meta-key">${m.key}</div>
      <div class="meta-val ${m.cls}">${m.val}</div>
    </div>`).join('');

  showResult(`${prefix}-result`);
}

/* ════════════════════════════════════════
   DIRECT UPLOAD TO S3
   ════════════════════════════════════════ */
function onFileChange(e) {
  const f = e.target.files[0];
  if (!f) return;
  selectedFile = f;
  document.getElementById('drop-text').textContent = `${f.name}  (${fmtBytes(f.size)})`;
  document.getElementById('ul-send-btn').disabled = false;
}

// Drag & drop
const dz = document.getElementById ? null : null; // set after DOM load
function initDrop() {
  const zone = document.getElementById('drop-zone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (!f) return;
    selectedFile = f;
    document.getElementById('drop-text').textContent = `${f.name}  (${fmtBytes(f.size)})`;
    document.getElementById('ul-send-btn').disabled = false;
  });
}

async function sendUpload() {
  if (!selectedFile || !ulPresignedUrl) return;

  const ct     = document.getElementById('ul-ct').value;
  const btn    = document.getElementById('ul-send-btn');
  const status = document.getElementById('ul-status');

  btn.disabled = true;
  status.textContent = '';
  status.className   = '';
  show('progress-row');
  setBar(0);

  try {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', ulPresignedUrl);
      xhr.setRequestHeader('Content-Type', ct);
      xhr.upload.onprogress = ev => {
        if (ev.lengthComputable) setBar(Math.round(ev.loaded / ev.total * 100));
      };
      xhr.onload  = () => xhr.status < 300 ? resolve() : reject(new Error(`S3 returned HTTP ${xhr.status}`));
      xhr.onerror = ()  => reject(new Error('Network error'));
      xhr.send(selectedFile);
    });

    setBar(100);
    status.textContent = '✓ Upload successful';
    status.className   = 'ok';
    logResponse('PUT (S3 direct)', ulPresignedUrl.split('?')[0], { file: selectedFile.name, size: fmtBytes(selectedFile.size) }, 200, { message: 'Upload successful' });

  } catch (e) {
    status.textContent = `✗ ${e.message}`;
    status.className   = 'err';
  } finally {
    btn.disabled = false;
  }
}

function setBar(pct) {
  document.getElementById('progress-bar').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';
}

/* ════════════════════════════════════════
   COPY URL
   ════════════════════════════════════════ */
function copyText(id) {
  const text = document.getElementById(id).value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
}

/* ════════════════════════════════════════
   RAW RESPONSE LOG
   ════════════════════════════════════════ */
function logResponse(method, url, reqBody, status, resBody) {
  const ok = status >= 200 && status < 300;
  const out = [
    `[${new Date().toLocaleTimeString()}]  ${method}  ${status} ${ok ? 'OK' : 'ERROR'}`,
    `Endpoint : ${url}`,
    `Request  : ${JSON.stringify(reqBody)}`,
    `Response : ${JSON.stringify(resBody, null, 2)}`,
    '─'.repeat(60),
  ].join('\n');

  const pre = document.getElementById('log-body');
  pre.textContent = out + (pre.textContent === '— no requests yet —' ? '' : '\n\n' + pre.textContent);
}
function clearLog() {
  document.getElementById('log-body').textContent = '— no requests yet —';
}

/* ════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════ */
function extractUrl(data) {
  return data?.url || data?.presignedUrl || data?.uploadUrl || data?.downloadUrl || data?.signedUrl || null;
}

function parsePresignedUrl(url) {
  try {
    const u      = new URL(url);
    const params = Object.fromEntries(u.searchParams);
    // Bucket from hostname: bucket.s3.region.amazonaws.com  OR  s3.region.amazonaws.com/bucket
    let bucket = '', region = '';
    const host = u.hostname; // e.g. mybucket.s3.ap-southeast-1.amazonaws.com
    const m1   = host.match(/^(.+?)\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
    const m2   = host.match(/^s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
    if (m1) { bucket = m1[1]; region = m1[2]; }
    else if (m2) { region = m2[1]; bucket = u.pathname.split('/')[1]; }

    const cred = params['X-Amz-Credential'] || params['x-amz-credential'] || '';
    const algo = params['X-Amz-Algorithm'] || params['x-amz-algorithm'] || '';
    const date = params['X-Amz-Date']      || params['x-amz-date']      || '';
    const exp  = params['X-Amz-Expires']   || params['x-amz-expires']   || '';

    return { bucket, region, credential: cred, algorithm: algo, date, expires: exp };
  } catch { return {}; }
}

function extractBucket(url) {
  try {
    const host = new URL(url).hostname;
    const m = host.match(/^(.+?)\.s3/);
    return m ? m[1] : '—';
  } catch { return '—'; }
}

function formatDate(amzDate) {
  // 20240612T093000Z  →  2024-06-12 09:30:00 UTC
  try {
    const d = amzDate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3 $4:$5:$6 UTC');
    return d;
  } catch { return amzDate; }
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}

function showResult(id) {
  const el = document.getElementById(id);
  el.style.display = 'flex';
  el.classList.add('visible');
}
function hideResult(id) {
  const el = document.getElementById(id);
  if (el) { el.style.display = 'none'; el.classList.remove('visible'); }
}
function show(id) { const el = document.getElementById(id); if (el) el.style.display = 'flex'; }
function hide(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
function showErr(id, msg) { const el = document.getElementById(id); el.textContent = msg; el.style.display = 'block'; }
function clearErr(id)     { const el = document.getElementById(id); el.textContent = ''; el.style.display = 'none'; }

function setLoading(btn, on) {
  btn.classList.toggle('loading', on);
  btn.disabled = on;
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

/* ── Init ───────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  // Restore saved API URLs
  const dlSaved = localStorage.getItem('dl-api');
  const ulSaved = localStorage.getItem('ul-api');
  if (dlSaved) document.getElementById('dl-api').value = dlSaved;
  if (ulSaved) document.getElementById('ul-api').value = ulSaved;

  // Auto-save on change
  document.getElementById('dl-api').addEventListener('input', e =>
    localStorage.setItem('dl-api', e.target.value));
  document.getElementById('ul-api').addEventListener('input', e =>
    localStorage.setItem('ul-api', e.target.value));

  initDrop();
});
