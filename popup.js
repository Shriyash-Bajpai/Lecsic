const $ = (id) => document.getElementById(id);
const buttons = document.querySelectorAll(".roles button");
let tabId = null;

const renderRole = (role) =>
  buttons.forEach((b) => b.classList.toggle("active", b.dataset.role === (role || "none")));

async function refreshStatus() {
  const s = await chrome.runtime.sendMessage({ type: "status" });
  $("enabled").checked = s.enabled;
  document.body.classList.toggle("off", !s.enabled);

  const box = $("status");
  box.className = "status";
  const tabsInfo = `${s.lectureTabs} lecture · ${s.musicTabs} music tab${s.musicTabs === 1 ? "" : "s"} marked`;

  if (!s.enabled) {
    $("status-main").textContent = "Paused";
    $("status-sub").textContent = "Lecsic is switched off";
  } else if (s.lecturePlaying) {
    box.classList.add("lecture");
    $("status-main").textContent = "Lecture playing";
    $("status-sub").textContent = s.musicHeld ? "Music is on hold" : tabsInfo;
  } else if (s.musicTabs > 0 && s.lectureTabs > 0) {
    box.classList.add("music");
    $("status-main").textContent = "Music flowing";
    $("status-sub").textContent = "Press play on your lecture to switch";
  } else {
    $("status-main").textContent = "Waiting for tabs";
    $("status-sub").textContent = tabsInfo;
  }
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab.id;
  $("title").textContent = tab.title || "Untitled";
  try { $("host").textContent = new URL(tab.url).hostname; } catch (e) {}
  if (tab.favIconUrl) $("fav").src = tab.favIconUrl; else $("fav").style.visibility = "hidden";

  const { role } = await chrome.runtime.sendMessage({ type: "getRole", tabId });
  renderRole(role);
  refreshStatus();
  setInterval(refreshStatus, 1000);

  buttons.forEach((b) =>
    b.addEventListener("click", async () => {
      const newRole = b.dataset.role === "none" ? null : b.dataset.role;
      renderRole(newRole);
      await chrome.runtime.sendMessage({ type: "setRole", tabId, role: newRole });
      refreshStatus();
    })
  );

  $("enabled").addEventListener("change", async (e) => {
    await chrome.runtime.sendMessage({ type: "setEnabled", enabled: e.target.checked });
    refreshStatus();
  });
})();
