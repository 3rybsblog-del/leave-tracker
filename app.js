const STORAGE_KEY = "leave-tracker-v1";
const INITIAL_STATE = {
  asOf: "2026-05-19",
  base: {
    paid: 12,
    refresh: 3,
  },
  usages: [],
};
let fallbackStateJson = "";

const leaveConfig = {
  paid: {
    label: "有給",
    grantMonth: 10,
    grantDay: 1,
    grantAmount: 20,
  },
  refresh: {
    label: "リフレッシュ休暇",
    grantMonth: 4,
    grantDay: 1,
    grantAmount: 3,
  },
};

const els = {
  paidRemaining: document.querySelector("#paidRemaining"),
  refreshRemaining: document.querySelector("#refreshRemaining"),
  todayText: document.querySelector("#todayText"),
  nextGrantText: document.querySelector("#nextGrantText"),
  form: document.querySelector("#usageForm"),
  leaveType: document.querySelector("#leaveType"),
  usageDate: document.querySelector("#usageDate"),
  amount: document.querySelector("#amount"),
  historyList: document.querySelector("#historyList"),
  resetButton: document.querySelector("#resetButton"),
  resetDialog: document.querySelector("#resetDialog"),
  confirmReset: document.querySelector("#confirmReset"),
};

const today = new Date();
const todayIso = toIsoDate(today);
let state = loadState();

els.usageDate.value = todayIso;
els.todayText.textContent = `今日: ${formatDate(todayIso)}`;
restoreUsageFromUrl();

document.querySelectorAll("[data-amount]").forEach((button) => {
  button.addEventListener("click", () => {
    els.amount.value = button.dataset.amount;
  });
});

document.querySelectorAll("[data-step]").forEach((button) => {
  button.addEventListener("click", () => {
    const current = Number(els.amount.value || 0);
    const next = Math.max(0.5, current + Number(button.dataset.step));
    els.amount.value = Number(next.toFixed(1));
  });
});

els.form.addEventListener("submit", (event) => {
  event.preventDefault();

  addUsage(els.leaveType.value, Number(els.amount.value), els.usageDate.value);
});

els.historyList.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-delete]");
  if (!button) return;

  state.usages = state.usages.filter((usage) => usage.id !== button.dataset.delete);
  saveState();
  render();
});

els.resetButton.addEventListener("click", () => {
  els.resetDialog.showModal();
});

els.confirmReset.addEventListener("click", () => {
  state = cloneInitialState();
  saveState();
  render();
});

render();
registerServiceWorker();

function render() {
  const balances = calculateBalances();
  els.paidRemaining.textContent = formatAmount(balances.paid);
  els.refreshRemaining.textContent = formatAmount(balances.refresh);
  els.nextGrantText.textContent = nextGrantLabel();
  renderHistory();
}

function renderHistory() {
  const sorted = [...state.usages].sort((a, b) => {
    if (a.date === b.date) return b.createdAt.localeCompare(a.createdAt);
    return b.date.localeCompare(a.date);
  });

  if (sorted.length === 0) {
    els.historyList.innerHTML = `<li class="empty">まだ利用履歴はありません。</li>`;
    return;
  }

  els.historyList.innerHTML = sorted
    .map((usage) => {
      const label = leaveConfig[usage.type].label;
      return `
        <li class="history-item">
          <div>
            <strong>${escapeHtml(label)} ${formatAmount(usage.amount)}日</strong>
            <span>${formatDate(usage.date)}</span>
          </div>
          <button type="button" data-delete="${usage.id}" aria-label="削除">×</button>
        </li>
      `;
    })
    .join("");
}

function addUsage(type, amount, date) {
  const balances = calculateBalances();

  if (!leaveConfig[type] || !date || !amount || amount < 0.5) return false;

  if (amount > balances[type]) {
    alert(`${leaveConfig[type].label}の残り日数を超えています。`);
    return false;
  }

  state.usages.push({
    id: createId(),
    type,
    amount,
    date,
    createdAt: new Date().toISOString(),
  });

  saveState();
  els.amount.value = 1;
  render();
  return true;
}

function calculateBalances(targetDate = today) {
  const balances = { ...state.base };

  Object.entries(leaveConfig).forEach(([type, config]) => {
    balances[type] = grantAdjustedBalance(type, config, targetDate);
  });

  state.usages.forEach((usage) => {
    balances[usage.type] -= usage.amount;
  });

  return balances;
}

function grantAdjustedBalance(type, config, targetDate) {
  let balance = state.base[type];
  let year = new Date(`${state.asOf}T00:00:00`).getFullYear();
  const endYear = targetDate.getFullYear();

  while (year <= endYear) {
    const grantDate = new Date(year, config.grantMonth - 1, config.grantDay);
    if (grantDate > new Date(`${state.asOf}T00:00:00`) && grantDate <= endOfDay(targetDate)) {
      balance += config.grantAmount;
    }
    year += 1;
  }

  return balance;
}

function nextGrantLabel() {
  const nextDates = Object.values(leaveConfig)
    .map((config) => {
      let date = new Date(today.getFullYear(), config.grantMonth - 1, config.grantDay);
      if (date < startOfDay(today)) {
        date = new Date(today.getFullYear() + 1, config.grantMonth - 1, config.grantDay);
      }
      return `${config.label}: ${formatDate(toIsoDate(date))}`;
    })
    .join(" / ");

  return `次の付与 ${nextDates}`;
}

function loadState() {
  const raw = readSavedState();
  if (!raw) return cloneInitialState();

  try {
    const parsed = JSON.parse(raw);
    return {
      ...cloneInitialState(),
      ...parsed,
      base: { ...INITIAL_STATE.base, ...parsed.base },
      usages: Array.isArray(parsed.usages) ? parsed.usages : [],
    };
  } catch {
    return cloneInitialState();
  }
}

function saveState() {
  const json = JSON.stringify(state);
  fallbackStateJson = json;

  try {
    localStorage.setItem(STORAGE_KEY, json);
  } catch {
    // File previews can block localStorage. The app still works for the open tab.
  }
}

function readSavedState() {
  try {
    return localStorage.getItem(STORAGE_KEY) || fallbackStateJson;
  } catch {
    return fallbackStateJson;
  }
}

function restoreUsageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const type = params.get("leaveType");
  const date = params.get("usageDate");
  const amount = Number(params.get("amount"));

  if (!type || !date || !amount) return;

  els.leaveType.value = type;
  els.usageDate.value = date;
  els.amount.value = amount;

  const alreadyRestored = state.usages.some((usage) => {
    return usage.type === type && usage.date === date && usage.amount === amount;
  });

  if (alreadyRestored) {
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  if (addUsage(type, amount, date)) {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}

function cloneInitialState() {
  return JSON.parse(JSON.stringify(INITIAL_STATE));
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatAmount(amount) {
  return Number(amount.toFixed(1)).toLocaleString("ja-JP", {
    minimumFractionDigits: amount % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  if (window.location.protocol === "file:") return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch(() => {});
  });
}
