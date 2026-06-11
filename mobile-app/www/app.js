'use strict';
/* ConciergeCloud — App de Operação & Vistorias
 * SPA vanilla. Funciona no navegador (fallbacks) e dentro do Capacitor (plugins nativos). */

const API = window.CC_CONFIG.API_BASE;
const Cap = window.Capacitor || null;
const hasNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());

// ---------- storage (Preferences no nativo, localStorage no web) ----------
const store = {
  async get(k){ try{ if(hasNative && Cap.Plugins.Preferences){ const {value}=await Cap.Plugins.Preferences.get({key:k}); return value; } }catch{} return localStorage.getItem(k); },
  async set(k,v){ try{ if(hasNative && Cap.Plugins.Preferences){ await Cap.Plugins.Preferences.set({key:k,value:v}); return; } }catch{} localStorage.setItem(k,v); },
  async del(k){ try{ if(hasNative && Cap.Plugins.Preferences){ await Cap.Plugins.Preferences.remove({key:k}); return; } }catch{} localStorage.removeItem(k); },
};

let state = { token:null, user:null, listings:[], checklist:[], draft:null };

// ---------- API ----------
async function api(path, { method='GET', body, auth=true } = {}){
  const headers = { 'Content-Type':'application/json' };
  if(auth && state.token) headers.Authorization = 'Bearer '+state.token;
  const res = await fetch(API+path, { method, headers, body: body?JSON.stringify(body):undefined });
  let data; try{ data = await res.json(); }catch{ data = null; }
  if(res.status === 401 && auth){ await logout(); throw new Error('Sessão expirada'); }
  if(!res.ok) throw new Error((data && data.error) || ('Erro '+res.status));
  return data;
}

// ---------- navegação ----------
function show(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.add('hidden'));
  document.getElementById('screen-'+id).classList.remove('hidden');
  document.getElementById('topbar').classList.toggle('hidden', id==='login');
}
document.addEventListener('click', e=>{ if(e.target.matches('[data-back]')) goHome(); });

// ---------- auth ----------
document.getElementById('loginForm').addEventListener('submit', async e=>{
  e.preventDefault();
  const errEl = document.getElementById('loginError'); errEl.classList.add('hidden');
  const btn = document.getElementById('loginSubmit'); btn.disabled = true; btn.textContent='Entrando...';
  try{
    const login = document.getElementById('login').value.trim().toLowerCase();
    const password = document.getElementById('password').value;
    const r = await api('/auth/login', { method:'POST', auth:false, body:{ login, password } });
    state.token = r.token; state.user = r.user;
    await store.set('token', r.token); await store.set('user', JSON.stringify(r.user));
    await afterLogin();
  }catch(err){ errEl.textContent = err.message; errEl.classList.remove('hidden'); }
  finally{ btn.disabled=false; btn.textContent='Entrar'; }
});

async function logout(){
  state = { token:null, user:null, listings:[], checklist:[], draft:null };
  await store.del('token'); await store.del('user');
  show('login');
}
document.getElementById('logoutBtn').addEventListener('click', logout);

async function afterLogin(){
  document.getElementById('who').textContent = `${state.user.name} · ${roleLabel(state.user.role)}`;
  state.listings = state.user.listings || [];
  try{ state.listingOptions = await api('/listings'); }catch{ state.listingOptions = (state.listings||[]).map(id=>({id,name:id})); }
  if(!state.listingOptions.length) state.listingOptions = (state.listings||[]).map(id=>({id,name:id}));
  // FIX v5 (11/06): registerPush DESLIGADO até o FCM estar configurado.
  // PushNotifications.register() SEM google-services.json crasha o app
  // NATIVAMENTE pós-login ("Default FirebaseApp is not initialized") —
  // era a verdadeira causa das "falhas contínuas". Religar quando o
  // Firebase do projeto for criado (roadmap RM FCM).
  // registerPush();
  await goHome();
}
function roleLabel(r){ return ({admin:'Equipe',host:'Gestor',provider:'Vistoriador',owner:'Proprietário'})[r]||r; }

