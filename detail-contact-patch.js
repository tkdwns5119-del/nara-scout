(() => {
  const addStyle = css => { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); };
  addStyle('header>div.max-w-7xl,main.max-w-7xl,main.flex-grow.max-w-7xl{width:100%!important;max-width:none!important;margin-left:0!important;margin-right:0!important}header>div.max-w-7xl,main.max-w-7xl,main.flex-grow.max-w-7xl{padding-left:1rem!important;padding-right:1rem!important}');

  const v = x => x == null || String(x).trim() === '' ? '-' : String(x).trim();
  const pick = (o, keys) => {
    for (const k of keys) { const val = o?.[k]; if (val != null && String(val).trim()) return String(val).trim(); }
    const d = o?.detailInfo || o?.detail || o?.raw || {};
    for (const k of keys) { const val = d?.[k]; if (val != null && String(val).trim()) return String(val).trim(); }
    return '';
  };
  const originalContact = (fn, item) => {
    try {
      const f = window?.[fn];
      const value = typeof f === 'function' ? f(item) : '';
      return value != null && String(value).trim() ? String(value).trim() : '';
    } catch {
      return '';
    }
  };
  const nameOf = i => originalContact('getContactName', i) || pick(i, ['ntceInsttOfclNm','bidNtceChargerNm','bidNtceChgrNm','ntceInsttChargerNm','dminsttOfclNm','dminsttChargerNm','prcrmntReqstdocRcptChargerNm','ofclNm','chargerNm','contactName','managerName','officerName','담당자명','담당자']);
  const telOf = i => originalContact('getContactTel', i) || pick(i, ['ntceInsttOfclTelNo','bidNtceChargerTelNo','bidNtceChgrTelNo','ntceInsttChargerTelNo','dminsttOfclTelNo','dminsttChargerTelNo','prcrmntReqstdocRcptChargerTelNo','ofclTelNo','chargerTelNo','telNo','contactTel','managerTel','officerTel','phone','telephone','담당자전화번호','전화번호']);
  const emailOf = i => originalContact('getContactEmail', i) || pick(i, ['ntceInsttOfclEmailAdres','ntceInsttOfclEmailAdrs','ntceInsttOfclEmailAddr','bidNtceChargerEmailAdres','bidNtceChgrEmailAdres','dminsttOfclEmailAdres','ofclEmailAdres','chargerEmail','officerEmail','contactEmail','managerEmail','email','담당자이메일']);
  const deptOf = i => originalContact('getContactDept', i) || pick(i, ['ntceInsttOfclDeptNm','bidNtceChargerDeptNm','bidNtceChgrDeptNm','dminsttOfclDeptNm','ofclDeptNm','chargerDeptNm','deptNm','department','contactDept','managerDept','officerDept','담당부서']);
  const money = x => { try { return formatKoreanCurrency(Number(x) || 0); } catch { return (Number(x) || 0).toLocaleString('ko-KR') + '원'; } };
  const card = (l, val, sub = '') => `<div class="bg-slate-50 border border-slate-200 rounded-xl p-3"><div class="text-[10px] text-slate-400 font-semibold mb-1">${l}</div><div class="text-xs sm:text-sm font-bold text-slate-800 break-words">${v(val)}</div>${sub ? `<div class="text-[10px] text-slate-400 mt-1">${sub}</div>` : ''}</div>`;
  const method = i => { try { return getContractMethodLabel(i); } catch { return i.contractMethod || i.contractMethodRaw || '계약방법 미확인'; } };
  const status = i => { try { const s = getImportantState(i.bidNtceNo), a = []; if (s.checked) a.push('체크 사업'); if (s.issue) a.push('이슈 검토'); return a.length ? a.join(' / ') : '미검토'; } catch { return '미검토'; } };
  const dday = x => { const d = new Date(String(x || '').slice(0, 10)); if (isNaN(d)) return '일정 미확인'; const t = new Date(); t.setHours(0,0,0,0); const n = Math.ceil((d - t) / 86400000); return n > 0 ? 'D-' + n : n === 0 ? 'D-DAY' : '마감 ' + Math.abs(n) + '일 경과'; };
  const band = n => { n = Number(n) || 0; return n >= 5e8 ? '5억 이상 / 대형' : n >= 2e8 ? '2억~5억 / 중대형' : n >= 5e7 ? '5천만~2억 / 일반' : n > 0 ? '5천만 이하 / 소형' : '예산 미확인'; };
  const level = i => { const n = Number(i.assignBudgetAmt) || 0, m = method(i); if (i.serviceType === '사전규격') return '사전검토 우선'; if (n >= 2e8) return '중점 검토'; if (m.includes('수의')) return '빠른 확인'; return '일반 검토'; };

  async function fixImportantFirebase() {
    if (typeof loadExternalScriptOnce !== 'function' || typeof updateImportantSharedStatus !== 'function') return;
    try {
      const res = await fetch('./data/workflow-config.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const cfg = await res.json();
      if (cfg.provider !== 'firebase') return;
      const firebaseConfig = { ...(cfg.firebaseConfig || {}) };
      if (!firebaseConfig.apiKey && Array.isArray(firebaseConfig.apiKeyParts)) firebaseConfig.apiKey = firebaseConfig.apiKeyParts.join('');
      delete firebaseConfig.apiKeyParts;
      if (!firebaseConfig.apiKey) return;
      await loadExternalScriptOnce('https://www.gstatic.com/firebasejs/8.10.1/firebase-app.js');
      await loadExternalScriptOnce('https://www.gstatic.com/firebasejs/8.10.1/firebase-database.js');
      let app; try { app = firebase.app('di-important-issue-store'); } catch { app = firebase.initializeApp(firebaseConfig, 'di-important-issue-store'); }
      const ref = firebase.database(app).ref(cfg.issuePath || 'importantIssues');
      window.importantIssueFirebaseRef = ref;
      window.importantIssueSharedReady = true;
      const applyRemoteStore = remote => {
        const nextStore = remote && typeof remote === 'object' ? remote : {};
        window.importantIssueStore = nextStore;
        try { importantIssueStore = nextStore; } catch {}
        if (typeof saveImportantIssueStore === 'function') saveImportantIssueStore({ skipShared: true });
        try { if (typeof updateImportantIssueSummary === 'function') updateImportantIssueSummary(); } catch {}
        try { renderBidsTable(); } catch {}
        try { renderImportantIssueBids(); } catch {}
      };
      const snap = await ref.once('value');
      applyRemoteStore(snap.val());
      ref.on('value', s => { try { applyRemoteStore(s.val()); updateImportantSharedStatus('Firebase 공유 저장 동기화 완료', 'success'); } catch {} });
      updateImportantSharedStatus('Firebase 공유 저장 연결 완료 — 다른 사용자와 체크/이슈 상태가 공유됩니다.', 'success');
    } catch (e) { try { updateImportantSharedStatus('Firebase 공유 저장 연결 실패: ' + e.message, 'error'); } catch {} }
  }

  const shell = () => {
    const m = document.getElementById('aiAssistantModal');
    if (!m) return null;
    m.innerHTML = `<div class="bg-white rounded-3xl max-w-7xl w-full max-h-[92vh] overflow-hidden flex flex-col shadow-2xl border border-slate-200 animate-fade-in"><div class="p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50"><div class="flex items-center space-x-2.5"><span class="p-2 bg-cyan-100 text-cyber-cyan rounded-xl"><i data-lucide="file-search" class="w-5 h-5 text-cyber-cyan"></i></span><div><h3 class="font-extrabold text-slate-900 text-sm sm:text-base">사업 기본 상세정보</h3><p class="text-[10px] sm:text-xs text-slate-500">나라장터 수집 데이터 기준 상세 화면</p></div></div><button onclick="closeAiAssistant()" class="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><i data-lucide="x" class="w-5 h-5"></i></button></div><div class="flex-grow p-5 sm:p-6 overflow-y-auto space-y-5"><div class="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-4"><div class="flex flex-wrap items-center justify-between gap-2"><div class="flex flex-wrap items-center gap-2"><span id="d-type" class="px-2.5 py-0.5 rounded-full text-[10px] font-bold border"></span><span id="d-status" class="px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-200"></span><span id="d-level" class="px-2.5 py-0.5 rounded-full text-[10px] font-bold border bg-slate-50 text-slate-700 border-slate-200"></span></div><span id="d-no" class="text-[10px] text-slate-400 font-mono"></span></div><h4 id="d-title" class="font-extrabold text-slate-900 text-base sm:text-xl leading-snug"></h4><div id="d-basic" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3"></div></div><div class="grid grid-cols-1 xl:grid-cols-3 gap-4"><div class="xl:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden"><div class="p-4 border-b border-slate-100 bg-slate-50 font-bold text-sm text-slate-900">상세 항목</div><div id="d-detail" class="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3"></div></div><div class="space-y-4"><div class="bg-white border border-slate-200 rounded-2xl overflow-hidden"><div class="p-4 border-b border-slate-100 bg-slate-50 font-bold text-sm text-slate-900">검토용 요약</div><div id="d-summary" class="p-4 text-xs sm:text-sm text-slate-700 leading-relaxed whitespace-pre-line"></div></div><button id="d-link" class="w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5"><i data-lucide="external-link" class="w-4 h-4"></i><span>나라장터 원본공고 이동</span></button><button id="d-copy" class="w-full py-3 rounded-xl bg-cyan-50 hover:bg-cyan-100 border border-cyan-200 text-cyber-cyan text-xs font-bold flex items-center justify-center gap-1.5"><i data-lucide="copy" class="w-4 h-4"></i><span>검토 요약 복사</span></button></div></div></div></div>`;
    return m;
  };

  const show = no => {
    const i = (window.activeBids || activeBids || []).find(x => x.bidNtceNo === no);
    if (!i) return false;
    const m = shell(); if (!m) return false;
    const t = i.serviceType || '-', nm = nameOf(i) || '담당자명 미확인', tel = telOf(i) || '전화번호 미확인', em = emailOf(i), dp = deptOf(i), b = money(i.assignBudgetAmt), bd = band(i.assignBudgetAmt), st = status(i), lv = level(i), cl = t === '공고' ? '마감일' : t === '사전규격' ? '의견종료' : '예정월';
    const summary = ['[사업 검토 요약]','- 사업명: ' + v(i.bidNtceNm),'- 유형/번호: ' + t + ' / ' + v(i.bidNtceNo),'- 담당자: ' + nm,'- 담당자 전화번호: ' + tel, dp ? '- 담당부서: ' + dp : null, em ? '- 담당자 이메일: ' + em : null, '- 계약방법: ' + method(i), '- 공고기관: ' + v(i.ntceInsttNm), '- 수요기관: ' + v(i.dminsttNm), '- 지역: ' + v(i.region), '- 예산: ' + b + ' (' + bd + ')', '- ' + cl + ': ' + v(i.bidClseDt) + ' / ' + dday(i.bidClseDt), '- 검토상태: ' + st, '- 검토우선도: ' + lv].filter(Boolean).join('\n');
    document.getElementById('d-type').innerText = t; document.getElementById('d-type').className = 'px-2.5 py-0.5 rounded-full text-[10px] font-bold border ' + (t === '사전규격' ? 'border-fuchsia-200 bg-fuchsia-50 text-cyber-fuchsia' : t === '발주계획' ? 'border-amber-200 bg-amber-50 text-cyber-amber' : 'border-cyan-200 bg-cyan-50 text-cyber-cyan');
    document.getElementById('d-status').innerText = st; document.getElementById('d-level').innerText = lv; document.getElementById('d-no').innerText = v(i.bidNtceNo); document.getElementById('d-title').innerText = v(i.bidNtceNm);
    document.getElementById('d-basic').innerHTML = card('공고기관', i.ntceInsttNm) + card('수요기관', i.dminsttNm) + card('담당자', nm, dp) + card('담당자 전화번호', tel, em) + card('배정 예산', b, bd) + card('마감 상태', dday(i.bidClseDt), cl);
    document.getElementById('d-detail').innerHTML = card('사업 유형', t) + card('공고 번호', i.bidNtceNo) + card('계약방법', method(i)) + card('공고기관', i.ntceInsttNm) + card('수요기관', i.dminsttNm) + card('지역', i.region) + card('담당자명', nm, dp) + card('담당자 전화번호', tel, em) + card('담당부서', dp || '-') + card('담당자 이메일', em || '-') + card('예산 구간', bd, b) + card('마감/예정', i.bidClseDt, cl + ' / ' + dday(i.bidClseDt)) + card('검토 상태', st) + card('검토 우선도', lv) + card('수집 키워드', i.searchKeyword) + card('원본 URL', i.g2bUrl || 'https://www.g2b.go.kr');
    document.getElementById('d-summary').innerText = summary; document.getElementById('d-link').onclick = () => openBidLink(i.g2bUrl || 'https://www.g2b.go.kr'); document.getElementById('d-copy').onclick = () => { navigator.clipboard.writeText(summary); try { showToast('검토 요약을 복사했습니다.', 'copy'); } catch {} };
    m.classList.remove('hidden'); if (window.lucide) lucide.createIcons();
    return true;
  };

  const originalOpenBidDetail = window.openBidDetail || (typeof openBidDetail === 'function' && openBidDetail);
  const originalOpenAiAssistant = window.openAiAssistant || (typeof openAiAssistant === 'function' && openAiAssistant);
  const openPatchedDetail = (bidNo) => {
    if (show(bidNo)) return true;
    const fallback = originalOpenBidDetail || originalOpenAiAssistant;
    if (typeof fallback === 'function' && fallback !== openPatchedDetail) {
      fallback(bidNo);
      return true;
    }
    return false;
  };
  const deco = () => { document.querySelectorAll('button[onclick*="openAiAssistant"],button[onclick*="openBidDetail"]').forEach(b => { b.title = '상세보기'; b.innerHTML = '<i data-lucide="file-search" class="w-3.5 h-3.5"></i>'; }); if (window.lucide) lucide.createIcons(); };
  document.addEventListener('click', event => {
    const trigger = event.target.closest('[onclick*="openAiAssistant"],[onclick*="openBidDetail"]');
    if (!trigger) return;
    const onclick = trigger.getAttribute('onclick') || '';
    const match = onclick.match(/open(?:AiAssistant|BidDetail)\('([^']+)'\)/);
    if (!match) return;
    if (show(match[1])) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  window.openBidDetailPatched = show;
  window.openAiAssistantPatched = show;
  window.openBidDetail = openPatchedDetail;
  window.openAiAssistant = openPatchedDetail;
  try { openBidDetail = openPatchedDetail; } catch {}
  try { openAiAssistant = openPatchedDetail; } catch {}
  const old = window.renderBidsTable || (typeof renderBidsTable === 'function' && renderBidsTable); if (typeof old === 'function' && !old.__patchedDetail) { const p = x => { old(x); setTimeout(deco, 0); }; p.__patchedDetail = true; window.renderBidsTable = p; try { renderBidsTable = p; } catch {} }
  setTimeout(deco, 200); setInterval(deco, 2000); setTimeout(fixImportantFirebase, 800);
})();
