/* tags.js — lit les infos d'un fichier son : titre, artiste, album, numéro de piste, pochette.
   MP3 (ID3v2 et ID3v1) et M4A/AAC (iTunes). Les autres formats : on garde le nom du fichier. */
(function (racine) {
  'use strict';

  /* ---------- texte ---------- */
  function decoder(octets, enc) {
    try {
      if (enc === 1) {                                            // UTF-16 avec BOM
        let little = true, debut = 0;
        if (octets[0] === 0xff && octets[1] === 0xfe) { debut = 2; } else if (octets[0] === 0xfe && octets[1] === 0xff) { little = false; debut = 2; }
        return new TextDecoder(little ? 'utf-16le' : 'utf-16be').decode(octets.subarray(debut));
      }
      if (enc === 2) return new TextDecoder('utf-16be').decode(octets);
      if (enc === 3) return new TextDecoder('utf-8').decode(octets);
      return new TextDecoder('windows-1252').decode(octets);       // ISO-8859-1
    } catch (e) { return ''; }
  }
  const nettoyer = (s) => String(s || '').replace(/\u0000+$/g, '').split('\u0000')[0].replace(/^﻿/, '').trim();

  // position de la fin d'une chaîne terminée par zéro (1 octet pour latin1/utf8, 2 pour utf16)
  function finChaine(o, debut, enc) {
    if (enc === 1 || enc === 2) { for (let i = debut; i + 1 < o.length; i += 2) if (o[i] === 0 && o[i + 1] === 0) return i; return o.length; }
    for (let i = debut; i < o.length; i++) if (o[i] === 0) return i;
    return o.length;
  }
  const pas = (enc) => (enc === 1 || enc === 2 ? 2 : 1);

  function typeImage(o, mime) {
    if (o[0] === 0xff && o[1] === 0xd8) return 'image/jpeg';
    if (o[0] === 0x89 && o[1] === 0x50) return 'image/png';
    if (o[0] === 0x47 && o[1] === 0x49) return 'image/gif';
    if (o[8] === 0x57 && o[9] === 0x45) return 'image/webp';
    const m = String(mime || '').toLowerCase();
    return m.indexOf('/') > 0 ? m : (m === 'png' ? 'image/png' : 'image/jpeg');
  }

  /* ---------- MP3 : ID3v2 ---------- */
  async function lireId3v2(fichier) {
    const tete = new Uint8Array(await fichier.slice(0, 10).arrayBuffer());
    if (tete.length < 10 || tete[0] !== 0x49 || tete[1] !== 0x44 || tete[2] !== 0x33) return null;
    const version = tete[3], drapeaux = tete[5];
    const taille = ((tete[6] & 0x7f) << 21) | ((tete[7] & 0x7f) << 14) | ((tete[8] & 0x7f) << 7) | (tete[9] & 0x7f);
    let o = new Uint8Array(await fichier.slice(10, 10 + taille).arrayBuffer());
    if (drapeaux & 0x80 && version < 4) {                            // « désynchronisation » : on retire les 00 ajoutés après FF
      const net = []; for (let i = 0; i < o.length; i++) { net.push(o[i]); if (o[i] === 0xff && o[i + 1] === 0) i++; }
      o = Uint8Array.from(net);
    }
    let p = 0;
    if (drapeaux & 0x40) {                                           // en-tête étendu : on le saute
      const t = version === 4 ? (((o[0] & 0x7f) << 21) | ((o[1] & 0x7f) << 14) | ((o[2] & 0x7f) << 7) | (o[3] & 0x7f)) : (((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) + 4);
      p = Math.min(t, o.length);
    }
    const res = { titre: '', artiste: '', album: '', piste: 0, image: null };
    const long = version === 2 ? 3 : 4, ent = version === 2 ? 6 : 10;
    let meilleureImage = null, typeMeilleure = 99;
    while (p + ent <= o.length) {
      const id = String.fromCharCode(...o.subarray(p, p + long));
      if (!/^[A-Z0-9]+$/.test(id)) break;                             // fin des infos (zone de remplissage)
      let t;
      if (version === 2) t = (o[p + 3] << 16) | (o[p + 4] << 8) | o[p + 5];
      else if (version === 4) t = ((o[p + 4] & 0x7f) << 21) | ((o[p + 5] & 0x7f) << 14) | ((o[p + 6] & 0x7f) << 7) | (o[p + 7] & 0x7f);
      else t = ((o[p + 4] << 24) | (o[p + 5] << 16) | (o[p + 6] << 8) | o[p + 7]) >>> 0;
      const corps = o.subarray(p + ent, Math.min(p + ent + t, o.length));
      p += ent + t;
      if (!corps.length) continue;
      const texte = () => nettoyer(decoder(corps.subarray(1), corps[0]));
      if (id === 'TIT2' || id === 'TT2') res.titre = res.titre || texte();
      else if (id === 'TPE1' || id === 'TP1') res.artiste = res.artiste || texte();
      else if (id === 'TALB' || id === 'TAL') res.album = res.album || texte();
      else if (id === 'TRCK' || id === 'TRK') res.piste = res.piste || (parseInt(texte(), 10) || 0);
      else if ((id === 'APIC' || id === 'PIC') && corps.length > 20) {
        const enc = corps[0];
        let q = 1, mime = '';
        if (id === 'PIC') { mime = String.fromCharCode(...corps.subarray(1, 4)); q = 4; }
        else { const f = finChaine(corps, 1, 0); mime = String.fromCharCode(...corps.subarray(1, f)); q = f + 1; }
        const typePhoto = corps[q]; q++;
        const f2 = finChaine(corps, q, enc); q = f2 + pas(enc);
        const donnees = corps.subarray(q);
        if (donnees.length > 100) {
          const rang = typePhoto === 3 ? 0 : typePhoto === 0 ? 1 : 2;           // préférence : pochette de face
          if (rang < typeMeilleure) { typeMeilleure = rang; meilleureImage = new Blob([donnees], { type: typeImage(donnees, mime) }); }
        }
      }
    }
    res.image = meilleureImage;
    return res;
  }

  /* ---------- MP3 : ID3v1 (128 derniers octets) ---------- */
  async function lireId3v1(fichier) {
    if (fichier.size < 128) return null;
    const o = new Uint8Array(await fichier.slice(fichier.size - 128).arrayBuffer());
    if (o[0] !== 0x54 || o[1] !== 0x41 || o[2] !== 0x47) return null;
    const ch = (a, b) => nettoyer(decoder(o.subarray(a, b), 0));
    return { titre: ch(3, 33), artiste: ch(33, 63), album: ch(63, 93), piste: o[125] === 0 && o[126] ? o[126] : 0, image: null };
  }

  /* ---------- M4A / MP4 ---------- */
  async function lireAtome(fichier, pos) {
    const e = new DataView(await fichier.slice(pos, pos + 16).arrayBuffer());
    if (e.byteLength < 8) return null;
    let taille = e.getUint32(0), entete = 8;
    const type = String.fromCharCode(e.getUint8(4), e.getUint8(5), e.getUint8(6), e.getUint8(7));
    if (taille === 1 && e.byteLength >= 16) { taille = e.getUint32(8) * 4294967296 + e.getUint32(12); entete = 16; }
    else if (taille === 0) taille = fichier.size - pos;
    if (taille < entete) return null;
    return { type, pos, taille, entete };
  }
  function enfants(o, debut, fin) {
    const liste = []; let p = debut;
    while (p + 8 <= fin) {
      const t = ((o[p] << 24) | (o[p + 1] << 16) | (o[p + 2] << 8) | o[p + 3]) >>> 0;
      const type = String.fromCharCode(o[p + 4], o[p + 5], o[p + 6], o[p + 7]);
      if (t < 8) break;
      liste.push({ type, debut: p + 8, fin: Math.min(p + t, fin) }); p += t;
    }
    return liste;
  }
  async function lireMp4(fichier) {
    let pos = 0, moov = null;
    for (let n = 0; n < 40 && pos < fichier.size; n++) {
      const a = await lireAtome(fichier, pos);
      if (!a) return null;
      if (a.type === 'moov') { moov = a; break; }
      pos += a.taille;
    }
    if (!moov || moov.taille > 40e6) return null;
    const o = new Uint8Array(await fichier.slice(moov.pos, moov.pos + moov.taille).arrayBuffer());
    const trouver = (liste, type) => liste.find((x) => x.type === type);
    const udta = trouver(enfants(o, 8, o.length), 'udta'); if (!udta) return null;
    const meta = trouver(enfants(o, udta.debut, udta.fin), 'meta'); if (!meta) return null;
    const ilst = trouver(enfants(o, meta.debut + 4, meta.fin), 'ilst'); if (!ilst) return null;
    const res = { titre: '', artiste: '', album: '', piste: 0, image: null };
    for (const champ of enfants(o, ilst.debut, ilst.fin)) {
      const data = trouver(enfants(o, champ.debut, champ.fin), 'data'); if (!data) continue;
      const v = o.subarray(data.debut + 8, data.fin), genre = ((o[data.debut + 1] << 16) | (o[data.debut + 2] << 8) | o[data.debut + 3]);
      const nom = champ.type;
      if (nom === '©nam') res.titre = nettoyer(decoder(v, 3));
      else if (nom === '©ART') res.artiste = nettoyer(decoder(v, 3));
      else if (nom === '©alb') res.album = nettoyer(decoder(v, 3));
      else if (nom === 'trkn' && v.length >= 4) res.piste = (v[2] << 8) | v[3];
      else if (nom === 'covr' && v.length > 100) res.image = new Blob([v], { type: genre === 14 ? 'image/png' : typeImage(v, '') });
    }
    return res;
  }

  /* ---------- lecture d'un fichier ---------- */
  function depuisNom(nom) {
    const sans = String(nom || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    const m = /^(.{1,60}?)\s+[-–—]\s+(.+)$/.exec(sans);
    return m ? { artiste: m[1].trim(), titre: m[2].trim() } : { artiste: '', titre: sans };
  }
  async function lire(fichier) {
    let t = null;
    try {
      const nom = (fichier.name || '').toLowerCase();
      if (/\.(m4a|mp4|aac|m4b)$/.test(nom) || /mp4|m4a|aac/.test(fichier.type || '')) t = await lireMp4(fichier);
      if (!t) t = await lireId3v2(fichier);
      if (!t || (!t.titre && !t.artiste)) { const v1 = await lireId3v1(fichier); if (v1) t = { ...(t || {}), ...Object.fromEntries(Object.entries(v1).filter(([, v]) => v)), image: t && t.image }; }
    } catch (e) { t = null; }
    t = t || { titre: '', artiste: '', album: '', piste: 0, image: null };
    const n = depuisNom(fichier.name);
    if (!t.titre) { t.titre = n.titre || 'Sans titre'; if (!t.artiste) t.artiste = n.artiste; }
    return t;
  }

  /* ---------- pochette : on réduit l'image (carré 480 px max) pour la garder légère ---------- */
  async function reduireImage(blob, max) {
    max = max || 480;
    if (!blob) return null;
    try {
      let bmp, w, h;
      try { bmp = await createImageBitmap(blob); w = bmp.width; h = bmp.height; }
      catch (e) {
        bmp = await new Promise((ok, ko) => { const i = new Image(); const u = URL.createObjectURL(blob); i.onload = () => { URL.revokeObjectURL(u); ok(i); }; i.onerror = () => { URL.revokeObjectURL(u); ko(e); }; i.src = u; });
        w = bmp.naturalWidth; h = bmp.naturalHeight;
      }
      if (!w || !h) return null;
      const c = Math.min(w, h), sx = (w - c) / 2, sy = (h - c) / 2;           // on recadre au carré, au centre
      const cote = Math.min(max, c);
      const cv = document.createElement('canvas'); cv.width = cote; cv.height = cote;
      const x = cv.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, cote, cote);
      x.drawImage(bmp, sx, sy, c, c, 0, 0, cote, cote);
      if (bmp.close) bmp.close();
      return cv.toDataURL('image/jpeg', 0.82);
    } catch (e) { return null; }
  }

  /* ---------- durée : on laisse le navigateur la lire ---------- */
  function duree(blob) {
    return new Promise((ok) => {
      const a = new Audio(); const u = URL.createObjectURL(blob);
      let fini = false;
      const fin = (v) => { if (fini) return; fini = true; clearTimeout(t); a.removeAttribute('src'); try { a.load(); } catch (e) { /* rien */ } URL.revokeObjectURL(u); ok(v); };
      const t = setTimeout(() => fin(0), 6000);
      a.preload = 'metadata';
      a.onloadedmetadata = () => fin(isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => fin(-1);                                              // -1 : le navigateur ne sait pas lire ce fichier
      a.src = u;
    });
  }

  racine.Mp3Tags = { lire, reduireImage, duree };
})(typeof self !== 'undefined' ? self : this);
