const $ = id => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];

const STATUS = {
  want: ['Хочу','want'], plan: ['Планирую','plan'], ordered: ['Заказал','ordered'],
  bought: ['Куплено','bought'], paused: ['Отложено','paused']
};
const PRIORITY = {1:'Низкий',2:'Средний',3:'Высокий',4:'Купить первым'};
const CATEGORY_ICONS = {
  'Техника':'⌘','Аксессуары':'◉','Красота':'✦','Одежда и обувь':'◇','Дом':'⌂','Инструменты':'⚒',
  'Путешествия':'✈','Подарки':'🎁','Другое':'•'
};
const STORE_NAMES = {
  'rozetka.com.ua':'Rozetka','makeup.com.ua':'Makeup','converse.org.ua':'Converse','allo.ua':'ALLO',
  'comfy.ua':'COMFY','foxtrot.com.ua':'Фокстрот','epicentrk.ua':'Епіцентр'
};
const STORE_DEFAULT_CATEGORY = {
  'makeup.com.ua':'Красота','converse.org.ua':'Одежда и обувь','allo.ua':'Техника',
  'comfy.ua':'Техника','foxtrot.com.ua':'Техника'
};
function applyStoreFromUrl(){
  const d=getDomain(els.urlInput.value.trim()); if(!d) return;
  if(STORE_NAMES[d]) els.storeInput.value=STORE_NAMES[d];
  if(STORE_DEFAULT_CATEGORY[d] && (!els.itemId.value || els.categoryInput.value==='Техника' || els.categoryInput.value==='Другое')) els.categoryInput.value=STORE_DEFAULT_CATEGORY[d];
  updatePreview();
}

const params = new URLSearchParams(location.search);
const state = {
  items: [], view: 'home', homeStatus: 'all', theme: localStorage.getItem('hochu-theme') || 'system',
  me: null, inviteToken: params.get('invite') || '', resetToken: params.get('reset') || '',
  admin: { overview:null, users:[], requests:[], resets:[] }
};

const els = {
  loginView:$('loginView'), loginForm:$('loginForm'), loginInput:$('loginInput'), passwordInput:$('passwordInput'), loginMessage:$('loginMessage'), togglePassword:$('togglePassword'),
  requestAccessBtn:$('requestAccessBtn'), forgotPasswordBtn:$('forgotPasswordBtn'), inviteNotice:$('inviteNotice'), inviteNoticeText:$('inviteNoticeText'), inviteRequestBtn:$('inviteRequestBtn'),
  appShell:$('appShell'), pageTitle:$('pageTitle'), pageSubtitle:$('pageSubtitle'), addTopButton:$('addTopButton'), themeQuick:$('themeQuick'),
  adminNavItem:$('adminNavItem'), adminNavBadge:$('adminNavBadge'), adminSettingsCard:$('adminSettingsCard'), openAdminSettings:$('openAdminSettings'),
  statCount:$('statCount'), statSaved:$('statSaved'), statSavedSub:$('statSavedSub'), statOrdered:$('statOrdered'), statBought:$('statBought'), statActiveText:$('statActiveText'),
  homeSearch:$('homeSearch'), homeSort:$('homeSort'), homeList:$('homeList'), homeEmpty:$('homeEmpty'), totalActive:$('totalActive'), overallBar:$('overallBar'), overallText:$('overallText'),
  allSearch:$('allSearch'), allStatus:$('allStatus'), allCategory:$('allCategory'), allStore:$('allStore'), allList:$('allList'),
  categoryGrid:$('categoryGrid'), storesGrid:$('storesGrid'), storeCountBadge:$('storeCountBadge'),
  aTotal:$('aTotal'), aSaved:$('aSaved'), aLeft:$('aLeft'), aBought:$('aBought'), aTotalBar:$('aTotalBar'), aSavedBar:$('aSavedBar'), aLeftBar:$('aLeftBar'), aBoughtBar:$('aBoughtBar'), categoryProgress:$('categoryProgress'),
  profileName:$('profileName'), profileAvatar:$('profileAvatar'), profileRole:$('profileRole'), nameSetting:$('nameSetting'), accountSetting:$('accountSetting'), saveName:$('saveName'), logoutButton:$('logoutButton'), mobileAdd:$('mobileAdd'),
  editor:$('editorDialog'), editorForm:$('editorForm'), editorTitle:$('editorTitle'), editorClose:$('editorClose'), cancelEditor:$('cancelEditor'), deleteItem:$('deleteItem'),
  itemId:$('itemId'), urlInput:$('urlInput'), fetchPreview:$('fetchPreview'), fetchMessage:$('fetchMessage'), titleInput:$('titleInput'), priceInput:$('priceInput'), savedInput:$('savedInput'), categoryInput:$('categoryInput'), priorityInput:$('priorityInput'), statusInput:$('statusInput'), storeInput:$('storeInput'), imageInput:$('imageInput'), noteInput:$('noteInput'),
  previewImageWrap:$('previewImageWrap'), previewImage:$('previewImage'), previewPlaceholder:$('previewPlaceholder'), previewTitle:$('previewTitle'), previewStoreBadge:$('previewStoreBadge'), previewPrice:$('previewPrice'), previewSaved:$('previewSaved'), previewProgressBar:$('previewProgressBar'), previewProgressText:$('previewProgressText'),
  accessDialog:$('accessDialog'), accessForm:$('accessForm'), accessClose:$('accessClose'), accessCancel:$('accessCancel'), accessInviteState:$('accessInviteState'), accessName:$('accessName'), accessUsername:$('accessUsername'), accessEmail:$('accessEmail'), accessPassword:$('accessPassword'), accessPassword2:$('accessPassword2'), accessMessage:$('accessMessage'), accessFormMessage:$('accessFormMessage'),
  forgotDialog:$('forgotDialog'), forgotForm:$('forgotForm'), forgotClose:$('forgotClose'), forgotCancel:$('forgotCancel'), forgotLogin:$('forgotLogin'), forgotMessage:$('forgotMessage'),
  resetPasswordDialog:$('resetPasswordDialog'), resetPasswordForm:$('resetPasswordForm'), resetPasswordHint:$('resetPasswordHint'), newPassword:$('newPassword'), newPassword2:$('newPassword2'), resetPasswordMessage:$('resetPasswordMessage'), resetBack:$('resetBack'),
  inviteDialog:$('inviteDialog'), inviteForm:$('inviteForm'), inviteClose:$('inviteClose'), inviteCancel:$('inviteCancel'), inviteLabel:$('inviteLabel'), inviteDays:$('inviteDays'), inviteUses:$('inviteUses'), inviteMessage:$('inviteMessage'), inviteResult:$('inviteResult'), inviteUrl:$('inviteUrl'), copyInvite:$('copyInvite'), createInviteBtn:$('createInviteBtn'),
  resetLinkDialog:$('resetLinkDialog'), resetLinkClose:$('resetLinkClose'), resetLinkUrl:$('resetLinkUrl'), copyResetLink:$('copyResetLink'),
  adminUsersCount:$('adminUsersCount'), adminActiveCount:$('adminActiveCount'), adminPendingCount:$('adminPendingCount'), adminResetCount:$('adminResetCount'), adminItemsCount:$('adminItemsCount'), adminItemsSum:$('adminItemsSum'), accessRequestsList:$('accessRequestsList'), resetRequestsList:$('resetRequestsList'), adminUsersList:$('adminUsersList'), adminUserSearch:$('adminUserSearch')
};

