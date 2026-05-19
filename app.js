const STORAGE_KEY = "leave-tracker-v1";
const DEFAULT_SETTINGS = {
  asOf: "2026-05-19",
  base: {
    paid: 12,
    refresh: 3,
  },
  grants: {
    paid: {
      month: 10,
      day: 1,
      amount: 20,
    },
    refresh: {
      month: 4,
      day: 1,
      amount: 3,
    },
  },
};
const INITIAL_STATE = {
  configured: false,
  settings: DEFAULT_SETTINGS,
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
  paidGrantText: document.querySelector("#paidGrantText"),
  refreshGrantText: document.querySelector("#refreshGrantText"),
  todayText: document.querySelector("#todayText"),
  nextGrantText: document.querySelector("#nextGrantText"),
  form: document.querySelector("#usageForm"),
  leaveType: document.querySelector("#leaveType"),
  usageDate: document.querySelector("#usageDate"),
  amount: document.querySelector("#amount"),
  historyList: document.querySelector("#historyList"),
  settingsButton: document.querySelector("#settingsButton"),
  resetButton: document.querySelector("#resetButton"),
  resetDialog: document.querySelector("#resetDialog"),
  confirmReset: document.querySelector("#confirmReset"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  settingsCancel: document.querySelector("#settingsCancel"),
  settingsAsOf: document.querySelector("#settingsAsOf"),
  settingsPaidBase: document.querySelector("#settingsPaidBase"),
  settingsPaidGrantMonth: document.querySelector("#settingsPaidGrantMonth"),
  settingsPaidGrantDay: document.querySelector("#settingsPaidGrantDay"),
  settingsPaidGrantAmount: document.querySelector("#settingsPaidGrantAmount"),
  settingsRefreshBase: document.querySelector("#settingsRefreshBase"),
  settingsRefreshGrantMonth: document.querySelector("#settingsRefreshGrantMonth"),
  settingsRefreshGrantDay: document.querySelector("#settingsRefreshGrantDay"),
  settingsRefreshGrantAmount: document.querySelector("#settingsRefreshGrantAmount"),
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

els.settingsButton.addEventListener("click", () => {
  openSettingsDialog(false);
});

els.resetButton.addEventListener("click", () => {
  els.resetDialog.showModal();
});

els.confirmReset.addEventListener("click", () => {
  state = cloneInitialState();
  saveState();
  openSettingsDialog(true);
  render();
});

els.settingsCancel.addEventListener("click", () => {
  if (state.configured) els.settingsDialog.close();
});

els.settingsDialog.addEventListener("cancel", (event) => {
  if (!state.configured) event.preventDefault();
});

els.settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  saveSettingsFromForm();
  els.settingsDialog.close();
});

render();
if (!state.configured) openSettingsDialog(true);
registerServiceWorker();

function render() {
  const balances = calculateBalances();
  els.paidRemaining.textContent = formatAmount(balances.paid);
  els.refreshRemaining.textContent = formatAmount(balances.refresh);
  els.paidGrantText.textContent = grantText("paid");
  els.refreshGrantText.textContent = grantText("refresh");
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
  const balances = { ...state.settings.base };

  Object.entries(leaveConfig).forEach(([type, config]) => {
    balances[type] = grantAdjustedBalance(type, config, targetDate);
  });

  state.usages.forEach((usage) => {
    balances[usage.type] -= usage.amount;
  });

  return balances;
}

function grantAdjustedBalance(type, config, targetDate) {
  const settings = state.settings;
  const grant = settings.grants[type];
  let balance = settings.base[type];
  let year = new Date(`${settings.asOf}T00:00:00`).getFullYear();
  const endYear = targetDate.getFullYear();

  while (year <= endYear) {
    const grantDate = new Date(year, grant.month - 1, grant.day);
    if (grantDate > new Date(`${settings.asOf}T00:00:00`) && grantDate <= endOfDay(targetDate)) {
      balance += grant.amount;
    }
    year += 1;
  }

  return balance;
}

function nextGrantLabel() {
  const nextDates = Object.entries(leaveConfig)
    .map(([type, config]) => {
      const grant = state.settings.grants[type];
      let date = new Date(today.getFullYear(), grant.month - 1, grant.day);
      if (date < startOfDay(today)) {
        date = new Date(today.getFullYear() + 1, grant.month - 1, grant.day);
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
    const settings = normalizeSettings(parsed.settings || parsed);
    return {
      ...cloneInitialState(),
      ...parsed,
      configured: parsed.configured ?? Boolean(raw),
      settings,
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

function normalizeSettings(settings) {
  return {
    asOf: settings.asOf || DEFAULT_SETTINGS.asOf,
    base: {
      paid: Number(settings.base?.paid ?? DEFAULT_SETTINGS.base.paid),
      refresh: Number(settings.base?.refresh ?? DEFAULT_SETTINGS.base.refresh),
    },
    grants: {
      paid: {
        month: Number(settings.grants?.paid?.month ?? settings.paidGrantMonth ?? DEFAULT_SETTINGS.grants.paid.month),
        day: Number(settings.grants?.paid?.day ?? settings.paidGrantDay ?? DEFAULT_SETTINGS.grants.paid.day),
        amount: Number(settings.grants?.paid?.amount ?? settings.paidGrantAmount ?? DEFAULT_SETTINGS.grants.paid.amount),
      },
      refresh: {
        month: Number(
          settings.grants?.refresh?.month ?? settings.refreshGrantMonth ?? DEFAULT_SETTINGS.grants.refresh.month
        ),
        day: Number(settings.grants?.refresh?.day ?? settings.refreshGrantDay ?? DEFAULT_SETTINGS.grants.refresh.day),
        amount: Number(
          settings.grants?.refresh?.amount ?? settings.refreshGrantAmount ?? DEFAULT_SETTINGS.grants.refresh.amount
        ),
      },
    },
  };
}

function openSettingsDialog(isRequired) {
  fillSettingsForm();
  els.settingsCancel.disabled = isRequired;
  els.settingsDialog.showModal();
}

function fillSettingsForm() {
  const settings = state.settings;
  els.settingsAsOf.value = settings.asOf;
  els.settingsPaidBase.value = settings.base.paid;
  els.settingsPaidGrantMonth.value = settings.grants.paid.month;
  els.settingsPaidGrantDay.value = settings.grants.paid.day;
  els.settingsPaidGrantAmount.value = settings.grants.paid.amount;
  els.settingsRefreshBase.value = settings.base.refresh;
  els.settingsRefreshGrantMonth.value = settings.grants.refresh.month;
  els.settingsRefreshGrantDay.value = settings.grants.refresh.day;
  els.settingsRefreshGrantAmount.value = settings.grants.refresh.amount;
}

function saveSettingsFromForm() {
  state.settings = normalizeSettings({
    asOf: els.settingsAsOf.value,
    base: {
      paid: els.settingsPaidBase.value,
      refresh: els.settingsRefreshBase.value,
    },
    grants: {
      paid: {
        month: els.settingsPaidGrantMonth.value,
        day: els.settingsPaidGrantDay.value,
        amount: els.settingsPaidGrantAmount.value,
      },
      refresh: {
        month: els.settingsRefreshGrantMonth.value,
        day: els.settingsRefreshGrantDay.value,
        amount: els.settingsRefreshGrantAmount.value,
      },
    },
  });
  state.configured = true;
  saveState();
  render();
}

function grantText(type) {
  const grant = state.settings.grants[type];
  return `毎年${grant.month}/${grant.day}に+${formatAmount(grant.amount)}日`;
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