// ---------- HOME ----------
async function goHome(){
  const role = state.user.role;
  if(role === 'owner'){ return renderOwner(); }
  show('home');
  document.getElementById('homeTitle').textContent = 'Hoje';
  const actions = document.getElementById('homeActions'); actions.innerHTML='';
  if(role==='provider'||role==='host'||role==='admin'){
    const b=document.createElement('button'); b.className='tile gold';
    b.innerHTML='Nova vistoria<small>fotografe os itens da unidade</small>';
    b.onclick=startVistoria; actions.appendChild(b);
  }
  await flushQueue();
  await renderInspList();
}

async function renderInspList(){
  const el = document.getElementById('inspList'); el.innerHTML='<div class="hint">Carregando...</div>';
  try{
    const list = await api('/inspections');
    const queued = await getQueue();
    let html='';
    queued.forEach((q,i)=>{ html += itemRow(`${q.listingName||q.listingId}`, `na fila offline · ${q.date}`, 'queued','Aguardando envio'); });
    if(!list.length && !queued.length) html += '<div class="hint">Nenhuma vistoria ainda.</div>';
    list.forEach(d=>{
      const sub = `${d.date} · ${d.providerName||''} ${d.aiReport&&d.aiReport.summary?'· IA: '+d.aiReport.summary.slice(0,40)+'…':''}`;
      html += `<div class="item" data-open="${d.id}"><div class="t"><b>${d.listingName||d.listingId}</b><small>${sub}</small></div><span class="badge ${d.status}">${statusLabel(d.status)}</span></div>`;
    });
    el.innerHTML = html;
    el.querySelectorAll('[data-open]').forEach(n=> n.onclick=()=>openDetail(n.getAttribute('data-open')));
  }catch(err){ el.innerHTML='<div class="error">'+err.message+'</div>'; }
}
function itemRow(title,sub,badge,badgeTxt){ return `<div class="item"><div class="t"><b>${title}</b><small>${sub}</small></div><span class="badge ${badge}">${badgeTxt}</span></div>`; }
function statusLabel(s){ return ({pending:'Pendente',in_progress:'Em andamento',submitted:'Enviada',reviewed:'Com IA'})[s]||s; }

// ---------- VISTORIA ----------
async function startVistoria(){
  if(!state.checklist.length){ try{ state.checklist = (await api('/inspections/checklist')).checklist; }catch{ state.checklist=[]; } }
  const opts = state.listingOptions && state.listingOptions.length ? state.listingOptions : [];
  state.draft = { listingId: opts[0]?opts[0].id:'', listingName: opts[0]?opts[0].name:'', date: new Date().toISOString().slice(0,10), geo:null,
    items: state.checklist.map(c=>({ category:c.category, key:c.key, label:c.label, status:null, note:'', photos:[] })) };
  const sel = document.getElementById('listingSelect');
  sel.innerHTML = (opts.length?opts:[{id:'',name:'(sem imóvel atribuído)'}]).map(o=>`<option value="${o.id}">${o.name}</option>`).join('');
  sel.onchange = ()=>{ state.draft.listingId = sel.value; const o=opts.find(x=>x.id===sel.value); state.draft.listingName = o?o.name:sel.value; };
  document.getElementById('geoStatus').textContent='Localização: capturando…';
  captureGeo();
  renderChecklist();
  document.getElementById('vistoriaMsg').textContent='';
  show('vistoria');
}

