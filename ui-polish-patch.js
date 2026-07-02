(() => {
  const addStyle = (css) => {
    const style = document.createElement("style");
    style.id = "di-ui-polish-patch";
    style.textContent = css;
    document.head.appendChild(style);
  };

  addStyle(`
    :root {
      --di-bg: #f3f6fb;
      --di-panel: #ffffff;
      --di-panel-soft: #f8fafc;
      --di-border: #d9e2ec;
      --di-border-strong: #b8c4d2;
      --di-text: #172033;
      --di-muted: #667085;
      --di-cyan: #007f96;
      --di-emerald: #087f5b;
      --di-rose: #c22f52;
      --di-amber: #b26b00;
      --di-radius: 8px;
    }

    html,
    body {
      background: var(--di-bg) !important;
      color: var(--di-text) !important;
      letter-spacing: 0 !important;
    }

    body {
      min-width: 0;
    }

    [class*="blur-xl"],
    [class*="rounded-full"][class*="blur"] {
      display: none !important;
    }

    header {
      background: rgba(255, 255, 255, 0.96) !important;
      border-bottom: 1px solid var(--di-border) !important;
      box-shadow: 0 1px 0 rgba(15, 23, 42, 0.04) !important;
    }

    header .w-10.h-10 {
      border-radius: var(--di-radius) !important;
      background: #0f172a !important;
      box-shadow: none !important;
    }

    main {
      padding-top: 18px !important;
      padding-bottom: 28px !important;
    }

    .card-soft,
    .bg-cyber-card,
    .bg-white,
    .bg-slate-50,
    .rounded-xl,
    .rounded-2xl,
    .rounded-3xl {
      border-radius: var(--di-radius) !important;
    }

    .card-soft,
    .bg-cyber-card {
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05) !important;
      border-color: var(--di-border) !important;
    }

    .tab-btn {
      min-height: 42px !important;
      border-radius: 6px !important;
      white-space: nowrap !important;
    }

    .tab-btn.bg-cyan-50,
    .tab-btn.text-cyber-cyan {
      background: #e8f7fa !important;
      color: var(--di-cyan) !important;
      border-color: #b9e3ea !important;
    }

    #tab-dashboard > .grid:first-of-type > div {
      padding: 16px !important;
      min-height: 132px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    #tab-dashboard h3[id^="stat-"],
    #tab-important h3[id^="important-"] {
      font-size: 24px !important;
      line-height: 1.15 !important;
      color: var(--di-text) !important;
    }

    #urgent-bids-grid > *,
    #hot-matches-grid > * {
      border-radius: var(--di-radius) !important;
      border-color: var(--di-border) !important;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05) !important;
    }

    input,
    select,
    button {
      border-radius: 6px !important;
    }

    input:focus,
    select:focus,
    button:focus-visible {
      outline: 2px solid rgba(0, 127, 150, 0.22) !important;
      outline-offset: 2px !important;
      box-shadow: none !important;
    }

    #bidsTableBody tr,
    #checkedImportantBidsTableBody tr,
    #issueImportantBidsTableBody tr {
      background: #fff !important;
    }

    #bidsTableBody tr:hover,
    #checkedImportantBidsTableBody tr:hover,
    #issueImportantBidsTableBody tr:hover {
      background: #f8fbfd !important;
    }

    #bidsTableBody tr.bg-amber-50\\/30,
    #checkedImportantBidsTableBody tr.bg-amber-50\\/30,
    #issueImportantBidsTableBody tr.bg-amber-50\\/30 {
      background: #fff8eb !important;
    }

    table thead tr {
      background: #eef3f8 !important;
    }

    table th {
      color: #354052 !important;
      font-weight: 800 !important;
      border-bottom: 1px solid var(--di-border) !important;
    }

    table td {
      border-bottom: 1px solid #edf1f5 !important;
    }

    td button[onclick^="toggleImportantChecked"],
    td button[onclick^="toggleImportantIssue"],
    td button[onclick^="openAiAssistant"],
    td button[onclick^="openBidLink"] {
      width: 34px !important;
      height: 34px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
    }

    td button[onclick^="toggleImportantChecked"].bg-emerald-100 {
      background: #dff7ec !important;
      color: var(--di-emerald) !important;
      border-color: #91d7b8 !important;
    }

    td button[onclick^="toggleImportantIssue"].bg-rose-100 {
      background: #ffe7ed !important;
      color: var(--di-rose) !important;
      border-color: #f1a3b6 !important;
    }

    #importantSharedStatus {
      border-radius: var(--di-radius) !important;
    }

    #aiAssistantModal > div {
      border-radius: var(--di-radius) !important;
      box-shadow: 0 24px 60px rgba(15, 23, 42, 0.22) !important;
    }

    [data-checkbox-filter-menu] {
      border-radius: var(--di-radius) !important;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.16) !important;
    }

    @media (max-width: 768px) {
      header > div {
        height: auto !important;
        min-height: 64px !important;
        padding-top: 10px !important;
        padding-bottom: 10px !important;
        gap: 10px !important;
      }

      header h1 {
        font-size: 15px !important;
      }

      main {
        padding-left: 10px !important;
        padding-right: 10px !important;
      }

      .tab-btn {
        min-width: 116px;
      }

      main > .flex.border {
        overflow-x: auto;
        justify-content: flex-start;
      }

      table th,
      table td {
        padding: 10px !important;
      }
    }
  `);

  const notify = (message, icon = "info") => {
    try {
      showToast(message, icon);
    } catch {
      console.log(message);
    }
  };

  const refreshImportantViews = () => {
    try {
      saveImportantIssueStore({ skipShared: true });
    } catch {
      try {
        localStorage.setItem(IMPORTANT_ISSUE_LS, JSON.stringify(importantIssueStore || {}));
      } catch {}
    }

    try {
      updateImportantIssueSummary();
    } catch {}

    try {
      if (typeof applyFilters === "function") applyFilters();
      else if (typeof renderBidsTable === "function") renderBidsTable();
    } catch {}

    try {
      renderImportantIssueBids();
    } catch {}
  };

  const syncImportantKey = async (bidNo, next) => {
    try {
      if (!importantIssueSharedReady || !importantIssueFirebaseRef) return;

      if (next && (next.checked || next.issue)) {
        await importantIssueFirebaseRef.child(bidNo).set(next);
      } else {
        await importantIssueFirebaseRef.child(bidNo).remove();
      }

      if (typeof updateImportantSharedStatus === "function") {
        updateImportantSharedStatus("Firebase 공유 저장 완료", "success");
      }
    } catch (error) {
      try {
        updateImportantSharedStatus(`Firebase 저장 실패: ${error.message}`, "error");
      } catch {}
    }
  };

  const setImportantState = (bidNo, next, toastMessage, toastIcon) => {
    if (next && (next.checked || next.issue)) {
      importantIssueStore[bidNo] = next;
    } else {
      delete importantIssueStore[bidNo];
    }

    refreshImportantViews();
    syncImportantKey(bidNo, next);
    notify(toastMessage, toastIcon);
  };

  const patchedToggleChecked = (bidNo) => {
    const current = getImportantState(bidNo);
    const next = {
      ...current,
      checked: !current.checked,
      updatedAt: new Date().toISOString(),
    };

    setImportantState(
      bidNo,
      next,
      next.checked ? "중요 사업 체크 완료" : "중요 사업 체크가 해제되었습니다.",
      next.checked ? "check-circle" : "info"
    );
  };

  const patchedToggleIssue = (bidNo) => {
    const current = getImportantState(bidNo);
    const next = {
      ...current,
      issue: !current.issue,
      updatedAt: new Date().toISOString(),
    };

    setImportantState(
      bidNo,
      next,
      next.issue ? "이슈 검토 사업으로 등록했습니다." : "이슈 검토 표시가 해제되었습니다.",
      next.issue ? "badge-alert" : "info"
    );
  };

  try {
    window.toggleImportantChecked = patchedToggleChecked;
    toggleImportantChecked = patchedToggleChecked;
  } catch {}

  try {
    window.toggleImportantIssue = patchedToggleIssue;
    toggleImportantIssue = patchedToggleIssue;
  } catch {}

  const polishText = () => {
    const sync = document.getElementById("syncStatusText");
    if (sync) sync.textContent = "조달 데이터 동기화";

    document.querySelectorAll("button").forEach((button) => {
      button.classList.add("di-control");
    });

    const admin = document.querySelector("button[onclick=\"switchTab('api-setup')\"] span");
    if (admin) admin.textContent = "관리자 설정";

    if (window.lucide) lucide.createIcons();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", polishText, { once: true });
  } else {
    polishText();
  }

  setTimeout(polishText, 300);
  setTimeout(refreshImportantViews, 600);
})();