function money(v){ return new Intl.NumberFormat('uk-UA',{maximumFractionDigits:0}).format(Number(v||0))+' ₴'; }
function esc(v=''){ return String(v).replace(/[&<>'"]/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;' }[c])); }
function validImageUrl(v=''){
  const s=String(v||'').trim();
  if(!s || /\[object(?:%20|\s)+Object\]/i.test(s)) return '';
  try { const u=new URL(s); return ['http:','https:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
}
function clamp(n,a,b){ return Math.min(b,Math.max(a,n)); }
function progress(item){ return item.price > 0 ? clamp((Number(item.saved||0)/Number(item.price))*100,0,100) : 0; }
function activeItems(){ return state.items.filter(x=>x.status!=='bought'); }
function getDomain(url='') { try { return new URL(url).hostname.replace(/^www\./,''); } catch { return ''; } }
function storeName(item){ return item.store || STORE_NAMES[item.storeDomain] || item.storeDomain || 'Магазин'; }
function storeLogo(domain){
  if(!domain) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}
function storeBadge(item){
  const d = item.storeDomain || getDomain(item.url);
  const logo = d ? `<img src="${esc(storeLogo(d))}" alt="" onerror="this.remove()">` : '';
  return `<span class="store-pill">${logo}${esc(storeName({...item,storeDomain:d}))}</span>`;
}
function statusChip(status){ const s=STATUS[status]||STATUS.want; return `<span class="status-chip ${s[1]}">${s[0]}</span>`; }

async function api(url, options={}){
  const opts = {...options, headers:{'content-type':'application/json',...(options.headers||{})}};
  const r = await fetch(url, opts);
  const data = await r.json().catch(()=>({}));
  if(r.status===401){ showLogin(); throw new Error('Нужен вход'); }
  if(!r.ok) throw new Error(data.error || `Ошибка ${r.status}`);
  return data;
}
function showLogin(){ els.appShell.classList.add('hidden'); els.loginView.classList.remove('hidden'); }
function showApp(){ els.loginView.classList.add('hidden'); els.appShell.classList.remove('hidden'); }

function applyTheme(theme){
  state.theme = theme;
  localStorage.setItem('hochu-theme',theme);
  document.documentElement.dataset.theme = theme;
  $$('.theme-card').forEach(b=>b.classList.toggle('active', b.dataset.themeChoice===theme));
}
function nextTheme(){
  const resolved = state.theme==='system' ? (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light') : state.theme;
  applyTheme(resolved==='dark'?'light':'dark');
}
function updateProfile(){
  const u=state.me; if(!u)return;
  els.profileName.textContent=u.name||u.username; els.profileAvatar.textContent=(u.name||u.username||'?').trim().charAt(0).toUpperCase();
  els.profileRole.textContent=u.role==='admin'?'администратор':'личный журнал'; els.nameSetting.value=u.name||''; els.accountSetting.value=`${u.username} · ${u.email}`;
  els.adminNavItem.classList.toggle('hidden',u.role!=='admin'); els.adminSettingsCard.classList.toggle('hidden',u.role!=='admin');
}

async function boot(){
  applyTheme(state.theme);
  if(state.resetToken){ await openResetFromToken(); return; }
  if(state.inviteToken) await validateInvite();
  const me = await fetch('/api/me').then(r=>r.json()).catch(()=>({authenticated:false}));
  if(!me.authenticated){ showLogin(); return; }
  state.me=me.user; updateProfile(); showApp(); await loadItems();
  if(state.me?.role==='admin') await refreshAdminBadge();
}
async function validateInvite(){
  try{const r=await fetch(`/api/invite/validate?token=${encodeURIComponent(state.inviteToken)}`);const d=await r.json();if(d.valid){els.inviteNotice.classList.remove('hidden');els.inviteNoticeText.textContent=d.label?`Приглашение для: ${d.label}`:'Можно подать заявку на доступ.';}else{state.inviteToken='';}}
  catch{state.inviteToken='';}
}
async function openResetFromToken(){
  showLogin();
  try{const r=await fetch(`/api/password-reset/validate?token=${encodeURIComponent(state.resetToken)}`);const d=await r.json();if(!d.valid){els.loginMessage.textContent='Ссылка сброса недействительна или уже истекла.';return;}els.resetPasswordHint.textContent=`Аккаунт: ${d.username}. Придумай новый пароль — администратор его не увидит.`;els.resetPasswordDialog.showModal();}
  catch{els.loginMessage.textContent='Не удалось проверить ссылку сброса.';}
}
async function loadItems(){
  state.items = await api('/api/items');
  renderAll();
}

function viewMeta(view){
  return ({
    home:['Мои покупки','Желания, на которые ты копишь'],purchases:['Все покупки','Полный журнал желаний и покупок'],
    categories:['Категории','Сгруппировано по типу покупки'],stores:['Магазины','Где лежат твои хотелки'],
    stats:['Статистика','Сколько хочется, сколько накоплено'],admin:['Администрирование','Пользователи, заявки и доступ'],settings:['Настройки','Оформление и профиль']
  })[view] || ['Хочу','Личный журнал покупок'];
}
function setView(view){
  state.view=view;
  $$('.view').forEach(v=>v.classList.remove('active'));
  $(`view-${view}`)?.classList.add('active');
  $$('.nav-item,.mobile-nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  const [t,s]=viewMeta(view); els.pageTitle.textContent=t; els.pageSubtitle.textContent=s;
  if(view==='categories') renderCategories(); if(view==='stores') renderStores(); if(view==='stats') renderStats(); if(view==='purchases') renderAllPurchases(); if(view==='admin') loadAdmin();
}

function renderAll(){
  renderStatsTop(); renderHome(); renderAllPurchases(); renderCategories(); renderStores(); renderStats(); refreshFilters();
}
function renderStatsTop(){
  const active=activeItems(), total=active.reduce((s,x)=>s+x.price,0), saved=active.reduce((s,x)=>s+Math.min(x.saved,x.price||x.saved),0);
  els.statCount.textContent=active.length; els.statActiveText.textContent=`${active.length} активных желаний`;
  els.statSaved.textContent=money(saved); els.statSavedSub.textContent=`из ${money(total)}`;
  els.statOrdered.textContent=state.items.filter(x=>x.status==='ordered').length; els.statBought.textContent=state.items.filter(x=>x.status==='bought').length;
  els.totalActive.textContent=money(total); const pct=total?clamp(saved/total*100,0,100):0; els.overallBar.style.width=`${pct}%`; els.overallText.textContent=`Накоплено ${Math.round(pct)}% · ${money(saved)} из ${money(total)}`;
}
function sorted(items, mode){
  const copy=[...items];
  if(mode==='priority') return copy.sort((a,b)=>b.priority-a.priority);
  if(mode==='priceAsc') return copy.sort((a,b)=>a.price-b.price);
  if(mode==='priceDesc') return copy.sort((a,b)=>b.price-a.price);
  if(mode==='progress') return copy.sort((a,b)=>progress(b)-progress(a));
  return copy.sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
}
function itemRow(item){
  const pct=progress(item), safeImage=validImageUrl(item.image), img=safeImage ? `<img class="product-thumb" src="${esc(safeImage)}" alt="" onerror="this.outerHTML='<div class=&quot;thumb-placeholder&quot;>🛍</div>'">` : `<div class="thumb-placeholder">🛍</div>`;
  return `<article class="purchase-row" data-id="${item.id}">
    ${img}
    <div class="product-main"><div class="product-title">${esc(item.title)}</div><div class="product-meta">${storeBadge(item)}<span class="category-pill">${esc(item.category)}</span></div></div>
    <div class="money-block price-block"><span>Цена</span><strong>${money(item.price)}</strong></div>
    <div class="money-block saved-block"><span>Накопил</span><strong>${money(item.saved)}</strong><div class="tiny-progress"><i style="width:${pct}%"></i></div></div>
    ${statusChip(item.status)}
    <button class="row-menu" data-edit="${item.id}" aria-label="Редактировать">⋮</button>
  </article>`;
}
function bindRows(){
  $$('[data-edit]').forEach(b=>b.onclick=e=>{e.stopPropagation();openEditor(b.dataset.edit)});
  $$('.purchase-row').forEach(r=>r.onclick=()=>openEditor(r.dataset.id));
}
function renderHome(){
  const q=els.homeSearch.value.trim().toLowerCase();
  let list=state.items.filter(x=>state.homeStatus==='all'||x.status===state.homeStatus).filter(x=>!q||[x.title,x.store,x.storeDomain,x.category,x.note].join(' ').toLowerCase().includes(q));
  list=sorted(list,els.homeSort.value);
  els.homeList.innerHTML=list.map(itemRow).join(''); els.homeEmpty.classList.toggle('hidden',list.length!==0); bindRows();
}
function renderAllPurchases(){
  const q=els.allSearch.value.trim().toLowerCase(), s=els.allStatus.value, c=els.allCategory.value, st=els.allStore.value;
  const list=state.items.filter(x=>(s==='all'||x.status===s)&&(c==='all'||x.category===c)&&(st==='all'||(x.storeDomain||getDomain(x.url))===st)).filter(x=>!q||[x.title,x.store,x.storeDomain,x.category,x.note].join(' ').toLowerCase().includes(q));
  els.allList.innerHTML=list.length?sorted(list,'recent').map(itemRow).join(''):`<div class="empty-state"><h3>Ничего не найдено</h3><p>Измени фильтры или добавь новую покупку.</p></div>`; bindRows();
}
function refreshFilters(){
  const cats=[...new Set(state.items.map(x=>x.category).filter(Boolean))].sort();
  const stores=[...new Set(state.items.map(x=>x.storeDomain||getDomain(x.url)).filter(Boolean))].sort();
  const cval=els.allCategory.value,sval=els.allStore.value;
  els.allCategory.innerHTML='<option value="all">Все категории</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
  els.allStore.innerHTML='<option value="all">Все магазины</option>'+stores.map(d=>`<option value="${esc(d)}">${esc(STORE_NAMES[d]||d)}</option>`).join('');
  if(cats.includes(cval)) els.allCategory.value=cval; if(stores.includes(sval)) els.allStore.value=sval;
}
function renderCategories(){
  const groups={}; for(const x of state.items){ if(!groups[x.category])groups[x.category]=[]; groups[x.category].push(x); }
  const entries=Object.entries(groups).sort((a,b)=>b[1].length-a[1].length);
  els.categoryGrid.innerHTML=entries.length?entries.map(([cat,arr])=>{const total=arr.reduce((s,x)=>s+x.price,0),saved=arr.reduce((s,x)=>s+Math.min(x.saved,x.price||x.saved),0),pct=total?saved/total*100:0;return `<article class="category-card glass"><div><span class="category-icon">${CATEGORY_ICONS[cat]||'•'}</span><h3>${esc(cat)}</h3><small>${arr.length} товаров · ${money(total)}</small></div><div><div class="cat-progress"><i style="width:${clamp(pct,0,100)}%"></i></div><small>Накоплено ${Math.round(pct)}%</small></div></article>`}).join(''):`<div class="empty-state glass"><h3>Категорий пока нет</h3><p>Они появятся автоматически после добавления товаров.</p></div>`;
}
function renderStores(){
  const groups={}; for(const x of state.items){ const d=x.storeDomain||getDomain(x.url)||'other'; if(!groups[d])groups[d]=[]; groups[d].push(x); }
  const entries=Object.entries(groups).sort((a,b)=>b[1].length-a[1].length); els.storeCountBadge.textContent=entries.length;
  els.storesGrid.innerHTML=entries.length?entries.map(([domain,arr])=>{const name=STORE_NAMES[domain]||arr[0]?.store||domain;const total=arr.reduce((s,x)=>s+x.price,0);const logo=domain!=='other'?`<img src="${storeLogo(domain)}" alt="" onerror="this.remove()">`:'🛍';return `<article class="store-card glass"><div class="store-logo">${logo}</div><div class="store-copy"><b>${esc(name)}</b><small>${domain==='other'?'Без сайта':esc(domain)} · ${arr.length} товаров</small></div><div class="store-total"><strong>${money(total)}</strong><small>в списке</small></div></article>`}).join(''):`<div class="empty-state glass"><h3>Магазинов пока нет</h3><p>Добавь ссылку на товар — магазин появится здесь.</p></div>`;
}
function renderStats(){
  const active=activeItems(), total=active.reduce((s,x)=>s+x.price,0), saved=active.reduce((s,x)=>s+Math.min(x.saved,x.price||x.saved),0), left=Math.max(0,total-saved), bought=state.items.filter(x=>x.status==='bought').length;
  els.aTotal.textContent=money(total); els.aSaved.textContent=money(saved); els.aLeft.textContent=money(left); els.aBought.textContent=bought;
  const savedPct=total?saved/total*100:0; els.aTotalBar.style.width='100%';els.aSavedBar.style.width=`${savedPct}%`;els.aLeftBar.style.width=`${100-savedPct}%`;els.aBoughtBar.style.width=`${state.items.length?bought/state.items.length*100:0}%`;
  const groups={}; for(const x of active){ if(!groups[x.category])groups[x.category]=[];groups[x.category].push(x); }
  els.categoryProgress.innerHTML=Object.entries(groups).map(([cat,arr])=>{const t=arr.reduce((s,x)=>s+x.price,0),sv=arr.reduce((s,x)=>s+Math.min(x.saved,x.price||x.saved),0),pct=t?sv/t*100:0;return `<div class="progress-row"><label>${esc(cat)}</label><div class="bar"><i style="width:${clamp(pct,0,100)}%"></i></div><span>${Math.round(pct)}% · ${money(sv)}</span></div>`}).join('')||'<div class="empty-state"><p>Статистика появится после добавления желаний.</p></div>';
}

function resetEditor(){
  els.editorForm.reset(); els.itemId.value=''; els.fetchMessage.textContent=''; els.fetchPreview.textContent='✦ Подтянуть'; els.deleteItem.classList.add('hidden'); els.editorTitle.textContent='Новое желание'; els.priorityInput.value='2'; els.statusInput.value='want'; els.categoryInput.value='Техника'; updatePreview();
}
function openEditor(id=null){
  resetEditor();
  if(id){ const x=state.items.find(v=>v.id===id); if(!x)return; els.itemId.value=x.id;els.urlInput.value=x.url||'';els.titleInput.value=x.title||'';els.priceInput.value=x.price||'';els.savedInput.value=x.saved||'';els.categoryInput.value=x.category||'Другое';els.priorityInput.value=String(x.priority||2);els.statusInput.value=x.status||'want';els.storeInput.value=x.store||'';els.imageInput.value=validImageUrl(x.image||'');els.noteInput.value=x.note||'';els.deleteItem.classList.remove('hidden');els.editorTitle.textContent='Редактировать желание'; }
  updatePreview(); els.editor.showModal();
}
function updatePreview(){
  const title=els.titleInput.value.trim()||'Новое желание',price=Number(els.priceInput.value||0),saved=Number(els.savedInput.value||0),pct=price?clamp(saved/price*100,0,100):0,img=validImageUrl(els.imageInput.value),store=els.storeInput.value.trim()||'Магазин';
  els.previewTitle.textContent=title;els.previewStoreBadge.textContent=store;els.previewPrice.textContent=money(price);els.previewSaved.textContent=money(saved);els.previewProgressBar.style.width=`${pct}%`;els.previewProgressText.textContent=`${Math.round(pct)}%`;
  if(img){els.previewImage.src=img;els.previewImage.style.display='block';els.previewPlaceholder.style.display='none';els.previewImage.onerror=()=>{els.previewImage.style.display='none';els.previewPlaceholder.style.display='block'}}else{els.previewImage.style.display='none';els.previewPlaceholder.style.display='block'}
}
function itemPayload(){
  const url=els.urlInput.value.trim(); return {title:els.titleInput.value.trim(),url,image:validImageUrl(els.imageInput.value),store:els.storeInput.value.trim(),storeDomain:getDomain(url),price:Number(els.priceInput.value||0),saved:Number(els.savedInput.value||0),category:els.categoryInput.value,priority:Number(els.priorityInput.value),status:els.statusInput.value,note:els.noteInput.value.trim()};
}

function fmtDate(v){ if(!v)return '—'; try{return new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(v))}catch{return '—'} }
function roleLabel(role){ return role==='admin'?'Администратор':'Пользователь'; }
function statusLabel(status){ return status==='blocked'?'Заблокирован':'Активен'; }
async function refreshAdminBadge(){
  if(state.me?.role!=='admin')return;
  try{const o=await api('/api/admin/overview');const n=Number(o.pendingAccess||0)+Number(o.pendingResets||0);els.adminNavBadge.textContent=n;els.adminNavBadge.classList.toggle('hidden',!n);}catch{}
}
async function loadAdmin(){
  if(state.me?.role!=='admin')return;
  try{
    const [overview,users,requests,resets]=await Promise.all([api('/api/admin/overview'),api('/api/admin/users'),api('/api/admin/access-requests'),api('/api/admin/reset-requests')]);
    state.admin={overview,users,requests,resets}; renderAdmin();
  }catch(err){alert(err.message)}
}
function renderAdmin(){
  const {overview,users,requests,resets}=state.admin;if(!overview)return;
  els.adminUsersCount.textContent=overview.users.total||0;els.adminActiveCount.textContent=`${overview.users.active||0} активных`;
  els.adminPendingCount.textContent=overview.pendingAccess||0;els.adminResetCount.textContent=overview.pendingResets||0;els.adminItemsCount.textContent=overview.wishlist.items||0;els.adminItemsSum.textContent=money(overview.wishlist.totalPrice||0);
  const pending=Number(overview.pendingAccess||0)+Number(overview.pendingResets||0);els.adminNavBadge.textContent=pending;els.adminNavBadge.classList.toggle('hidden',!pending);
  els.accessRequestsList.innerHTML=requests.length?requests.map(r=>`<article class="admin-request-card"><div class="admin-person"><div class="avatar small">${esc((r.name||'?').charAt(0).toUpperCase())}</div><div><b>${esc(r.name)}</b><small>@${esc(r.username)} · ${esc(r.email)}</small>${r.invite_label?`<small>Приглашение: ${esc(r.invite_label)}</small>`:''}</div></div><div class="request-message">${esc(r.message||'Без сообщения')}</div><div class="request-actions"><button class="secondary" data-decline-request="${r.id}">Отклонить</button><button class="primary" data-approve-request="${r.id}">Одобрить</button></div></article>`).join(''):'<div class="empty-state"><p>Новых заявок нет.</p></div>';
  els.resetRequestsList.innerHTML=resets.length?resets.map(r=>{const uid=r.user_id||r.userId||r.user?.id;const name=r.name||r.user?.name||r.username||r.user?.username||r.email;return `<article class="admin-request-card reset-request-card"><div class="admin-person"><div class="avatar small">${esc(String(name||'?').charAt(0).toUpperCase())}</div><div><b>${esc(name)}</b><small>${esc(r.username||r.user?.username||'')} · ${esc(r.email)}</small><small>Запрос: ${fmtDate(r.created_at||r.createdAt)}</small></div></div><div class="request-actions"><button class="primary" data-reset-user="${uid}">Создать ссылку</button></div></article>`}).join(''):'<div class="empty-state"><p>Запросов на сброс пароля нет.</p></div>';
  renderAdminUsers(); bindAdminActions();
}
function renderAdminUsers(){
  const q=(els.adminUserSearch?.value||'').trim().toLowerCase(); const users=state.admin.users.filter(u=>!q||[u.name,u.username,u.email].join(' ').toLowerCase().includes(q));
  els.adminUsersList.innerHTML=users.map(u=>`<article class="admin-user-row"><div class="admin-person"><div class="avatar small">${esc((u.name||u.username||'?').charAt(0).toUpperCase())}</div><div><b>${esc(u.name)}</b><small>@${esc(u.username)} · ${esc(u.email)}</small></div></div><span class="role-chip ${u.role}">${roleLabel(u.role)}</span><span class="user-status ${u.status}">${statusLabel(u.status)}</span><div class="user-stats"><b>${u.itemCount||0}</b><small>товаров</small></div><div class="user-stats"><b>${money(u.totalSaved||0)}</b><small>накопил</small></div><small class="last-login">${u.lastLoginAt?`вход ${fmtDate(u.lastLoginAt)}`:'ещё не входил'}</small><div class="admin-user-actions">${u.id===state.me.id?'<span class="self-label">это ты</span>':`<button class="secondary mini" data-reset-user="${u.id}">Сброс</button><button class="secondary mini" data-toggle-user="${u.id}" data-next-status="${u.status==='blocked'?'active':'blocked'}">${u.status==='blocked'?'Разблокировать':'Блок'}</button><button class="danger-button mini" data-delete-user="${u.id}">Удалить</button>`}</div></article>`).join('');
  bindAdminActions();
}
function bindAdminActions(){
  $$('[data-approve-request]').forEach(b=>b.onclick=async()=>{if(!confirm('Одобрить заявку и создать пользователю аккаунт?'))return;try{await api(`/api/admin/access-requests/${b.dataset.approveRequest}/approve`,{method:'POST',body:'{}'});await loadAdmin()}catch(e){alert(e.message)}});
  $$('[data-decline-request]').forEach(b=>b.onclick=async()=>{if(!confirm('Отклонить заявку?'))return;try{await api(`/api/admin/access-requests/${b.dataset.declineRequest}/decline`,{method:'POST',body:'{}'});await loadAdmin()}catch(e){alert(e.message)}});
  $$('[data-reset-user]').forEach(b=>b.onclick=()=>createResetLink(b.dataset.resetUser));
  $$('[data-toggle-user]').forEach(b=>b.onclick=async()=>{const status=b.dataset.nextStatus;if(!confirm(status==='blocked'?'Заблокировать пользователя? Его активные сессии завершатся.':'Разблокировать пользователя?'))return;try{await api(`/api/admin/users/${b.dataset.toggleUser}/status`,{method:'PATCH',body:JSON.stringify({status})});await loadAdmin()}catch(e){alert(e.message)}});
  $$('[data-delete-user]').forEach(b=>b.onclick=async()=>{if(!confirm('Удалить пользователя и ВСЕ его хотелки? Это действие нельзя отменить.'))return;try{await api(`/api/admin/users/${b.dataset.deleteUser}`,{method:'DELETE'});await loadAdmin()}catch(e){alert(e.message)}});
}
async function createResetLink(userId){
  try{const d=await api(`/api/admin/users/${userId}/reset-link`,{method:'POST',body:'{}'});els.resetLinkUrl.value=d.url;els.resetLinkDialog.showModal();await loadAdmin();}catch(e){alert(e.message)}
}
function openAccessDialog(){
  els.accessForm.reset();els.accessFormMessage.textContent='';
  if(!state.inviteToken){els.accessInviteState.innerHTML='<b>Нужна ссылка-приглашение</b><span>Попроси администратора создать приглашение и открыть его ссылку.</span>';}
  else{els.accessInviteState.innerHTML='<b>Приглашение подтверждено ✓</b><span>После заявки администратор всё равно должен одобрить аккаунт.</span>';}
  els.accessDialog.showModal();
}
async function copyText(value,button){
  try{await navigator.clipboard.writeText(value);const old=button.textContent;button.textContent='Скопировано ✓';setTimeout(()=>button.textContent=old,1600);}catch{prompt('Скопируй ссылку:',value)}
}

els.loginForm.addEventListener('submit',async e=>{
  e.preventDefault();
  const form = new FormData(e.currentTarget);
  const login = String(form.get('login') ?? els.loginInput.value ?? '').trim();
  const password = String(form.get('password') ?? els.passwordInput.value ?? '');
  if(!login || !password){ els.loginMessage.textContent='Укажи логин/email и пароль.'; return; }
  els.loginMessage.textContent='Проверяю…';
  try{
    const d=await api('/api/login',{method:'POST',credentials:'same-origin',body:JSON.stringify({login,password})});
    state.me=d.user; els.passwordInput.value=''; els.loginMessage.textContent=''; updateProfile(); showApp(); await loadItems();
    if(state.me?.role==='admin') await refreshAdminBadge();
  }catch(err){ els.loginMessage.textContent=err.message; }
});
els.togglePassword.onclick=()=>{els.passwordInput.type=els.passwordInput.type==='password'?'text':'password'};
els.requestAccessBtn.onclick=openAccessDialog;els.inviteRequestBtn.onclick=openAccessDialog;els.forgotPasswordBtn.onclick=()=>{els.forgotForm.reset();els.forgotMessage.textContent='';els.forgotDialog.showModal()};
els.accessClose.onclick=els.accessCancel.onclick=()=>els.accessDialog.close();
els.forgotClose.onclick=els.forgotCancel.onclick=()=>els.forgotDialog.close();
els.accessForm.addEventListener('submit',async e=>{e.preventDefault();if(!state.inviteToken){els.accessFormMessage.textContent='Открой ссылку-приглашение от администратора.';return}if(els.accessPassword.value!==els.accessPassword2.value){els.accessFormMessage.textContent='Пароли не совпадают.';return}els.accessFormMessage.textContent='Отправляю заявку…';try{const d=await api('/api/access-request',{method:'POST',body:JSON.stringify({inviteToken:state.inviteToken,name:els.accessName.value,username:els.accessUsername.value,email:els.accessEmail.value,password:els.accessPassword.value,message:els.accessMessage.value})});els.accessFormMessage.textContent=d.message;setTimeout(()=>els.accessDialog.close(),1800)}catch(err){els.accessFormMessage.textContent=err.message}});
els.forgotForm.addEventListener('submit',async e=>{e.preventDefault();els.forgotMessage.textContent='Отправляю…';try{const d=await api('/api/password-reset/request',{method:'POST',body:JSON.stringify({login:els.forgotLogin.value})});els.forgotMessage.textContent=d.message}catch(err){els.forgotMessage.textContent=err.message}});
els.resetPasswordForm.addEventListener('submit',async e=>{e.preventDefault();if(els.newPassword.value!==els.newPassword2.value){els.resetPasswordMessage.textContent='Пароли не совпадают.';return}els.resetPasswordMessage.textContent='Сохраняю…';try{const d=await api('/api/password-reset/complete',{method:'POST',body:JSON.stringify({token:state.resetToken,password:els.newPassword.value})});els.resetPasswordMessage.textContent=d.message;state.resetToken='';history.replaceState({},'',location.pathname);setTimeout(()=>{els.resetPasswordDialog.close();showLogin()},1200)}catch(err){els.resetPasswordMessage.textContent=err.message}});
els.resetBack.onclick=()=>{els.resetPasswordDialog.close();state.resetToken='';history.replaceState({},'',location.pathname);showLogin()};
els.themeQuick.onclick=nextTheme; els.addTopButton.onclick=()=>openEditor(); els.mobileAdd.onclick=()=>openEditor();
$$('[data-action="add"]').forEach(b=>b.onclick=()=>openEditor());
$$('.nav-item,.mobile-nav-item').forEach(b=>b.onclick=()=>setView(b.dataset.view));
$$('.theme-card').forEach(b=>b.onclick=()=>applyTheme(b.dataset.themeChoice));
els.saveName.onclick=async()=>{try{const d=await api('/api/profile',{method:'PATCH',body:JSON.stringify({name:els.nameSetting.value.trim()})});state.me=d.user;updateProfile()}catch(err){alert(err.message)}};
els.logoutButton.onclick=async()=>{await fetch('/api/logout',{method:'POST'});state.me=null;showLogin()};
els.adminUserSearch?.addEventListener('input',renderAdminUsers);els.openAdminSettings.onclick=()=>setView('admin');
els.createInviteBtn.onclick=()=>{els.inviteForm.reset();els.inviteDays.value='7';els.inviteUses.value='1';els.inviteResult.classList.add('hidden');els.inviteMessage.textContent='';els.inviteDialog.showModal()};
els.inviteClose.onclick=els.inviteCancel.onclick=()=>els.inviteDialog.close();
els.inviteForm.addEventListener('submit',async e=>{e.preventDefault();els.inviteMessage.textContent='Создаю…';try{const d=await api('/api/admin/invitations',{method:'POST',body:JSON.stringify({label:els.inviteLabel.value,days:Number(els.inviteDays.value),maxUses:Number(els.inviteUses.value)})});els.inviteUrl.value=d.url;els.inviteResult.classList.remove('hidden');els.inviteMessage.textContent=`Действует до ${fmtDate(d.expiresAt)}.`}catch(err){els.inviteMessage.textContent=err.message}});
els.copyInvite.onclick=()=>copyText(els.inviteUrl.value,els.copyInvite);els.resetLinkClose.onclick=()=>els.resetLinkDialog.close();els.copyResetLink.onclick=()=>copyText(els.resetLinkUrl.value,els.copyResetLink);

els.homeSearch.oninput=renderHome; els.homeSort.onchange=renderHome;
$$('#homeTabs .tab').forEach(b=>b.onclick=()=>{state.homeStatus=b.dataset.status;$$('#homeTabs .tab').forEach(x=>x.classList.toggle('active',x===b));renderHome()});
[els.allSearch,els.allStatus,els.allCategory,els.allStore].forEach(el=>{el.addEventListener(el.tagName==='INPUT'?'input':'change',renderAllPurchases)});

els.editorClose.onclick=()=>els.editor.close(); els.cancelEditor.onclick=()=>els.editor.close();
[els.titleInput,els.priceInput,els.savedInput,els.storeInput,els.imageInput].forEach(el=>el.addEventListener('input',updatePreview));
els.urlInput.addEventListener('input',applyStoreFromUrl);
els.urlInput.addEventListener('paste',()=>setTimeout(applyStoreFromUrl,0));
els.fetchPreview.onclick=async()=>{
  const url=els.urlInput.value.trim();
  if(!url){els.fetchMessage.textContent='Сначала вставь ссылку.';return}
  applyStoreFromUrl();
  els.fetchPreview.disabled=true; els.fetchMessage.textContent='Читаю карточку товара…';
  try{
    const d=await api('/api/product-preview',{method:'POST',body:JSON.stringify({url})});
    if(d.title) els.titleInput.value=d.title;
    if(d.price) els.priceInput.value=d.price;
    if(d.store) els.storeInput.value=d.store;
    if(d.image) els.imageInput.value=validImageUrl(d.image);
    if(d.category) els.categoryInput.value=d.category;
    if(d.canonicalUrl) els.urlInput.value=d.canonicalUrl;
    els.fetchMessage.textContent=d.message || (d.quality==='partial'?'Получены не все данные — проверь поля.':d.quality==='none'?'Не удалось получить данные автоматически. Заполни поля вручную.':'Готово. Проверь данные перед сохранением.');
    els.fetchPreview.textContent=d.quality==='none'?'✦ Подтянуть':'↻ Обновить';
    updatePreview();
  }catch(err){
    els.fetchMessage.textContent='Не удалось получить данные автоматически. Ссылка останется в карточке — заполни поля вручную.';
  }finally{els.fetchPreview.disabled=false}
};
els.editorForm.addEventListener('submit',async e=>{e.preventDefault();const payload=itemPayload();try{if(els.itemId.value)await api(`/api/items/${els.itemId.value}`,{method:'PUT',body:JSON.stringify(payload)});else await api('/api/items',{method:'POST',body:JSON.stringify(payload)});els.editor.close();await loadItems()}catch(err){alert(err.message)}});
els.deleteItem.onclick=async()=>{if(!els.itemId.value||!confirm('Удалить эту покупку из журнала?'))return;try{await api(`/api/items/${els.itemId.value}`,{method:'DELETE'});els.editor.close();await loadItems()}catch(err){alert(err.message)}};

window.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();els.homeSearch.focus()}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='n'){e.preventDefault();openEditor()}});
if('serviceWorker' in navigator){
  window.addEventListener('load',async()=>{
    try{
      const reg=await navigator.serviceWorker.register('/sw.js?v=1.1.4',{updateViaCache:'none'});
      await reg.update();
    }catch{}
  });
}
boot();
