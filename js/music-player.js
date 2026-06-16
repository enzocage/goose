/* ═══════════════════════════════════════════════════════════
   SUBTLE BACKGROUND MUSIC PLAYER (Enzo Cage — Carbon)
   Hidden behind a toggle icon. Auto-starts on the first game
   interaction (a user gesture, so autoplay is allowed).
   Self-contained module — operates only on its own #music-* DOM.
   ═══════════════════════════════════════════════════════════ */
(() => {
  const BASE = 'https://www.enzocage.de/mp3/enzo_cage_carbon/';
  const FILES = [
    ['enzo_cage_ice.mp3', 'Ice'],
    ['enzo_cage_ease.mp3', 'Ease'],
    ['enzo_cage_denmark.mp3', 'Denmark'],
    ['enzo_cage_can_we_die.mp3', 'Can We Die'],
    ['enzo_cage_akira.mp3', 'Akira'],
    ['enzo_cage_vergangenheit.mp3', 'Vergangenheit'],
    ['enzo_cage_berlin_dark_tower.mp3', 'Berlin Dark Tower'],
    ['enzo_cage_crystal_drol.mp3', 'Crystal Drol'],
    ['enzo_cage_puristic.mp3', 'Puristic'],
    ['enzo_cage_on.mp3', 'On'],
    ['enzo_cage_pulsefire.mp3', 'Pulsefire'],
  ];
  const tracks = FILES.map(([f, t]) => ({ url: BASE + f, title: `Enzo Cage – ${t}` }));

  const audio   = document.getElementById('music-audio');
  const toggle  = document.getElementById('music-toggle');
  const panel   = document.getElementById('music-panel');
  const listEl  = document.getElementById('music-list');
  const statusEl= document.getElementById('music-status');
  const playBtn = document.getElementById('music-play');
  const prevBtn = document.getElementById('music-prev');
  const nextBtn = document.getElementById('music-next');
  const seek    = document.getElementById('music-seek');
  const fill    = document.getElementById('music-progress-fill');
  const vol     = document.getElementById('music-vol');
  const timeEl  = document.getElementById('music-time');
  const iconPlay = document.getElementById('music-icon-play');
  const iconPause= document.getElementById('music-icon-pause');
  if (!audio || !toggle || !panel) return; // markup missing — bail quietly

  let currentIndex = 0;
  let isPlaying = false;
  let started = false;     // has playback ever begun
  let autostarted = false; // first-interaction autostart done

  audio.volume = parseFloat(vol.value);

  function renderList() {
    listEl.innerHTML = '';
    tracks.forEach((track, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'music-row' + (i === currentIndex ? ' active' : '');
      row.innerHTML = `<span class="music-row-num">${String(i + 1).padStart(2, '0')}</span>` +
                      `<span class="music-row-title">${track.title}</span>`;
      row.addEventListener('click', () => loadTrack(i));
      listEl.appendChild(row);
    });
    if (isPlaying) {
      const active = listEl.querySelector('.music-row.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    }
  }

  function setPlayIcon() {
    iconPlay.classList.toggle('hidden', isPlaying);
    iconPause.classList.toggle('hidden', !isPlaying);
  }

  function loadTrack(index) {
    currentIndex = (index + tracks.length) % tracks.length;
    started = true;
    renderList();
    const track = tracks[currentIndex];
    statusEl.textContent = track.title;
    audio.src = track.url;
    audio.play().then(() => {
      isPlaying = true;
      setPlayIcon();
    }).catch(() => {
      isPlaying = false;
      setPlayIcon();
      statusEl.textContent = 'Tap ▶ to play';
    });
  }

  function togglePlay() {
    if (!started || !audio.src) { loadTrack(0); return; }
    if (isPlaying) { audio.pause(); isPlaying = false; }
    else { audio.play().catch(() => {}); isPlaying = true; }
    setPlayIcon();
  }

  function fmt(s) {
    if (isNaN(s)) return '00:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }

  // Controls
  playBtn.addEventListener('click', togglePlay);
  nextBtn.addEventListener('click', () => loadTrack(currentIndex + 1));
  prevBtn.addEventListener('click', () => loadTrack(currentIndex - 1));
  audio.addEventListener('ended', () => loadTrack(currentIndex + 1));

  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      const p = (audio.currentTime / audio.duration) * 100;
      seek.value = p;
      fill.style.width = p + '%';
      timeEl.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
    }
  });
  seek.addEventListener('input', (e) => {
    if (audio.duration) {
      audio.currentTime = (audio.duration / 100) * e.target.value;
      fill.style.width = e.target.value + '%';
    }
  });
  vol.addEventListener('input', (e) => { audio.volume = parseFloat(e.target.value); });
  audio.addEventListener('error', () => { statusEl.textContent = 'Playback error'; });

  // Toggle panel visibility
  toggle.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    toggle.classList.toggle('active', open);
  });

  renderList();
})();
