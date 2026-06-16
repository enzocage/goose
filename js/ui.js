/* ═══════════════════════════════════════════════════════════
   UI CONTROLS
   HUD readouts (prisms, plutonium, moves, timer, combo), the transient
   message banner + typewriter title, and the compound-grouping indicators.
   All read from S and write the DOM; they hold no state of their own.
   ═══════════════════════════════════════════════════════════ */
import { S, audio } from './state.js';

export function updatePrismUI() {
  let collect = 0; let total = 0;
  S.activePrisms.forEach(p => {
    if (p.type !== 'miniprism' && p.type !== 'plutonium') {
      total++; if (p.collected) collect++;
    }
  });
  document.getElementById('prism-count').textContent = `${collect}/${total}`;
}
export function updatePlutoniumUI() {
  let totalPlutonium = 0;
  S.activePrisms.forEach(p => {
    if (p.type === 'plutonium') totalPlutonium++;
  });
  const display = document.getElementById('plutonium-display');
  if (display) {
    if (totalPlutonium > 0) {
      display.style.display = 'flex';
      document.getElementById('plutonium-count').textContent = `${S.depositedPlutonium}/${totalPlutonium}`;
    } else {
      display.style.display = 'none';
    }
  }
}
export function updateMoveUI() { document.getElementById('move-counter').textContent = `${S.moveCount} move${S.moveCount!==1?'s':''}`; }
export function updateTimerUI() {
  const mins = Math.floor(S.elapsedTime / 60);
  const secs = Math.floor(S.elapsedTime % 60);
  document.getElementById('timer-display').textContent = `${mins}:${String(secs).padStart(2,'0')}`;
}
export function updateComboUI() {
  const el = document.getElementById('combo-count');
  const lbl = document.getElementById('combo-label');
  if (S.comboCount >= 3) {
    el.textContent = `x${S.comboCount}`;
    el.classList.add('active'); lbl.classList.add('active');
  } else {
    el.classList.remove('active'); lbl.classList.remove('active');
  }
}
export function showMessage(text, dur=2) {
  const el = document.getElementById('message');
  el.textContent = text; el.classList.add('visible');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('visible'), dur*1000);
}

export function playTypewriterTitle(el, text) {
  if (S.typewriterInterval) clearInterval(S.typewriterInterval);
  el.textContent = '';
  let i = 0;
  S.typewriterInterval = setInterval(() => {
    if (i < text.length) {
      el.textContent += text[i];
      audio.playTypewriterTick();
      i++;
    } else {
      clearInterval(S.typewriterInterval);
      S.typewriterInterval = null;
    }
  }, 45);
}

// ── Compound-object grouping indicator (active while O is held) ──
export function groupMemberCount(gid) {
  if (gid === null || gid === undefined || !S.activeLevel) return 0;
  let n = 0;
  S.activeLevel.blocks.forEach(b => { if (b.properties && b.properties.group === gid) n++; });
  return n;
}
export function refreshGroupingIndicator() {
  const el = document.getElementById('group-count');
  if (!el) return;
  const n = groupMemberCount(S.currentGroupId);
  el.textContent = `${n} block${n === 1 ? '' : 's'}`;
}
export function setGroupingUI(active) {
  document.getElementById('grouping-indicator').classList.toggle('active', active);
  document.getElementById('grouping-vignette').classList.toggle('active', active);
}
