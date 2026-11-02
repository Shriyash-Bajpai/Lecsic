# Lecsic — lectures & music, in rhythm

## Install (Chrome / Edge / Brave)
1. `edge://extensions` → Developer mode → **Load unpacked** → select this folder
   (updating: click the reload icon on the extension).
2. No need to reload your tabs: Lecsic attaches to a tab the moment you mark it.

## Mark your tabs
- Click the Lecsic icon → pick Lecture / Music.
- Right-click a page → **Lecsic** → Lecture tab / Music tab / Not marked.
- Keyboard: Alt+Shift+L / M / X  (edge://extensions/shortcuts to change).
- One-click mode: right-click the Lecsic icon → tick "One-click mode".
  Then each click on the icon cycles this tab: none → Lecture → Music → none.

Marked tabs get a small badge on their tab icon: orange **L** / purple **M**.

## Notes
- Browsers don't let extensions add items to the tab-strip right-click menu.
- Music you paused yourself stays paused; closing the lecture tab resumes music.
- Tuning: RESUME_DELAY_MS, FADE_MS, FADE_START at the top of background.js.
- Iframes that appear long after page load aren't scanned until the next
  page load; re-marking the tab (Alt+Shift+L) rescans.
