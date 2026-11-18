'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const te = new TextEncoder();
  const td = new TextDecoder();

  // ---------------------------------------------------------------- i18n --
  const I18N = {
    mn: {
      title: 'Файл хуваалцах',
      subtitle: 'Файлаа оруулаад богино, нууцлалтай линк аваарай. Бүх файл шифрлэгдэж хадгалагдана.',
      dropTitle: 'Файлаа энд чирж оруулах эсвэл дарж сонгох',
      dropHint: 'Ctrl+V дарж буулгаж бас болно',
      limit: 'Дээд хэмжээ: {size}',
      expires: 'Хадгалах хугацаа',
      exp_1h: '1 цаг',
      exp_1d: '1 өдөр',
      exp_7d: '7 хоног',
      exp_30d: '30 хоног',
      password: 'Нууц үг (заавал биш)',
      passwordPh: 'Хоосон бол нууц үггүй',
      passwordNote: '🔒 Нууц үг тавивал файл таны browser дээр шифрлэгдэнэ — сервер хүртэл уншиж чадахгүй.',
      burn: 'Нэг удаа татсаны дараа устгах',
      uploadKey: 'Upload түлхүүр',
      upload: 'Оруулах',
      encrypting: 'Шифрлэж байна…',
      uploading: 'Оруулж байна… {pct}%',
      saving: 'GitHub-д хадгалж байна…',
      ready: 'Линк бэлэн боллоо!',
      copy: 'Хуулах',
      copied: 'Хуулсан ✓',
      share: 'Хуваалцах',
      another: 'Өөр файл оруулах',
      remaining: 'Устах хүртэл: {time}',
      oneTime: 'Нэг удаа татагдана',
      protected: 'Нууц үгтэй',
      myFiles: 'Миний файлууд (энэ төхөөрөмж дээр)',
      delete: 'Устгах',
      confirmDelete: 'Энэ файлыг бүрмөсөн устгах уу?',
      loading: 'Ачаалж байна…',
      download: 'Татах',
      decryptDownload: 'Тайлж татах',
      encryptedFile: 'Нууц үгтэй файл',
      enterPassword: 'Нууц үг',
      wrongPassword: 'Нууц үг буруу байна.',
      needPassword: 'Нууц үгээ оруулна уу.',
      burnWarn: '⚠️ Анхаар: энэ файл нэг удаа татагдсаны дараа бүрмөсөн устна.',
      downloading: 'Татаж байна… {pct}',
      decrypting: 'Тайлж байна…',
      done: 'Татаж дууслаа ✓',
      doneBurned: 'Татаж дууслаа ✓ Файл серверээс устгагдсан.',
      notFound: 'Файл олдсонгүй',
      notFoundHint: 'Линк буруу, хугацаа нь дууссан эсвэл файл устгагдсан байна.',
      home: 'Нүүр хуудас',
      footer: 'AES-256-GCM шифрлэлт · GitHub storage · Линк зөвхөн танд',
      days: '{n} өдөр',
      hours: '{n} цаг',
      minutes: '{n} минут',
      err_too_large: 'Файл хэт том байна. Дээд хэмжээ: {size}.',
      err_rate_limited: 'Хэт олон хүсэлт илгээлээ. Түр хүлээгээд дахин оролдоно уу.',
      err_unauthorized: 'Upload түлхүүр буруу эсвэл оруулаагүй байна.',
      err_network: 'Сүлжээний алдаа. Дахин оролдоно уу.',
      err_empty: 'Файл хоосон байна.',
      err_no_crypto: 'Энэ browser шифрлэлт дэмжихгүй байна (HTTPS шаардлагатай).',
      err_generic: 'Алдаа гарлаа. Дахин оролдоно уу.',
    },
    en: {
      title: 'Share a file',
      subtitle: 'Upload a file and get a short, private link. Every file is stored encrypted.',
      dropTitle: 'Drop a file here or click to choose',
      dropHint: 'You can also paste with Ctrl+V',
      limit: 'Max size: {size}',
      expires: 'Expires after',
      exp_1h: '1 hour',
      exp_1d: '1 day',
      exp_7d: '7 days',
      exp_30d: '30 days',
      password: 'Password (optional)',
      passwordPh: 'Leave empty for none',
      passwordNote: '🔒 With a password the file is encrypted in your browser — not even the server can read it.',
      burn: 'Delete after the first download',
      uploadKey: 'Upload key',
      upload: 'Upload',
      encrypting: 'Encrypting…',
      uploading: 'Uploading… {pct}%',
      saving: 'Saving to GitHub…',
      ready: 'Your link is ready!',
      copy: 'Copy',
      copied: 'Copied ✓',
      share: 'Share',
      another: 'Upload another file',
      remaining: 'Expires in {time}',
      oneTime: 'One-time download',
      protected: 'Password protected',
      myFiles: 'My files (on this device)',
      delete: 'Delete',
      confirmDelete: 'Permanently delete this file?',
      loading: 'Loading…',
      download: 'Download',
      decryptDownload: 'Decrypt & download',
      encryptedFile: 'Password-protected file',
      enterPassword: 'Password',
      wrongPassword: 'Wrong password.',
      needPassword: 'Please enter the password.',
      burnWarn: '⚠️ Heads up: this file is permanently deleted after one download.',
      downloading: 'Downloading… {pct}',
      decrypting: 'Decrypting…',
      done: 'Download complete ✓',
      doneBurned: 'Download complete ✓ The file was deleted from the server.',
      notFound: 'File not found',
      notFoundHint: 'The link is wrong, has expired, or the file was deleted.',
      home: 'Go home',
      footer: 'AES-256-GCM encryption · GitHub storage · Links stay private',
      days: '{n}d',
      hours: '{n}h',
      minutes: '{n}m',
      err_too_large: 'File is too large. Max size: {size}.',
      err_rate_limited: 'Too many requests. Please wait a moment and try again.',
      err_unauthorized: 'The upload key is missing or wrong.',
      err_network: 'Network error. Please try again.',
      err_empty: 'The file is empty.',
      err_no_crypto: 'This browser does not support encryption (HTTPS required).',
      err_generic: 'Something went wrong. Please try again.',
    },
  };

  let lang = localStorage.getItem('sf:lang') || 'mn';
  if (!I18N[lang]) lang = 'mn';
  const rerenders = [];

  function t(key, vars = {}) {
    const s = I18N[lang][key] ?? I18N.en[key] ?? key;
    return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  }

  function applyI18n() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
    $('lang').textContent = lang === 'mn' ? 'EN' : 'MN';
    rerenders.forEach((fn) => fn());
  }

  $('lang').addEventListener('click', () => {
    lang = lang === 'mn' ? 'en' : 'mn';
    localStorage.setItem('sf:lang', lang);
    applyI18n();
  });

  // ------------------------------------------------------------- helpers --
  function fmtSize(n) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)} ${units[i]}`;
  }

  function fmtRemaining(iso) {
    const ms = Math.max(0, Date.parse(iso) - Date.now());
    const d = Math.floor(ms / 864e5);
    const h = Math.floor((ms % 864e5) / 36e5);
    const m = Math.max(1, Math.floor((ms % 36e5) / 6e4));
    if (d > 0) return `${t('days', { n: d })} ${h ? t('hours', { n: h }) : ''}`.trim();
    if (h > 0) return `${t('hours', { n: h })} ${t('minutes', { n: m })}`;
    return t('minutes', { n: m });
  }

  function errorText(err) {
    const code = err && err.code;
    const key = `err_${code}`;
    if (code && I18N.en[key]) return t(key, { size: fmtSize(config.maxFileSize) });
    if (err && err.message && !code) console.error(err);
    return t('err_generic');
  }

  function show(el, on = true) {
    el.hidden = !on;
  }

  function setProgress(prefix, label, pct) {
    show($(prefix), true);
    $(`${prefix}-text`).textContent = label;
    const bar = $(`${prefix}-bar`);
    if (pct == null) {
      bar.classList.add('indeterminate');
    } else {
      bar.classList.remove('indeterminate');
      bar.style.width = `${pct}%`;
    }
  }

  function safeName(name) {
    return String(name || 'file').replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩\\/]/g, '_').slice(0, 200) || 'file';
  }

  function saveBytes(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName(name);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function copyText(text, input) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      input.select();
      document.execCommand('copy');
    }
  }

  // ------------------------------------------------- browser-side crypto --
  // Format: "SFE1" | iterations u32 BE | salt 16 | iv 12 | AES-256-GCM(payload)
  // payload: headerLen u32 BE | header JSON {name,type} | file bytes
  // The header (bytes 0..35) is authenticated as additional data.
  const MAGIC = [0x53, 0x46, 0x45, 0x31];
  const ITERATIONS = 600_000;

  async function deriveKey(password, salt, iterations, usage) {
    const base = await crypto.subtle.importKey('raw', te.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      [usage],
    );
  }

  async function e2eEncrypt(file, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITERATIONS, 'encrypt');
    const header = te.encode(JSON.stringify({ name: file.name, type: file.type }));
    const plain = new Uint8Array(4 + header.length + file.size);
    new DataView(plain.buffer).setUint32(0, header.length);
    plain.set(header, 4);
    plain.set(new Uint8Array(await file.arrayBuffer()), 4 + header.length);
    const prefix = new Uint8Array(36);
    prefix.set(MAGIC, 0);
    new DataView(prefix.buffer).setUint32(4, ITERATIONS);
    prefix.set(salt, 8);
    prefix.set(iv, 24);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: prefix }, key, plain);
    return new Blob([prefix, ct], { type: 'application/octet-stream' });
  }

  async function e2eDecrypt(bytes, password) {
    if (bytes.length < 56 || MAGIC.some((b, i) => bytes[i] !== b)) throw { code: 'generic' };
    const prefix = bytes.slice(0, 36);
    const iterations = new DataView(prefix.buffer).getUint32(4);
    if (iterations < 100_000 || iterations > 10_000_000) throw { code: 'generic' };
    const key = await deriveKey(password, prefix.slice(8, 24), iterations, 'decrypt');
    let plain;
    try {
      plain = new Uint8Array(
        await crypto.subtle.decrypt({ name: 'AES-GCM', iv: prefix.slice(24, 36), additionalData: prefix }, key, bytes.subarray(36)),
      );
    } catch {
      throw { code: 'wrong_password' };
    }
    const len = new DataView(plain.buffer).getUint32(0);
    const header = JSON.parse(td.decode(plain.subarray(4, 4 + len)));
    return { name: header.name, data: plain.subarray(4 + len) };
  }

  // ------------------------------------------------------------- history --
  const HISTORY_KEY = 'sf:history';
  function loadHistory() {
    try {
      const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      return Array.isArray(list) ? list.filter((x) => x && Date.parse(x.expiresAt) > Date.now()) : [];
    } catch {
      return [];
    }
  }
  function saveHistory(list) {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 50)));
  }

  function renderHistory() {
    const list = loadHistory();
    saveHistory(list);
    const ul = $('history');
    ul.replaceChildren();
    show($('view-history'), list.length > 0 && !$('view-upload').hidden);
    for (const item of list) {
      const li = document.createElement('li');
      const info = document.createElement('div');
      info.className = 'grow';
      const name = document.createElement('div');
      name.className = 'ellipsis strong';
      name.textContent = `${item.e2e ? '🔒 ' : ''}${item.name}`;
      const meta = document.createElement('div');
      meta.className = 'muted small ellipsis';
      meta.textContent = `${item.url.replace(/^https?:\/\//, '')} · ${fmtRemaining(item.expiresAt)}${item.burn ? ` · ${t('oneTime')}` : ''}`;
      info.append(name, meta);

      const actions = document.createElement('div');
      actions.className = 'actions';
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'ghost';
      copyBtn.textContent = t('copy');
      copyBtn.addEventListener('click', async () => {
        await copyText(item.url, $('result-url'));
        copyBtn.textContent = t('copied');
        setTimeout(() => (copyBtn.textContent = t('copy')), 1500);
      });
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'ghost danger';
      delBtn.textContent = t('delete');
      delBtn.addEventListener('click', async () => {
        if (!confirm(t('confirmDelete'))) return;
        delBtn.disabled = true;
        try {
          const res = await fetch(`/api/file/${encodeURIComponent(item.id)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${item.deleteToken}` },
          });
          if (!res.ok && res.status !== 404) throw new Error(String(res.status));
          saveHistory(loadHistory().filter((x) => x.id !== item.id));
          renderHistory();
        } catch {
          delBtn.disabled = false;
          alert(t('err_generic'));
        }
      });
      actions.append(copyBtn, delBtn);
      li.append(info, actions);
      ul.append(li);
    }
  }

  // -------------------------------------------------------------- upload --
  let config = { maxFileSize: 20 * 1024 * 1024, expiries: ['1h', '1d', '7d', '30d'], defaultExpiry: '1d', uploadAuth: false };
  let selected = null;
  let lastResult = null;

  function renderExpiry() {
    const sel = $('expires');
    const current = sel.value || config.defaultExpiry;
    sel.replaceChildren(
      ...config.expiries.map((k) => {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = t(`exp_${k}`);
        return o;
      }),
    );
    sel.value = config.expiries.includes(current) ? current : config.defaultExpiry;
    $('limit').textContent = t('limit', { size: fmtSize(config.maxFileSize) });
  }

  function selectFile(file) {
    if (!file) return;
    selected = file;
    $('f-name').textContent = file.name || 'file';
    $('f-size').textContent = fmtSize(file.size);
    show($('drop'), false);
    show($('options'), true);
    show($('upload-error'), false);
    show($('progress'), false);
    if (file.size > config.maxFileSize) showUploadError({ code: 'too_large' });
    $('upload-btn').focus();
  }

  function resetUpload() {
    selected = null;
    $('file').value = '';
    $('password').value = '';
    $('burn').checked = false;
    show($('options'), false);
    show($('result'), false);
    show($('upload-form-wrap'), true);
    show($('drop'), true);
  }

  function showUploadError(err) {
    const el = $('upload-error');
    el.textContent = errorText(err);
    show(el, true);
  }

  function xhrUpload(body, opts) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const q = new URLSearchParams({
        expires: opts.expires,
        burn: opts.burn ? '1' : '0',
        e2e: opts.e2e ? '1' : '0',
        format: 'json',
      });
      xhr.open('POST', `/api/upload?${q}`);
      xhr.responseType = 'json';
      xhr.setRequestHeader('Content-Type', opts.e2e ? 'application/octet-stream' : opts.type || 'application/octet-stream');
      if (!opts.e2e) xhr.setRequestHeader('X-File-Name', encodeURIComponent(opts.name));
      if (opts.token) xhr.setRequestHeader('Authorization', `Bearer ${opts.token}`);
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        const pct = Math.round((e.loaded / e.total) * 100);
        if (pct < 100) setProgress('progress', t('uploading', { pct }), pct);
        else setProgress('progress', t('saving'), null);
      };
      xhr.upload.onload = () => setProgress('progress', t('saving'), null);
      xhr.onload = () => {
        if (xhr.status === 201 && xhr.response) resolve(xhr.response);
        else reject({ code: (xhr.response && xhr.response.error) || 'generic', status: xhr.status });
      };
      xhr.onerror = () => reject({ code: 'network' });
      xhr.send(body);
    });
  }

  function renderResult() {
    if (!lastResult) return;
    const r = lastResult;
    $('result-url').value = r.url;
    const parts = [t('remaining', { time: fmtRemaining(r.expiresAt) })];
    if (r.burn) parts.push(t('oneTime'));
    if (r.e2e) parts.push(t('protected'));
    $('result-info').textContent = parts.join(' · ');
  }

  async function onUpload(e) {
    e.preventDefault();
    if (!selected) return;
    show($('upload-error'), false);
    if (selected.size > config.maxFileSize) return showUploadError({ code: 'too_large' });
    if (selected.size === 0) return showUploadError({ code: 'empty' });

    const password = $('password').value;
    const e2e = password.length > 0;
    const token = $('token').value.trim();
    const btn = $('upload-btn');
    btn.disabled = true;
    try {
      let body = selected;
      if (e2e) {
        if (!window.crypto || !crypto.subtle) throw { code: 'no_crypto' };
        setProgress('progress', t('encrypting'), null);
        body = await e2eEncrypt(selected, password);
      }
      setProgress('progress', t('uploading', { pct: 0 }), 0);
      const res = await xhrUpload(body, {
        e2e,
        burn: $('burn').checked,
        expires: $('expires').value,
        name: selected.name || 'file',
        type: selected.type,
        token,
      });
      if (token) sessionStorage.setItem('sf:token', token);
      lastResult = res;
      const list = loadHistory();
      list.unshift({
        id: res.id,
        url: res.url,
        name: selected.name || 'file',
        size: selected.size,
        expiresAt: res.expiresAt,
        burn: res.burn,
        e2e: res.e2e,
        deleteToken: res.deleteToken,
      });
      saveHistory(list);
      renderResult();
      show($('upload-form-wrap'), false);
      show($('result'), true);
      $('copy').textContent = t('copy');
      $('copy').focus();
      renderHistory();
    } catch (err) {
      if (err && err.code === 'unauthorized') show($('token-field'), true);
      showUploadError(err);
    } finally {
      btn.disabled = false;
      show($('progress'), false);
    }
  }

  function initUpload() {
    show($('view-upload'), true);
    const savedToken = sessionStorage.getItem('sf:token');
    if (savedToken) $('token').value = savedToken;

    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (c) config = c;
        show($('token-field'), config.uploadAuth);
        renderExpiry();
      })
      .catch(() => renderExpiry());
    renderExpiry();
    rerenders.push(renderExpiry, renderResult, renderHistory);

    const drop = $('drop');
    $('file').addEventListener('change', (e) => selectFile(e.target.files[0]));
    drop.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        $('file').click();
      }
    });
    let depth = 0;
    document.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (++depth === 1) drop.classList.add('over');
    });
    document.addEventListener('dragleave', () => {
      if (--depth <= 0) {
        depth = 0;
        drop.classList.remove('over');
      }
    });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      drop.classList.remove('over');
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f && !$('upload-form-wrap').hidden) selectFile(f);
    });
    document.addEventListener('paste', (e) => {
      const f = e.clipboardData && e.clipboardData.files[0];
      if (f && !$('upload-form-wrap').hidden && !$('drop').hidden) selectFile(f);
    });

    $('f-clear').addEventListener('click', resetUpload);
    $('options').addEventListener('submit', onUpload);
    $('another').addEventListener('click', resetUpload);
    $('copy').addEventListener('click', async () => {
      await copyText($('result-url').value, $('result-url'));
      $('copy').textContent = t('copied');
      setTimeout(() => ($('copy').textContent = t('copy')), 1800);
    });
    if (navigator.share) {
      show($('share'), true);
      $('share').addEventListener('click', () => navigator.share({ url: $('result-url').value }).catch(() => {}));
    }
    renderHistory();
  }

  // ------------------------------------------------------------ download --
  async function fetchBytes(url, onProgress) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      let code = 'generic';
      try {
        code = (await res.json()).error || code;
      } catch {
        /* ignore */
      }
      throw { code, status: res.status };
    }
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
    const out = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  }

  function initDownload(id) {
    show($('view-download'), true);
    let info = null;
    let cipher = null; // kept so a wrong password never needs a re-download
    let finished = false;

    const missing = (err) => {
      show($('dl-loading'), false);
      show($('dl-info'), false);
      show($('dl-missing'), true);
      if (err && err.code === 'rate_limited') {
        $('dl-missing-text').dataset.i18n = 'err_rate_limited';
        $('dl-missing-text').textContent = t('err_rate_limited');
      }
    };

    const render = () => {
      if (!info) return;
      $('dl-name').textContent = info.e2e ? t('encryptedFile') : info.name;
      $('dl-name').title = info.e2e ? '' : info.name;
      $('dl-meta').textContent = [fmtSize(info.size), t('remaining', { time: fmtRemaining(info.expiresAt) })].join(' · ');
      $('dl-btn').textContent = info.e2e ? t('decryptDownload') : t('download');
    };
    rerenders.push(render);

    const dlError = (err) => {
      if (err && err.status === 404) return missing();
      $('dl-error').textContent = err && err.code === 'wrong_password' ? t('wrongPassword') : errorText(err);
      show($('dl-error'), true);
    };

    fetch(`/api/file/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          let code = 'generic';
          try {
            code = (await res.json()).error;
          } catch {
            /* ignore */
          }
          throw { code, status: res.status };
        }
        return res.json();
      })
      .then((data) => {
        info = data;
        render();
        show($('dl-loading'), false);
        show($('dl-info'), true);
        show($('dl-burn'), info.burn);
        show($('dl-pass-field'), info.e2e);
        (info.e2e ? $('dl-pass') : $('dl-btn')).focus();
      })
      .catch(missing);

    $('dl-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!info || finished) return;
      show($('dl-error'), false);
      const btn = $('dl-btn');

      // Plain file that is not one-time: let the browser's download manager stream it.
      if (!info.e2e && !info.burn) {
        const a = document.createElement('a');
        a.href = `/${encodeURIComponent(id)}/dl`;
        a.download = '';
        document.body.append(a);
        a.click();
        a.remove();
        return;
      }

      const password = $('dl-pass').value;
      if (info.e2e && !password) {
        $('dl-error').textContent = t('needPassword');
        show($('dl-error'), true);
        $('dl-pass').focus();
        return;
      }
      if (info.e2e && (!window.crypto || !crypto.subtle)) return dlError({ code: 'no_crypto' });

      btn.disabled = true;
      try {
        if (!cipher) {
          cipher = await fetchBytes(`/${encodeURIComponent(id)}/dl`, (loaded, total) => {
            const pct = total ? Math.round((loaded / total) * 100) : null;
            setProgress('dl-progress', t('downloading', { pct: pct == null ? fmtSize(loaded) : `${pct}%` }), pct);
          });
        }
        if (info.e2e) {
          setProgress('dl-progress', t('decrypting'), null);
          const { name, data } = await e2eDecrypt(cipher, password);
          saveBytes(data, name);
        } else {
          saveBytes(cipher, info.name);
        }
        finished = info.burn;
        $('dl-done').textContent = info.burn ? t('doneBurned') : t('done');
        show($('dl-done'), true);
        if (info.burn) {
          show($('dl-form'), false);
          show($('dl-burn'), false);
        }
      } catch (err) {
        dlError(err);
        if (err && err.code === 'wrong_password') $('dl-pass').select();
      } finally {
        btn.disabled = false;
        show($('dl-progress'), false);
      }
    });
  }

  // -------------------------------------------------------------- router --
  const m = /^\/([0-9A-Za-z]{5,16})\/?$/.exec(location.pathname);
  if (m) initDownload(m[1]);
  else initUpload();
  applyI18n();
})();
