/* ==========================================================================
   market-data.js — market-oracle（別プロジェクト）が収集した日経平均・
   S&P500・オルカンの実測値を読み込み、天空イベントの検証記録に自動表示する。

   データソース：./data/market-data.json（market-oracleのexport_astrology_app_data.py
   が毎朝7時の自動収集ジョブから書き出す。{"YYYY-MM-DD": {"日経平均":..,"S&P500":..,"オルカン":..}}）
   ローカルにファイルが無い場合（fetch失敗）は機能しないだけで、他の機能には影響しない。
   ========================================================================== */
const MarketData = (() => {
  let cache = null;
  let loadPromise = null;

  async function load(){
    if(cache) return cache;
    if(!loadPromise){
      loadPromise = fetch('./data/market-data.json')
        .then(r => { if(!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
        .then(data => { cache = data; return data; })
        .catch(err => {
          console.warn('[MarketData] market-data.jsonの読み込みに失敗しました。天空イベントの検証記録は手動入力のみになります。', err);
          loadPromise = null; // 失敗はキャッシュせず、次回呼び出しで再試行できるようにする
          return {};
        });
    }
    return loadPromise;
  }

  // dateStr: 'YYYY-MM-DD'。当日データが無い場合は直近後方向（最大7日）に遡って探す
  // （祝日・休場日でも直前の終値を参考表示できるようにするため）
  async function getNear(dateStr){
    const data = await load();
    let d = new Date(dateStr + 'T00:00:00Z');
    for(let i=0;i<7;i++){
      const key = d.toISOString().slice(0,10);
      if(data[key]) return {date:key, ...data[key]};
      d.setUTCDate(d.getUTCDate()-1);
    }
    return null;
  }

  return { load, getNear };
})();
