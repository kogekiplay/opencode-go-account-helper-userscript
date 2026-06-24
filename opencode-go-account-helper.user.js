// ==UserScript==
// @name         opencode go账号助手
// @namespace    https://cpa.tlytelec.com/opencode-go
// @version      0.1.2
// @description  Sync OpenCode Go account metadata, API key, and opt-in cookies to CPA.
// @license      MIT
// @homepageURL  https://github.com/kogekiplay/opencode-go-account-helper-userscript
// @supportURL   https://github.com/kogekiplay/opencode-go-account-helper-userscript/issues
// @downloadURL  https://raw.githubusercontent.com/kogekiplay/opencode-go-account-helper-userscript/main/opencode-go-account-helper.user.js
// @updateURL    https://raw.githubusercontent.com/kogekiplay/opencode-go-account-helper-userscript/main/opencode-go-account-helper.user.js
// @match        https://opencode.ai/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_info
// @grant        GM_registerMenuCommand
// @grant        GM_cookie
// @grant        GM_notification
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_NAME = 'opencode go账号助手';
  const DEFAULT_CPA_BASE = 'https://cpa.tlytelec.com:18443';
  const MANAGEMENT_PATH = '/v0/management';
  const WORKSPACE_PATTERN = /\/workspace\/(wrk_[A-Za-z0-9]+)/;
  const API_KEY_PATTERN = /sk-[A-Za-z0-9_-]{20,}/;

  const state = {
    panel: null,
    launcher: null,
    accounts: [],
    message: '',
    busy: false,
  };

  const getSetting = (key, fallback = '') => GM_getValue(key, fallback);
  const setSetting = (key, value) => GM_setValue(key, value);

  function cpaBase() {
    return String(getSetting('cpaBase', DEFAULT_CPA_BASE))
      .trim()
      .replace(/\/+$/, '');
  }

  function managementBaseURL() {
    return `${cpaBase()}${MANAGEMENT_PATH}`;
  }

  function managementKey() {
    return String(getSetting('managementKey', ''));
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showMessage(message) {
    state.message = message;
    renderPanel();
  }

  function notify(message, title = SCRIPT_NAME) {
    const text = String(message || '');
    try {
      if (typeof GM_notification === 'function') {
        GM_notification({
          title,
          text,
          timeout: 4500,
        });
        return;
      }
    } catch {
      // Fall through to alert when the userscript manager cannot show notifications.
    }
    window.alert(`${title}\n\n${text}`);
  }

  function showError(error) {
    const message = error && error.message ? error.message : String(error);
    showMessage(`失败：${message}`);
    notify(`失败：${message}`);
  }

  function focusField(field) {
    window.setTimeout(() => {
      if (!state.panel) return;
      const input = state.panel.querySelector(`[data-field="${field}"]`);
      if (!input) return;
      input.focus();
      if (typeof input.select === 'function') input.select();
    }, 0);
  }

  function showPanelMessage(message, field) {
    state.message = message;
    openPanel();
    if (field) focusField(field);
  }

  function userscriptEnvironmentText() {
    try {
      const info = typeof GM_info === 'object' ? GM_info : {};
      const handler = info.scriptHandler || '未知脚本管理器';
      const version = info.version || '未知版本';
      return `${handler} ${version}`;
    } catch {
      return '未知脚本管理器';
    }
  }

  function withBusy(task) {
    if (state.busy) return Promise.resolve();
    state.busy = true;
    renderPanel();
    return Promise.resolve()
      .then(task)
      .catch(showError)
      .finally(() => {
        state.busy = false;
        renderPanel();
      });
  }

  function request(method, path, body) {
    return new Promise((resolve, reject) => {
      const headers = { 'Content-Type': 'application/json' };
      const key = managementKey().trim();
      if (!key) {
        const message = '请先填写管理密钥';
        showPanelMessage(message, 'managementKey');
        reject(new Error(message));
        return;
      }
      if (key) headers.Authorization = `Bearer ${key}`;

      GM_xmlhttpRequest({
        method,
        url: `${managementBaseURL()}${path}`,
        headers,
        data: body ? JSON.stringify(body) : undefined,
        timeout: 30000,
        onload: (response) => {
          let data = null;
          try {
            data = response.responseText ? JSON.parse(response.responseText) : null;
          } catch {
            data = response.responseText;
          }

          if (response.status >= 200 && response.status < 300) {
            resolve(data);
            return;
          }

          const message =
            data && typeof data === 'object' && data.error
              ? String(data.error)
              : `HTTP ${response.status}`;
          reject(new Error(message));
        },
        onerror: () => reject(new Error('请求 CPA 失败')),
        ontimeout: () => reject(new Error('请求 CPA 超时')),
      });
    });
  }

  async function fetchSameOriginText(path) {
    const response = await fetch(path, {
      credentials: 'include',
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`${path} HTTP ${response.status}`);
    return {
      text: await response.text(),
      url: response.url,
    };
  }

  async function detectWorkspaceID() {
    const current = location.pathname.match(WORKSPACE_PATTERN);
    if (current) return current[1];

    try {
      const result = await fetchSameOriginText('/auth');
      const redirected = result.url.match(WORKSPACE_PATTERN);
      if (redirected) return redirected[1];
    } catch {
      // Keep this best-effort; the sync payload can still use the API key as identity.
    }

    return '';
  }

  function readVisibleText() {
    return document.body ? document.body.innerText || '' : '';
  }

  function detectEmail(text) {
    const fromText = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    if (fromText) return fromText[0];

    try {
      for (const storage of [localStorage, sessionStorage]) {
        for (let i = 0; i < storage.length; i += 1) {
          const key = storage.key(i);
          const value = key ? storage.getItem(key) : '';
          const match = value ? value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) : null;
          if (match) return match[0];
        }
      }
    } catch {
      // Storage can be blocked; page text remains the primary source.
    }

    return '';
  }

  async function findApiKey(workspaceID) {
    const visible = readVisibleText().match(API_KEY_PATTERN);
    if (visible) return visible[0];

    if (!workspaceID) return '';
    try {
      const keysPage = await fetchSameOriginText(`/workspace/${encodeURIComponent(workspaceID)}/keys`);
      const match = keysPage.text.match(API_KEY_PATTERN);
      return match ? match[0] : '';
    } catch {
      return '';
    }
  }

  function cookiePairString(cookies) {
    const pairs = [];
    const seen = new Set();
    for (const cookie of cookies) {
      if (!cookie || !cookie.name) continue;
      if (seen.has(cookie.name)) continue;
      seen.add(cookie.name);
      pairs.push(`${cookie.name}=${cookie.value || ''}`);
    }
    return pairs.join('; ');
  }

  function documentCookieObjects() {
    return (document.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eq = part.indexOf('=');
        return eq > 0
          ? { name: part.slice(0, eq), value: part.slice(eq + 1), domain: '.opencode.ai', path: '/' }
          : null;
      })
      .filter(Boolean);
  }

  function cookieLookupURLs(workspaceID) {
    const urls = [
      location.href,
      'https://opencode.ai/',
      'https://opencode.ai/auth',
    ];
    if (workspaceID) {
      urls.push(
        `https://opencode.ai/workspace/${encodeURIComponent(workspaceID)}`,
        `https://opencode.ai/workspace/${encodeURIComponent(workspaceID)}/go`,
        `https://opencode.ai/workspace/${encodeURIComponent(workspaceID)}/keys`
      );
    }
    return urls.filter((url, index) => url && urls.indexOf(url) === index);
  }

  function mergeCookies(cookieLists) {
    const out = [];
    const seen = new Set();
    for (const cookies of cookieLists) {
      for (const cookie of cookies || []) {
        if (!cookie || !cookie.name) continue;
        const key = [cookie.name, cookie.domain || '', cookie.path || ''].join('\n');
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(cookie);
      }
    }
    return out;
  }

  function listCookiesForURL(details) {
    return new Promise((resolve, reject) => {
      GM_cookie.list(details, (cookies, error) => {
        if (error) {
          reject(new Error(String(error)));
          return;
        }
        resolve(Array.isArray(cookies) ? cookies : []);
      });
    });
  }

  async function listCookies(workspaceID) {
    if (typeof GM_cookie === 'undefined' || !GM_cookie.list) {
      return documentCookieObjects();
    }

    const details = [];
    for (const url of cookieLookupURLs(workspaceID)) {
      details.push({ url });
      details.push({ url, partitionKey: {} });
    }
    details.push({ domain: 'opencode.ai' });
    details.push({ domain: '.opencode.ai' });

    const results = await Promise.all(details.map((item) => listCookiesForURL(item).catch(() => [])));
    const cookies = mergeCookies(results);
    return cookies.length > 0 ? cookies : documentCookieObjects();
  }

  function cookieLooksIncomplete(cookieString) {
    const names = parseCookiePairs(cookieString).map((pair) => pair.name.toLowerCase());
    if (names.length === 0) return true;
    return names.every((name) => name === 'oc_locale');
  }

  async function readCookieString(workspaceID) {
    const allowCookie = Boolean(getSetting('allowCookieUpload', true));
    if (!allowCookie) return '';

    try {
      const cookie = cookiePairString(await listCookies(workspaceID));
      return cookieLooksIncomplete(cookie) ? '' : cookie;
    } catch {
      const cookie = document.cookie || '';
      return cookieLooksIncomplete(cookie) ? '' : cookie;
    }
  }

  function cookieNamesText(cookieString) {
    const names = parseCookiePairs(cookieString).map((pair) => pair.name).filter(Boolean);
    return names.length > 0 ? names.join(', ') : '无';
  }

  async function diagnoseCookieRead() {
    const workspaceID = await detectWorkspaceID();
    const cookies = await listCookies(workspaceID);
    const cookie = cookiePairString(cookies);
    const names = cookieNamesText(cookie);
    const incomplete = cookieLooksIncomplete(cookie);
    const env = userscriptEnvironmentText();
    const message = incomplete
      ? `Cookie 读取不完整，只读到：${names}\n环境：${env}\nOpenCode 登录 Cookie 大概率是 HttpOnly；Tampermonkey 稳定版通常读不到，需要 Tampermonkey Beta 才能导出给 CPA 后端刷新额度。`
      : `Cookie 读取正常，读到 ${parseCookiePairs(cookie).length} 个 Cookie：${names}\n环境：${env}`;
    showMessage(message.replace(/\n/g, ' '));
    notify(message, `${SCRIPT_NAME} - Cookie 诊断`);
  }

  function deleteCookie(cookie) {
    if (typeof GM_cookie !== 'undefined' && GM_cookie.delete) {
      return new Promise((resolve) => {
        GM_cookie.delete(
          {
            url: 'https://opencode.ai/',
            name: cookie.name,
          },
          () => resolve()
        );
      });
    }

    document.cookie = `${cookie.name}=; domain=.opencode.ai; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    document.cookie = `${cookie.name}=; domain=opencode.ai; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
    return Promise.resolve();
  }

  async function clearCurrentCookies() {
    const workspaceID = await detectWorkspaceID();
    const cookies = await listCookies(workspaceID).catch(() => documentCookieObjects());
    await Promise.all(cookies.map((cookie) => deleteCookie(cookie)));
  }

  function parseCookiePairs(cookieString) {
    return String(cookieString || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eq = part.indexOf('=');
        if (eq <= 0) return null;
        return {
          name: part.slice(0, eq).trim(),
          value: part.slice(eq + 1),
        };
      })
      .filter(Boolean);
  }

  function setCookiePair(pair) {
    if (typeof GM_cookie !== 'undefined' && GM_cookie.set) {
      return new Promise((resolve) => {
        GM_cookie.set(
          {
            url: 'https://opencode.ai/',
            name: pair.name,
            value: pair.value,
            domain: '.opencode.ai',
            path: '/',
            secure: true,
            sameSite: 'lax',
          },
          () => resolve()
        );
      });
    }

    document.cookie = `${pair.name}=${pair.value}; domain=.opencode.ai; path=/; secure; SameSite=Lax`;
    return Promise.resolve();
  }

  async function syncCurrentAccount() {
    const visibleText = readVisibleText();
    const workspaceID = await detectWorkspaceID();
    const apiKey = await findApiKey(workspaceID);
    const cookie = await readCookieString(workspaceID);
    const email = detectEmail(visibleText);

    const payload = {
      alias: email || workspaceID || 'OpenCode Go',
      email,
      'workspace-id': workspaceID,
      'api-key': apiKey,
      cookie,
    };

    const result = await request('POST', '/opencode-go/sync', payload);
    const accountID = result && result.account && result.account.id ? result.account.id : 'ok';
    const cookieMessage = cookie
      ? '，已包含 Cookie'
      : getSetting('allowCookieUpload', true)
        ? `，但没有读到认证 Cookie（${userscriptEnvironmentText()} 可能无法读取 HttpOnly Cookie，请使用菜单“诊断 Cookie 读取”确认）`
        : '';
    const message = `已同步：${accountID}${cookieMessage}`;
    await loadAccounts({ silent: true }).catch(() => {});
    showMessage(message);
    notify(message);
  }

  async function loadAccounts(options = {}) {
    const result = await request('GET', '/opencode-go/accounts');
    state.accounts = Array.isArray(result.accounts) ? result.accounts : [];
    if (!options.silent) showMessage(`已加载 ${state.accounts.length} 个账号`);
  }

  function accountWorkspaceID(account) {
    return account.workspaceId || account['workspace-id'] || '';
  }

  function accountName(account) {
    return account.alias || account.email || account.username || accountWorkspaceID(account) || account.id;
  }

  function accountHasCookie(account) {
    return Boolean(account.hasCookie || account['has-cookie']);
  }

  function accountHasApiKey(account) {
    return Boolean(account.hasApiKey || account['has-api-key']);
  }

  function accountApiKeySynced(account) {
    return Boolean(account.apiKeySynced || account['api-key-synced']);
  }

  function accountApiKeyPreview(account) {
    return account.apiKeyPreview || account['api-key-preview'] || '';
  }

  function accountWorkspaceURL(account) {
    const workspaceID = accountWorkspaceID(account);
    return workspaceID
      ? `https://opencode.ai/workspace/${encodeURIComponent(workspaceID)}/go`
      : 'https://opencode.ai/auth';
  }

  async function applyAccountCookie(account) {
    if (!accountHasCookie(account)) throw new Error('该账号没有保存 Cookie');

    const result = await request(
      'GET',
      `/opencode-go/accounts/${encodeURIComponent(account.id)}/switch-cookie`
    );
    const cookie = result && result.cookie;
    if (!cookie) throw new Error('该账号没有可用 Cookie');

    const pairs = parseCookiePairs(cookie);
    if (pairs.length === 0) throw new Error('CPA 返回的 Cookie 为空');

    await clearCurrentCookies();
    for (const pair of pairs) {
      await setCookiePair(pair);
    }
  }

  async function switchAccount(account) {
    const name = accountName(account);
    const targetURL = accountWorkspaceURL(account);
    if (!window.confirm(`切换到 ${name} 并打开工作区？`)) {
      return;
    }

    await applyAccountCookie(account);

    showMessage(`已切换到：${name}`);
    window.setTimeout(() => {
      window.location.assign(targetURL);
    }, 300);
  }

  function accountRowsHTML() {
    if (state.accounts.length === 0) {
      return '<div class="ocg-empty">还没有加载 CPA 账号</div>';
    }

    const cookieCount = state.accounts.filter(accountHasCookie).length;
    const summary = `<div class="ocg-account-summary">已保存 Cookie：${cookieCount} / ${state.accounts.length}</div>`;
    return summary + state.accounts
      .map((account) => {
        const name = accountName(account);
        const workspaceID = accountWorkspaceID(account);
        const hasCookie = accountHasCookie(account);
        const meta = [
          workspaceID ? `Workspace ${workspaceID}` : 'Workspace 未识别',
          accountApiKeyPreview(account) || (accountHasApiKey(account) ? 'API key 已保存' : '无 API key'),
          hasCookie ? 'Cookie 已保存' : '无 Cookie',
          accountApiKeySynced(account) ? '已写入 provider' : '未写入 provider',
        ];
        return `
          <article class="ocg-account" data-account-id="${escapeHTML(account.id)}">
            <div class="ocg-account-main">
              <span>${escapeHTML(name)}</span>
              <small>${escapeHTML(meta.join(' · '))}</small>
            </div>
            <div class="ocg-account-actions">
              <button data-switch-account="${escapeHTML(account.id)}" type="button" ${hasCookie ? '' : 'disabled'}>切换账号</button>
            </div>
          </article>
        `;
      })
      .join('');
  }

  function renderPanel() {
    if (!state.panel) return;

    state.panel.innerHTML = `
      <div class="ocg-title-row">
        <div class="ocg-title">${escapeHTML(SCRIPT_NAME)}</div>
        <button class="ocg-close" data-action="close" type="button">×</button>
      </div>
      <label>CPA 地址
        <input data-field="cpaBase" value="${escapeHTML(cpaBase())}" placeholder="${escapeHTML(DEFAULT_CPA_BASE)}">
      </label>
      <label>管理密钥
        <input data-field="managementKey" type="password" value="${escapeHTML(managementKey())}" autocomplete="off">
      </label>
      <label class="ocg-row">
        <input data-field="allowCookieUpload" type="checkbox" ${getSetting('allowCookieUpload', true) ? 'checked' : ''}>
        <span>允许上传 Cookie（默认开启）</span>
      </label>
      <div class="ocg-actions">
        <button data-action="sync" type="button" ${state.busy ? 'disabled' : ''}>同步当前账号</button>
        <button data-action="load" type="button" ${state.busy ? 'disabled' : ''}>拉取 CPA 账号</button>
      </div>
      <div class="ocg-message">${escapeHTML(state.message || '')}</div>
      <div class="ocg-accounts">${accountRowsHTML()}</div>
    `;

    state.panel.querySelectorAll('[data-field]').forEach((input) => {
      input.addEventListener('change', () => {
        if (input.type === 'checkbox') {
          setSetting(input.dataset.field, input.checked);
        } else {
          setSetting(input.dataset.field, input.value);
        }
      });
    });

    state.panel
      .querySelector('[data-action="close"]')
      .addEventListener('click', () => {
        collapsePanel();
      });
    state.panel
      .querySelector('[data-action="sync"]')
      .addEventListener('click', () => withBusy(syncCurrentAccount));
    state.panel
      .querySelector('[data-action="load"]')
      .addEventListener('click', () => withBusy(loadAccounts));
    state.panel.querySelectorAll('[data-switch-account]').forEach((button) => {
      button.addEventListener('click', () => {
        const account = state.accounts.find((item) => item.id === button.dataset.switchAccount);
        if (account) withBusy(() => switchAccount(account));
      });
    });
  }

  function installStyle() {
    if (document.getElementById('opencode-go-account-helper-style')) return;
    const style = document.createElement('style');
    style.id = 'opencode-go-account-helper-style';
    style.textContent = `
      #opencode-go-account-helper{position:fixed;right:16px;bottom:16px;z-index:2147483647;width:min(360px,calc(100vw - 32px));box-sizing:border-box;padding:12px;border:1px solid #d0d7de;border-radius:8px;background:#fff;color:#1f2328;box-shadow:0 16px 40px rgba(0,0,0,.18);font:13px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #opencode-go-account-helper *{box-sizing:border-box}
      #opencode-go-account-helper .ocg-title-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
      #opencode-go-account-helper .ocg-title{font-weight:700}
      #opencode-go-account-helper .ocg-close{width:26px;height:26px;padding:0;border-radius:50%}
      #opencode-go-account-helper label{display:grid;gap:4px;margin:8px 0;color:#57606a}
      #opencode-go-account-helper input{width:100%;min-width:0;padding:7px 8px;border:1px solid #d0d7de;border-radius:6px;background:#fff;color:#1f2328}
      #opencode-go-account-helper .ocg-row{display:flex;align-items:center;gap:8px;color:#1f2328}
      #opencode-go-account-helper .ocg-row input{width:auto}
      #opencode-go-account-helper button{min-height:30px;padding:6px 9px;border:1px solid #d0d7de;border-radius:6px;background:#f6f8fa;color:#1f2328;cursor:pointer;font:inherit}
      #opencode-go-account-helper button:hover:not(:disabled){background:#eef2f6}
      #opencode-go-account-helper button:disabled{cursor:not-allowed;opacity:.62}
      #opencode-go-account-helper .ocg-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
      #opencode-go-account-helper .ocg-message{min-height:18px;margin-top:8px;color:#57606a;overflow-wrap:anywhere}
      #opencode-go-account-helper .ocg-accounts{display:grid;gap:6px;max-height:240px;margin-top:8px;overflow:auto}
      #opencode-go-account-helper .ocg-account-summary{padding:7px 8px;border-radius:6px;background:#f6f8fa;color:#57606a}
      #opencode-go-account-helper .ocg-account{display:grid;gap:8px;width:100%;padding:8px;border:1px solid #d0d7de;border-radius:8px;background:#fff}
      #opencode-go-account-helper .ocg-account-main{display:grid;gap:2px;text-align:left}
      #opencode-go-account-helper .ocg-account span{overflow-wrap:anywhere}
      #opencode-go-account-helper .ocg-account small{color:#57606a}
      #opencode-go-account-helper .ocg-account-actions{display:flex;flex-wrap:wrap;gap:6px}
      #opencode-go-account-helper .ocg-empty{padding:10px;border:1px dashed #d0d7de;border-radius:6px;color:#57606a;text-align:center}
      #opencode-go-account-helper-launcher{position:fixed;right:16px;bottom:16px;z-index:2147483647;min-height:34px;padding:7px 11px;border:1px solid #d0d7de;border-radius:999px;background:#fff;color:#1f2328;box-shadow:0 10px 28px rgba(0,0,0,.16);cursor:pointer;font:13px/1.3 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      #opencode-go-account-helper-launcher:hover{background:#f6f8fa}
    `;
    document.head.appendChild(style);
  }

  function ensureLauncher() {
    installStyle();
    if (!state.launcher) {
      state.launcher = document.createElement('button');
      state.launcher.id = 'opencode-go-account-helper-launcher';
      state.launcher.type = 'button';
      state.launcher.textContent = '账号助手';
      state.launcher.addEventListener('click', openPanel);
      document.body.appendChild(state.launcher);
    }
    return state.launcher;
  }

  function collapsePanel() {
    if (state.panel) state.panel.hidden = true;
    ensureLauncher().hidden = false;
  }

  function openPanel() {
    installStyle();
    ensureLauncher().hidden = true;
    if (!state.panel) {
      state.panel = document.createElement('div');
      state.panel.id = 'opencode-go-account-helper';
      document.body.appendChild(state.panel);
    } else {
      state.panel.hidden = false;
    }
    renderPanel();
    if (!state.busy && managementKey().trim() && state.accounts.length === 0) {
      withBusy(() => loadAccounts({ silent: true })).catch(() => {});
    }
  }

  function start() {
    openPanel();
  }

  GM_registerMenuCommand('打开 OpenCode Go 账号助手', openPanel);
  GM_registerMenuCommand('同步当前 OpenCode Go 账号', () => withBusy(syncCurrentAccount));
  GM_registerMenuCommand('拉取 CPA OpenCode Go 账号', () => withBusy(loadAccounts));
  GM_registerMenuCommand('诊断 Cookie 读取', () => withBusy(diagnoseCookieRead));

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
