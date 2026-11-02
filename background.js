const RESUME_DELAY_MS = 150;  // wait this long after the lecture pauses before music returns
const FADE_MS = 600;          // music ramps up over this long...
const FADE_START = 0.3;       // ...starting at 30% volume, so it's audible right away
let resumeTimer = null;
let queue = Promise.resolve();
const enqueue = (fn) => (queue = queue.then(fn).catch(console.error));

const ROLE_STYLE = {
  lecture: { text: "L", color: "#e8590c", label: "Lecture" },
  music: { text: "M", color: "#7048e8", label: "Music" },
};

// ---------- storage ----------
const getRoles = async () => (await chrome.storage.local.get("roles")).roles || {};
const setRoles = (roles) => chrome.storage.local.set({ roles });
const isEnabled = async () => (await chrome.storage.local.get("enabled")).enabled !== false;
async function getSession() {
  const s = await chrome.storage.session.get(["playing", "pausedMusic"]);
  return { playing: s.playing || [], pausedMusic: s.pausedMusic || [] };
}
const setSession = (patch) => chrome.storage.session.set(patch);

// ---------- injected into pages (must be self-contained) ----------
function injectedPauseAll() {
  const set = (window.__lecsicPaused = window.__lecsicPaused || new Set());
  let n = 0;
  document.querySelectorAll("video, audio").forEach((m) => {
    if (m.__lecsicFade) {
      clearInterval(m.__lecsicFade);
      m.__lecsicFade = null;
      if (m.__lecsicTarget != null) m.volume = m.__lecsicTarget;
    }
    if (!m.paused && !m.ended) {
      m.__lecsicTarget = m.volume;
      m.pause();
      set.add(m);
      n++;
    }
  });
  return n;
}

function injectedPlayAll(fadeMs, startFrac) {
  const set = window.__lecsicPaused;
  if (!set) return 0;
  let n = 0;
  set.forEach((m) => {
    if (!m.isConnected) return;
    const target = m.__lecsicTarget != null ? m.__lecsicTarget : m.volume;
    m.__lecsicTarget = target;
    m.volume = target * startFrac;
    m.play()
      .then(() => {
        const start = performance.now();
        clearInterval(m.__lecsicFade);
        m.__lecsicFade = setInterval(() => {
          const t = Math.min(1, (performance.now() - start) / fadeMs);
          const ease = 1 - (1 - t) * (1 - t); // ease-out: quick lift, gentle landing
          m.volume = target * (startFrac + (1 - startFrac) * ease);
          if (t >= 1) {
            clearInterval(m.__lecsicFade);
            m.__lecsicFade = null;
            m.__lecsicTarget = null;
          }
        }, 40);
      })
      .catch(() => {
        m.volume = target;
        m.__lecsicTarget = null;
      });
    n++;
  });
  set.clear();
  return n;
}

function injectedToast(text) {
  const old = document.getElementById("__lecsic_toast");
  if (old) old.remove();
  const el = document.createElement("div");
  el.id = "__lecsic_toast";
  el.textContent = text;
  el.style.cssText =
    "position:fixed;left:20px;bottom:20px;z-index:2147483647;padding:10px 16px;" +
    "background:#323232;color:#fff;font:14px Arial,sans-serif;border-radius:4px;" +
    "box-shadow:0 2px 6px rgba(0,0,0,.3);pointer-events:none;";
  document.documentElement.appendChild(el);
  setTimeout(() => el.remove(), 2000);
}

async function runInTab(tabId, func, args = []) {
  try {
    return await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args });
  } catch (e) {
    return null;
  }
}

async function toast(tabId, text) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: injectedToast, args: [text] });
  } catch (e) {}
}

// Inject the content script into a marked tab (only marked tabs ever get it).
async function pushRole(tabId, role) {
  const target = { tabId, allFrames: true };
  try {
    if (role) await chrome.scripting.executeScript({ target, files: ["content.js"] });
    await chrome.scripting.executeScript({
      target,
      func: (r) => window.__lecsic && window.__lecsic.setRole(r),
      args: [role || null],
    });
  } catch (e) {}
}

