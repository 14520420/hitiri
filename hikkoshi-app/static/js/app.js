/* ===================================================================
   NewLife — フロントエンドロジック
   =================================================================== */

// ── 状態管理 ─────────────────────────────────────────────────────
const state = {
  tasks:      {},       // { category: [task, ...] }
  memos:      [],
  trainInfo:  null,
  activeSection: "dashboard",
  activeCat:  "all",
};

// ── 初期化 ───────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  setupNav();
  updateClock();
  setInterval(updateClock, 1000);

  // データ読み込み
  loadTasks();
  loadMemos();
  fetchTrainInfo();

  // 電車情報は5分ごと自動更新
  setInterval(fetchTrainInfo, 5 * 60 * 1000);

  // チェックリスト構築
  buildChecklist();

  // 引越し日: 今日から1ヶ月後をデフォルトに
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  document.getElementById("globalMoveDate").value = d.toISOString().split("T")[0];

  document.getElementById("initTasksBtn").addEventListener("click", initTasks);
});

// ── ナビゲーション ────────────────────────────────────────────────
function setupNav() {
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const sec = btn.dataset.section;
      switchSection(sec);
    });
  });
}

function switchSection(sec) {
  document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".section").forEach(s => s.classList.remove("active"));

  const navBtn = document.querySelector(`.nav-item[data-section="${sec}"]`);
  if (navBtn) navBtn.classList.add("active");

  const section = document.getElementById(`section-${sec}`);
  if (section) section.classList.add("active");

  state.activeSection = sec;

  const titles = {
    dashboard: "ダッシュボード",
    tasks:     "手続きタスク管理",
    memo:      "生活メモ",
    train:     "電車遅延情報",
    checklist: "引越しチェックリスト",
  };
  document.getElementById("pageTitle").textContent = titles[sec] || sec;

  // セクション別の再描画
  if (sec === "tasks")  renderTasks();
  if (sec === "memo")   renderMemos();
  if (sec === "train")  renderTrainFull();
}

// ── 時計 ─────────────────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const str = now.toLocaleDateString("ja-JP", {month:"long", day:"numeric", weekday:"short"})
            + " " + now.toLocaleTimeString("ja-JP", {hour:"2-digit", minute:"2-digit"});
  document.getElementById("datetimeDisplay").textContent = str;
}

// ── タスク操作 ────────────────────────────────────────────────────
async function loadTasks() {
  try {
    const r = await fetch("/api/tasks");
    const d = await r.json();
    if (d.success) {
      state.tasks = d.tasks || {};
      renderDashboard();
      if (state.activeSection === "tasks") renderTasks();
    }
  } catch (e) {
    console.error("Task load error:", e);
  }
}

async function initTasks() {
  const moveDate = document.getElementById("globalMoveDate").value;
  if (!moveDate) { showToast("引越し予定日を選択してください"); return; }

  const btn = document.getElementById("initTasksBtn");
  btn.textContent = "生成中...";
  btn.disabled = true;

  try {
    const r = await fetch("/api/tasks/init", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ move_date: moveDate }),
    });
    const d = await r.json();
    if (d.success) {
      showToast(`✅ ${d.added}件のタスクを追加しました！`);
      await loadTasks();
    }
  } catch (e) {
    showToast("タスク生成に失敗しました");
  } finally {
    btn.textContent = "タスクを自動生成";
    btn.disabled = false;
  }
}

async function addTask() {
  const title = document.getElementById("newTaskTitle").value.trim();
  if (!title) { showToast("タイトルを入力してください"); return; }

  const body = {
    title:    title,
    category: document.getElementById("newTaskCategory").value,
    deadline: document.getElementById("newTaskDeadline").value,
    priority: document.getElementById("newTaskPriority").value,
    note:     document.getElementById("newTaskNote").value,
  };

  try {
    const r = await fetch("/api/tasks", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    });
    if ((await r.json()).success) {
      closeModal("addTaskModal");
      showToast("✅ タスクを追加しました");
      await loadTasks();
    }
  } catch (e) {
    showToast("追加に失敗しました");
  }
}

