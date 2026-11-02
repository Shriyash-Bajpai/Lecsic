// Lecsic: reports play/pause state of <video>/<audio> elements in this frame.
(() => {
  if (window.__lecsicLoaded) return;
  window.__lecsicLoaded = true;

  let lastState = false;
  const anyPlaying = () =>
    [...document.querySelectorAll("video, audio")].some((m) => !m.paused && !m.ended);

  const report = () => {
    const now = anyPlaying();
    if (now === lastState) return;
    lastState = now;
    try { chrome.runtime.sendMessage({ type: "media", playing: now }); } catch (e) {}
  };

  ["play", "playing", "pause", "ended", "emptied"].forEach((evt) =>
    document.addEventListener(evt, report, true)
  );
  setInterval(report, 1000); // fallback for players that don't fire events reliably

  window.addEventListener("pagehide", () => {
    lastState = false;
    try { chrome.runtime.sendMessage({ type: "media", playing: false }); } catch (e) {}
  });

  report();
})();
