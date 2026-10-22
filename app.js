/* app.js — les écrans et les menus du lecteur : l'écran de l'iPod, ce que fait chaque bouton, les playlists, les pochettes. */
(function () {
  'use strict';
  const DB = self.Mp3DB, Tags = self.Mp3Tags, L = self.Mp3Lecteur, Roue = self.Mp3Roue;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nouvelId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const fmt = (s) => { if (!isFinite(s) || s < 0) s = 0; s = Math.floor(s); const m = Math.floor(s / 60), r = s % 60, h = Math.floor(m / 60); return h ? h + ':' + String(m % 60).padStart(2, '0') + ':' + String(r).padStart(2, '0') : m + ':' + String(r).padStart(2, '0'); };
  const coll = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
  const pluriel = (n, un, plus) => n + ' ' + (n > 1 ? plus : un);

  /* ---------- icônes ---------- */
  const svg = (d, cls) => '<svg class="' + (cls || 'ic') + '" viewBox="0 0 24 24">' + d + '</svg>';
  const ICN = {
    note: svg('<path d="M12 3v10.4a3.6 3.6 0 1 0 2 3.2V7h4V3z"/>', ''),
    jouant: svg('<path d="M6 4l14 8-14 8z"/>', 'jouant'),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', ''),
    play: svg('<path d="M6 4l14 8-14 8z"/>'),
    melange: svg('<path d="M4 4h4l4 4-4 4H4zM14 14h6v6h-6z" opacity=".0"/><path d="M3 5h4l10 14h4M3 19h4l3-4.2M14 9.2L17 5h4M18 2l3 3-3 3M18 16l3 3-3 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'),
    plus: svg('<path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/>'),
  };
  const GLYPHE_PLAY = '<svg viewBox="0 0 24 24"><path d="M6 4l14 8-14 8z"/></svg>';
  const GLYPHE_PAUSE = '<svg viewBox="0 0 24 24"><path d="M5 4h5v16H5zM14 4h5v16h-5z"/></svg>';

  /* ---------- données ---------- */
  const S = { sons: [], parId: new Map(), playlists: [], reglages: { clic: true, ecran: 'clair' }, stockage: '' };
  const sonDe = (id) => S.parId.get(id) || null;
  const sonsTries = () => S.sons.slice().sort((a, b) => coll.compare(a.titre, b.titre) || coll.compare(a.artiste, b.artiste));
  const nomArtiste = (s) => s.artiste || 'Artiste inconnu';
  const nomAlbum = (s) => s.album || 'Album inconnu';
  const vignette = (s) => (s ? (s.mini || s.cover || null) : null);
  const parOrdreAlbum = (a, b) => coll.compare(nomAlbum(a), nomAlbum(b)) || (a.piste || 999) - (b.piste || 999) || coll.compare(a.titre, b.titre);
  function groupes(cle) {
    const m = new Map();
    S.sons.forEach((s) => { const k = cle(s); if (!m.has(k)) m.set(k, []); m.get(k).push(s); });
    return [...m.entries()].sort((a, b) => coll.compare(a[0], b[0]));
  }
  const plDe = (id) => S.playlists.find((p) => p.id === id) || null;
  const sauverPl = (p) => DB.mettre('playlists', [p]).catch(() => msg("Impossible d'enregistrer"));
  const sauverSons = (l) => DB.mettre('sons', l).catch(() => msg("Impossible d'enregistrer"));
  const sauverReglages = () => DB.mettre('meta', [{ cle: 'reglages', valeur: S.reglages }]).catch(() => {});

  /* ---------- messages sur l'écran ---------- */
  let tMsg = null;
  function msg(t, ms) { const e = $('msg'); e.textContent = t; e.classList.remove('cache'); clearTimeout(tMsg); tMsg = setTimeout(() => e.classList.add('cache'), ms || 1900); }
  function msgFixe(t) { const e = $('msg'); e.textContent = t; e.classList.remove('cache'); clearTimeout(tMsg); }
  function msgCache() { clearTimeout(tMsg); $('msg').classList.add('cache'); }

  /* ---------- pile d'écrans ---------- */
  let pile = [];
  const cur = () => pile[pile.length - 1];
  function pousser(e) { e.sel = e.sel || 0; e.scroll = 0; pile.push(e); rendre(); e.ouvre && e.ouvre(); if (e.focus) { const i = document.querySelector('#liste input'); if (i) { i.focus(); try { i.select(); } catch (x) { /* rien */ } } } }
  function retour(silencieux) {
    if (pile.length <= 1) return;
    const e = pile.pop(); e.ferme && e.ferme();
    if (document.activeElement && document.activeElement.blur && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    if (!silencieux) rendre();
  }
  function retourJusqua(type) { while (pile.length > 1 && cur().id !== type) pile.pop(); rendre(); }

  function htmlLigne(r, i, sel) {
    const c = ['row'];
    if (r.sep) c.push('sep'); if (r.passif) c.push('passif'); if (r.texte) c.push('texte'); if (r.s) c.push('l2'); if (r.prise) c.push('prise'); if (r.danger) c.push('danger'); if (r.champ) c.push('champ'); if (i === sel) c.push('sel');
    if (r.champ) return '<div class="' + c.join(' ') + '" data-i="' + i + '"><label>' + esc(r.champ.label) + '</label><input data-id="' + esc(r.champ.id) + '" value="' + esc(r.champ.valeur || '') + '" placeholder="' + esc(r.champ.placeholder || '') + '" maxlength="80" autocomplete="off" autocapitalize="sentences" spellcheck="false" enterkeyhint="done"></div>';
    let h = '<div class="' + c.join(' ') + '" data-i="' + i + '">';
    if (r.vig !== undefined) h += '<span class="vig">' + (r.vig ? '<img src="' + r.vig + '" alt="">' : ICN.note) + '</span>';
    if (r.icone) h += ICN[r.icone];
    if (r.s) h += '<span class="dbl"><b>' + esc(r.t) + '</b><small>' + esc(r.s) + '</small></span>'; else h += '<span class="t">' + esc(r.t) + '</span>';
    if (r.d) h += '<span class="d">' + esc(r.d) + '</span>';
    if (r.coche !== undefined) h += '<span class="coche">' + (r.coche ? ICN.check : '') + '</span>';
    if (r.jouant) h += ICN.jouant;
    if (r.chev) h += '<i class="chev"></i>';
    return h + '</div>';
  }
  function normaliserSel(e) {
    const n = e.rows.length; if (!n) { e.sel = 0; return; }
    e.sel = Math.max(0, Math.min(e.sel, n - 1));
    if (e.rows[e.sel].passif) { let j = e.sel; while (j < n && e.rows[j].passif) j++; if (j >= n) { j = e.sel; while (j >= 0 && e.rows[j].passif) j--; } e.sel = Math.max(0, j); }
  }

  function rendre() {
    const e = cur(); if (!e) return;
    $('barre-titre').textContent = typeof e.titre === 'function' ? e.titre() : e.titre;
    majEtatBarre();
    if (e.type === 'lecture') { vueLecture(); return; }
    e.rows = e.lignes(); normaliserSel(e);
    const vue = $('vue');
    vue.innerHTML = '<div class="liste" id="liste">' + e.rows.map((r, i) => htmlLigne(r, i, e.sel)).join('') + '</div><div id="sb"><i></i></div>';
    const l = $('liste');
    l.scrollTop = e.scroll || 0;
    l.addEventListener('scroll', () => { e.scroll = l.scrollTop; majSb(true); }, { passive: true });
    majSel();
  }
  function majSel() {
    const e = cur(), l = $('liste'); if (!l) return;
    const ancien = l.querySelector('.row.sel'); if (ancien) ancien.classList.remove('sel');
    const el = l.querySelector('.row[data-i="' + e.sel + '"]'); if (!el) return;
    el.classList.add('sel');
    const haut = el.offsetTop, bas = haut + el.offsetHeight;
    if (haut < l.scrollTop) l.scrollTop = haut;
    else if (bas > l.scrollTop + l.clientHeight) l.scrollTop = bas - l.clientHeight;
    majSb(true);
  }
  let tSb = null;
  function majSb(montrer) {
    const l = $('liste'), sb = $('sb'); if (!l || !sb) return;
    const h = l.clientHeight, H = l.scrollHeight;
    if (H <= h + 2) { sb.classList.remove('on'); return; }
    const i = sb.firstChild, hb = Math.max(18, (h / H) * (h - 6));
    i.style.height = hb + 'px'; i.style.top = (l.scrollTop / (H - h)) * (h - 6 - hb) + 'px';
    if (montrer) { sb.classList.add('on'); clearTimeout(tSb); tSb = setTimeout(() => sb.classList.remove('on'), 1100); }
  }
  function majEtatBarre() {
    $('barre-etat').innerHTML = L.courant() ? (L.enLecture() ? GLYPHE_PLAY : GLYPHE_PAUSE) : '';
  }

  /* ---------- lecture en cours ---------- */
  function vueLecture() {
    const s = L.courant(), vue = $('vue');
    if (!s) { vue.innerHTML = '<div class="np-vide"><b>Aucun titre</b><span>Choisis un son dans le menu.</span></div>'; return; }
    const { n, total } = L.rang();
    const art = s.cover ? '<img class="np-art" src="' + s.cover + '" alt="">' :
      '<button class="np-art vide" data-act="pochette" aria-label="Ajouter une pochette">' + svg('<path d="M12 3v10.4a3.6 3.6 0 1 0 2 3.2V7h4V3z"/>', '') + '<span>Ajouter<br>une pochette</span></button>';
    const modes = (L.aleatoire ? svg('<path d="M3 5h4l10 14h4M3 19h4l3-4.2M14 9.2L17 5h4M18 2l3 3-3 3M18 16l3 3-3 3"/>', '') : '') +
      (L.repetition !== 'non' ? svg('<path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>', '') + (L.repetition === 'un' ? '<em>1</em>' : '') : '');
    vue.innerHTML = '<div class="np"><div class="np-haut">' + art + '<div class="np-infos"><b>' + esc(s.titre) + '</b><span>' + esc(nomArtiste(s)) + '</span><span>' + esc(s.album || '') + '</span><span class="np-n">' + n + ' sur ' + total + modes + '</span></div></div>' +
      '<div class="np-barre"><span id="np-t0">0:00</span><div class="np-piste" id="np-piste"><i id="np-rempli"></i></div><span id="np-t1">-0:00</span></div></div>';
    majTemps();
  }
  let tScrub = null;
  function majTemps() {
    const e = cur(); if (!e || e.type !== 'lecture') return;
    const t0 = $('np-t0'); if (!t0) return;
    const t = L.temps(), d = L.duree();
    t0.textContent = fmt(t); $('np-t1').textContent = '-' + fmt(Math.max(0, d - t));
    $('np-rempli').style.width = (d > 0 ? Math.min(100, (t / d) * 100) : 0) + '%';
  }
  function marquerScrub() { const p = $('np-piste'); if (!p) return; p.classList.add('scrub'); clearTimeout(tScrub); tScrub = setTimeout(() => p.classList.remove('scrub'), 900); }

  /* ---------- écrans types ---------- */
  function confirmer(titre, textes, libelle, fnOk) {
    pousser({ id: 'confirm', titre, sel: textes.length + 1, lignes: () => [...textes.map((t) => ({ t, texte: true, passif: true })), { t: libelle, danger: true, action: () => { retour(true); fnOk(); } }, { t: 'Annuler', action: () => retour() }] });
  }
  function formulaire(titre, champs, libelle, fnOk) {
    const e = { id: 'form', titre, champs, focus: true, lignes: () => [...champs.map((c) => ({ champ: c })), { t: libelle || 'OK', action: () => e.valider() }, { t: 'Annuler', action: () => retour() }],
      valider() { const v = {}; champs.forEach((c) => { v[c.id] = (c.valeur || '').trim(); }); retour(true); fnOk(v); } };
    pousser(e);
  }

  function ligneSon(s, action, ctx, mode) {
    const c = L.courant();
    const r = { t: s.titre, action, long: () => pousser(ecranOptionsSon(s.id, ctx || {})), jouant: !!(c && c.id === s.id) };
    if (mode === 'album') r.d = s.duree > 0 ? fmt(s.duree) : '';
    else { r.s = mode === 'artiste' ? nomAlbum(s) : nomArtiste(s); r.vig = vignette(s); }
    return r;
  }
  function jouerListe(ids, index, melanger) {
    if (!ids.length) { msg('Rien à lire'); return; }
    L.jouer(ids, index, melanger);
    if (cur().type !== 'lecture') pousser(ecranLecture());
  }
  const idsDe = (sons) => sons.map((s) => s.id);

  function ecranMenu() {
    return { id: 'menu', titre: 'MP3', sel: S.sons.length ? 0 : (L.courant() ? 6 : 5), lignes: () => {
      const r = [];
      if (L.courant()) r.push({ t: 'Lecture en cours', chev: true, action: () => pousser(ecranLecture()) });
      r.push({ t: 'Playlists', chev: true, action: () => pousser(ecranPlaylists()) });
      r.push({ t: 'Titres', chev: true, action: () => pousser(ecranTitres()) });
      r.push({ t: 'Artistes', chev: true, action: () => pousser(ecranArtistes()) });
      r.push({ t: 'Albums', chev: true, action: () => pousser(ecranAlbums()) });
      r.push({ t: 'Aléatoire', action: () => jouerListe(idsDe(sonsTries()), 0, true) });
      r.push({ t: 'Ajouter des sons', action: ouvrirImport });
      r.push({ t: 'Réglages', chev: true, action: () => pousser(ecranReglages()) });
      if (!S.sons.length) r.push({ t: "Aucun son pour l'instant. Choisis « Ajouter des sons » pour en mettre.", texte: true, passif: true });
      return r;
    } };
  }
  function ecranLecture() { return { id: 'lecture', type: 'lecture', titre: 'Lecture en cours' }; }

  function ecranTitres() {
    return { id: 'titres', titre: 'Titres', lignes: () => {
      const t = sonsTries(), ids = idsDe(t);
      if (!t.length) return [{ t: 'Aucun son', passif: true }, { t: 'Ajouter des sons', action: ouvrirImport }];
      return t.map((s, i) => ligneSon(s, () => jouerListe(ids, i)));
    } };
  }
  function ecranArtistes() {
    return { id: 'artistes', titre: 'Artistes', lignes: () => {
      const g = groupes(nomArtiste);
      if (!g.length) return [{ t: 'Aucun son', passif: true }, { t: 'Ajouter des sons', action: ouvrirImport }];
      return g.map(([nom, sons]) => ({ t: nom, d: String(sons.length), vig: vignette(sons.find((s) => vignette(s))) , chev: true, action: () => pousser(ecranArtiste(nom)) }));
    } };
  }
  function ecranArtiste(nom) {
    return { id: 'artiste', titre: nom, lignes: () => {
      const sons = S.sons.filter((s) => nomArtiste(s) === nom).sort(parOrdreAlbum), ids = idsDe(sons);
      return sons.map((s, i) => ligneSon(s, () => jouerListe(ids, i), {}, 'artiste'));
    } };
  }
  function ecranAlbums() {
    return { id: 'albums', titre: 'Albums', lignes: () => {
      const g = groupes(nomAlbum);
      if (!g.length) return [{ t: 'Aucun son', passif: true }, { t: 'Ajouter des sons', action: ouvrirImport }];
      return g.map(([nom, sons]) => ({ t: nom, d: String(sons.length), vig: vignette(sons.find((s) => vignette(s))), chev: true, action: () => pousser(ecranAlbum(nom)) }));
    } };
  }
  function ecranAlbum(nom) {
    return { id: 'album', titre: nom, lignes: () => {
      const sons = S.sons.filter((s) => nomAlbum(s) === nom).sort(parOrdreAlbum), ids = idsDe(sons);
      return sons.map((s, i) => ligneSon(s, () => jouerListe(ids, i), {}, 'album'));
    } };
  }

  /* ---------- playlists ---------- */
  function ecranPlaylists() {
    return { id: 'playlists', titre: 'Playlists', lignes: () => {
      const r = [{ t: 'Nouvelle playlist…', icone: 'plus', action: nouvellePlaylist }];
      S.playlists.slice().sort((a, b) => coll.compare(a.nom, b.nom)).forEach((p) => {
        const sons = p.ids.map(sonDe).filter(Boolean);
        r.push({ t: p.nom, d: String(sons.length), vig: vignette(sons.find((s) => vignette(s))), chev: true, action: () => pousser(ecranPlaylist(p.id)), long: () => pousser(ecranModifierPlaylist(p.id)) });
      });
      if (!S.playlists.length) r.push({ t: 'Aucune playlist. Crée la première avec « Nouvelle playlist… ».', texte: true, passif: true });
      return r;
    } };
  }
  function nouvellePlaylist() {
    formulaire('Nouvelle playlist', [{ id: 'nom', label: 'Nom', valeur: 'Playlist ' + (S.playlists.length + 1) }], 'Créer', (v) => {
      const p = { id: nouvelId(), nom: v.nom || 'Playlist ' + (S.playlists.length + 1), ids: [], cree: Date.now() };
      S.playlists.push(p); sauverPl(p);
      pousser(ecranPlaylist(p.id));
      if (S.sons.length) pousser(ecranChoisirTitres(p.id)); else msg('Playlist créée. Ajoute d\'abord des sons.');
    });
  }
  function ecranPlaylist(id) {
    return { id: 'playlist', plId: id, titre: () => (plDe(id) ? plDe(id).nom : ''), lignes: () => {
      const p = plDe(id); if (!p) return [];
      const sons = p.ids.map(sonDe).filter(Boolean), ids = idsDe(sons), r = [];
      r.push({ t: 'Lire', icone: 'play', action: () => jouerListe(ids, 0) });
      r.push({ t: 'Aléatoire', icone: 'melange', action: () => jouerListe(ids, 0, true) });
      r.push({ t: 'Modifier…', chev: true, action: () => pousser(ecranModifierPlaylist(id)) });
      if (!sons.length) r.push({ t: 'Playlist vide. Touche « Modifier… » puis « Ajouter des titres ».', texte: true, passif: true });
      sons.forEach((s, i) => r.push(ligneSon(s, () => jouerListe(ids, i), { playlistId: id })));
      return r;
    } };
  }
  function ecranModifierPlaylist(id) {
    return { id: 'modpl', titre: 'Modifier', lignes: () => {
      const p = plDe(id); if (!p) return [];
      return [
        { t: 'Ajouter des titres', chev: true, action: () => (S.sons.length ? pousser(ecranChoisirTitres(id)) : msg('Ajoute d\'abord des sons')) },
        { t: 'Réorganiser', chev: true, action: () => (p.ids.length > 1 ? pousser(ecranReorganiser(id)) : msg('Il faut au moins 2 titres')) },
        { t: 'Renommer', chev: true, action: () => formulaire('Renommer', [{ id: 'nom', label: 'Nom', valeur: p.nom }], 'OK', (v) => { if (v.nom) { p.nom = v.nom; sauverPl(p); } rendre(); }) },
        { t: 'Supprimer la playlist', danger: true, action: () => confirmer('Supprimer ?', ['La playlist « ' + p.nom + ' » sera supprimée.', 'Tes sons restent dans le lecteur.'], 'Supprimer', () => {
          S.playlists = S.playlists.filter((x) => x.id !== id); DB.supprimer('playlists', [id]).catch(() => {});
          while (pile.length > 1 && cur().id !== 'playlists') pile.pop();
          if (cur().id !== 'playlists' && pile.length > 1) pile.pop();
          rendre(); msg('Playlist supprimée');
        }) },
      ];
    } };
  }
  function ecranChoisirTitres(id) {
    return { id: 'choisir', titre: () => 'Ajouter à « ' + (plDe(id) ? plDe(id).nom : '') + ' »', sel: 1, lignes: () => {
      const p = plDe(id); if (!p) return [];
      const dedans = new Set(p.ids), r = [{ t: 'Terminé (' + pluriel(p.ids.length, 'titre', 'titres') + ')', action: () => retour() }];
      sonsTries().forEach((s) => r.push({ t: s.titre, s: nomArtiste(s), vig: vignette(s), coche: dedans.has(s.id), action: () => {
        if (dedans.has(s.id)) p.ids = p.ids.filter((x) => x !== s.id); else p.ids.push(s.id);
        sauverPl(p); rendre();
      } }));
      return r;
    } };
  }
  function ecranReorganiser(id) {
    const e = { id: 'reorg', titre: 'Réorganiser', pris: null, lignes: () => {
      const p = plDe(id); if (!p) return [];
      return p.ids.map(sonDe).filter(Boolean).map((s, i) => ({ t: (e.pris === i ? '⇅  ' : '') + s.titre, s: nomArtiste(s), vig: vignette(s), prise: e.pris === i, action: () => { e.pris = e.pris === i ? null : i; e.titre = e.pris === null ? 'Réorganiser' : 'Déplace avec la molette'; rendre(); } }));
    }, tourner: (d) => {
      const p = plDe(id); if (!p || e.pris === null) return false;
      const j = e.pris + (d > 0 ? 1 : -1);
      if (j < 0 || j >= p.ids.length) return true;
      [p.ids[e.pris], p.ids[j]] = [p.ids[j], p.ids[e.pris]];
      e.pris = j; e.sel = j; sauverPl(p); rendre(); return true;
    }, ferme: () => {} };
    return e;
  }

  /* ---------- options d'un son (appui long sur le bouton central) ---------- */
  function ecranOptionsSon(sonId, ctx) {
    return { id: 'options', titre: () => (sonDe(sonId) ? sonDe(sonId).titre : 'Options'), lignes: () => {
      const s = sonDe(sonId); if (!s) return [];
      const r = [];
      if (ctx.lecture) {
        r.push({ t: 'Aléatoire', d: L.aleatoire ? 'Oui' : 'Non', action: () => { L.definirAleatoire(!L.aleatoire); rendre(); } });
        r.push({ t: 'Répéter', d: { non: 'Non', tout: 'Tout', un: 'Un titre' }[L.repetition], action: () => { L.definirRepetition({ non: 'tout', tout: 'un', un: 'non' }[L.repetition]); rendre(); } });
      }
      r.push({ t: 'Ajouter à une playlist', chev: true, action: () => pousser(ecranAjouterAPlaylist([s.id])) });
      if (ctx.playlistId && plDe(ctx.playlistId)) r.push({ t: 'Retirer de la playlist', action: () => { const p = plDe(ctx.playlistId); p.ids = p.ids.filter((x) => x !== s.id); sauverPl(p); retour(true); rendre(); msg('Retiré de « ' + p.nom + ' »'); } });
      r.push({ t: s.cover ? 'Changer la pochette' : 'Ajouter une pochette', action: () => choisirPochette([s.id]) });
      r.push({ t: 'Modifier les infos', chev: true, action: () => formulaire('Infos du son', [{ id: 'titre', label: 'Titre', valeur: s.titre }, { id: 'artiste', label: 'Artiste', valeur: s.artiste }, { id: 'album', label: 'Album', valeur: s.album }], 'OK', (v) => {
        s.titre = v.titre || s.titre; s.artiste = v.artiste; s.album = v.album; sauverSons([s]); L.majSession(); rendre();
      }) });
      r.push({ t: 'Supprimer du lecteur', danger: true, action: () => confirmer('Supprimer ?', ['« ' + s.titre + ' » sera effacé de ce lecteur et de toutes les playlists.'], 'Supprimer', () => supprimerSon(s)) });
      return r;
    } };
  }
  function ecranAjouterAPlaylist(ids) {
    return { id: 'ajoutpl', titre: 'Ajouter à une playlist', lignes: () => {
      const r = [{ t: 'Nouvelle playlist…', icone: 'plus', action: () => formulaire('Nouvelle playlist', [{ id: 'nom', label: 'Nom', valeur: 'Playlist ' + (S.playlists.length + 1) }], 'Créer', (v) => {
        const p = { id: nouvelId(), nom: v.nom || 'Playlist ' + (S.playlists.length + 1), ids: ids.slice(), cree: Date.now() };
        S.playlists.push(p); sauverPl(p); rendre(); msg('Ajouté à « ' + p.nom + ' »');
      }) }];
      S.playlists.slice().sort((a, b) => coll.compare(a.nom, b.nom)).forEach((p) => {
        const tous = ids.every((i) => p.ids.includes(i));
        r.push({ t: p.nom, coche: tous, action: () => {
          if (tous) { p.ids = p.ids.filter((x) => !ids.includes(x)); msg('Retiré de « ' + p.nom + ' »'); }
          else { ids.forEach((i) => { if (!p.ids.includes(i)) p.ids.push(i); }); msg('Ajouté à « ' + p.nom + ' »'); }
          sauverPl(p); rendre();
        } });
      });
      return r;
    } };
  }
  async function supprimerSon(s) {
    try { await DB.retirerSons([s.id]); } catch (e) { msg('Suppression impossible'); return; }
    S.sons = S.sons.filter((x) => x.id !== s.id); S.parId.delete(s.id);
    const touches = [];
    S.playlists.forEach((p) => { if (p.ids.includes(s.id)) { p.ids = p.ids.filter((x) => x !== s.id); touches.push(p); } });
    if (touches.length) DB.mettre('playlists', touches).catch(() => {});
    L.retirer(s.id);
    while (pile.length > 1 && ['options', 'confirm', 'lecture'].includes(cur().id || cur().type)) pile.pop();
    rendre(); msg('Son supprimé');
  }

  /* ---------- réglages ---------- */
  function ecranReglages() {
    return { id: 'reglages', titre: 'Réglages', ouvre: () => estimer(), lignes: () => [
      { t: 'Clic sonore', d: S.reglages.clic ? 'Oui' : 'Non', action: () => { S.reglages.clic = !S.reglages.clic; Roue.clic(S.reglages.clic); sauverReglages(); rendre(); } },
      { t: 'Écran', d: S.reglages.ecran === 'sombre' ? 'Sombre' : 'Clair', action: () => { S.reglages.ecran = S.reglages.ecran === 'sombre' ? 'clair' : 'sombre'; appliquerEcran(); sauverReglages(); rendre(); } },
      { t: 'Aléatoire', d: L.aleatoire ? 'Oui' : 'Non', action: () => { L.definirAleatoire(!L.aleatoire); rendre(); } },
      { t: 'Répéter', d: { non: 'Non', tout: 'Tout', un: 'Un titre' }[L.repetition], action: () => { L.definirRepetition({ non: 'tout', tout: 'un', un: 'non' }[L.repetition]); rendre(); } },
      { t: 'Stockage', d: S.stockage || '…', passif: true },
      { t: 'Aide', chev: true, action: () => pousser(ecranAide()) },
      { t: 'Tout effacer', danger: true, action: () => confirmer('Tout effacer ?', ['Tous les sons, pochettes et playlists seront supprimés de cet appareil.'], 'Tout effacer', toutEffacer) },
    ] };
  }
  async function estimer() {
    try {
      const nb = S.sons.length, taille = S.sons.reduce((a, s) => a + (s.taille || 0), 0);
      S.stockage = nb + (nb > 1 ? ' sons · ' : ' son · ') + (taille >= 1e9 ? (taille / 1e9).toFixed(2).replace('.', ',') + ' Go' : Math.round(taille / 1e5) / 10 + ' Mo').replace('.', ',');
      if (cur() && cur().id === 'reglages') rendre();
    } catch (e) { /* rien */ }
  }
  function ecranAide() {
    const l = ['Molette : fais tourner ton doigt sur le cercle pour faire défiler. Tu peux aussi toucher l\'écran.', 'Bouton du centre : choisir.', 'MENU : revenir en arrière.', '▶❚❚ : lecture / pause. ◀◀ et ▶▶ : titre précédent / suivant.', 'Maintiens ◀◀ ou ▶▶ pour reculer ou avancer dans le titre.', 'Dans « Lecture en cours », la molette avance ou recule dans le titre.', 'Appui long sur le bouton du centre (ou appui simple dans « Lecture en cours ») : options — playlist, pochette, supprimer…', 'Tes sons restent dans ton iPhone : rien n\'est envoyé sur Internet.'];
    return { id: 'aide', titre: 'Aide', lignes: () => l.map((t) => ({ t, texte: true, passif: false, action: () => {} })) };
  }
  async function toutEffacer() {
    try { await DB.vider(); } catch (e) { /* rien */ }
    L.vider(); S.sons = []; S.parId.clear(); S.playlists = [];
    pile = [ecranMenu()]; rendre(); msg('Tout est effacé');
  }
  function appliquerEcran() { $('ecran').className = S.reglages.ecran === 'sombre' ? 'sombre' : 'clair'; }

  /* ---------- ajout de sons ---------- */
  function typeAudio(f) {
    const ext = ((f.name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1];
    return { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg' }[ext] || f.type || 'audio/mpeg';
  }
  function ouvrirImport() { const i = $('f-audio'); i.value = ''; i.click(); }
  $('f-audio').addEventListener('change', () => { const fl = [...$('f-audio').files]; $('f-audio').value = ''; if (fl.length) importer(fl); });

  async function importer(fichiers) {
    const nouveaux = []; let doublons = 0, refuses = [], plein = false;
    const connus = new Set(S.sons.map((s) => s.nom + '|' + s.taille));
    for (let i = 0; i < fichiers.length; i++) {
      const f = fichiers[i];
      msgFixe('Ajout ' + (i + 1) + '/' + fichiers.length + '…\n' + (f.name || '').slice(0, 40));
      if (connus.has(f.name + '|' + f.size)) { doublons++; continue; }
      try {
        const type = typeAudio(f), blob = f.slice(0, f.size, type);
        const t = await Tags.lire(f);
        const d = await Tags.duree(blob);
        if (d < 0) { refuses.push(f.name); continue; }
        const cover = t.image ? await Tags.reduireImage(t.image, 480) : null;
        const mini = t.image && cover ? await Tags.reduireImage(t.image, 72) : null;
        const son = { id: nouvelId(), titre: t.titre, artiste: t.artiste || '', album: t.album || '', piste: t.piste || 0, duree: d, taille: f.size, type, nom: f.name, cover, mini, ajoute: Date.now() };
        await DB.ajouterSon(son, blob);
        S.sons.push(son); S.parId.set(son.id, son); nouveaux.push(son); connus.add(f.name + '|' + f.size);
      } catch (e) {
        if (e && (e.name === 'QuotaExceededError' || /quota/i.test(String(e.message)))) { plein = true; break; }
        refuses.push(f.name);
      }
    }
    msgCache(); rendre();
    const parts = [];
    if (nouveaux.length) parts.push(pluriel(nouveaux.length, 'son ajouté', 'sons ajoutés'));
    if (doublons) parts.push(pluriel(doublons, 'déjà présent', 'déjà présents'));
    if (refuses.length) parts.push(refuses.length === 1 ? 'Format illisible :\n' + refuses[0].slice(0, 36) : refuses.length + ' fichiers illisibles');
    if (plein) parts.push('Mémoire pleine');
    if (parts.length) msg(parts.join(' · '), 2800);
    const sans = nouveaux.filter((s) => !s.cover);
    if (sans.length) setTimeout(() => proposerPochette(sans), 900);
  }

  /* ---------- pochettes ---------- */
  let cible = null;
  function choisirPochette(ids, apres) { cible = { ids, apres }; const i = $('f-image'); i.value = ''; i.click(); }
  $('f-image').addEventListener('change', async () => {
    const f = $('f-image').files[0]; $('f-image').value = '';
    const c = cible; cible = null;
    if (!f || !c) return;
    msgFixe('Pochette…');
    const grande = await Tags.reduireImage(f, 480);
    if (!grande) { msg('Image illisible'); return; }
    const petite = await Tags.reduireImage(f, 72);
    const touches = [];
    c.ids.forEach((id) => {
      const s = sonDe(id); if (!s) return;
      s.cover = grande; s.mini = petite; touches.push(s);
      if (s.album) S.sons.forEach((x) => { if (x !== s && x.album === s.album && !x.cover) { x.cover = grande; x.mini = petite; touches.push(x); } });   // même album : même pochette
    });
    await sauverSons(touches);
    L.majSession(); rendre(); msg(touches.length > 1 ? 'Pochette ajoutée (' + touches.length + ' sons)' : 'Pochette ajoutée');
    c.apres && c.apres();
  });
  // après un ajout : propose une pochette pour les sons qui n'en ont pas
  function proposerPochette(liste) {
    liste = liste.filter((s) => sonDe(s.id) && !s.cover);
    if (!liste.length) return;
    const s = liste[0], reste = liste.length - 1;
    pousser({ id: 'confirm', titre: 'Pochette', sel: 1, lignes: () => [
      { t: '« ' + s.titre + ' » n\'a pas de pochette.' + (reste ? ' (+ ' + pluriel(reste, 'autre', 'autres') + ')' : ''), texte: true, passif: true },
      { t: 'Choisir une image', action: () => { retour(true); choisirPochette([s.id], () => setTimeout(() => proposerPochette(liste.slice(1)), 700)); } },
      { t: 'Plus tard', action: () => retour() },
    ] });
  }

  /* ---------- boutons de la molette ---------- */
  function tourner(d) {
    const e = cur();
    if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    if (e.tourner && e.tourner(d)) return;
    if (e.type === 'lecture') { L.chercherPar(d * 5); marquerScrub(); return; }
    const rows = e.rows; if (!rows || !rows.length) return;
    let i = e.sel; const pas = d > 0 ? 1 : -1;
    let j = i + pas; while (j >= 0 && j < rows.length && rows[j].passif) j += pas;
    if (j >= 0 && j < rows.length) { e.sel = j; majSel(); }
  }
  function activer(i) {
    const e = cur(), r = e.rows && e.rows[i]; if (!r || r.passif && !r.action) return;
    if (r.champ) { const inp = document.querySelector('.row[data-i="' + i + '"] input'); if (inp) inp.focus(); return; }
    if (r.action) r.action(r);
  }
  function optionsLecture() { const s = L.courant(); if (s) pousser(ecranOptionsSon(s.id, { lecture: true })); }
  Roue.creer($('roue'), {
    tourner,
    centre: () => { const e = cur(); if (e.type === 'lecture') optionsLecture(); else activer(e.sel); },
    centreLong: () => { const e = cur(); if (e.type === 'lecture') { optionsLecture(); return; } const r = e.rows && e.rows[e.sel]; if (r && r.long) r.long(r); },
    menu: () => { if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur(); retour(); },
    play: () => {
      if (L.courant()) { L.basculer(); return; }
      if (!S.sons.length) { msg('Aucun son.\nChoisis « Ajouter des sons ».'); return; }
      jouerListe(idsDe(sonsTries()), 0);
    },
    precedent: () => { if (!L.courant()) return msg('Aucun titre'); L.precedent(); },
    suivant: () => { if (!L.courant()) return msg('Aucun titre'); L.suivant(); },
    tenir: (dir) => { if (L.courant()) L.tenir(dir); },
    relacher: () => L.arreterTenir(),
  });

  // toucher l'écran
  $('vue').addEventListener('click', (ev) => {
    const art = ev.target.closest('[data-act=pochette]');
    if (art) { const s = L.courant(); if (s) choisirPochette([s.id]); return; }
    const row = ev.target.closest('.row'); if (!row) return;
    const e = cur(), i = +row.dataset.i;
    if (ev.target.tagName === 'INPUT') { e.sel = i; majSel(); return; }
    e.sel = i; majSel(); Roue.tic(true); activer(i);
  });
  $('vue').addEventListener('input', (ev) => {
    const t = ev.target, e = cur(); if (!t.dataset || !t.dataset.id || !e.champs) return;
    const c = e.champs.find((x) => x.id === t.dataset.id); if (c) c.valeur = t.value;
  });
  $('vue').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); const e = cur(); if (e.valider) e.valider(); } });
  window.addEventListener('scroll', () => window.scrollTo(0, 0));

  /* ---------- événements du lecteur ---------- */
  L.on('change', () => { rendre(); });
  L.on('etat', () => { majEtatBarre(); });
  L.on('temps', (t, d) => {
    majTemps();
    const s = L.courant(); if (s && !s.duree && d > 0) { s.duree = d; sauverSons([s]); }
  });
  L.on('erreur', (m, s) => msg((m || 'Erreur') + (s ? '\n« ' + s.titre.slice(0, 30) + ' »' : ''), 2600));

  /* ---------- démarrage ---------- */
  async function demarrer() {
    const ok = await DB.ouvrir();
    let etatLecteur = null;
    if (ok) {
      const [sons, pls, metas] = await Promise.all([DB.tout('sons'), DB.tout('playlists'), DB.tout('meta')]);
      S.sons = sons; sons.forEach((s) => S.parId.set(s.id, s));
      S.playlists = pls.map((p) => ({ ...p, ids: (p.ids || []).filter((i) => S.parId.has(i)) }));
      metas.forEach((m) => { if (m.cle === 'reglages') S.reglages = { ...S.reglages, ...m.valeur }; if (m.cle === 'lecteur') etatLecteur = m.valeur; });
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* rien */ }
    }
    L.definirSons(sonDe);
    appliquerEcran(); Roue.clic(S.reglages.clic);
    pile = [ecranMenu()];
    rendre();
    if (etatLecteur) L.restaurer(etatLecteur);
    if (!ok) msg("Stockage indisponible : les sons ne seront pas gardés (quitte la navigation privée)", 4000);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
    self.Mp3App = { S, pile: () => pile, rendre, cur, pousser, retour, importer, jouerListe, choisirPochette, tourner, activer, msg };
  }
  demarrer();
})();
