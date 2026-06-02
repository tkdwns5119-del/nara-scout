/* Firebase Realtime Database workflow adapter for DI dashboard.
 * This replaces the previous Cloudflare/Pages Function workflow sync at runtime.
 * It keeps all existing UI functions intact and only overrides workflow storage/sync.
 */
(function () {
  const CONFIG_URL = './data/workflow-config.json?t=' + Date.now();
  const APP_NAME = 'DI Procurement Dashboard';

  let firebaseReady = false;
  let firebaseRef = null;
  let remoteApplying = false;
  let saveTimer = null;
  let lastRemoteJson = '';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        if (existing.dataset.loaded === 'true') resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve();
      };
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  function log(message, type) {
    if (typeof window.logConsole === 'function') {
      window.logConsole(`[Firebase] ${message}`, type || 'normal');
    } else {
      console.log(`[Firebase] ${message}`);
    }
  }

  function toast(message, icon) {
    if (typeof window.showToast === 'function') window.showToast(message, icon || 'database');
  }

  function getLocalStore() {
    try {
      return JSON.parse(localStorage.getItem('DI_BID_WORKFLOW_V1') || '{}');
    } catch {
      return {};
    }
  }

  function setLocalStore(store) {
    window.workflowStoreCache = store || {};
    localStorage.setItem('DI_BID_WORKFLOW_V1', JSON.stringify(store || {}));
  }

  function mergeStores(localStore, remoteStore) {
    const merged = { ...(localStore || {}) };

    Object.entries(remoteStore || {}).forEach(([key, remoteValue]) => {
      const localValue = merged[key];

      if (!localValue) {
        merged[key] = remoteValue;
        return;
      }

      const localTime = new Date(localValue.updatedAt || 0).getTime();
      const remoteTime = new Date(remoteValue.updatedAt || 0).getTime();

      merged[key] = remoteTime > localTime
        ? { ...localValue, ...remoteValue }
        : { ...remoteValue, ...localValue };
    });

    return merged;
  }

  function normalizePayload(payload) {
    if (!payload) return {};
    if (payload.workflow && typeof payload.workflow === 'object') return payload.workflow;
    if (payload.data && typeof payload.data === 'object') return payload.data;
    if (typeof payload === 'object') return payload;
    return {};
  }

  function refreshUi() {
    try {
      if (typeof window.applyFilters === 'function') window.applyFilters();
      if (typeof window.renderHotMatches === 'function') window.renderHotMatches();
      if (typeof window.renderUrgentBids === 'function') window.renderUrgentBids();
      if (typeof window.renderRegionalStats === 'function') window.renderRegionalStats();
    } catch (e) {
      console.warn('[Firebase] UI refresh skipped:', e);
    }
  }

  async function initFirebaseWorkflow() {
    try {
      const res = await fetch(CONFIG_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('workflow-config.json load failed: HTTP ' + res.status);

      const cfg = await res.json();
      if (cfg.provider !== 'firebase') {
        log('workflow-config provider가 firebase가 아닙니다. 기존 저장 방식을 유지합니다.', 'warn');
        return false;
      }

      const firebaseConfig = cfg.firebaseConfig || {};
      if (!firebaseConfig.apiKey || String(firebaseConfig.apiKey).startsWith('PASTE_')) {
        log('Firebase 설정값이 아직 입력되지 않았습니다. data/workflow-config.json을 수정해야 합니다.', 'warn');
        toast('Firebase 설정값을 입력해야 공유 저장이 됩니다.', 'alert-triangle');
        return false;
      }

      await loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
      await loadScript('https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js');

      const appName = 'di-dashboard-workflow';
      let app;
      try {
        app = firebase.app(appName);
      } catch {
        app = firebase.initializeApp(firebaseConfig, appName);
      }

      const db = firebase.database(app);
      firebaseRef = db.ref(cfg.path || 'workflow');
      firebaseReady = true;

      // Initial merge once.
      const snap = await firebaseRef.once('value');
      const remote = normalizePayload(snap.val());
      const merged = mergeStores(getLocalStore(), remote);
      setLocalStore(merged);

      if (Object.keys(merged).length > 0) {
        await firebaseRef.update(merged);
      }

      // Real-time sync.
      firebaseRef.on('value', snapshot => {
        const remoteStore = normalizePayload(snapshot.val());
        const remoteJson = JSON.stringify(remoteStore || {});
        if (remoteJson === lastRemoteJson) return;
        lastRemoteJson = remoteJson;

        remoteApplying = true;
        const mergedStore = mergeStores(getLocalStore(), remoteStore);
        setLocalStore(mergedStore);
        remoteApplying = false;

        refreshUi();
        log('실시간 공유 상태를 동기화했습니다.', 'success');
      });

      const syncText = document.getElementById('syncStatusText');
      if (syncText) {
        syncText.innerText = 'Firebase 실시간 공유 저장 ON';
        syncText.className = 'text-xs text-emerald-700 font-bold';
      }

      log('Firebase Realtime Database 연결 완료', 'success');
      toast('Firebase 실시간 공유 저장 연결 완료', 'database');
      return true;
    } catch (e) {
      log('Firebase 연결 실패: ' + e.message, 'error');
      toast('Firebase 연결 실패: 설정값을 확인하세요.', 'alert-triangle');
      return false;
    }
  }

  function installOverrides() {
    window.saveWorkflowStoreToFirebaseNow = async function () {
      if (!firebaseReady || !firebaseRef) return false;
      await firebaseRef.update(getLocalStore());
      return true;
    };

    window.saveWorkflowStore = function (store, options = {}) {
      setLocalStore(store || {});

      if (options.skipServer || remoteApplying) return;

      clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        try {
          if (firebaseReady && firebaseRef) {
            await firebaseRef.update(getLocalStore());
            log('검토 상태 자동 저장 완료', 'success');
          } else {
            log('Firebase 미연결: 현재 브라우저에만 저장되었습니다.', 'warn');
          }
        } catch (e) {
          log('Firebase 자동 저장 실패: ' + e.message, 'error');
        }
      }, 600);
    };

    window.initializeWorkflowServerSync = async function () {
      const ok = await initFirebaseWorkflow();
      return getLocalStore();
    };

    window.saveWorkflowStoreToGitHubNow = async function () {
      return await window.saveWorkflowStoreToFirebaseNow();
    };

    window.manualLoadWorkflowFromGitHub = async function () {
      await initFirebaseWorkflow();
      refreshUi();
      toast('Firebase 공유 상태를 불러왔습니다.', 'download');
    };

    window.manualSaveWorkflowToGitHub = async function () {
      const ok = await window.saveWorkflowStoreToFirebaseNow();
      if (ok) toast('Firebase에 저장되었습니다.', 'upload-cloud');
    };
  }

  function boot() {
    installOverrides();
    setTimeout(() => initFirebaseWorkflow(), 800);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