async function toggleTask(taskId, category, completed) {
  try {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ completed: !completed }),
    });
    // ローカル状態を即時更新
    const cat = state.tasks[category] || [];
    const t = cat.find(t => t.task_id === taskId);
    if (t) t.completed = !completed;
    renderTasks();
    renderDashboard();
  } catch (e) { showToast("更新失敗"); }
}

async function deleteTask(taskId, category) {
  if (!confirm("このタスクを削除しますか？")) return;
  try {
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    state.tasks[category] = (state.tasks[category] || []).filter(t => t.task_id !== taskId);
    renderTasks();
    renderDashboard();
    showToast("🗑 タスクを削除しました");
  } catch (e) { showToast("削除失敗"); }
}

// ── タスク描画 ────────────────────────────────────────────────────
function renderTasks() {
  const container = document.getElementById("tasksList");
  const cats = Object.keys(state.tasks);

  if (cats.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:60px 20px; color:var(--text3);">
        <p style="font-size:32px;margin-bottom:12px;">📋</p>
        <p>タスクがありません。<br>左下の「タスクを自動生成」ボタンから始めましょう！</p>
      </div>`;
    return;
  }

  // カテゴリフィルターの構築
  const filterBar = document.getElementById("categoryFilters");
  const existing = Array.from(filterBar.querySelectorAll(".filter-tab")).map(b => b.dataset.cat);
  cats.forEach(cat => {
    if (!existing.includes(cat)) {
      const btn = document.createElement("button");
      btn.className = "filter-tab";
      btn.dataset.cat = cat;
      btn.textContent = cat;
      btn.addEventListener("click", () => {
        document.querySelectorAll(".filter-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state.activeCat = cat;
        renderTasks();
      });
      filterBar.appendChild(btn);
    }
  });

  const displayCats = state.activeCat === "all" ? cats : [state.activeCat];
  let html = "";

  displayCats.forEach(cat => {
    const tasks = (state.tasks[cat] || []).sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const prio = { high: 0, medium: 1, low: 2 };
      return (prio[a.priority] || 1) - (prio[b.priority] || 1);
    });

    if (tasks.length === 0) return;

    html += `<div class="category-section">
      <div class="category-title">${cat}</div>
      <div style="display:flex;flex-direction:column;gap:8px;">`;

    tasks.forEach(t => {
      const doneClass  = t.completed ? "done" : "";
      const itemClass  = t.completed ? "completed" : "";
      const prioLabel  = { high: "高", medium: "中", low: "低" }[t.priority] || "中";
      const prioClass  = `badge-${t.priority || "medium"}`;

      let deadlineHtml = "";
      if (t.deadline) {
        const diff = Math.ceil((new Date(t.deadline) - new Date()) / 86400000);
        let cls = "", text = "";
        if (diff < 0)       { cls = "overdue"; text = `${Math.abs(diff)}日超過`; }
        else if (diff === 0){ cls = "soon";    text = "今日が期限"; }
        else if (diff <= 7) { cls = "soon";    text = `あと${diff}日`; }
        else                { cls = "";        text = `${t.deadline}`; }
        deadlineHtml = `<span class="badge-deadline ${cls}">📅 ${text}</span>`;
      }

      html += `
        <div class="task-item ${itemClass}">
          <button class="task-check ${doneClass}"
            onclick="toggleTask('${t.task_id}','${cat}',${!!t.completed})"></button>
          <div class="task-body">
            <div class="task-title">${escHtml(t.title)}</div>
            ${t.note ? `<div class="task-note">${escHtml(t.note)}</div>` : ""}
            <div class="task-meta">
              <span class="badge ${prioClass}">優先度: ${prioLabel}</span>
              ${deadlineHtml}
            </div>
          </div>
          <button class="task-del" onclick="deleteTask('${t.task_id}','${cat}')">✕</button>
        </div>`;
    });

    html += `</div></div>`;
  });

  container.innerHTML = html;
}

// ── ダッシュボード描画 ─────────────────────────────────────────────
function renderDashboard() {
  const allTasks = Object.values(state.tasks).flat();
  const total     = allTasks.length;
  const completed = allTasks.filter(t => t.completed).length;
  const pct       = total ? (completed / total) * 100 : 0;

  document.getElementById("completedCount").textContent = completed;
  document.getElementById("totalCount").textContent     = total;

  const ring = document.getElementById("progressRing");
  const circ = 314;
  ring.style.strokeDashoffset = circ - (circ * pct / 100);
  ring.style.stroke = pct < 30 ? "#ff6b6b" : pct < 70 ? "#f6c90e" : "#3dd68c";

  const pctLabel = total ? `${Math.round(pct)}% 完了` : "タスクを追加してください";
  document.getElementById("progressLabel").textContent = pctLabel;

  // 期限が近いタスク (未完了のみ、期限7日以内)
  const upcoming = allTasks
    .filter(t => !t.completed && t.deadline)
    .map(t => ({ ...t, diff: Math.ceil((new Date(t.deadline) - new Date()) / 86400000) }))
    .filter(t => t.diff <= 7)
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 5);

  const upcomingEl = document.getElementById("upcomingTasks");
  if (upcoming.length === 0) {
    upcomingEl.innerHTML = `<p style="font-size:12px;color:var(--text3);">期限が近いタスクはありません</p>`;
  } else {
    upcomingEl.innerHTML = upcoming.map(t => {
      const cls = t.diff < 0 ? "overdue" : t.diff <= 3 ? "soon" : "";
      const label = t.diff < 0 ? `${Math.abs(t.diff)}日超過` : t.diff === 0 ? "今日" : `あと${t.diff}日`;
      return `<div class="upcoming-item ${cls}">
        <div class="upcoming-item-title">${escHtml(t.title)}</div>
        <div class="upcoming-item-date">📅 ${label}</div>
      </div>`;
    }).join("");
  }
}

// ── メモ操作 ─────────────────────────────────────────────────────
async function loadMemos() {
  try {
    const r = await fetch("/api/memos");
    const d = await r.json();
    if (d.success) {
      state.memos = d.memos;
      renderBudgetSummary();
      if (state.activeSection === "memo") renderMemos();
    }
  } catch(e) { console.error(e); }
}

async function addMemo() {
  const title   = document.getElementById("memoTitle").value.trim();
  if (!title) { showToast("タイトルを入力してください"); return; }

  const body = {
    type:    document.getElementById("memoType").value,
    title,
    amount:  document.getElementById("memoAmount").value,
    content: document.getElementById("memoContent").value,
  };

  try {
    const r = await fetch("/api/memos", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body),
    });
    if ((await r.json()).success) {
      ["memoTitle","memoAmount","memoContent"].forEach(id => document.getElementById(id).value = "");
      showToast("✅ メモを保存しました");
      await loadMemos();
    }
  } catch(e) { showToast("保存失敗"); }
}

async function deleteMemo(memoId) {
  try {
    await fetch(`/api/memos/${memoId}`, { method: "DELETE" });
    state.memos = state.memos.filter(m => m.memo_id !== memoId);
    renderMemos();
    renderBudgetSummary();
    showToast("🗑 メモを削除しました");
  } catch(e) { showToast("削除失敗"); }
}

function renderMemos() {
  const container = document.getElementById("memosList");
  if (state.memos.length === 0) {
    container.innerHTML = `<div style="color:var(--text3);font-size:13px;padding:20px;">メモがありません</div>`;
    return;
  }

  const typeLabel = { expense:"支出", contact:"連絡先", important:"重要", general:"一般" };
  container.innerHTML = state.memos.map(m => `
    <div class="memo-item">
      <div class="memo-body">
        <span class="memo-type-badge type-${m.type}">${typeLabel[m.type] || m.type}</span>
        <div class="memo-title">${escHtml(m.title)}</div>
        ${m.amount ? `<div class="memo-amount">¥${Number(m.amount).toLocaleString()}</div>` : ""}
        ${m.content ? `<div class="memo-content">${escHtml(m.content)}</div>` : ""}
      </div>
      <button class="task-del" onclick="deleteMemo('${m.memo_id}')">✕</button>
    </div>
  `).join("");
}

function renderBudgetSummary() {
  const el = document.getElementById("budgetSummary");
  const expenses = state.memos.filter(m => m.type === "expense" && m.amount);
  if (expenses.length === 0) {
    el.innerHTML = `<p style="font-size:12px;color:var(--text3);">支出メモを追加してください</p>`;
    return;
  }
  const total = expenses.reduce((s, m) => s + Number(m.amount || 0), 0);
  const rows  = expenses.slice(0, 4).map(m => `
    <div class="budget-row">
      <span>${escHtml(m.title)}</span>
      <span class="budget-amount">¥${Number(m.amount).toLocaleString()}</span>
    </div>`).join("");
  const more = expenses.length > 4 ? `<div style="font-size:11px;color:var(--text3);margin-top:4px;">他${expenses.length-4}件...</div>` : "";
  el.innerHTML = rows + more + `
    <div class="budget-total">
      <span>合計</span>
      <span class="budget-amount">¥${total.toLocaleString()}</span>
    </div>`;
}

// ── 電車遅延情報 ──────────────────────────────────────────────────
async function fetchTrainInfo() {
  // バッジをローディング状態に
  document.querySelector("#trainBadgeTop .badge-dot").className = "badge-dot loading";
  document.getElementById("trainBadgeText").textContent = "取得中...";

  try {
    const r = await fetch("/api/train-delay");
    const d = await r.json();
    state.trainInfo = d;

    // トップバッジ更新
    const dot  = document.querySelector("#trainBadgeTop .badge-dot");
    const text = document.getElementById("trainBadgeText");
    if (d.all_normal) {
      dot.className  = "badge-dot normal";
      text.textContent = "全線正常運行";
    } else if (d.delays && d.delays.length > 0) {
      dot.className  = "badge-dot delay";
      text.textContent = `${d.delays.length}路線が遅延中`;
    } else if (d.error) {
      dot.className  = "badge-dot loading";
      text.textContent = "情報取得エラー";
    }

    renderTrainDash();
    renderTrainFull();
  } catch(e) {
    document.querySelector("#trainBadgeTop .badge-dot").className = "badge-dot loading";
    document.getElementById("trainBadgeText").textContent = "取得失敗";
  }
}

function renderTrainDash() {
  const el = document.getElementById("dashTrainContent");
  const src = document.getElementById("trainSourceDash");
  const d   = state.trainInfo;
  if (!d) return;

  if (d.error) {
    el.innerHTML = `<div style="color:var(--text3);font-size:13px;">⚠ 情報取得失敗: バックエンドへの接続を確認してください</div>`;
    return;
  }

  if (d.all_normal || (d.delays && d.delays.length === 0)) {
    el.innerHTML = `<div class="dash-all-normal">✅ 全路線正常運行中</div>`;
  } else {
    el.innerHTML = d.delays.slice(0, 5).map(dl => `
      <div class="dash-delay-item">
        <span class="dash-delay-name">${escHtml(dl.line)}</span>
        <span class="dash-delay-status">${escHtml(dl.status)}</span>
      </div>`).join("") +
      (d.delays.length > 5 ? `<div style="font-size:11px;color:var(--text3);margin-top:6px;">他${d.delays.length-5}路線...</div>` : "");
  }
  src.textContent = d.fetched_at ? `取得時刻: ${d.fetched_at} — ${d.source}` : "";
}

function renderTrainFull() {
  const el = document.getElementById("trainDelayContent");
  const d  = state.trainInfo;
  if (!d) { el.innerHTML = `<div class="loading-pulse">データを取得中...</div>`; return; }

  let html = "";

  if (d.error) {
    html = `
      <div class="delay-status-banner has-delay">
        <span class="delay-icon">⚠️</span>
        <div class="delay-msg">
          <h3>情報取得エラー</h3>
          <p>${escHtml(d.error)}</p>
          <p style="margin-top:4px;font-size:12px;">バックエンドが起動していることを確認してください</p>
        </div>
      </div>`;
  } else if (d.all_normal || (d.delays && d.delays.length === 0)) {
    html = `
      <div class="delay-status-banner normal">
        <span class="delay-icon">✅</span>
        <div class="delay-msg">
          <h3>全路線正常運行中</h3>
          <p>${d.area || "関東エリア"} — 現在遅延・運休はございません</p>
        </div>
      </div>`;
  } else {
    html = `
      <div class="delay-status-banner has-delay">
        <span class="delay-icon">🚨</span>
        <div class="delay-msg">
          <h3>${d.delays.length}路線で遅延・運休が発生中</h3>
          <p>最新情報は各鉄道会社の公式サイトでもご確認ください</p>
        </div>
      </div>
      <div class="delay-lines">
        ${d.delays.map(dl => `
          <div class="delay-line-item">
            <span class="delay-line-name">🚆 ${escHtml(dl.line)}</span>
            <span class="delay-line-status">${escHtml(dl.status)}</span>
          </div>`).join("")}
      </div>`;
  }

  html += `<div class="train-timestamp">
    データ取得元: ${d.source || "Yahoo!路線情報"} / 取得時刻: ${d.fetched_at || "不明"}
  </div>`;

  el.innerHTML = html;
}

// ── チェックリスト ────────────────────────────────────────────────
const CHECKLIST_DATA = {
  "📋 引越し前（2ヶ月〜）": [
    "引越し業者の選定・相見積もり",
    "インターネット回線の申込（1〜2ヶ月前）",
    "不用品の整理・処分",
    "新居の下見・採寸",
    "家具・家電の購入計画",
  ],
  "📦 引越し前（1ヶ月〜1週間）": [
    "荷造り開始（本・衣類・小物）",
    "郵便局の転居届提出",
    "ライフライン（電気・ガス・水道）開始申込",
    "旧居のライフライン解約連絡",
    "銀行・クレジットカード住所変更",
  ],
  "🏠 引越し当日": [
    "旧居の最終確認・傷チェック（写真撮影）",
    "新居の傷・汚れチェック（写真撮影）",
    "家具・家電の搬入・設置",
    "電気・ガス・水道の開通確認",
    "鍵の受け渡し確認",
  ],
  "✅ 引越し後（2週間以内）": [
    "住民票の異動届（14日以内）",
    "マイナンバーカードの住所変更",
    "運転免許証の住所変更",
    "国民健康保険・年金の住所変更",
    "近隣への挨拶",
    "ゴミ出しルールの確認",
    "家賃引き落とし口座設定",
  ],
  "💼 仕事・社会人手続き": [
    "職場への新住所届出",
    "通勤経路・定期券の手配",
    "スーツ・仕事用品の準備",
    "生活費管理アプリの設定",
    "緊急連絡先リストの作成",
  ],
};

function buildChecklist() {
  const container = document.getElementById("checklistContent");
  const stored = JSON.parse(localStorage.getItem("checklist") || "{}");

  container.innerHTML = Object.entries(CHECKLIST_DATA).map(([cat, items]) => `
    <div class="checklist-cat">
      <div class="checklist-cat-title">${cat}</div>
      ${items.map((item, i) => {
        const key  = `${cat}__${i}`;
        const done = !!stored[key];
        return `<div class="checklist-item ${done ? "checked" : ""}" id="cli_${btoa(key).replace(/=/g,"")}">
          <input type="checkbox" id="chk_${i}_${cat.length}" ${done ? "checked" : ""}
            onchange="toggleChecklist(this, '${key}')">
          <label for="chk_${i}_${cat.length}">${escHtml(item)}</label>
        </div>`;
      }).join("")}
    </div>`).join("");
}

function toggleChecklist(cb, key) {
  const stored = JSON.parse(localStorage.getItem("checklist") || "{}");
  stored[key] = cb.checked;
  localStorage.setItem("checklist", JSON.stringify(stored));
  cb.closest(".checklist-item").classList.toggle("checked", cb.checked);
}

// ── モーダル ─────────────────────────────────────────────────────
function openAddTask() {
  document.getElementById("addTaskModal").classList.add("show");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("show");
}

// ── ユーティリティ ────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

let toastTimer;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3000);
}
