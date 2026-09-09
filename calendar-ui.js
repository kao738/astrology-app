/* ==========================================================================
   calendar-ui.js — 天空イベントカレンダー：UI
   役割：新タブ「天空イベント」の描画・フィルター・カレンダー/リスト切替・
   イベント詳細モーダル（天空図＋検証記録フォーム）・アスペクト検索。

   依存（読み込み順：index.html本体 → sky-events.js → journal-store.js →
   economic-events-data.js → 本ファイル）：
     SkyEvents, Journal, ECONOMIC_EVENTS, economicEventToSkyFormat,
     calcPlanet, toJD, fmtDate, jdToLocalHM, PSYM, PNAMES, SIGNS, SSYM
   ========================================================================== */
(() => {
  const IMPORTANCE_ICON = {critical:'🔥', high:'⭐', normal:''};
  const TYPE_LABEL = {aspect:'アスペクト', ingress:'サイン移動', station:'逆行/順行', moonphase:'新月・満月', eclipse:'日食・月食', node:'ノード移動', pattern:'複合アスペクト', economic:'経済'};
  const PATTERN_ICON = {grandTrine:'▲', tsquare:'⊤', grandCross:'✛', stellium:'✦'};

  const state = { events: [], view: 'list', startJD: null, endJD: null, calYM: null };

  function typeLabelOf(e){ return e.category==='economic' ? '経済' : (TYPE_LABEL[e.type]||''); }

  function eventIcon(e){
    if(e.category==='economic') return '📅';
    if(e.type==='aspect') return e.aspect.sym;
    if(e.type==='ingress') return '→';
    if(e.type==='station') return e.detail==='逆行開始'?'℞':'D';
    if(e.type==='moonphase') return e.title.slice(0,2);
    if(e.type==='eclipse') return e.isSolar?'🌑':'🌕';
    if(e.type==='node') return e.nodeKind==='Ascending'?'☊':'☋';
    if(e.type==='pattern') return PATTERN_ICON[e.patternKind]||'✦';
    return '·';
  }

  // ---- 期間計算 ----
  function addMonths(y,m,d,n){ const dt=new Date(y,m-1+n,d); return {y:dt.getFullYear(), m:dt.getMonth()+1, d:dt.getDate()}; }
  function computeRange(){
    const period = document.getElementById('sePeriod').value;
    const now = new Date();
    let sy=now.getFullYear(), sm=now.getMonth()+1, sd=1, ey, em, ed;
    if(period==='month'){
      ey=sy; em=sm+1; if(em>12){em=1;ey++;} ed=1;
    }else if(period==='custom'){
      const sVal=document.getElementById('seStartDate').value, eVal=document.getElementById('seEndDate').value;
      if(!sVal||!eVal){ return null; }
      const[y1,m1,d1]=sVal.split('-').map(Number); const[y2,m2,d2]=eVal.split('-').map(Number);
      return { startJD: toJD(y1,m1,d1,0,0,9), endJD: toJD(y2,m2,d2,23,59,9) };
    }else{
      sy=now.getFullYear(); sm=now.getMonth()+1; sd=now.getDate();
      const months={'3m':3,'6m':6,'1y':12}[period]||3;
      const e=addMonths(sy,sm,sd,months);
      ey=e.y; em=e.m; ed=e.d;
      return { startJD: toJD(sy,sm,sd,0,0,9), endJD: toJD(ey,em,ed,23,59,9) };
    }
    return { startJD: toJD(sy,sm,sd,0,0,9), endJD: toJD(ey,em,ed,23,59,9) };
  }

  // ---- フィルター取得 ----
  function selectedBodies(){
    return Array.from(document.querySelectorAll('.se-body-check:checked')).map(el=>el.value);
  }
  function selectedAspects(){
    const checked=Array.from(document.querySelectorAll('.se-aspect-check:checked')).map(el=>el.value);
    return checked.length ? checked : SkyEvents.ASPECT_DEFS.map(a=>a.name);
  }
  function selectedTypes(){
    const checked=Array.from(document.querySelectorAll('.se-type-check:checked')).map(el=>el.value);
    return checked;
  }
  function selectedImportance(){
    const checked=Array.from(document.querySelectorAll('.se-importance-check:checked')).map(el=>el.value);
    return checked.length ? checked : ['critical','high','normal'];
  }

  // ---- 生成・描画 ----
  function fetchAndRender(){
    const range=computeRange();
    if(!range){ alert('開始日・終了日を入力してください'); return; }
    const status=document.getElementById('seStatus');
    const btn=document.getElementById('seGenBtn');
    btn.disabled=true; btn.textContent='計算中...';
    status.textContent='計算中…（期間・天体数によっては数秒かかります）';
    setTimeout(()=>{
      try{
        const bodies=selectedBodies().length?selectedBodies():SkyEvents.ALL_BODIES;
        const types=selectedTypes().length?selectedTypes():['aspect','ingress','station','moonphase','eclipse','node','pattern'];
        let events = SkyEvents.getAllEvents(range.startJD, range.endJD, {
          bodies, types, aspects: selectedAspects(), importance: selectedImportance(),
        });
        if(document.getElementById('seShowEconomic').checked){
          const econ = ECONOMIC_EVENTS
            .map(economicEventToSkyFormat)
            .filter(e=>e.jd>=range.startJD && e.jd<=range.endJD);
          events = events.concat(econ).sort((a,b)=>a.jd-b.jd);
        }
        state.events=events; state.startJD=range.startJD; state.endJD=range.endJD;
        state.calYM=jdToYM(range.startJD);
        status.textContent=`${events.length}件のイベントを検出しました`;
        render();
      }catch(e){
        status.textContent='⚠ 計算中にエラーが発生しました: '+e.message;
        console.error(e);
      }
      btn.disabled=false; btn.textContent='✦ 表示する';
    },30);
  }

  function jdToYM(jd){ const d=jdToDate(jd); return {y:d.getUTCFullYear(), m:d.getUTCMonth()+1}; }

  function render(){
    document.getElementById('seListWrap').style.display = state.view==='list' ? 'block':'none';
    document.getElementById('seCalendarWrap').style.display = state.view==='calendar' ? 'block':'none';
    if(state.view==='list') renderList(); else renderCalendar();
  }

  function renderList(){
    const wrap=document.getElementById('seListWrap');
    if(!state.events.length){ wrap.innerHTML='<p style="color:var(--muted);font-size:12px;font-family:sans-serif;padding:1rem">該当するイベントがありません。フィルターや期間を見直してください。</p>'; return; }
    let rows = state.events.map(e=>{
      const importanceBadge = IMPORTANCE_ICON[e.importance]||'';
      const timeStr = e.category==='economic' && e.timeConfirmed===false ? '' : jdToLocalHM(e.jd,9);
      return `<tr class="se-row" data-id="${e.id}" style="cursor:pointer">
        <td>${fmtDate(e.jd)}${timeStr?' '+timeStr:''}</td>
        <td style="font-size:15px">${eventIcon(e)}</td>
        <td style="text-align:left">${e.title}</td>
        <td>${typeLabelOf(e)}</td>
        <td>${importanceBadge}</td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<div class="row-between"><p class="sec-title">イベント一覧（${state.events.length}件）</p><button class="action-btn" id="seCsvBtn">↓ CSV保存</button></div>
      <div class="eph-table-wrap" style="max-height:520px"><table class="eph-table" style="white-space:normal">
      <thead><tr><th class="eph-date-h">日時</th><th>記号</th><th>内容</th><th>種別</th><th>重要度</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
    wrap.querySelectorAll('.se-row').forEach(tr=>tr.addEventListener('click',()=>{
      const ev=state.events.find(e=>e.id===tr.dataset.id);
      if(ev) openDetail(ev);
    }));
    document.getElementById('seCsvBtn').addEventListener('click',()=>{
      const rows=[['日時','種別','内容','重要度']];
      state.events.forEach(e=>rows.push([`${fmtDate(e.jd)} ${jdToLocalHM(e.jd,9)}`, typeLabelOf(e), e.title, e.importance||'']));
      downloadCSV(`sky-events-${fmtDate(state.startJD)}_${fmtDate(state.endJD)}.csv`, rows);
    });
  }

  function renderCalendar(){
    const wrap=document.getElementById('seCalendarWrap');
    const {y,m}=state.calYM;
    const first=new Date(y,m-1,1), last=new Date(y,m,0);
    const firstJD=toJD(y,m,1,0,0,9), lastJD=toJD(y,m,last.getDate(),23,59,9);
    const startWeekday=first.getDay();
    const byDay={};
    state.events.forEach(e=>{
      if(e.jd<firstJD-1||e.jd>lastJD+1) return;
      const key=fmtDate(e.jd);
      (byDay[key]=byDay[key]||[]).push(e);
    });
    let cells='';
    for(let i=0;i<startWeekday;i++) cells+='<div class="se-cal-cell se-cal-empty"></div>';
    for(let d=1;d<=last.getDate();d++){
      const dateStr=`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayEvents=byDay[dateStr]||[];
      const badges=dayEvents.slice(0,4).map(e=>`<span class="se-cal-badge" data-id="${e.id}" title="${e.title}">${eventIcon(e)}</span>`).join('');
      const overflow=dayEvents.length>4?`<span class="se-cal-more">+${dayEvents.length-4}</span>`:'';
      cells+=`<div class="se-cal-cell"><div class="se-cal-daynum">${d}</div><div class="se-cal-badges">${badges}${overflow}</div></div>`;
    }
    wrap.innerHTML = `
      <div class="row-between">
        <div style="display:flex;align-items:center;gap:10px">
          <button class="action-btn" id="seCalPrev">◀</button>
          <p class="sec-title" style="min-width:100px;text-align:center">${y}年${m}月</p>
          <button class="action-btn" id="seCalNext">▶</button>
        </div>
      </div>
      <div class="se-cal-grid">
        ${['日','月','火','水','木','金','土'].map(w=>`<div class="se-cal-wh">${w}</div>`).join('')}
        ${cells}
      </div>`;
    document.getElementById('seCalPrev').addEventListener('click',()=>{ let{y,m}=state.calYM; m--; if(m<1){m=12;y--;} state.calYM={y,m}; renderCalendar(); });
    document.getElementById('seCalNext').addEventListener('click',()=>{ let{y,m}=state.calYM; m++; if(m>12){m=1;y++;} state.calYM={y,m}; renderCalendar(); });
    wrap.querySelectorAll('.se-cal-badge').forEach(b=>b.addEventListener('click',(ev)=>{
      ev.stopPropagation();
      const found=state.events.find(e=>e.id===b.dataset.id);
      if(found) openDetail(found);
    }));
  }

  // ---- 天空図（1リング、ハウスなし） ----
  function drawSkyWheel(canvas,jd,size){
    const ctx=canvas.getContext('2d'), W=canvas.width,H=canvas.height,cx=W/2,cy=H/2,sc=size/320;
    ctx.clearRect(0,0,W,H);
    const OR=cx-4, SR=cx-30*sc, PR=cx-56*sc;
    ctx.fillStyle='#fdfaf3'; ctx.beginPath();ctx.arc(cx,cy,OR,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='rgba(26,42,74,0.3)'; ctx.lineWidth=1.2;
    ctx.beginPath();ctx.arc(cx,cy,OR,0,Math.PI*2);ctx.stroke();
    ctx.beginPath();ctx.arc(cx,cy,SR,0,Math.PI*2);ctx.stroke();
    for(let i=0;i<12;i++){
      const a=(180-i*30)*Math.PI/180;
      ctx.strokeStyle='rgba(26,42,74,0.15)';
      ctx.beginPath();ctx.moveTo(cx+SR*Math.cos(a),cy+SR*Math.sin(a));ctx.lineTo(cx+OR*Math.cos(a),cy+OR*Math.sin(a));ctx.stroke();
      const ma=(180-(i*30+15))*Math.PI/180;
      ctx.fillStyle='#b8860b'; ctx.font=`${13*sc}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(SSYM[i], cx+((SR+OR)/2)*Math.cos(ma), cy+((SR+OR)/2)*Math.sin(ma));
    }
    const pos={}; SkyEvents.ALL_BODIES.forEach(p=>pos[p]=calcPlanet(p,jd));
    const orbs=SkyEvents.getOrbSettings();
    const ac={conj:'rgba(184,134,11,0.55)',trine:'rgba(0,140,80,0.4)',sext:'rgba(0,100,180,0.35)',sq:'rgba(180,40,40,0.4)',opp:'rgba(160,80,0,0.4)'};
    SkyEvents.ALL_BODIES.forEach((p1,i)=>SkyEvents.ALL_BODIES.slice(i+1).forEach(p2=>{
      const asp=SkyEvents.getAspectWithOrb(pos[p1],pos[p2],orbs);
      if(asp){
        const a1=(180-pos[p1])*Math.PI/180, a2=(180-pos[p2])*Math.PI/180;
        ctx.strokeStyle=ac[asp.cls]||'rgba(0,0,0,0.15)'; ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(cx+PR*Math.cos(a1),cy+PR*Math.sin(a1));ctx.lineTo(cx+PR*Math.cos(a2),cy+PR*Math.sin(a2));ctx.stroke();
      }
    }));
    SkyEvents.ALL_BODIES.forEach(p=>{
      const a=(180-pos[p])*Math.PI/180, x=cx+PR*Math.cos(a), y=cy+PR*Math.sin(a);
      ctx.fillStyle='#fff'; ctx.beginPath();ctx.arc(x,y,9*sc,0,Math.PI*2);ctx.fill();
      ctx.strokeStyle='#1a2a4a'; ctx.lineWidth=1; ctx.beginPath();ctx.arc(x,y,9*sc,0,Math.PI*2);ctx.stroke();
      ctx.fillStyle='#1a2a4a'; ctx.font=`bold ${11*sc}px serif`; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(PSYM[p],x,y);
    });
  }

  // ---- 詳細モーダル ----
  function openDetail(e){
    document.getElementById('eventModalTitle').textContent = `${fmtDate(e.jd)} ${e.category==='economic'&&e.timeConfirmed===false?'':jdToLocalHM(e.jd,9)}`;
    const j = Journal.get(e.id);
    const signsHtml = e.signs ? `<table class="asp-table" style="margin-top:6px"><tbody>${Object.entries(e.signs).map(([p,s])=>`<tr><td>${PSYM[p]||''} ${PNAMES[p]||p}</td><td>${s}</td></tr>`).join('')}</tbody></table>` : '';
    const aspectHtml = e.aspect ? `<p style="font-family:sans-serif;font-size:12px;color:var(--muted);margin-top:6px">角度：${e.aspect.angle}°（正確な成立時刻）</p>` : '';
    const keywordsHtml = (e.keywords&&e.keywords.length) ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px">${e.keywords.map(k=>`<span class="abadge a-conj">${k}</span>`).join('')}</div>` : '';
    const mkt = j.marketData||{};
    const marketFields=['nikkei','nasdaq','vix','dxy','us10y','btc','oil'];
    const marketLabels={nikkei:'日経平均',nasdaq:'NASDAQ',vix:'VIX',dxy:'DXY',us10y:'米10年債',btc:'BTC',oil:'原油'};

    document.getElementById('eventModalBody').innerHTML = `
      <p style="font-family:sans-serif;font-size:15px;color:var(--navy);font-weight:700">${e.title}</p>
      <p style="font-family:sans-serif;font-size:11px;color:var(--muted);margin-top:2px">${IMPORTANCE_ICON[e.importance]||''} ${typeLabelOf(e)}</p>
      ${aspectHtml}${signsHtml}${keywordsHtml}
      <div style="display:flex;justify-content:center;margin:14px 0">
        <canvas id="eventWheelCanvas" width="280" height="280"></canvas>
      </div>
      <details style="margin-top:10px;background:#fff;border:1.5px solid rgba(26,42,74,0.12);border-radius:8px;padding:10px 12px;" open>
        <summary style="cursor:pointer;font-family:sans-serif;font-size:12px;font-weight:700;color:var(--navy);">検証記録</summary>
        <div style="margin-top:10px;display:flex;flex-direction:column;gap:8px;font-family:sans-serif;">
          <div class="form-group"><span class="form-label">事前テーマ・メモ</span><textarea class="form-input" id="jPreNote" rows="2">${j.preNote||''}</textarea></div>
          <div class="form-group"><span class="form-label">実際に起きた出来事</span><textarea class="form-input" id="jActual" rows="2">${j.actualOutcome||''}</textarea></div>
          <div class="form-group"><span class="form-label">市場データ</span>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px">
              ${marketFields.map(f=>`<input class="form-input" style="font-size:11px;padding:6px 8px" id="jMkt_${f}" placeholder="${marketLabels[f]}" value="${mkt[f]||''}">`).join('')}
            </div>
          </div>
          <div class="form-group"><span class="form-label">検証メモ</span><textarea class="form-input" id="jVerify" rows="2">${j.verifyNote||''}</textarea></div>
          <button class="action-btn" id="jSaveBtn" style="align-self:flex-start">💾 保存</button>
          <span id="jSaveStatus" style="font-size:10px;color:var(--muted)"></span>
        </div>
      </details>`;

    document.getElementById('eventModalOverlay').classList.add('open');
    setTimeout(()=>{
      const canvas=document.getElementById('eventWheelCanvas');
      if(canvas) drawSkyWheel(canvas, e.jd, 280);
    },10);

    document.getElementById('jSaveBtn').addEventListener('click',()=>{
      const marketData={}; marketFields.forEach(f=>marketData[f]=document.getElementById('jMkt_'+f).value);
      Journal.save(e.id, {
        preNote: document.getElementById('jPreNote').value,
        actualOutcome: document.getElementById('jActual').value,
        verifyNote: document.getElementById('jVerify').value,
        marketData,
      });
      document.getElementById('jSaveStatus').textContent='保存しました ✓';
      setTimeout(()=>{ const el=document.getElementById('jSaveStatus'); if(el) el.textContent=''; },2000);
    });
  }

  // ---- 検索機能 ----
  function initSearchSelects(){
    const p1=document.getElementById('seSearchP1'), p2=document.getElementById('seSearchP2'), asp=document.getElementById('seSearchAsp');
    SkyEvents.ALL_BODIES.forEach(b=>{
      p1.insertAdjacentHTML('beforeend', `<option value="${b}">${PSYM[b]} ${PNAMES[b]}</option>`);
      p2.insertAdjacentHTML('beforeend', `<option value="${b}">${PSYM[b]} ${PNAMES[b]}</option>`);
    });
    p2.value='Uranus'; if(p1.options.length>5) p1.value='Jupiter';
    SkyEvents.ASPECT_DEFS.forEach(a=>asp.insertAdjacentHTML('beforeend', `<option value="${a.name}">${a.sym} ${a.name}</option>`));
  }

  function runSearch(){
    const p1=document.getElementById('seSearchP1').value, p2=document.getElementById('seSearchP2').value;
    const aspName=document.getElementById('seSearchAsp').value;
    const years=parseInt(document.getElementById('seSearchRange').value,10);
    if(p1===p2){ alert('異なる2天体を選んでください'); return; }
    const resultEl=document.getElementById('seSearchResult');
    resultEl.innerHTML='<p style="font-size:11px;color:var(--muted);font-family:sans-serif">検索中…</p>';
    setTimeout(()=>{
      const now=new Date();
      const startJD=toJD(now.getFullYear()-years,now.getMonth()+1,now.getDate(),0,0,9);
      const endJD=toJD(now.getFullYear()+years,now.getMonth()+1,now.getDate(),0,0,9);
      const orbs=SkyEvents.getOrbSettings();
      const all=SkyEvents.scanAspectEvents([p1,p2],startJD,endJD,orbs).filter(e=>e.aspect.name===aspName);
      const todayJD=toJD(now.getFullYear(),now.getMonth()+1,now.getDate(),12,0,9);
      if(!all.length){ resultEl.innerHTML='<p style="font-size:11px;color:var(--muted);font-family:sans-serif">該当する成立日が見つかりませんでした</p>'; return; }
      const rows=all.map(e=>`<tr><td>${fmtDate(e.jd)}</td><td>${e.jd<todayJD?'過去':'未来'}</td><td>${e.signs[p1]} / ${e.signs[p2]}</td></tr>`).join('');
      resultEl.innerHTML=`<div class="eph-table-wrap" style="max-height:300px"><table class="eph-table"><thead><tr><th class="eph-date-h">日付</th><th>過去/未来</th><th>成立時のサイン</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    },20);
  }

  // ---- オーブ設定モーダル（簡易プロンプト方式） ----
  function openOrbSettings(){
    const orbs=SkyEvents.getOrbSettings();
    const labels={conj:'コンジャンクション ☌',sext:'セクスタイル ⚹',sq:'スクエア □',trine:'トライン △',opp:'オポジション ☍'};
    const body=Object.keys(labels).map(k=>`<div class="eph-field"><span class="form-label" style="font-size:9px;opacity:0.7">${labels[k]}</span><input class="transit-date-input" type="number" step="0.5" min="0" max="15" id="orb_${k}" value="${orbs[k]}" style="width:80px"></div>`).join('');
    document.getElementById('eventModalTitle').textContent='オーブ設定';
    document.getElementById('eventModalBody').innerHTML = `
      <p style="font-family:sans-serif;font-size:11px;color:var(--muted);margin-bottom:10px">各アスペクトのオーブ（許容度数）。初期値は一般的な範囲です。</p>
      <div style="display:flex;flex-wrap:wrap;gap:10px">${body}</div>
      <div style="margin-top:14px;display:flex;gap:8px">
        <button class="today-btn" id="orbSaveBtn">保存</button>
        <button class="action-btn" id="orbResetBtn">初期値に戻す</button>
      </div>`;
    document.getElementById('eventModalOverlay').classList.add('open');
    document.getElementById('orbSaveBtn').addEventListener('click',()=>{
      const newOrbs={};
      Object.keys(labels).forEach(k=>newOrbs[k]=parseFloat(document.getElementById('orb_'+k).value)||SkyEvents.DEFAULT_ORBS[k]);
      SkyEvents.saveOrbSettings(newOrbs);
      document.getElementById('eventModalOverlay').classList.remove('open');
    });
    document.getElementById('orbResetBtn').addEventListener('click',()=>{
      SkyEvents.resetOrbSettings();
      openOrbSettings();
    });
  }

  // ---- フィルターUI初期構築 ----
  function initFilters(){
    const bodyWrap=document.getElementById('seBodyChecks');
    bodyWrap.innerHTML = SkyEvents.ALL_BODIES.map(b=>`<label style="display:flex;align-items:center;gap:4px;font-family:sans-serif;font-size:11px;color:var(--navy);cursor:pointer"><input type="checkbox" class="se-body-check" value="${b}" checked style="accent-color:var(--navy)"> ${PSYM[b]}${PNAMES[b]}</label>`).join('');

    document.getElementById('seAspectChecks').innerHTML = SkyEvents.ASPECT_DEFS.map(a=>`<label style="display:flex;align-items:center;gap:4px;font-family:sans-serif;font-size:11px;color:var(--navy);cursor:pointer"><input type="checkbox" class="se-aspect-check" value="${a.name}" checked style="accent-color:var(--navy)"> ${a.sym}${a.name}</label>`).join('');

    const types=[['aspect','アスペクト'],['ingress','サイン移動'],['station','逆行/順行開始'],['moonphase','新月・満月'],['eclipse','日食・月食'],['node','ノード移動'],['pattern','複合アスペクト']];
    document.getElementById('seTypeChecks').innerHTML = types.map(([k,l])=>`<label style="display:flex;align-items:center;gap:4px;font-family:sans-serif;font-size:11px;color:var(--navy);cursor:pointer"><input type="checkbox" class="se-type-check" value="${k}" checked style="accent-color:var(--navy)"> ${l}</label>`).join('');

    const imps=[['critical','🔥 非常に重要'],['high','⭐ 重要'],['normal','通常']];
    document.getElementById('seImportanceChecks').innerHTML = imps.map(([k,l])=>`<label style="display:flex;align-items:center;gap:4px;font-family:sans-serif;font-size:11px;color:var(--navy);cursor:pointer"><input type="checkbox" class="se-importance-check" value="${k}" checked style="accent-color:var(--navy)"> ${l}</label>`).join('');

    document.querySelectorAll('.se-preset-btn').forEach(btn=>btn.addEventListener('click',()=>{
      const preset=btn.dataset.preset;
      const target = preset==='outer'?SkyEvents.OUTER_BODIES : preset==='transpersonal'?SkyEvents.TRANSPERSONAL_BODIES : SkyEvents.ALL_BODIES;
      document.querySelectorAll('.se-body-check').forEach(cb=>cb.checked=target.includes(cb.value));
    }));
  }

  function init(){
    initFilters();
    initSearchSelects();

    document.getElementById('sePeriod').addEventListener('change',()=>{
      document.getElementById('seCustomRange').style.display = document.getElementById('sePeriod').value==='custom' ? 'flex':'none';
    });
    document.getElementById('seGenBtn').addEventListener('click',fetchAndRender);
    document.getElementById('seOrbBtn').addEventListener('click',openOrbSettings);
    document.getElementById('seSearchBtn').addEventListener('click',runSearch);

    document.querySelectorAll('.se-view-btn').forEach(btn=>btn.addEventListener('click',()=>{
      document.querySelectorAll('.se-view-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      state.view=btn.dataset.view;
      render();
    }));

    document.getElementById('eventModalClose').addEventListener('click',()=>document.getElementById('eventModalOverlay').classList.remove('open'));
    document.getElementById('eventModalOverlay').addEventListener('click',(ev)=>{ if(ev.target.id==='eventModalOverlay') document.getElementById('eventModalOverlay').classList.remove('open'); });

    document.getElementById('seListWrap').innerHTML='<p style="color:var(--muted);font-size:12px;font-family:sans-serif;padding:1rem">期間・フィルターを選んで「表示する」を押してください</p>';
  }

  init();
})();
