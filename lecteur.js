/* lecteur.js — le moteur de lecture : file d'attente, aléatoire, répéter, contrôles de l'écran verrouillé, reprise là où on s'était arrêté. */
(function (racine) {
  'use strict';
  const DB = racine.Mp3DB;
  const a = new Audio();
  a.preload = 'auto';
  a.setAttribute('playsinline', '');

  let trouverSon = () => null;     // l'appli nous dit comment retrouver un son à partir de son identifiant
  let ordre = [];                  // la file dans l'ordre d'origine
  let liste = [];                  // la file dans l'ordre de lecture (mélangée ou non)
  let idx = -1;
  let aleatoire = false, repetition = 'non';       // répétition : non | tout | un
  let url = null, jeton = 0, aReprendre = null, erreursSuite = 0, minuteurSauve = null, tenuTimer = null, tenuPas = 0;
  const ecouteurs = { change: [], etat: [], temps: [], erreur: [] };
  const on = (n, f) => ecouteurs[n].push(f);
  const emit = (n, ...x) => ecouteurs[n].forEach((f) => { try { f(...x); } catch (e) { console.error(e); } });

  const courant = () => (idx >= 0 && idx < liste.length ? trouverSon(liste[idx]) : null);
  const enLecture = () => !a.paused && !a.ended && !!a.src;
  const duree = () => (isFinite(a.duration) && a.duration > 0 ? a.duration : (courant() && courant().duree) || 0);
  const temps = () => a.currentTime || 0;

  function melanger(t) { for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; } return t; }

  /* ---------- chargement d'un son ---------- */
  async function charger(id, depuis, lire) {
    const mon = ++jeton;
    const rec = await DB.lire('audio', id);
    if (mon !== jeton) return;
    if (!rec || !rec.blob) { emit('erreur', 'Fichier introuvable', trouverSon(id)); echec(); return; }
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(rec.blob);
    aReprendre = depuis > 0 ? depuis : null;
    a.src = url;
    emit('change'); majSession();
    if (lire) {
      try { await a.play(); }
      catch (e) {
        if (mon !== jeton || (e && e.name === 'AbortError')) return;
        if (e && e.name === 'NotAllowedError') { emit('etat'); return; }
        emit('erreur', 'Format non pris en charge', trouverSon(id)); echec();
      }
    } else emit('etat');
  }
  function echec() {                                // on passe au suivant, sans boucler à l'infini
    erreursSuite++;
    if (liste.length > 1 && erreursSuite < liste.length) suivant(true); else { a.pause(); emit('etat'); }
  }

  /* ---------- commandes ---------- */
  function jouer(ids, index, melangerTout) {
    ids = ids.filter((i) => trouverSon(i));
    if (!ids.length) return;
    ordre = ids.slice();
    if (melangerTout !== undefined) aleatoire = !!melangerTout;
    erreursSuite = 0;
    if (aleatoire) {
      const choisi = melangerTout && index === 0 ? null : ordre[Math.max(0, Math.min(index, ordre.length - 1))];
      if (choisi) { const autres = melanger(ordre.filter((i) => i !== choisi)); liste = [choisi, ...autres]; }
      else liste = melanger(ordre.slice());
      idx = 0;
    } else { liste = ordre.slice(); idx = Math.max(0, Math.min(index, liste.length - 1)); }
    charger(liste[idx], 0, true); sauver();
  }
  function suivant(auto) {
    if (!liste.length) return;
    if (auto && repetition === 'un') { a.currentTime = 0; a.play().catch(() => {}); return; }
    if (idx < liste.length - 1) idx++;
    else if (auto && repetition !== 'tout') { a.pause(); a.currentTime = 0; emit('etat'); emit('temps', 0, duree()); sauver(); return; }
    else { idx = 0; if (aleatoire && liste.length > 1) { const c = liste[liste.length - 1]; liste = melanger(liste.slice()); if (liste[0] === c) liste.push(liste.shift()); } }
    charger(liste[idx], 0, true); sauver();
  }
  function precedent() {
    if (!liste.length) return;
    if (temps() > 3 || (idx === 0 && repetition !== 'tout')) { a.currentTime = 0; emit('temps', 0, duree()); if (a.paused && a.src) { /* reste en pause */ } return; }
    idx = idx > 0 ? idx - 1 : liste.length - 1;
    charger(liste[idx], 0, true); sauver();
  }
  function basculer() {
    if (!a.src || !courant()) return false;
    if (a.paused) a.play().catch(() => emit('etat')); else a.pause();
    return true;
  }
  function chercher(t) {
    const d = duree(); if (!d || !a.src) return;
    a.currentTime = Math.max(0, Math.min(d - 0.3, t));
    emit('temps', a.currentTime, d);
  }
  const chercherPar = (dt) => chercher(temps() + dt);
  function tenir(dir) {                             // appui long sur ◀◀ / ▶▶ : on avance ou recule de plus en plus vite
    arreterTenir(); tenuPas = 0;
    tenuTimer = setInterval(() => { tenuPas++; chercherPar(dir * (2 + Math.min(tenuPas, 20) * 0.8)); }, 120);
  }
  function arreterTenir() { if (tenuTimer) { clearInterval(tenuTimer); tenuTimer = null; } }

  function definirAleatoire(v) {
    aleatoire = !!v;
    if (liste.length) {
      const cur = liste[idx];
      if (aleatoire) { const autres = melanger(ordre.filter((i) => i !== cur)); liste = [cur, ...autres]; idx = 0; }
      else { liste = ordre.slice(); idx = Math.max(0, liste.indexOf(cur)); }
    }
    emit('change'); sauver();
  }
  function definirRepetition(v) { repetition = v; emit('change'); sauver(); }

  // un son a été supprimé de l'appareil
  function retirer(id) {
    if (!ordre.includes(id) && !liste.includes(id)) return;
    const etaitCourant = liste[idx] === id, lisait = enLecture();
    const pos = liste.indexOf(id);
    liste = liste.filter((i) => i !== id); ordre = ordre.filter((i) => i !== id);
    if (!liste.length) { jeton++; a.pause(); a.removeAttribute('src'); try { a.load(); } catch (e) { /* rien */ } if (url) { URL.revokeObjectURL(url); url = null; } idx = -1; emit('change'); emit('etat'); sauver(); return; }
    if (etaitCourant) { idx = Math.min(pos, liste.length - 1); charger(liste[idx], 0, lisait); }
    else if (pos < idx) idx--;
    emit('change'); sauver();
  }
  function vider() { jeton++; a.pause(); a.removeAttribute('src'); try { a.load(); } catch (e) { /* rien */ } if (url) { URL.revokeObjectURL(url); url = null; } ordre = []; liste = []; idx = -1; emit('change'); emit('etat'); }

  /* ---------- reprise ---------- */
  function sauver() {
    clearTimeout(minuteurSauve);
    minuteurSauve = setTimeout(sauverMaintenant, 400);
  }
  function sauverMaintenant() {
    clearTimeout(minuteurSauve);
    DB.mettre('meta', [{ cle: 'lecteur', valeur: { ordre, liste, idx, t: temps(), aleatoire, repetition } }]).catch(() => {});
  }
  function restaurer(e) {
    if (!e) return;
    aleatoire = !!e.aleatoire; repetition = e.repetition || 'non';
    const ok = (i) => !!trouverSon(i);
    const l = (e.liste || []).filter(ok), o = (e.ordre || []).filter(ok);
    if (!l.length) return;
    const cur = (e.liste || [])[e.idx];
    liste = l; ordre = o.length ? o : l.slice();
    idx = Math.max(0, l.indexOf(cur));
    charger(liste[idx], cur && ok(cur) ? e.t || 0 : 0, false);
  }

  /* ---------- écran verrouillé / centre de contrôle ---------- */
  function majSession() {
    if (!('mediaSession' in navigator)) return;
    const s = courant(); if (!s) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: s.titre || '', artist: s.artiste || '', album: s.album || '', artwork: s.cover ? [{ src: s.cover, sizes: '480x480', type: 'image/jpeg' }] : [] });
    } catch (e) { /* rien */ }
  }
  if ('mediaSession' in navigator) {
    const m = (n, f) => { try { navigator.mediaSession.setActionHandler(n, f); } catch (e) { /* non géré */ } };
    m('play', () => { basculer(); }); m('pause', () => { a.pause(); });
    m('previoustrack', () => precedent()); m('nexttrack', () => suivant(false));
    m('seekbackward', (d) => chercherPar(-((d && d.seekOffset) || 10))); m('seekforward', (d) => chercherPar((d && d.seekOffset) || 10));
    m('seekto', (d) => { if (d && d.seekTime != null) chercher(d.seekTime); });
  }

  /* ---------- événements du lecteur ---------- */
  a.addEventListener('loadedmetadata', () => { if (aReprendre != null && isFinite(a.duration)) { try { a.currentTime = Math.min(aReprendre, Math.max(0, a.duration - 1)); } catch (e) { /* rien */ } } aReprendre = null; emit('temps', temps(), duree()); });
  a.addEventListener('timeupdate', () => {
    emit('temps', temps(), duree());
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && isFinite(a.duration) && a.duration > 0) { try { navigator.mediaSession.setPositionState({ duration: a.duration, playbackRate: 1, position: Math.min(a.currentTime, a.duration) }); } catch (e) { /* rien */ } }
  });
  a.addEventListener('play', () => emit('etat'));
  a.addEventListener('playing', () => { erreursSuite = 0; emit('etat'); });
  a.addEventListener('pause', () => { emit('etat'); sauverMaintenant(); });
  a.addEventListener('ended', () => suivant(true));
  a.addEventListener('error', () => { if (!a.src || !courant()) return; emit('erreur', 'Format non pris en charge', courant()); echec(); });
  setInterval(() => { if (enLecture()) sauverMaintenant(); }, 5000);
  racine.addEventListener('pagehide', sauverMaintenant);

  racine.Mp3Lecteur = {
    on, jouer, suivant: () => suivant(false), precedent, basculer, chercher, chercherPar, tenir, arreterTenir,
    definirAleatoire, definirRepetition, retirer, vider, restaurer, majSession, sauverMaintenant,
    definirSons(f) { trouverSon = f; },
    courant, enLecture, duree, temps,
    get aleatoire() { return aleatoire; }, get repetition() { return repetition; },
    get liste() { return liste.slice(); }, get index() { return idx; },
    rang() { return { n: idx + 1, total: liste.length }; },
    get audio() { return a; },
  };
})(typeof self !== 'undefined' ? self : this);
