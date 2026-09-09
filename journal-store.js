/* ==========================================================================
   journal-store.js — 天空イベントの検証記録（localStorage永続化）
   既存の hoshiyomi_profiles_v1 と同じ「JSON配列/オブジェクトをlocalStorageに
   丸ごと保存する」パターンを踏襲。イベントの id をキーにした連想オブジェクト。
   ========================================================================== */
const Journal = (() => {
  const KEY = 'hoshiyomi_event_journal_v1';

  function loadAll(){
    try{ return JSON.parse(localStorage.getItem(KEY)) || {}; }catch{ return {}; }
  }
  function saveAll(obj){ localStorage.setItem(KEY, JSON.stringify(obj)); }

  function get(eventId){
    const all=loadAll();
    return all[eventId] || {preNote:'', actualOutcome:'', marketData:{nikkei:'',nasdaq:'',vix:'',dxy:'',us10y:'',btc:'',oil:''}, verifyNote:'', updatedAt:''};
  }
  function save(eventId, entry){
    const all=loadAll();
    all[eventId] = {...get(eventId), ...entry, updatedAt:new Date().toISOString()};
    saveAll(all);
    return all[eventId];
  }
  function remove(eventId){
    const all=loadAll();
    delete all[eventId];
    saveAll(all);
  }
  function hasEntry(eventId){
    const e=loadAll()[eventId];
    if(!e) return false;
    return !!(e.preNote || e.actualOutcome || e.verifyNote || Object.values(e.marketData||{}).some(v=>v));
  }
  function listAll(){ return loadAll(); }

  return { get, save, remove, hasEntry, listAll };
})();
