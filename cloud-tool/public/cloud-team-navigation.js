(function () {
  'use strict';

  const roleLabels = {
    owner: '所有者',
    admin: '管理员',
    operator: '操作员',
    viewer: '只读成员',
  };
  const BRIDGE_CHANNEL = 'taobao-full-chain-tool-v1';

  function cleanText(value, fallback) {
    const text = String(value == null ? '' : value).trim();
    return text || fallback;
  }

  async function lockAccountVault() {
    const cloudSync = window.TaobaoCloudSync;
    if (cloudSync && typeof cloudSync.lockAccountVault === 'function') {
      await cloudSync.lockAccountVault();
      return;
    }
    await new Promise((resolve) => {
      const requestId = 'vault-lock-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      let settled = false;
      let timer = 0;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        resolve();
      };
      const onMessage = (event) => {
        const message = event.data;
        if (event.source !== window || event.origin !== location.origin || !message ||
            message.channel !== BRIDGE_CHANNEL || message.type !== 'response' ||
            message.requestId !== requestId) return;
        finish();
      };
      timer = setTimeout(finish, 1200);
      window.addEventListener('message', onMessage);
      window.postMessage({
        channel: BRIDGE_CHANNEL,
        type: 'request',
        requestId,
        action: 'lockAccountVault',
        payload: {},
      }, location.origin);
    });
  }

  async function loadAccount() {
    const nameNode = document.getElementById('cloudTeamAccountName');
    const roleNode = document.getElementById('cloudTeamAccountRole');
    const avatarNode = document.getElementById('cloudTeamAvatar');
    if (!nameNode || !roleNode || !avatarNode) return;
    try {
      const response = await fetch('/api/session', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (response.status === 401 || response.status === 403) {
        try { await lockAccountVault(); } catch {}
        const next = location.pathname + location.search;
        location.replace('/login?next=' + encodeURIComponent(next));
        return;
      }
      if (!response.ok) throw new Error('session unavailable');
      const payload = await response.json();
      const user = payload && payload.user || {};
      const member = payload && payload.member || {};
      const name = cleanText(user.displayName || member.displayName || user.username, '团队成员');
      const role = cleanText(payload && payload.role || member.role, 'admin');
      nameNode.textContent = name;
      roleNode.textContent = roleLabels[role] || '团队成员';
      avatarNode.textContent = name.slice(0, 1).toUpperCase();
    } catch {
      nameNode.textContent = '已登录成员';
      roleNode.textContent = '团队账号';
      avatarNode.textContent = '用';
    }
  }

  function bindLogout() {
    const button = document.getElementById('cloudTeamLogout');
    const label = document.getElementById('cloudTeamLogoutLabel');
    if (!button) return;
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      if (label) label.textContent = '正在退出…';
      try {
        try { await lockAccountVault(); } catch {}
        await fetch('/api/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      } catch {
        // The login page verifies the session again even if this request fails.
      } finally {
        location.replace('/login');
      }
    });
  }

  function revealActiveNavigationItem() {
    const navigation = document.querySelector('.cloud-team-nav');
    const active = navigation && navigation.querySelector('[aria-current="page"]');
    if (!navigation || !active || navigation.scrollWidth <= navigation.clientWidth) return;
    navigation.scrollLeft = Math.max(
      0,
      active.offsetLeft - (navigation.clientWidth - active.offsetWidth) / 2,
    );
  }

  bindLogout();
  requestAnimationFrame(revealActiveNavigationItem);
  void loadAccount();
})();
