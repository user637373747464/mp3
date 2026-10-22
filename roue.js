/* roue.js — la molette tactile : tourner le doigt sur le cercle, appuyer sur MENU / ◀◀ / ▶▶ / ▶❚❚ / le bouton central.
   Appui long sur le centre = options. Appui long sur ◀◀ ou ▶▶ = reculer / avancer dans le titre.
   Sur ordinateur : flèches, Entrée, Échap, espace, et la molette de la souris. */
(function (racine) {
  'use strict';
  const CRAN = 24;            // degrés de rotation pour avancer d'une ligne
  const SEUIL = 9;            // degrés avant qu'un glissement ne soit considéré comme une rotation (et plus comme un appui)
  const CENTRE_RAYON = 0.31;  // rayon du bouton central, en fraction de la molette

  /* ---------- le petit « clic » de la molette ---------- */
  let ctxAudio = null, clicActif = true;
  function tic(fort) {
    if (!clicActif) return;
    try {
      if (!ctxAudio) {
        const C = racine.AudioContext || racine.webkitAudioContext; if (!C) return;
        ctxAudio = new C();
      }
      if (ctxAudio.state === 'suspended') ctxAudio.resume();
      const n = Math.floor(ctxAudio.sampleRate * 0.011), buf = ctxAudio.createBuffer(1, n, ctxAudio.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      const src = ctxAudio.createBufferSource(); src.buffer = buf;
      const f = ctxAudio.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1600;
      const g = ctxAudio.createGain(); g.gain.value = fort ? 0.45 : 0.22;
      src.connect(f); f.connect(g); g.connect(ctxAudio.destination); src.start();
    } catch (e) { /* pas de son, tant pis */ }
  }
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* rien */ }

  function zoneDe(dx, dy) {
    const a = Math.atan2(dy, dx) * 180 / Math.PI;
    if (a >= -45 && a < 45) return 'suivant';
    if (a >= 45 && a < 135) return 'play';
    if (a >= -135 && a < -45) return 'menu';
    return 'precedent';
  }

  function creer(el, h) {
    let p = null;               // appui en cours
    let dernier = null;         // dernier appui terminé (pour le « click » qui suit)
    const centre = () => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, R: r.width / 2 }; };
    const angle = (e, c) => Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180 / Math.PI;

    el.addEventListener('pointerdown', (e) => {
      if (p) return;
      const c = centre(), dx = e.clientX - c.x, dy = e.clientY - c.y, d = Math.hypot(dx, dy) / c.R;
      if (d > 1.04) return;
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* pointeur simulé */ }
      const zone = d < CENTRE_RAYON ? 'centre' : zoneDe(dx, dy);
      p = { id: e.pointerId, c, zone, a0: angle(e, c), cumul: 0, tourne: false, acc: 0, long: false, tenu: false, timer: null };
      el.dataset.zone = zone;
      if (zone === 'centre') p.timer = setTimeout(() => { if (!p || p.tourne) return; p.long = true; tic(true); h.centreLong && h.centreLong(); }, 520);
      else if (zone === 'precedent' || zone === 'suivant') p.timer = setTimeout(() => { if (!p || p.tourne) return; p.tenu = true; h.tenir && h.tenir(zone === 'suivant' ? 1 : -1); }, 420);
    });

    el.addEventListener('pointermove', (e) => {
      if (!p || e.pointerId !== p.id) return;
      const d = Math.hypot(e.clientX - p.c.x, e.clientY - p.c.y) / p.c.R;
      if (d < 0.22) return;                                    // trop près du centre : l'angle est instable
      const a = angle(e, p.c);
      let delta = a - p.a0; if (delta > 180) delta -= 360; if (delta < -180) delta += 360;
      p.a0 = a;
      if (p.zone === 'centre' && !p.tourne) {                  // on a commencé sur le bouton central : seul un vrai glissement dans l'anneau compte
        if (d < CENTRE_RAYON + 0.08) return;
      }
      p.cumul += delta;
      if (!p.tourne) {
        if (Math.abs(p.cumul) < SEUIL) return;
        p.tourne = true; clearTimeout(p.timer);
        if (p.tenu) { p.tenu = false; h.relacher && h.relacher(); }
        p.acc = p.cumul;
      } else p.acc += delta;
      while (p.acc >= CRAN) { p.acc -= CRAN; tic(); h.tourner && h.tourner(1); }
      while (p.acc <= -CRAN) { p.acc += CRAN; tic(); h.tourner && h.tourner(-1); }
    });

    const fin = (e) => {
      if (!p || e.pointerId !== p.id) return;
      clearTimeout(p.timer);
      if (p.tenu) h.relacher && h.relacher();
      dernier = { zone: p.zone, tourne: p.tourne, long: p.long, tenu: p.tenu, t: Date.now() };
      p = null; delete el.dataset.zone;
      if (e.type === 'pointercancel') dernier.tourne = true;   // annulé : on ne déclenche rien
    };
    el.addEventListener('pointerup', fin); el.addEventListener('pointercancel', fin);

    // l'action se déclenche sur « click » (geste utilisateur fiable pour ouvrir le sélecteur de fichiers)
    el.addEventListener('click', (e) => {
      const d = dernier; dernier = null;
      if (!d || Date.now() - d.t > 1500 || d.tourne || d.long || d.tenu) return;
      tic(true);
      if (d.zone === 'centre') h.centre && h.centre();
      else if (d.zone === 'menu') h.menu && h.menu();
      else if (d.zone === 'play') h.play && h.play();
      else if (d.zone === 'precedent') h.precedent && h.precedent();
      else if (d.zone === 'suivant') h.suivant && h.suivant();
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    /* ---------- ordinateur : souris et clavier (utile pour essayer) ---------- */
    let acc = 0;
    racine.addEventListener('wheel', (e) => {
      acc += e.deltaY;
      while (acc >= 40) { acc -= 40; tic(); h.tourner && h.tourner(1); }
      while (acc <= -40) { acc += 40; tic(); h.tourner && h.tourner(-1); }
    }, { passive: true });
    racine.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowRight') { e.preventDefault(); tic(); h.tourner && h.tourner(1); }
      else if (k === 'ArrowUp' || k === 'ArrowLeft') { e.preventDefault(); tic(); h.tourner && h.tourner(-1); }
      else if (k === 'Enter') { e.preventDefault(); tic(true); h.centre && h.centre(); }
      else if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); h.menu && h.menu(); }
      else if (k === ' ') { e.preventDefault(); h.play && h.play(); }
      else if (k === 'n' || k === 'N') h.suivant && h.suivant();
      else if (k === 'p' || k === 'P') h.precedent && h.precedent();
    });
  }

  racine.Mp3Roue = { creer, tic, clic(v) { clicActif = !!v; } };
})(typeof self !== 'undefined' ? self : this);