// ---------- favicon badge composing ----------
const iconCache = new Map();
async function composeIcon(url, role) {
  const key = `${url}|${role}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const S = 64;
  const canvas = new OffscreenCanvas(S, S);
  const g = canvas.getContext("2d");

  let drawn = false;
  try {
    const blob = await (await fetch(url)).blob();
    g.drawImage(await createImageBitmap(blob), 0, 0, S, S);
    drawn = true;
  } catch (e) {}
  if (!drawn) { // e.g. SVG favicon or missing icon: neutral tile
    g.fillStyle = "#9aa0a6";
    g.beginPath();
    g.roundRect(4, 4, S - 8, S - 8, 12);
    g.fill();
  }

  const st = ROLE_STYLE[role];
  const cx = 43, cy = 43;
  g.fillStyle = "#fff";
  g.beginPath(); g.arc(cx, cy, 24, 0, Math.PI * 2); g.fill();
  g.fillStyle = st.color;
  g.beginPath(); g.arc(cx, cy, 20, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#fff";
  g.font = "bold 28px Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(st.text, cx, cy + 2);

  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const dataUrl = "data:image/png;base64," + btoa(bin);

  if (iconCache.size > 40) iconCache.clear();
  iconCache.set(key, dataUrl);
  return dataUrl;
}

// ---------- core logic ----------
async function lecturePlaying() {
  const roles = await getRoles();
  const { playing } = await getSession();
  return playing.some((key) => roles[key.split(":")[0]] === "lecture");
}

async function pauseMusic() {
  const roles = await getRoles();
  const { pausedMusic } = await getSession();
  const paused = new Set(pausedMusic);
  for (const [id, role] of Object.entries(roles)) {
    if (role !== "music") continue;
    const res = await runInTab(Number(id), injectedPauseAll);
    if (res && res.some((r) => r.result > 0)) paused.add(Number(id));
  }
  await setSession({ pausedMusic: [...paused] });
}

async function resumeMusic() {
  const { pausedMusic } = await getSession();
  await Promise.all(pausedMusic.map((id) => runInTab(id, injectedPlayAll, [FADE_MS, FADE_START])));
  await setSession({ pausedMusic: [] });
}

async function evaluate({ immediate = false } = {}) {
  clearTimeout(resumeTimer);
  const enabled = await isEnabled();
  if (enabled && (await lecturePlaying())) return pauseMusic();
  if (immediate || !enabled) return resumeMusic();
  resumeTimer = setTimeout(
    () => enqueue(async () => { if (!(await lecturePlaying())) await resumeMusic(); }),
    RESUME_DELAY_MS
  );
}

async function removePlayingForTab(tabId) {
  const { playing } = await getSession();
  await setSession({ playing: playing.filter((k) => k.split(":")[0] !== String(tabId)) });
}

// ---------- toolbar badge + menu ----------
async function updateBadge(tabId) {
  const st = ROLE_STYLE[(await getRoles())[tabId]];
  try {
    await chrome.action.setBadgeText({ tabId, text: st ? st.text : "" });
    if (st) await chrome.action.setBadgeBackgroundColor({ tabId, color: st.color });
  } catch (e) {}
}

async function syncMenu(tabId) {
  const role = (await getRoles())[tabId] || "none";
  try { await chrome.contextMenus.update(`role:${role}`, { checked: true }); } catch (e) {}
}

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    const contexts = ["page", "frame", "video", "audio", "selection", "link", "image", "action"];
    chrome.contextMenus.create({ id: "lecsic", title: "Lecsic", contexts });
    chrome.contextMenus.create({ id: "role:lecture", parentId: "lecsic", type: "radio", title: "Lecture tab", contexts });
    chrome.contextMenus.create({ id: "role:music", parentId: "lecsic", type: "radio", title: "Music tab", contexts });
    chrome.contextMenus.create({ id: "role:none", parentId: "lecsic", type: "radio", title: "Not marked", checked: true, contexts });
    chrome.contextMenus.create({ id: "oneclick", type: "checkbox", title: "One-click mode (icon click switches role)", contexts: ["action"] });
    applyPopupMode();
  });
}

// One-click mode: clicking the toolbar icon cycles None -> Lecture -> Music -> None (no popup).
async function applyPopupMode() {
  const on = (await chrome.storage.local.get("oneClick")).oneClick === true;
  chrome.action.setPopup({ popup: on ? "" : "popup.html" });
  try { await chrome.contextMenus.update("oneclick", { checked: on }); } catch (e) {}
}
applyPopupMode();

// ---------- set role (popup, menu, shortcuts, icon click all use this) ----------
function setTabRole(tabId, role, { showToast = false } = {}) {
  return enqueue(async () => {
    const roles = await getRoles();
    if (role) roles[tabId] = role; else delete roles[tabId];
    await setRoles(roles);
    await removePlayingForTab(tabId);

    if (role !== "music") {
      const { pausedMusic } = await getSession();
      await setSession({ pausedMusic: pausedMusic.filter((i) => i !== tabId) });
    }

    await pushRole(tabId, role);   // starts watching + draws the favicon badge
    await updateBadge(tabId);
    await syncMenu(tabId);
    await evaluate({ immediate: true });

    if (showToast) {
      const st = ROLE_STYLE[role];
      await toast(tabId, st ? `Marked as ${st.label.toLowerCase()} tab` : "Mark removed");
    }
  });
}

// ---------- events ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "media" && sender.tab) {
    const key = `${sender.tab.id}:${sender.frameId}`;
    enqueue(async () => {
      if ((await getRoles())[sender.tab.id] !== "lecture") return;
      const { playing } = await getSession();
      const set = new Set(playing);
      msg.playing ? set.add(key) : set.delete(key);
      await setSession({ playing: [...set] });
      await evaluate();
    });
  } else if (msg.type === "composeIcon") {
    composeIcon(msg.url, msg.role).then((dataUrl) => sendResponse({ dataUrl })).catch(() => sendResponse({}));
    return true;
  } else if (msg.type === "getRole") {
    getRoles().then((roles) => sendResponse({ role: roles[msg.tabId] || null }));
    return true;
  } else if (msg.type === "setRole") {
    setTabRole(msg.tabId, msg.role).then(() => sendResponse({ ok: true }));
    return true;
  } else if (msg.type === "setEnabled") {
    chrome.storage.local.set({ enabled: msg.enabled })
      .then(() => enqueue(() => evaluate({ immediate: true })))
      .then(() => sendResponse({ ok: true }));
    return true;
  } else if (msg.type === "status") {
    (async () => {
      const roles = await getRoles();
      const { pausedMusic } = await getSession();
      const ids = Object.keys(roles);
      sendResponse({
        enabled: await isEnabled(),
        lectureTabs: ids.filter((i) => roles[i] === "lecture").length,
        musicTabs: ids.filter((i) => roles[i] === "music").length,
        lecturePlaying: await lecturePlaying(),
        musicHeld: pausedMusic.length > 0,
      });
    })();
    return true;
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "oneclick") {
    chrome.storage.local.set({ oneClick: !!info.checked }).then(applyPopupMode);
    return;
  }
  if (!tab || !String(info.menuItemId).startsWith("role:")) return;
  const role = String(info.menuItemId).slice(5);
  setTabRole(tab.id, role === "none" ? null : role, { showToast: true });
});

chrome.action.onClicked.addListener(async (tab) => {
  const cur = (await getRoles())[tab.id] || null;
  const next = cur === null ? "lecture" : cur === "lecture" ? "music" : null;
  setTabRole(tab.id, next, { showToast: true });
});

chrome.commands.onCommand.addListener(async (cmd, tab) => {
  tab = tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab) return;
  const role = { "mark-lecture": "lecture", "mark-music": "music", "clear-mark": null }[cmd];
  if (role !== undefined) setTabRole(tab.id, role, { showToast: true });
});

chrome.tabs.onActivated.addListener(({ tabId }) => syncMenu(tabId));

chrome.tabs.onRemoved.addListener((tabId) =>
  enqueue(async () => {
    const roles = await getRoles();
    delete roles[tabId];
    await setRoles(roles);
    await removePlayingForTab(tabId);
    const { pausedMusic } = await getSession();
    await setSession({ pausedMusic: pausedMusic.filter((i) => i !== tabId) });
    await evaluate({ immediate: true });
  })
);

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status === "loading") enqueue(() => removePlayingForTab(tabId));
  if (info.status === "complete") {
    const role = (await getRoles())[tabId];
    if (role) pushRole(tabId, role); // page (re)loaded: re-attach to marked tabs only
  }
  if (info.status) { updateBadge(tabId); if (tab.active) syncMenu(tabId); }
});

chrome.runtime.onStartup.addListener(() => setRoles({}));
chrome.runtime.onInstalled.addListener(buildMenus);