function renderChecklist(){
  const el = document.getElementById('checklist'); el.innerHTML='';
  state.draft.items.forEach((it,idx)=>{
    const div=document.createElement('div'); div.className='chk';
    div.innerHTML = `<div class="cat">${it.category}</div><div class="clabel">${it.label}</div>
      <div class="statusrow">
        <button data-st="ok">OK</button>
        <button data-st="attention">Atenção</button>
        <button data-st="problem">Problema</button>
      </div>
      <div class="photos"></div>
      <textarea placeholder="Observação (opcional)">${it.note||''}</textarea>`;
    const stBtns = div.querySelectorAll('.statusrow button');
    stBtns.forEach(b=> b.onclick=()=>{ it.status=b.dataset.st; stBtns.forEach(x=>x.className=''); b.className='sel '+it.status; });
    if(it.status){ const sb=div.querySelector(`[data-st="${it.status}"]`); if(sb) sb.className='sel '+it.status; }
    div.querySelector('textarea').oninput = e=> it.note=e.target.value;
    renderPhotos(div.querySelector('.photos'), it);
    el.appendChild(div);
  });
}
function renderPhotos(box, it){
  box.innerHTML='';
  it.photos.forEach(p=>{ const im=document.createElement('img'); im.src=p.data; box.appendChild(im); });
  const add=document.createElement('button'); add.className='addphoto'; add.textContent='+';
  add.onclick=()=> takePhoto(it, box); box.appendChild(add);
}

async function takePhoto(it, box){
  try{
    let dataUrl;
    if(hasNative && Cap.Plugins.Camera){
      const photo = await Cap.Plugins.Camera.getPhoto({ quality:60, resultType:'dataUrl', source:'CAMERA', width:1280 });
      dataUrl = photo.dataUrl;
    }else{
      dataUrl = await pickFile();
    }
    if(dataUrl){ it.photos.push({ data:dataUrl }); renderPhotos(box,it); }
  }catch(err){ /* usuário cancelou */ }
}
function pickFile(){
  return new Promise(resolve=>{
    const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.capture='environment';
    inp.onchange=()=>{ const f=inp.files[0]; if(!f) return resolve(null);
      const r=new FileReader(); r.onload=()=>resolve(downscale(r.result)); r.readAsDataURL(f); };
    inp.click();
  });
}
// reduz a imagem pra não estourar payload (lado maior 1280px, jpeg 0.6)
function downscale(dataUrl){
  return new Promise(resolve=>{
    const img=new Image(); img.onload=()=>{
      const max=1280; let {width:w,height:h}=img; const s=Math.min(1,max/Math.max(w,h));
      const c=document.createElement('canvas'); c.width=w*s; c.height=h*s;
      c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      resolve(c.toDataURL('image/jpeg',0.6));
    }; img.src=dataUrl;
  });
}

async function captureGeo(){
  const el=document.getElementById('geoStatus');
  try{
    let pos;
    if(hasNative && Cap.Plugins.Geolocation){ pos = await Cap.Plugins.Geolocation.getCurrentPosition({enableHighAccuracy:true,timeout:8000}); }
    else { pos = await new Promise((res,rej)=> navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:8000})); }
    state.draft.geo = { lat:pos.coords.latitude, lng:pos.coords.longitude, accuracy:Math.round(pos.coords.accuracy||0) };
    el.textContent = `Localização: ${state.draft.geo.lat.toFixed(5)}, ${state.draft.geo.lng.toFixed(5)} (±${state.draft.geo.accuracy}m)`;
  }catch{ el.textContent='Localização: indisponível (será enviada sem geo)'; }
}

document.getElementById('submitVistoria').addEventListener('click', async ()=>{
  const d = state.draft; const msg=document.getElementById('vistoriaMsg');
  if(!d.listingId){ msg.textContent='Selecione o imóvel.'; return; }
  const payload = { listingId:d.listingId, listingName:d.listingName||d.listingId, date:d.date, status:'submitted', items:d.items, geo:d.geo };
  if(!navigator.onLine){ await enqueue(payload); msg.textContent='Sem conexão — vistoria salva na fila.'; updateOffline(); setTimeout(goHome,800); return; }
  document.getElementById('submitVistoria').disabled=true;
  try{ await api('/inspections', { method:'POST', body:payload }); msg.textContent='Vistoria enviada!'; setTimeout(goHome,600); }
  catch(err){ await enqueue(payload); msg.textContent='Falha de rede — salva na fila offline.'; updateOffline(); setTimeout(goHome,900); }
  finally{ document.getElementById('submitVistoria').disabled=false; }
});

