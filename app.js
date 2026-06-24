/* ── S3 Pre-signed URL Demo ─────────────── */

let dlPresignedUrl = null;
let ulPresignedUrl = null;
let selectedFile   = null;
let MOCK_MODE      = false;

/* ════════════════════════════════════════
   MOCK LAYER
   ════════════════════════════════════════ */
const MOCK = {
  bucket:    'my-private-bucket',
  region:    'ap-southeast-1',
  accessKey: 'AKIAIOSFODNN7EXAMPLE',

  // Build a realistic-looking AWS pre-signed URL
  buildUrl(method, key, contentType) {
    const now     = new Date();
    const dateStr = now.toISOString().replace(/[-:]/g,'').slice(0,15) + 'Z'; // 20240612T093000Z
    const dateDay = dateStr.slice(0,8);                                       // 20240612
    const expiry  = 300;
    const scope   = `${dateDay}/${this.region}/s3/aws4_request`;
    const cred    = encodeURIComponent(`${this.accessKey}/${scope}`);
    const sigHex  = Array.from({length:64}, () => '0123456789abcdef'[Math.random()*16|0]).join('');

    const base = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    const qs = [
      `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
      `X-Amz-Credential=${cred}`,
      `X-Amz-Date=${dateStr}`,
      `X-Amz-Expires=${expiry}`,
      `X-Amz-SignedHeaders=host${method === 'PUT' ? encodeURIComponent(';content-type') : ''}`,
      `X-Amz-Signature=${sigHex}`,
    ].join('&');
    return `${base}?${qs}`;
  },

  // Fake API Gateway → Lambda response (download)
  downloadResponse(key) {
    return {
      statusCode: 200,
      url: this.buildUrl('GET', key),
      bucket: this.bucket,
      key,
      region: this.region,
      expiresIn: 300,
      method: 'GET',
    };
  },

  // Fake API Gateway → Lambda response (upload)
  uploadResponse(key, contentType) {
    return {
      statusCode: 200,
      url: this.buildUrl('PUT', key, contentType),
      bucket: this.bucket,
      key,
      region: this.region,
      contentType,
      expiresIn: 300,
      method: 'PUT',
    };
  },
};

// Intercept fetch when mock mode is on
async function mockFetch(endpoint, opts) {
  // Simulate ~600ms network latency
  await delay(600);

  const body = JSON.parse(opts.body || '{}');

  // Decide by endpoint path or by presence of contentType
  const isUpload = endpoint.includes('upload') || body.contentType;
  const data = isUpload
    ? MOCK.uploadResponse(body.key || 'uploads/demo-file.jpg', body.contentType || 'image/jpeg')
    : MOCK.downloadResponse(body.key || 'images/demo-photo.jpg');

  return { ok: true, status: 200, text: async () => JSON.stringify(data) };
}

// Intercept XHR S3 PUT when mock mode is on
function mockXhrUpload(onProgress, onDone) {
  let pct = 0;
  const interval = setInterval(() => {
    pct += Math.random() * 18 + 4;
    if (pct >= 100) {
      clearInterval(interval);
      onProgress(100);
      setTimeout(() => onDone(200), 200);
    } else {
      onProgress(Math.min(Math.round(pct), 99));
    }
  }, 120);
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ════════════════════════════════════════
   MOCK TOGGLE
   ════════════════════════════════════════ */
function toggleMock(on) {
  MOCK_MODE = on;

  // Banner
  document.getElementById('mock-banner').style.display = on ? 'flex' : 'none';

  // Connection dot
  const dot   = document.getElementById('conn-dot');
  const label = document.getElementById('conn-label');
  dot.style.background   = on ? '#f59e0b' : '#22c55e';
  dot.style.boxShadow    = on ? '0 0 0 2px #fde68a' : '0 0 0 2px #bbf7d0';
  label.textContent      = on ? 'Mock Mode — no real AWS' : 'AWS Lambda · API Gateway · S3';

  if (on) {
    // Pre-fill demo values so user can click straight away
    if (!document.getElementById('dl-api').value)
      document.getElementById('dl-api').value = 'https://abc123def.execute-api.ap-southeast-1.amazonaws.com/prod/presign/download';
    if (!document.getElementById('dl-key').value)
      document.getElementById('dl-key').value = 'images/demo-photo.jpg';
    if (!document.getElementById('ul-api').value)
      document.getElementById('ul-api').value = 'https://abc123def.execute-api.ap-southeast-1.amazonaws.com/prod/presign/upload';
    if (!document.getElementById('ul-key').value)
      document.getElementById('ul-key').value = 'uploads/my-document.pdf';
    document.getElementById('ul-ct').value = 'application/pdf';
  }
}

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
   DOWNLOAD
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
    const reqBody = { key, expiresIn: 300 };
    const fetchFn = MOCK_MODE ? mockFetch : fetch;
    const res  = await fetchFn(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    logResponse('POST', api, reqBody, res.status, data);

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

  if (MOCK_MODE) {
    // In mock mode — fake-download a tiny generated blob instead of hitting S3
    const content = `[MOCK] This is a demo file.\nObject key: ${document.getElementById('dl-key').value}\nGenerated at: ${new Date().toISOString()}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = document.getElementById('dl-key').value.split('/').pop() || 'demo-file.txt';
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Mock download triggered ✓');
    return;
  }

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
    const reqBody = { key, contentType: ct, expiresIn: 300 };
    const fetchFn = MOCK_MODE ? mockFetch : fetch;
    const res  = await fetchFn(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });

    const raw = await res.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { raw }; }

    logResponse('POST', api, reqBody, res.status, data);

    if (!res.ok) throw new Error(data?.message || data?.error || `HTTP ${res.status}`);

    const url = extractUrl(data);
    if (!url) throw new Error('Cannot find a URL in the response. Check Lambda output format.');

    ulPresignedUrl = url;
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
  document.getElementById(`${prefix}-url-box`).value = url;

  const parsed  = parsePresignedUrl(url);
  const expSecs = parsed.expires ? parseInt(parsed.expires) : (data.expiresIn || 300);
  const expMin  = Math.round(expSecs / 60);

  const meta = [
    { key: 'HTTP Method', val: method,                                   cls: method === 'GET' ? 'blue' : 'green' },
    { key: 'Object Key',  val: key,                                      cls: 'mono' },
    { key: 'Bucket',      val: data.bucket || parsed.bucket || extractBucket(url), cls: 'mono' },
    { key: 'Region',      val: data.region || parsed.region || '—',      cls: '' },
    { key: 'Algorithm',   val: parsed.algorithm || 'AWS4-HMAC-SHA256',   cls: 'mono' },
    { key: 'Expires In',  val: `${expSecs}s (${expMin} min)`,            cls: 'orange' },
    { key: 'Credential',  val: parsed.credential ? truncate(parsed.credential, 30) : '—', cls: 'mono' },
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

function initDrop() {
  const zone = document.getElementById('drop-zone');
  if (!zone) return;
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('over'); });
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
  if (!ulPresignedUrl) return;

  // In mock mode allow upload without an actual file
  if (MOCK_MODE && !selectedFile) {
    selectedFile = new File(['[MOCK CONTENT]'], 'mock-file.txt', { type: 'text/plain' });
    document.getElementById('drop-text').textContent = 'mock-file.txt  (13 B)';
  }

  if (!selectedFile) return;

  const ct     = document.getElementById('ul-ct').value;
  const btn    = document.getElementById('ul-send-btn');
  const status = document.getElementById('ul-status');

  btn.disabled       = true;
  status.textContent = '';
  status.className   = '';
  show('progress-row');
  setBar(0);

  try {
    if (MOCK_MODE) {
      // Simulate upload with animated progress
      await new Promise(resolve =>
        mockXhrUpload(
          pct => setBar(pct),
          () => resolve()
        )
      );
    } else {
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
    }

    setBar(100);
    status.textContent = '✓ Upload successful';
    status.className   = 'ok';
    logResponse(
      'PUT (S3 direct)',
      ulPresignedUrl.split('?')[0] + '?[signature-truncated]',
      { file: selectedFile.name, size: fmtBytes(selectedFile.size), contentType: ct },
      200,
      { message: MOCK_MODE ? '[MOCK] Upload to S3 successful' : 'Upload successful' }
    );

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
   COPY
   ════════════════════════════════════════ */
function copyText(id) {
  const text = document.getElementById(id)?.value;
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
}

/* ════════════════════════════════════════
   RAW RESPONSE LOG
   ════════════════════════════════════════ */
function logResponse(method, url, reqBody, status, resBody) {
  const ok  = status >= 200 && status < 300;
  const tag = MOCK_MODE ? ' [MOCK]' : '';
  const out = [
    `[${new Date().toLocaleTimeString()}]${tag}  ${method}  →  HTTP ${status} ${ok ? '✓ OK' : '✗ ERROR'}`,
    `Endpoint : ${url}`,
    `Request  : ${JSON.stringify(reqBody)}`,
    `Response : ${JSON.stringify(resBody, null, 2)}`,
    '─'.repeat(64),
  ].join('\n');

  const pre = document.getElementById('log-body');
  const prev = pre.textContent.startsWith('—') ? '' : '\n\n' + pre.textContent;
  pre.textContent = out + prev;
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
    let bucket = '', region = '';
    const host = u.hostname;
    const m1   = host.match(/^(.+?)\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
    const m2   = host.match(/^s3[.-]([a-z0-9-]+)\.amazonaws\.com$/);
    if (m1) { bucket = m1[1]; region = m1[2]; }
    else if (m2) { region = m2[1]; bucket = u.pathname.split('/')[1]; }

    return {
      bucket,
      region,
      credential: params['X-Amz-Credential'] || params['x-amz-credential'] || '',
      algorithm:  params['X-Amz-Algorithm']  || params['x-amz-algorithm']  || '',
      date:       params['X-Amz-Date']        || params['x-amz-date']        || '',
      expires:    params['X-Amz-Expires']     || params['x-amz-expires']     || '',
    };
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
  try {
    return amzDate.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/, '$1-$2-$3 $4:$5:$6 UTC');
  } catch { return amzDate; }
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
function fmtBytes(b) {
  if (b < 1024)    return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
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
function show(id)  { const el = document.getElementById(id); if (el) el.style.display = 'flex'; }
function hide(id)  { const el = document.getElementById(id); if (el) el.style.display = 'none'; }
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
  setTimeout(() => t.classList.remove('show'), 2200);
}

/* ── Init ───────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const dlSaved = localStorage.getItem('dl-api');
  const ulSaved = localStorage.getItem('ul-api');
  if (dlSaved) document.getElementById('dl-api').value = dlSaved;
  if (ulSaved) document.getElementById('ul-api').value = ulSaved;

  document.getElementById('dl-api').addEventListener('input', e => localStorage.setItem('dl-api', e.target.value));
  document.getElementById('ul-api').addEventListener('input', e => localStorage.setItem('ul-api', e.target.value));

  initDrop();
});
