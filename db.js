/* db.js — stockage dans l'appareil (IndexedDB) : infos des sons, fichiers audio, playlists, réglages. */
(function (racine) {
  'use strict';
  const NOM = 'mp3-v1';
  const MAGASINS = ['sons', 'audio', 'playlists', 'meta'];
  let db = null;

  function ouvrir() {
    return new Promise((ok) => {
      if (!racine.indexedDB) return ok(false);
      let r;
      try { r = indexedDB.open(NOM, 1); } catch (e) { return ok(false); }
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('sons', { keyPath: 'id' });       // infos : titre, artiste, album, durée, pochette (petite image)
        d.createObjectStore('audio', { keyPath: 'id' });      // le fichier son lui-même (gardé à part pour ne pas tout charger)
        d.createObjectStore('playlists', { keyPath: 'id' });
        d.createObjectStore('meta', { keyPath: 'cle' });
      };
      r.onsuccess = () => { db = r.result; ok(true); };
      r.onerror = () => ok(false);
      r.onblocked = () => ok(false);
    });
  }

  function tx(magasins, mode, fn) {
    return new Promise((ok, ko) => {
      if (!db) return ok(undefined);
      let res;
      const t = db.transaction(magasins, mode);
      t.oncomplete = () => ok(res && 'result' in res ? res.result : res);
      t.onerror = () => ko(t.error);
      t.onabort = () => ko(t.error);
      res = fn(t);
    });
  }
  const tout = (m) => tx([m], 'readonly', (t) => t.objectStore(m).getAll()).then((r) => r || []);
  const lire = (m, id) => tx([m], 'readonly', (t) => t.objectStore(m).get(id));
  const mettre = (m, objets) => objets.length ? tx([m], 'readwrite', (t) => { const s = t.objectStore(m); objets.forEach((o) => s.put(o)); }) : Promise.resolve();
  const supprimer = (m, ids) => ids.length ? tx([m], 'readwrite', (t) => { const s = t.objectStore(m); ids.forEach((i) => s.delete(i)); }) : Promise.resolve();
  const vider = () => tx(MAGASINS, 'readwrite', (t) => { MAGASINS.forEach((m) => t.objectStore(m).clear()); });
  // enregistre un son entièrement (infos + fichier) en une seule opération : tout ou rien
  const ajouterSon = (son, blob) => tx(['sons', 'audio'], 'readwrite', (t) => { t.objectStore('sons').put(son); t.objectStore('audio').put({ id: son.id, blob }); });
  const retirerSons = (ids) => ids.length ? tx(['sons', 'audio'], 'readwrite', (t) => { ids.forEach((i) => { t.objectStore('sons').delete(i); t.objectStore('audio').delete(i); }); }) : Promise.resolve();

  racine.Mp3DB = { ouvrir, tout, lire, mettre, supprimer, vider, ajouterSon, retirerSons };
})(typeof self !== 'undefined' ? self : this);