// ---------- DETALHE / RELATÓRIO ----------
async function openDetail(id){
  show('detail'); const body=document.getElementById('detailBody'); body.innerHTML='<div class="hint">Carregando…</div>';
  try{
    const d = await api('/inspections/'+id);
    document.getElementById('detailTitle').textContent = `${d.listingName||d.listingId} · ${d.date}`;
    let html='';
    if(d.aiReport && d.aiReport.summary) html += `<div class="summary"><b>Resumo IA:</b> ${d.aiReport.summary}</div>`;
    if(d.aiReport && d.aiReport.issues && d.aiReport.issues.length) html += d.aiReport.issues.map(i=>`<div class="issue">${i}</div>`).join('');
    (d.items||[]).forEach(it=>{
      const st = it.status?`<span class="badge ${it.status==='ok'?'reviewed':it.status==='problem'?'queued':'submitted'}">${it.status}</span>`:'';
      html += `<div class="chk"><div class="cat">${it.category}</div><div class="clabel">${it.label} ${st}</div>`;
      if(it.aiNote) html += `<div class="hint">IA: ${it.aiNote}</div>`;
      if(it.note) html += `<div class="hint">Obs.: ${it.note}</div>`;
      if(it.photos && it.photos.length){ html += '<div class="photos">'+it.photos.map(p=>`<img src="${p.data||p.url}">`).join('')+'</div>'; }
      html += '</div>';
    });
    if(['host','admin'].includes(state.user.role) && (!d.aiReport || !d.aiReport.ran)){
      html += `<button class="primary" id="genAi">Gerar relatório por IA</button>`;
    }
    body.innerHTML = html;
    const g=document.getElementById('genAi');
    if(g) g.onclick=async()=>{ g.disabled=true; g.textContent='Analisando…'; try{ const r=await api('/inspections/'+id+'/ai-report',{method:'POST'}); g.textContent = r.ran?'Pronto!':'IA indisponível ('+(r.reason||'')+')'; setTimeout(()=>openDetail(id),700);}catch(e){ g.textContent=e.message; g.disabled=false; } };
  }catch(err){ body.innerHTML='<div class="error">'+err.message+'</div>'; }
}

// ---------- PROPRIETÁRIO ----------
async function renderOwner(){
  show('owner'); const body=document.getElementById('ownerBody'); body.innerHTML='<div class="hint">Carregando…</div>';
  const opt = (state.listingOptions && state.listingOptions[0]) || (state.listings[0] ? {id:state.listings[0],name:state.listings[0]} : null);
  const listing = opt && opt.id;
  if(opt && opt.name){ const h=document.querySelector('#screen-owner h1'); if(h) h.textContent = 'Imóvel '+opt.name; }
  if(!listing){ body.innerHTML='<div class="hint">Nenhum imóvel vinculado.</div>'; return; }
  try{
    const s = await api('/listings/'+encodeURIComponent(listing)+'/stats');
    const t=s.totals;
    let html = `<div class="stat">
      <div class="b"><div class="n">${t.future}</div><div class="l">Reservas futuras</div></div>
      <div class="b"><div class="n">${t.active}</div><div class="l">Em andamento</div></div>
      <div class="b"><div class="n">${t.past}</div><div class="l">Concluídas</div></div>
    </div>`;
    if(s.occupancy && s.occupancy.length){
      html += '<div class="occ"><div class="section-h">Ocupação por mês</div>';
      s.occupancy.slice(-6).forEach(o=>{ html += `<div class="row"><div class="m">${o.month}</div><div class="bar"><i style="width:${o.occupancyPct}%"></i></div><div class="p">${o.occupancyPct}%</div></div>`; });
      html += '</div>';
    }
    html += '<div class="section-h">Vistorias recentes</div>';
    if(s.inspections && s.inspections.length){
      s.inspections.forEach(i=>{ html += itemRow(i.date, i.summary?i.summary.slice(0,60):'sem relatório IA', i.status==='reviewed'?'reviewed':'submitted', i.issues+' pend.'); });
    } else html += '<div class="hint">Nenhuma vistoria registrada.</div>';
    html += `<div class="hint">${s.note}</div>`;
    body.innerHTML = html;
  }catch(err){ body.innerHTML='<div class="error">'+err.message+'</div>'; }
}

