/* ==========================================================================
   sky-events.js — 天空イベントカレンダー：計算エンジン
   役割：ネイタルチャートに依存しない「惑星同士」のアスペクト・サイン移動・
   逆行/順行・月相・日食/月食・ノード・複合アスペクトの検出。

   依存（index.html本体の<script>で定義済みのグローバルを再利用。
   読み込み順は astronomy-engine CDN → index.html本体 → 本ファイル、の順を守ること）：
     Astronomy（astronomy-engine CDN）, calcPlanet, PLANETS, PSYM, PNAMES,
     SIGNS, SSYM, findIngressJD, findStationJD, jdToDate, fmtDate
   新規に定義するのは SkyEvents オブジェクトのみ（既存グローバルとの衝突を避けるため名前空間化）。
   ========================================================================== */
const SkyEvents = (() => {

  // ---- 対象天体・フィルター用グルーピング ----
  const ALL_BODIES = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'];
  const OUTER_BODIES = ['Jupiter','Saturn','Uranus','Neptune','Pluto'];       // 木星以遠
  const TRANSPERSONAL_BODIES = ['Uranus','Neptune','Pluto'];                  // 土星以遠（世代天体）
  const SOCIAL_BODIES = ['Jupiter','Saturn'];                                 // 社会天体
  const NODE_LABEL = {Ascending:'ドラゴンヘッド（昇交点）', Descending:'ドラゴンテイル（降交点）'};
  const NODE_SYM = {Ascending:'☊', Descending:'☋'};

  const BODY_STEP = {Sun:3, Moon:0.5, Mercury:2, Venus:2, Mars:2, Jupiter:5, Saturn:8, Uranus:12, Neptune:15, Pluto:15};

  const ASPECT_DEFS = [
    {name:'コンジャンクション', sym:'☌', ang:0,   cls:'conj',  key:'conj'},
    {name:'セクスタイル',      sym:'⚹', ang:60,  cls:'sext',  key:'sext'},
    {name:'スクエア',          sym:'□', ang:90,  cls:'sq',    key:'sq'},
    {name:'トライン',          sym:'△', ang:120, cls:'trine', key:'trine'},
    {name:'オポジション',      sym:'☍', ang:180, cls:'opp',   key:'opp'},
  ];

  // ---- オーブ設定（localStorage保存、初期値は一般的な範囲） ----
  const ORB_KEY = 'hoshiyomi_sky_orb_v1';
  const DEFAULT_ORBS = {conj:8, opp:8, trine:8, sq:7, sext:6};
  function getOrbSettings(){
    try{ return {...DEFAULT_ORBS, ...(JSON.parse(localStorage.getItem(ORB_KEY))||{})}; }catch{ return {...DEFAULT_ORBS}; }
  }
  function saveOrbSettings(orbs){ localStorage.setItem(ORB_KEY, JSON.stringify(orbs)); }
  function resetOrbSettings(){ localStorage.removeItem(ORB_KEY); return {...DEFAULT_ORBS}; }

  // ---- 基本ユーティリティ ----
  function diffAbs(a,b){ const d=Math.abs(a-b); return d>180?360-d:d; }
  function signIndexAt(p,jd){ return Math.floor((((calcPlanet(p,jd)%360)+360)%360)/30); }
  function jdFromDate(date){ return date.getTime()/86400000 + 2440587.5; }

  function getAspectWithOrb(a,b,orbs){
    let diff=Math.abs(a-b); if(diff>180) diff=360-diff;
    for(const d of ASPECT_DEFS){
      const orb = orbs[d.key] ?? 8;
      const o = Math.abs(diff-d.ang);
      if(o<=orb) return {...d, orb:+o.toFixed(2)};
    }
    return null;
  }

  // 惑星同士（両方が動く）のアスペクトが正確に成立する瞬間を二分探索
  function findTransitAspectExactJD(p1,p2,jdA,jdB,targetAngle){
    function f(t){ return diffAbs(calcPlanet(p1,t), calcPlanet(p2,t)) - targetAngle; }
    let lo=jdA, hi=jdB, flo=f(lo);
    for(let i=0;i<28;i++){
      const mid=(lo+hi)/2, fm=f(mid);
      if((fm>=0)===(flo>=0)){ lo=mid; flo=fm; } else { hi=mid; }
    }
    return (lo+hi)/2;
  }

  // ---- 重要度・キーワード ----
  const KEYWORDS = {
    Sun:['自己表現','活力','方向性'], Moon:['感情','無意識','生活基盤'],
    Mercury:['思考','情報','コミュニケーション'], Venus:['調和','価値観','関係性'],
    Mars:['行動','衝動','競争'], Jupiter:['拡大','幸運','海外・法'],
    Saturn:['制限','責任','構造'], Uranus:['革新','テクノロジー','急変'],
    Neptune:['幻想','霊性','曖昧さ'], Pluto:['変容','支配','再生'],
  };
  function keywordsFor(bodies){
    const set=new Set();
    bodies.forEach(b=>(KEYWORDS[b]||[]).slice(0,2).forEach(k=>set.add(k)));
    return [...set].slice(0,5);
  }

  function classifyAspectImportance(p1,p2){
    // scanAspectEventsが生成するのは常に「正確な成立瞬間」のイベントなので、
    // オーブの大小ではなく関与する天体の組み合わせだけで重要度を決める。
    const t1=TRANSPERSONAL_BODIES.includes(p1), t2=TRANSPERSONAL_BODIES.includes(p2);
    const s1=SOCIAL_BODIES.includes(p1), s2=SOCIAL_BODIES.includes(p2);
    if(t1&&t2) return 'critical';                                    // 外惑星同士の正確なアスペクト
    if((s1&&t2)||(s2&&t1)||(s1&&s2)) return 'high';                  // 木星・土星と外惑星のアスペクト
    return 'normal';
  }
  function classifyIngressStationImportance(p){
    return OUTER_BODIES.includes(p) ? 'high' : 'normal';
  }

  // ---- イベント生成ヘルパー ----
  function makeAspectEvent(p1,p2,jd,def){
    const s1=signIndexAt(p1,jd), s2=signIndexAt(p2,jd);
    return {
      id:`aspect_${p1}_${p2}_${def.cls}_${Math.round(jd*1440)}`,
      category:'astro', type:'aspect',
      jd, bodies:[p1,p2],
      title:`${PSYM[p1]} ${PNAMES[p1]} ${def.sym} ${PSYM[p2]} ${PNAMES[p2]}`,
      aspect:{name:def.name, sym:def.sym, angle:def.ang},
      signs:{[p1]:SIGNS[s1], [p2]:SIGNS[s2]},
      importance: classifyAspectImportance(p1,p2),
      keywords: keywordsFor([p1,p2]),
    };
  }
  function makeIngressEvent(p,jd,fromSign,toSign){
    return {
      id:`ingress_${p}_${Math.round(jd*1440)}`,
      category:'astro', type:'ingress', jd, bodies:[p],
      title:`${PSYM[p]} ${PNAMES[p]} が${SIGNS[toSign]}へ移動`,
      detail:`${SIGNS[fromSign]} → ${SIGNS[toSign]}`,
      importance: classifyIngressStationImportance(p),
      keywords: keywordsFor([p]),
    };
  }
  function makeStationEvent(p,jd,toDirection){
    return {
      id:`station_${p}_${Math.round(jd*1440)}`,
      category:'astro', type:'station', jd, bodies:[p],
      title:`${PSYM[p]} ${PNAMES[p]} ${toDirection==='R'?'逆行開始':'順行再開'}`,
      detail: toDirection==='R'?'逆行開始':'順行再開',
      importance: classifyIngressStationImportance(p),
      keywords: keywordsFor([p]),
    };
  }
  function makeMoonPhaseEvent(quarter,jd){
    const names=['新月','上弦の月','満月','下弦の月'];
    const syms=['🌑','🌓','🌕','🌗'];
    const s=signIndexAt('Moon',jd);
    return {
      id:`moonphase_${quarter}_${Math.round(jd*1440)}`,
      category:'astro', type:'moonphase', jd, bodies:['Moon','Sun'],
      title:`${syms[quarter]} ${names[quarter]}（${SIGNS[s]}）`,
      detail:`月：${SIGNS[s]}`,
      importance:'normal',
      keywords: quarter===0?['始まり','種まき']:quarter===2?['達成','解放','手放し']:['調整','転換点'],
    };
  }
  function makeEclipseEvent(kind, isSolar, jd, extra){
    // EclipseKindは小文字の文字列enum（'penumbral'|'partial'|'annular'|'total'）
    const kindLabel = {total:'皆既', partial:'部分', annular:'金環', penumbral:'半影'}[kind] || String(kind);
    const important = (kind==='total'||kind==='annular') ? 'critical' : 'high';
    const s=signIndexAt(isSolar?'Sun':'Moon',jd);
    const eclipseWord = isSolar?'日食':'月食';
    return {
      id:`eclipse_${isSolar?'solar':'lunar'}_${Math.round(jd*1440)}`,
      category:'astro', type:'eclipse', jd, bodies:isSolar?['Sun','Moon']:['Moon','Sun'],
      title:`${isSolar?'☉':'☽'} ${kindLabel}${eclipseWord}`,
      eclipseKind:kind, isSolar,
      detail:`${kindLabel}${eclipseWord}（${SIGNS[s]}）`,
      importance: important,
      keywords:['転換','終わりと始まり','外的変化'],
      ...extra,
    };
  }
  function makeNodeEvent(kind,jd,fromSign,toSign){
    return {
      id:`node_${kind}_${Math.round(jd*1440)}`,
      category:'astro', type:'node', jd, bodies:['Node'], nodeKind:kind,
      title:`${NODE_SYM[kind]} ${NODE_LABEL[kind]}が${SIGNS[toSign]}へ移動`,
      detail:`${SIGNS[fromSign]} → ${SIGNS[toSign]}`,
      importance:'high',
      keywords:['運命の方向性','人生のテーマ'],
    };
  }
  function makeCompositeEvent(patternKind,bodies,startJD,endJD,peakJD,label){
    const important = bodies.every(b=>TRANSPERSONAL_BODIES.includes(b)) ? 'critical' : 'high';
    return {
      id:`pattern_${patternKind}_${bodies.join('-')}_${Math.round(peakJD*1440)}`,
      category:'astro', type:'pattern', patternKind,
      jd:peakJD, periodStart:startJD, periodEnd:endJD, bodies,
      title:`${label}（${bodies.map(b=>PSYM[b]).join(' ')}）`,
      detail: bodies.map(b=>`${PSYM[b]}${PNAMES[b]}`).join('・'),
      importance: important,
      keywords: keywordsFor(bodies),
    };
  }

  // ---- スキャン関数 ----
  function scanAspectEvents(bodies,startJD,endJD,orbs){
    const events=[];
    for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++){
      const p1=bodies[i],p2=bodies[j];
      const step=Math.min(BODY_STEP[p1]||5, BODY_STEP[p2]||5);
      const samples=[]; for(let t=startJD;t<endJD;t+=step) samples.push(t); samples.push(endJD);
      // 惑星位置はサンプル点ごとに1回だけ計算し、5種のアスペクト判定で使い回す
      const pos1=samples.map(t=>calcPlanet(p1,t));
      const pos2=samples.map(t=>calcPlanet(p2,t));
      ASPECT_DEFS.forEach(def=>{
        let prev=diffAbs(pos1[0],pos2[0])-def.ang;
        for(let k=1;k<samples.length;k++){
          const cur=diffAbs(pos1[k],pos2[k])-def.ang;
          if((prev<=0&&cur>0)||(prev>=0&&cur<0)){
            const jd=findTransitAspectExactJD(p1,p2,samples[k-1],samples[k],def.ang);
            events.push(makeAspectEvent(p1,p2,jd,def));
          }
          prev=cur;
        }
      });
    }
    return events;
  }

  function scanIngressEvents(bodies,startJD,endJD){
    const events=[];
    bodies.forEach(p=>{
      const step=BODY_STEP[p]||5;
      const samples=[]; for(let t=startJD;t<endJD;t+=step) samples.push(t); samples.push(endJD);
      let prevSign=signIndexAt(p,samples[0]);
      for(let i=1;i<samples.length;i++){
        const s=signIndexAt(p,samples[i]);
        if(s!==prevSign){
          const jd=findIngressJD(p,samples[i-1],samples[i],prevSign);
          events.push(makeIngressEvent(p,jd,prevSign,s));
          prevSign=s;
        }
      }
    });
    return events;
  }

  function scanStationEvents(bodies,startJD,endJD){
    const events=[];
    bodies.filter(p=>p!=='Sun'&&p!=='Moon').forEach(p=>{
      const step=BODY_STEP[p]||5;
      const samples=[]; for(let t=startJD;t<endJD;t+=step) samples.push(t); samples.push(endJD);
      if(samples.length<3) return;
      let prevDir=calcPlanet(p,samples[1])-calcPlanet(p,samples[0]);
      prevDir=((prevDir+540)%360-180)>=0?1:-1;
      for(let i=2;i<samples.length;i++){
        let d=calcPlanet(p,samples[i])-calcPlanet(p,samples[i-1]);
        d=((d+540)%360-180);
        const dir=d>=0?1:-1;
        if(dir!==prevDir){
          const jd=findStationJD(p,samples[i-2],samples[i]);
          events.push(makeStationEvent(p,jd,dir<0?'R':'D'));
          prevDir=dir;
        }
      }
    });
    return events;
  }

  // astronomy-engine 組み込み関数を利用（新月/満月、日食/月食、ノード）
  function scanMoonPhaseEvents(startJD,endJD){
    const events=[];
    let mq=Astronomy.SearchMoonQuarter(jdToDate(startJD));
    let guard=0;
    while(mq && jdFromDate(mq.time.date)<=endJD && guard<400){
      const jd=jdFromDate(mq.time.date);
      if(jd>=startJD) events.push(makeMoonPhaseEvent(mq.quarter,jd));
      mq=Astronomy.NextMoonQuarter(mq);
      guard++;
    }
    return events;
  }

  function scanEclipseEvents(startJD,endJD){
    const events=[];
    try{
      let se=Astronomy.SearchGlobalSolarEclipse(jdToDate(startJD));
      let guard=0;
      while(se && jdFromDate(se.peak.date)<=endJD && guard<50){
        const jd=jdFromDate(se.peak.date);
        if(jd>=startJD) events.push(makeEclipseEvent(String(se.kind),true,jd,{}));
        se=Astronomy.NextGlobalSolarEclipse(se.peak);
        guard++;
      }
    }catch(e){ console.warn('日食検索エラー',e); }
    try{
      let le=Astronomy.SearchLunarEclipse(jdToDate(startJD));
      let guard=0;
      while(le && jdFromDate(le.peak.date)<=endJD && guard<50){
        const jd=jdFromDate(le.peak.date);
        if(jd>=startJD) events.push(makeEclipseEvent(String(le.kind),false,jd,{}));
        le=Astronomy.NextLunarEclipse(le.peak);
        guard++;
      }
    }catch(e){ console.warn('月食検索エラー',e); }
    return events;
  }

  // 平均ドラゴンヘッド（昇交点）の黄経。Meeusの標準近似式（低精度で十分：符号変化がなく
  // 単調に逆行するため、サイン移動検出に向く）。astronomy-engineのSearchMoonNodeは
  // 「月が黄道面を横切る瞬間」（約27日周期）を返す別物の関数のため、ここでは使わない。
  function calcMeanNodeLon(jd){
    const T=(jd-2451545)/36525;
    const omega = 125.0445222 - 1934.1362608*T + 0.0020708*T*T + T*T*T/450000;
    return ((omega%360)+360)%360;
  }
  function findNodeIngressJD(jdA,jdB,startSign){
    let lo=jdA,hi=jdB;
    for(let i=0;i<24;i++){
      const mid=(lo+hi)/2;
      const s=Math.floor((((calcMeanNodeLon(mid)%360)+360)%360)/30);
      if(s===startSign) lo=mid; else hi=mid;
    }
    return hi;
  }
  function scanNodeEvents(startJD,endJD){
    const events=[];
    const step=20; // ノードは約18.6年で1周（1サイン約1.5年）のため粗いステップで十分
    const samples=[]; for(let t=startJD;t<endJD;t+=step) samples.push(t); samples.push(endJD);
    let prevSign=Math.floor((((calcMeanNodeLon(samples[0])%360)+360)%360)/30);
    for(let i=1;i<samples.length;i++){
      const s=Math.floor((((calcMeanNodeLon(samples[i])%360)+360)%360)/30);
      if(s!==prevSign){
        const jd=findNodeIngressJD(samples[i-1],samples[i],prevSign);
        events.push(makeNodeEvent('Ascending',jd,prevSign,s));
        events.push(makeNodeEvent('Descending',jd,(prevSign+6)%12,(s+6)%12));
        prevSign=s;
      }
    }
    return events;
  }

  // ---- 複合アスペクト（グランドトライン／Tスクエア／グランドクロス／ステリウム） ----
  // 日次サンプリングでアスペクトグラフを作り、パターンを検出。
  // ヨッド／カイトは今後の拡張（TODO）。
  function detectPatternsAtJD(bodies,jd,orbs){
    const pos={}; bodies.forEach(p=>pos[p]=calcPlanet(p,jd));
    const edges={}; // "p1|p2" -> aspect key
    bodies.forEach((p1,i)=>bodies.slice(i+1).forEach(p2=>{
      const a=getAspectWithOrb(pos[p1],pos[p2],orbs);
      if(a) edges[`${p1}|${p2}`]=a;
    }));
    function edgeOf(a,b){ return edges[`${a}|${b}`]||edges[`${b}|${a}`]||null; }

    const found=[];

    // ステリウム：同じサインに3天体以上
    const bySign={};
    bodies.forEach(p=>{ const s=Math.floor((((pos[p]%360)+360)%360)/30); (bySign[s]=bySign[s]||[]).push(p); });
    Object.values(bySign).forEach(group=>{ if(group.length>=3) found.push({kind:'stellium',bodies:[...group]}); });

    // グランドトライン：3天体すべてがトライン
    for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)for(let k=j+1;k<bodies.length;k++){
      const [a,b,c]=[bodies[i],bodies[j],bodies[k]];
      const e1=edgeOf(a,b),e2=edgeOf(b,c),e3=edgeOf(a,c);
      if(e1&&e2&&e3&&e1.cls==='trine'&&e2.cls==='trine'&&e3.cls==='trine'){
        found.push({kind:'grandTrine',bodies:[a,b,c]});
      }
      // Tスクエア：2天体がオポジション、両方が3天体目とスクエア
      if(e1&&e1.cls==='opp'&&e2&&e2.cls==='sq'&&e3&&e3.cls==='sq'){
        found.push({kind:'tsquare',bodies:[a,b,c],apex:c});
      }
      if(e3&&e3.cls==='opp'&&e1&&e1.cls==='sq'&&e2&&e2.cls==='sq'){
        found.push({kind:'tsquare',bodies:[a,c,b],apex:b});
      }
      if(e2&&e2.cls==='opp'&&e1&&e1.cls==='sq'&&e3&&e3.cls==='sq'){
        found.push({kind:'tsquare',bodies:[b,c,a],apex:a});
      }
    }
    // グランドクロス：4天体で2組のオポジション＋4本のスクエア
    for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++)for(let k=j+1;k<bodies.length;k++)for(let l=k+1;l<bodies.length;l++){
      const quad=[bodies[i],bodies[j],bodies[k],bodies[l]];
      const pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]];
      const es=pairs.map(([x,y])=>edgeOf(quad[x],quad[y]));
      const oppCount=es.filter(e=>e&&e.cls==='opp').length;
      const sqCount=es.filter(e=>e&&e.cls==='sq').length;
      if(oppCount===2&&sqCount===4) found.push({kind:'grandCross',bodies:quad});
    }
    return found;
  }

  const PATTERN_LABEL={grandTrine:'グランドトライン', tsquare:'Tスクエア', grandCross:'グランドクロス', stellium:'ステリウム'};

  function scanCompositeEvents(bodies,startJD,endJD,orbs,stepDays=1){
    const key=p=>[...p.bodies].sort().join(',')+'#'+p.kind;
    const active={}; // key -> {kind,bodies,start,end,samples:[{jd,pos}]}
    const results=[];
    const samples=[]; for(let t=startJD;t<endJD;t+=stepDays) samples.push(t); samples.push(endJD);

    samples.forEach(jd=>{
      const found=detectPatternsAtJD(bodies,jd,orbs);
      const seenKeys=new Set();
      found.forEach(f=>{
        const k=key(f); seenKeys.add(k);
        if(!active[k]) active[k]={kind:f.kind,bodies:f.bodies,start:jd,end:jd};
        else active[k].end=jd;
      });
      Object.keys(active).forEach(k=>{
        if(!seenKeys.has(k)){ results.push(active[k]); delete active[k]; }
      });
    });
    Object.values(active).forEach(a=>results.push(a));

    return results.map(r=>{
      const peakJD=(r.start+r.end)/2; // 簡易ピーク（範囲中央）。将来的に最小オーブ日へ精緻化可能
      return makeCompositeEvent(r.kind,r.bodies,r.start,r.end,peakJD,PATTERN_LABEL[r.kind]||r.kind);
    });
  }

  // ---- 統合取得 ----
  function getAllEvents(startJD,endJD,filters={}){
    const bodies = filters.bodies && filters.bodies.length ? filters.bodies : ALL_BODIES;
    const orbs = filters.orbs || getOrbSettings();
    const types = filters.types || ['aspect','ingress','station','moonphase','eclipse','node','pattern'];
    let events=[];
    if(types.includes('aspect'))   events=events.concat(scanAspectEvents(bodies,startJD,endJD,orbs));
    if(types.includes('ingress'))  events=events.concat(scanIngressEvents(bodies,startJD,endJD));
    if(types.includes('station'))  events=events.concat(scanStationEvents(bodies,startJD,endJD));
    if(types.includes('moonphase'))events=events.concat(scanMoonPhaseEvents(startJD,endJD));
    if(types.includes('eclipse'))  events=events.concat(scanEclipseEvents(startJD,endJD));
    if(types.includes('node'))     events=events.concat(scanNodeEvents(startJD,endJD));
    if(types.includes('pattern')){
      // 複合アスペクトは太陽・月・水星・金星を含めると成立/解消が頻繁すぎてノイズになるため、
      // 既存の長期トランジット検証タブと同じ考え方でデフォルト対象外にする（bodiesフィルターとは独立）
      const patternBodies = bodies.filter(b=>!['Sun','Moon','Mercury','Venus'].includes(b));
      if(patternBodies.length>=3){
        const rangeDays = endJD-startJD;
        const patternStep = rangeDays>200 ? 2 : 1;
        events=events.concat(scanCompositeEvents(patternBodies,startJD,endJD,orbs,patternStep));
      }
    }

    if(filters.aspects && filters.aspects.length){
      events=events.filter(e=> e.type!=='aspect' || filters.aspects.includes(e.aspect.name));
    }
    if(filters.importance && filters.importance.length){
      events=events.filter(e=>filters.importance.includes(e.importance));
    }
    events.sort((a,b)=>a.jd-b.jd);
    return events;
  }

  return {
    ALL_BODIES, OUTER_BODIES, TRANSPERSONAL_BODIES, SOCIAL_BODIES, ASPECT_DEFS,
    getOrbSettings, saveOrbSettings, resetOrbSettings, DEFAULT_ORBS,
    getAspectWithOrb, findTransitAspectExactJD, jdFromDate,
    scanAspectEvents, scanIngressEvents, scanStationEvents,
    scanMoonPhaseEvents, scanEclipseEvents, scanNodeEvents, scanCompositeEvents,
    getAllEvents,
  };
})();
