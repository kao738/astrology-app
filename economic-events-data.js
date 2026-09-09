/* ==========================================================================
   economic-events-data.js — 経済イベントデータ（手動管理）
   将来的に自動取得APIへ差し替えられるよう、天空イベントと同じ「1件=1オブジェクト」
   のフラットな配列にしてある。天空イベントカレンダー側は category:'economic' として
   同じタイムライン上に重ねて表示する想定（SkyEvents.getAllEventsとは別に、
   calendar-ui.js側でECONOMIC_EVENTSをマージする）。

   type一覧（今後増やしてよい）：
     fomc | cpi | ppi | pce | employment | boj | ecb | other
   dateJSTが未確定の場合は timeConfirmed:false にして時刻部分をダミーにする。
   ========================================================================== */
const ECONOMIC_EVENTS = [
  {
    id:'cpi_20260911', category:'economic', type:'cpi', country:'US',
    label:'米CPI（消費者物価指数）', dateJST:'2026-09-11T21:30:00+09:00',
    timeConfirmed:true, importance:'critical',
    note:'9月利上げの有無を左右する最大の材料',
    source:'手動入力（2026-09-10時点の報道ベース）',
  },
  {
    id:'ppi_20260910', category:'economic', type:'ppi', country:'US',
    label:'米PPI（生産者物価指数）', dateJST:'2026-09-10T21:30:00+09:00',
    timeConfirmed:true, importance:'high',
    note:'',
    source:'手動入力（2026-09-10時点の報道ベース）',
  },
  {
    id:'fomc_20260916', category:'economic', type:'fomc', country:'US',
    label:'FOMC政策金利発表（9/15〜16開催）', dateJST:'2026-09-17T03:00:00+09:00',
    timeConfirmed:false, importance:'critical',
    note:'9/15(火)〜16(水)開催、結果発表は米東部時間16日午後（日本時間17日未明）が通例',
    source:'手動入力（2026-09-10時点の報道ベース）',
  },
];

// 経済イベントを SkyEvents 互換の形（jd, title, importance等）に変換するヘルパー。
// jd計算に toJD() ではなく単純な日付換算を使うのは、経済イベントはローカル分単位の精度で
// 十分なため（占星術イベントのような秒単位の二分探索は不要）。
function economicEventToSkyFormat(ev){
  const d = new Date(ev.dateJST);
  const jd = d.getTime()/86400000 + 2440587.5;
  return {
    id: ev.id, category:'economic', type: ev.type, jd,
    title: ev.label, detail: ev.note||'', importance: ev.importance||'normal',
    keywords: [], timeConfirmed: ev.timeConfirmed!==false,
  };
}