// ---------- FILA OFFLINE ----------
async function getQueue(){ try{ return JSON.parse(await store.get('queue')||'[]'); }catch{ return []; } }
async function enqueue(p){
  // FIX v4 (11/06): payload com fotos base64 na fila = Preferences gigante →
  // leitura pela bridge nativa estourava o app no boot (crash-loop Galaxy A03).
  // Acima de ~700KB, guarda SEM fotos (estados/notas preservados).
  let entry = {...p, _queuedAt:Date.now()};
  try{
    if(JSON.stringify(entry).length > 700000){
      entry = {...entry, items:(entry.items||[]).map(it=>({...it, photos:[], _photosDropped:(it.photos||[]).length})), _photosStripped:true};
    }
  }catch{ entry = {...entry, items:[], _photosStripped:true}; }
  const q=await getQueue(); q.push(entry);
  if(q.length>10) q.splice(0, q.length-10); // teto da fila
  await store.set('queue', JSON.stringify(q));
}
async function flushQueue(){
  if(!navigator.onLine) return; let q=await getQueue(); if(!q.length) return;
  const rest=[];
  for(const p of q){ try{ await api('/inspections',{method:'POST',body:p}); }catch{ rest.push(p); } }
  await store.set('queue', JSON.stringify(rest)); updateOffline();
}
async function updateOffline(){
  const q=await getQueue();
  document.getElementById('queueCount').textContent=q.length;
  document.getElementById('offlineBanner').classList.toggle('hidden', navigator.onLine && q.length===0);
}
window.addEventListener('online', async ()=>{ await flushQueue(); updateOffline(); });
window.addEventListener('offline', updateOffline);

// ---------- PUSH (nativo) ----------
async function registerPush(){
  if(!hasNative || !Cap.Plugins.PushNotifications) return;
  try{
    const perm = await Cap.Plugins.PushNotifications.requestPermissions();
    if(perm.receive!=='granted') return;
    await Cap.Plugins.PushNotifications.register();
    Cap.Plugins.PushNotifications.addListener('registration', async token=>{
      try{ await api('/devices',{method:'POST',body:{platform:Cap.getPlatform(),pushToken:token.value}}); }catch{}
    });
  }catch{}
}

// ---------- BOOT ----------
(async function boot(){
  // FIX v4: crash-guard — se 2 boots seguidos não terminaram, a fila offline é
  // a suspeita nº 1 (Preferences gigante): descarta SEM ler e segue vivo.
  try{
    const booting = await store.get('booting');
    if(booting === '1'){
      const n = (parseInt(await store.get('bootCrashes')||'0',10) || 0) + 1;
      await store.set('bootCrashes', String(n));
      if(n >= 2){ await store.del('queue'); await store.set('bootCrashes','0'); }
    }
    await store.set('booting','1');
  }catch{}
  state.token = await store.get('token');
  const u = await store.get('user'); if(u){ try{ state.user=JSON.parse(u); }catch{} }
  // fila offline só DEPOIS da UI estar de pé (e fora do caminho crítico)
  setTimeout(()=>{ updateOffline().catch(()=>{}); }, 2000);
  try{
    if(state.token && state.user){ try{ await afterLogin(); }catch{ show('login'); } }
    else show('login');
  } finally {
    try{ await store.set('booting','0'); await store.set('bootCrashes','0'); }catch{}
  }
})();
