// YB Family Food Diary — 가족 식사 일기 (끼니당 1건 · 사진 1장 · 가족 공용)
import './style.css';
import { getTheme, setTheme } from './theme.js';
import { signIn, signOutUser, watchAuth, finishRedirect } from './firebase.js';
import * as store from './store.js';
import { loadBitmap, compressImage, makeThumb, rotateCanvas, kb } from './image.js';
import { SLOTS, SLOT_ORDER, slotOf, splitNow, mealId, weekday, baseTitle } from './meal.js';

const VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pref = {
  get: (k, d) => { try { return localStorage.getItem('ybf-' + k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('ybf-' + k, v); } catch { /* 무시 */ } },
};

const state = {
  user: null,
  list: [],
  month: pref.get('month', 'all'),
  slot: 'all',      // all | b | l | d | mine
  q: '',
  selId: null,
  busy: new Set(),  // 사진 처리 중인 기록
  loaded: false,
};

const uid = () => state.user?.uid;
const isMine = (r) => !!r && r.owner === uid();
const myName = () => state.user?.displayName || (state.user?.email || '').split('@')[0] || '가족';
const byId = (id) => state.list.find((r) => r.id === id) || null;
const current = () => byId(state.selId);
const todayStr = () => splitNow().date;

/* ───────── 걸러 보기 ───────── */
const monthOf = (r) => (r.date || '').slice(0, 7);
const inMonth = (r) => state.month === 'all' || monthOf(r) === state.month;
function matchQ(r) {
  if (!state.q) return true;
  const q = state.q.toLowerCase();
  return [r.title, r.memo, r.ownerName, baseTitle(r)].some((v) => String(v || '').toLowerCase().includes(q));
}
const matchSlot = (r, k = state.slot) => k === 'all' || (k === 'mine' ? isMine(r) : r.slot === k);
// 날짜는 최근 순, 같은 날 안에서는 아침→점심→저녁
const cmp = (a, b) => (a.date === b.date ? SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot) : a.date < b.date ? 1 : -1);
const visible = () => state.list.filter((r) => inMonth(r) && matchQ(r) && matchSlot(r)).sort(cmp);

/* ───────── 목록 ───────── */
function renderMonths() {
  const months = [...new Set(state.list.map(monthOf).filter(Boolean))].sort().reverse();
  if (state.month !== 'all' && !months.includes(state.month)) months.unshift(state.month);
  const opts = [['all', '전체 기간'], ...months.map((m) => [m, `${m.slice(0, 4)}년 ${+m.slice(5)}월`])];
  $('#sel-month').innerHTML = opts.map(([v, t]) => `<option value="${v}"${v === state.month ? ' selected' : ''}>${t}</option>`).join('');
}

function renderChips() {
  const base = state.list.filter((r) => inMonth(r) && matchQ(r));
  const items = [['all', '전체'], ['b', '아침'], ['l', '점심'], ['d', '저녁'], ['mine', '내 기록']];
  $('#chips').innerHTML = items
    .map(([k, t]) => `<button class="chip${state.slot === k ? ' active' : ''}" data-slot="${k}" role="tab">${t}<b>${base.filter((r) => matchSlot(r, k)).length}</b></button>`)
    .join('');
}

function renderToday() {
  const d = todayStr();
  const nowSlot = slotOf(splitNow().time);
  const cells = SLOT_ORDER.map((s) => {
    const r = byId(mealId(d, s));
    const who = r ? (isMine(r) ? '나' : r.ownerName || '가족') : s === nowSlot ? '지금 올리기' : '—';
    return `<button type="button" class="t-s${r ? ' done' : ''}${s === nowSlot ? ' now' : ''}" data-slot="${s}"${r ? ` data-id="${r.id}"` : ''}><b>${r ? '✓ ' : ''}${SLOTS[s]}</b><small>${esc(who)}</small></button>`;
  }).join('');
  $('#today').innerHTML = `<span class="t-h">오늘<br />${+d.slice(5, 7)}.${+d.slice(8)} (${weekday(d)})</span>${cells}`;
}

function cardHTML(r) {
  const thumb = r.thumb ? `style="background-image:url('${r.thumb}')"` : '';
  const sub = [r.time, isMine(r) ? `${r.ownerName || '나'} (나)` : r.ownerName, r.memo].filter(Boolean).join(' · ');
  return `<li class="card${r.id === state.selId ? ' active' : ''}" data-id="${r.id}">
    <span class="thumb" ${thumb}>${r.thumb ? '' : '🍽'}</span>
    <span class="c-main">
      <span class="c-base"><span class="slot-badge ${r.slot}">${SLOTS[r.slot]}</span>${esc(baseTitle(r))}</span>
      ${r.title ? `<span class="c-title">${esc(r.title)}</span>` : ''}
      <span class="c-sub">${esc(sub)}</span>
    </span>
  </li>`;
}

function renderList() {
  const ul = $('#list');
  if (!state.loaded) { ul.innerHTML = '<li class="empty">불러오는 중…</li>'; return; }
  const items = visible();
  if (!items.length) {
    ul.innerHTML = state.list.length
      ? '<li class="empty">조건에 맞는 기록이 없습니다.</li>'
      : '<li class="empty">아직 식사 기록이 없습니다.<br /><b>＋ 기록</b>으로 음식 사진을 찍거나 고르세요.</li>';
    return;
  }
  let html = '';
  let lastD = null;
  for (const r of items) {
    if (r.date !== lastD) {
      const n = state.list.filter((x) => x.date === r.date).length;
      html += `<li class="day-h"><span>${r.date.replace(/-/g, '.')} (${weekday(r.date)})</span><span>${n}/3끼</span></li>`;
      lastD = r.date;
    }
    html += cardHTML(r);
  }
  ul.innerHTML = html;
}

function renderAll() {
  renderMonths();
  renderChips();
  renderToday();
  renderList();
  renderDetail();
}

/* ───────── 상세 ───────── */
let shownId = null;
let editing = false;

function renderDetail() {
  const r = current();
  const has = !!r;
  $('#detail').hidden = !has;
  $('#empty-detail').hidden = has;
  const mine = isMine(r);
  const busy = has && state.busy.has(r.id);
  $('#btn-delete').disabled = !mine || busy;
  $('#btn-photo').disabled = !mine || busy;
  $('#btn-rotate').disabled = !mine || busy || !r?.hasImage;
  if (!has) {
    shownId = null;
    $('#detail-title').textContent = '식사 기록';
    $('#save-state').textContent = '';
    return;
  }
  const fresh = shownId !== r.id;
  $('#detail-title').textContent = r.title || baseTitle(r);
  $('#f-slot').className = `slot-badge ${r.slot}`;
  $('#f-slot').textContent = SLOTS[r.slot];
  $('#f-base').textContent = baseTitle(r);
  if (fresh || !editing) {
    setVal('#f-title', r.title || '');
    setVal('#f-date', r.date || '');
    setVal('#f-time', r.time || '');
    setVal('#f-memo', r.memo || '');
  }
  ['#f-title', '#f-memo'].forEach((s) => ($(s).readOnly = !mine));
  ['#f-date', '#f-time'].forEach((s) => ($(s).disabled = !mine));
  $('#f-date').max = todayStr();
  $('#f-ro').hidden = mine;
  const fmt = (t) => (t ? new Date(t).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  $('#f-meta').innerHTML = [
    `작성 ${esc(r.ownerName || '')}${mine ? ' (나)' : ''}`,
    `올림 ${fmt(r.createdAt)}${r.updatedAt && r.updatedAt - r.createdAt > 1000 ? ` · 수정 ${fmt(r.updatedAt)}` : ''}`,
    r.size ? `사진 ${kb(r.size)}${r.dim ? ` (${r.dim})` : ''}` : '',
  ].filter(Boolean).join('<br />');

  $('#busy').hidden = !busy;
  if (fresh) {
    const img = $('#photo-img');
    img.hidden = true;
    img.removeAttribute('src');
    $('#photo-empty').hidden = false;
    $('#photo-empty').innerHTML = r.hasImage ? '<p>사진을 불러오는 중…</p>' : '<p>사진이 없습니다</p>';
    if (r.thumb) { img.src = r.thumb; img.hidden = false; $('#photo-empty').hidden = true; }
    if (r.hasImage) loadPhoto(r.id);
  }
  shownId = r.id;
}

function loadPhoto(id) {
  store.loadImageURL(id).then((url) => {
    if (url && state.selId === id) { $('#photo-img').src = url; $('#photo-img').hidden = false; $('#photo-empty').hidden = true; }
  }).catch(() => {});
}

function setVal(sel, v) {
  const el = $(sel);
  if (document.activeElement !== el && el.value !== v) el.value = v;
}

function select(id, { open = true } = {}) {
  flushSave();
  state.selId = id;
  editing = false;
  renderList();
  renderDetail();
  if (open && id) $('#app').dataset.view = 'detail';
}

/* 제목·내용 입력 → 자동 저장 */
let saveTimer = null;
const pending = {};
function queueSave(fields) {
  const r = current();
  if (!isMine(r)) return;
  Object.assign(r, fields);
  Object.assign(pending, fields);
  editing = true;
  $('#save-state').textContent = '저장 중…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}
function flushSave() {
  clearTimeout(saveTimer);
  const r = current();
  const fields = { ...pending };
  Object.keys(pending).forEach((k) => delete pending[k]);
  if (!r || !Object.keys(fields).length) return;
  store.patchMeal(r.id, fields);
  editing = false;
  $('#save-state').textContent = '저장됨';
  renderList();
}

/* ───────── 추가 (끼니당 1건, 사진 1장) ───────── */
async function prepPhoto(file) {
  const bitmap = await loadBitmap(file);
  const blob = await compressImage(bitmap);
  const thumb = makeThumb(bitmap);
  if (bitmap.close) bitmap.close();
  return { blob, thumb, size: blob.size, dim: await dimOf(blob), orig: file.size };
}
async function dimOf(blob) {
  try { const b = await createImageBitmap(blob); const s = `${b.width}×${b.height}`; b.close?.(); return s; } catch { return ''; }
}

async function addPhoto(files) {
  const imgs = [...(files || [])].filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) return;
  if (!state.user) return toast('먼저 로그인해 주세요.');
  if (imgs.length > 1) toast('한 번에 사진 1장만 올릴 수 있어 첫 장만 사용합니다.');
  const file = imgs[0];
  const { date, time } = splitNow();
  const slot = slotOf(time);
  const id = mealId(date, slot);
  const exist = byId(id);
  if (exist) {
    if (isMine(exist)) {
      select(id);
      if (confirm(`오늘 ${SLOTS[slot]} 기록이 이미 있습니다.\n사진을 새 사진으로 바꿀까요?\n(끼니마다 1건·사진 1장만 올릴 수 있습니다)`)) replacePhoto(file);
    } else {
      select(id);
      toast(`오늘 ${SLOTS[slot]}은 ${exist.ownerName || '다른 가족'}님이 이미 기록했습니다.`, 4500);
    }
    return;
  }
  try {
    toast('사진을 줄이는 중…', 0);
    const p = await prepPhoto(file);
    if (byId(id)) return toast(`오늘 ${SLOTS[slot]} 기록이 방금 추가되었습니다.`); // 그사이 다른 가족이 올린 경우
    const now = Date.now();
    const rec = {
      id, date, time, slot, title: '', memo: '',
      owner: uid(), ownerName: myName(), ownerEmail: state.user.email || '',
      hasImage: true, thumb: p.thumb, size: p.size, dim: p.dim, createdAt: now, updatedAt: now,
    };
    state.list.push(rec);
    store.saveImage(id, p.blob, uid());
    store.saveMeal(rec);
    select(id);
    renderAll();
    toast(`오늘 ${SLOTS[slot]}을 기록했습니다 · 사진 ${kb(p.orig)} → ${kb(p.size)}`);
    setTimeout(() => { if (matchMedia('(min-width: 861px)').matches) $('#f-title').focus(); }, 60);
  } catch (e) {
    console.error(e);
    toast(`사진을 읽지 못했습니다: ${file.name || ''}`);
  }
}

async function replacePhoto(file) {
  const r = current();
  if (!isMine(r) || !file) return;
  state.busy.add(r.id);
  renderDetail();
  try {
    const p = await prepPhoto(file);
    store.forgetImage(r.id);
    await store.saveImage(r.id, p.blob, uid());
    const fields = { hasImage: true, thumb: p.thumb, size: p.size, dim: p.dim };
    Object.assign(r, fields);
    store.patchMeal(r.id, fields);
    toast(`사진을 바꿨습니다 · ${kb(p.orig)} → ${kb(p.size)}`);
  } catch (e) {
    console.error(e);
    toast('사진을 읽지 못했습니다.');
  } finally {
    state.busy.delete(r.id);
    shownId = null;
    renderAll();
  }
}

async function rotatePhoto() {
  const r = current();
  if (!isMine(r) || !r.hasImage) return;
  const blob = await store.loadImageBlob(r.id);
  if (!blob) return;
  state.busy.add(r.id);
  renderDetail();
  try {
    const up = rotateCanvas(await loadBitmap(blob), 90);
    const nb = await compressImage(up);
    store.forgetImage(r.id);
    await store.saveImage(r.id, nb, uid());
    const fields = { thumb: makeThumb(up), size: nb.size, dim: `${up.width}×${up.height}` };
    Object.assign(r, fields);
    store.patchMeal(r.id, fields);
  } finally {
    state.busy.delete(r.id);
    shownId = null;
    renderAll();
  }
}

/* 일시 변경 — 끼니가 바뀌면 해당 끼니가 비어 있을 때만 옮김 */
let whenTimer = null;
function queueWhen() {
  clearTimeout(whenTimer);
  whenTimer = setTimeout(commitWhen, 900);
}
let whenBusy = false;
async function commitWhen() {
  clearTimeout(whenTimer);
  const r = current();
  if (!isMine(r) || whenBusy) return;
  const date = $('#f-date').value;
  const time = $('#f-time').value;
  const revert = () => { $('#f-date').value = r.date; $('#f-time').value = r.time; };
  if (!date || !time) return revert();
  if (date === r.date && time === r.time) return;
  if (date > todayStr()) { toast('앞으로의 날짜로는 기록할 수 없습니다.'); return revert(); }
  const slot = slotOf(time);
  const newId = mealId(date, slot);
  if (newId === r.id) {
    Object.assign(r, { date, time });
    store.patchMeal(r.id, { date, time });
    $('#save-state').textContent = '저장됨';
    renderAll();
    return;
  }
  const other = byId(newId);
  if (other) {
    toast(`${date.replace(/-/g, '.')} ${SLOTS[slot]}에는 이미 ${isMine(other) ? '내' : `${other.ownerName || '다른 가족'}님의`} 기록이 있습니다.`, 4500);
    return revert();
  }
  whenBusy = true;
  flushSave();
  try {
    const blob = r.hasImage ? await store.loadImageBlob(r.id) : null;
    const oldId = r.id;
    const moved = { ...r, id: newId, date, time, slot };
    store.forgetImage(oldId);
    state.list = state.list.filter((x) => x.id !== oldId).concat(moved);
    state.selId = newId;
    shownId = null;
    await store.moveMeal(oldId, moved, blob);
    renderAll();
    toast(`${baseTitle(moved)} 기록으로 옮겼습니다.`);
  } finally {
    whenBusy = false;
  }
}

function removeCurrent() {
  const r = current();
  if (!isMine(r)) return;
  if (!confirm(`이 기록을 삭제할까요?\n${baseTitle(r)}${r.title ? ` — ${r.title}` : ''}\n(사진도 함께 지워지며 되돌릴 수 없습니다)`)) return;
  clearTimeout(saveTimer);
  Object.keys(pending).forEach((k) => delete pending[k]);
  state.list = state.list.filter((x) => x.id !== r.id);
  store.forgetImage(r.id);
  store.removeMeal(r.id);
  state.selId = null;
  $('#app').dataset.view = 'list';
  renderAll();
  toast('삭제했습니다.');
}

/* ───────── 작은 메뉴 ───────── */
function openPop(anchor, html, bind) {
  const pop = $('#pop');
  pop.innerHTML = html;
  pop.hidden = false;
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  const h = pop.offsetHeight;
  const left = Math.min(window.innerWidth - w - 8, Math.max(8, a.right - w));
  let top = a.bottom + 6;
  if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  bind?.(pop);
}
const closePop = () => { $('#pop').hidden = true; };

function addMenu(anchor) {
  const { date, time } = splitNow();
  const slot = slotOf(time);
  const ex = byId(mealId(date, slot));
  const note = !ex ? `지금 올리면 → 오늘 <b>${SLOTS[slot]}</b>`
    : isMine(ex) ? `오늘 ${SLOTS[slot]}은 이미 기록함 → 사진 바꾸기`
    : `오늘 ${SLOTS[slot]}은 ${esc(ex.ownerName || '가족')}님이 기록함`;
  const off = ex && !isMine(ex) ? ' disabled' : '';
  openPop(anchor, `
    <div class="pop-note">${note}</div>
    <button data-a="camera"${off}>📷 사진 찍기</button>
    <button data-a="pick"${off}>🖼 앨범에서 고르기</button>`);
}

function mainMenu(anchor) {
  const theme = getTheme();
  openPop(anchor, `
    <div class="pop-row">화면 <select id="sel-theme" class="sel sel-sm">
      <option value="system"${theme === 'system' ? ' selected' : ''}>🌓 시스템 설정 사용</option>
      <option value="dark"${theme === 'dark' ? ' selected' : ''}>🌙 다크모드 켜기</option>
      <option value="light"${theme === 'light' ? ' selected' : ''}>☀ 다크모드 끄기</option></select></div>
    <button data-a="install">📲 앱으로 설치하는 법</button>
    <button data-a="rules">ℹ 기록 규칙</button>
    <hr />
    <button data-a="signout" class="danger">로그아웃</button>`, (pop) => {
    $('#sel-theme', pop).onchange = (e) => setTheme(e.target.value);
  });
}

async function doAction(a) {
  closePop();
  if (a === 'camera') return $('#file-camera').click();
  if (a === 'pick') return $('#file-pick').click();
  if (a === 'signout') {
    if (confirm('로그아웃할까요? 다시 로그인하면 기록이 그대로 보입니다.')) await signOutUser();
    return;
  }
  if (a === 'install') {
    return alert('■ PC(크롬·엣지): 주소창 오른쪽의 설치 아이콘(⊕) → 설치\n■ 갤럭시(크롬): 오른쪽 위 ⋮ → 홈 화면에 추가 → 설치\n■ 아이폰(Safari): 아래 공유(□↑) → 홈 화면에 추가');
  }
  if (a === 'rules') {
    return alert('■ 하루 3번: 아침·점심·저녁 끼니마다 가족 전체에서 1건\n   - 아침: 11시 이전 / 점심: 16시 이전 / 저녁: 16시 이후\n■ 1건에 사진 1장 (촬영·앨범, 나중에 바꾸기 가능)\n■ 사진은 올리기 전에 긴 변 1,280px·200KB 이하로 줄여 저장\n■ 올린 시각이 자동 기록되며 수정 가능 (바뀐 끼니가 비어 있을 때만)\n■ 수정·삭제는 올린 사람만, 보기는 가족 모두');
  }
}

/* ───────── 알림 ───────── */
let toastTimer = null;
function toast(msg, ms = 3200, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  if (action) t.querySelector('button').onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => (t.hidden = true), ms);
}
function setSync(s, text) {
  const el = $('#sync');
  el.dataset.s = s;
  el.textContent = text;
}

/* ───────── 이벤트 ───────── */
function bind() {
  $('#btn-add').onclick = (e) => { e.stopPropagation(); addMenu(e.currentTarget); };
  $('#fab').onclick = (e) => { e.stopPropagation(); addMenu(e.currentTarget); };
  $('#btn-menu').onclick = (e) => { e.stopPropagation(); mainMenu(e.currentTarget); };
  $('#pop').addEventListener('click', (e) => {
    e.stopPropagation();
    const b = e.target.closest('button[data-a]');
    if (b && !b.disabled) doAction(b.dataset.a);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#pop')) closePop(); });
  window.addEventListener('resize', closePop);

  $('#file-camera').onchange = (e) => { addPhoto(e.target.files); e.target.value = ''; };
  $('#file-pick').onchange = (e) => { addPhoto(e.target.files); e.target.value = ''; };
  $('#file-camera2').onchange = (e) => { replacePhoto(e.target.files[0]); e.target.value = ''; };
  $('#file-pick2').onchange = (e) => { replacePhoto(e.target.files[0]); e.target.value = ''; };

  $('#sel-month').onchange = (e) => { state.month = e.target.value; pref.set('month', state.month); renderAll(); };
  $('#search').oninput = (e) => { state.q = e.target.value.trim(); renderChips(); renderList(); };
  $('#chips').onclick = (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.slot = b.dataset.slot;
    renderChips();
    renderList();
  };
  $('#today').onclick = (e) => {
    const b = e.target.closest('.t-s');
    if (!b) return;
    if (b.dataset.id) select(b.dataset.id);
    else if (b.classList.contains('now')) addMenu(b);
    else toast(`${SLOTS[b.dataset.slot]} 기록은 그 시간대에 올리거나, 올린 뒤 일시를 고쳐 옮길 수 있습니다.`, 4000);
  };
  $('#today').addEventListener('click', (e) => e.stopPropagation());

  $('#list').addEventListener('click', (e) => {
    const li = e.target.closest('.card');
    if (li) select(li.dataset.id);
  });
  document.querySelectorAll('[data-go="list"]').forEach((b) => (b.onclick = () => { flushSave(); $('#app').dataset.view = 'list'; }));

  $('#f-title').addEventListener('input', (e) => {
    queueSave({ title: e.target.value.trim() });
    $('#detail-title').textContent = e.target.value.trim() || baseTitle(current());
  });
  $('#f-memo').addEventListener('input', (e) => queueSave({ memo: e.target.value }));
  ['#f-title', '#f-memo'].forEach((s) => $(s).addEventListener('blur', () => flushSave()));
  ['#f-date', '#f-time'].forEach((s) => {
    $(s).addEventListener('change', queueWhen);
    $(s).addEventListener('blur', () => setTimeout(() => { if (!['f-date', 'f-time'].includes(document.activeElement?.id)) commitWhen(); }, 0));
  });

  $('#btn-delete').onclick = removeCurrent;
  $('#btn-rotate').onclick = rotatePhoto;
  $('#btn-photo').onclick = (e) => {
    e.stopPropagation();
    openPop(e.currentTarget, `
      <div class="pop-note">사진 1장 — 지금 사진을 새 사진으로 바꿉니다</div>
      <button data-p="camera2">📷 사진 찍기</button>
      <button data-p="pick2">🖼 앨범에서 고르기</button>`, (pop) => {
      pop.querySelectorAll('[data-p]').forEach((b) => (b.onclick = () => { closePop(); $(`#file-${b.dataset.p}`).click(); }));
    });
  };

  // 사진 크게 보기
  $('#photo-img').onclick = () => {
    $('#viewer-img').src = $('#photo-img').src;
    $('#viewer').hidden = false;
    $('#viewer').classList.remove('zoom');
  };
  $('#viewer').onclick = (e) => {
    if (e.target.id === 'viewer-img' && !$('#viewer').classList.contains('zoom')) { $('#viewer').classList.add('zoom'); return; }
    $('#viewer').hidden = true;
  };

  // 붙여넣기·끌어놓기 (PC) — 사진 1장
  document.addEventListener('paste', (e) => {
    if (document.body.classList.contains('signed-out')) return;
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); addPhoto(files); }
  });
  let dragN = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragN++; $('#drop').hidden = false; } });
  document.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('#drop').hidden = true; } });
  document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragN = 0;
    $('#drop').hidden = true;
    addPhoto(e.dataTransfer.files);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('#viewer').hidden) $('#viewer').hidden = true;
      else closePop();
    }
  });
  window.addEventListener('beforeunload', () => flushSave());
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); else renderToday(); });
  setInterval(renderToday, 60 * 1000); // 끼니 시간대가 바뀌면 오늘 현황 갱신

  $('#btn-signin').onclick = async () => {
    const btn = $('#btn-signin');
    btn.disabled = true;
    $('#login-msg').textContent = '';
    try { await signIn(); } catch (err) {
      $('#login-msg').textContent = `로그인하지 못했습니다 (${err.code || err.message}). 잠시 후 다시 시도해 주세요.`;
    } finally { btn.disabled = false; }
  };
}

/* ───────── 로그인 상태 ───────── */
function onAuth(user) {
  state.user = user;
  if (!user) {
    store.stop();
    document.body.classList.add('signed-out');
    state.list = [];
    state.loaded = false;
    state.selId = null;
    renderAll();
    return;
  }
  document.body.classList.remove('signed-out');
  $('#account').textContent = user.email || '';
  setSync('pending', '● 연결 중…');
  store.start((list, meta) => {
    const cur = current();
    const keep = editing && cur ? { ...pending } : null;
    state.list = list.map((r) => (keep && r.id === cur.id ? { ...r, ...keep } : r));
    state.loaded = true;
    if (meta.fromCache && !navigator.onLine) setSync('offline', '● 오프라인 (연결되면 자동 동기화)');
    else if (meta.pending) setSync('pending', '● 동기화 중…');
    else setSync('ok', '● 동기화됨');
    renderAll();
  }, (err, what) => {
    console.error('[Food Diary]', what, err);
    if (err.code === 'permission-denied' && what === '불러오기') {
      document.body.classList.add('signed-out');
      $('#login-msg').innerHTML = `<b>${esc(user.email || '')}</b><br />이 계정은 사용 허용 목록에 없습니다.<br /><button type="button" class="btn-text" id="btn-denied-out">다른 계정으로 로그인</button>`;
      $('#btn-denied-out').onclick = () => signOutUser();
    } else if (err.code === 'permission-denied') {
      toast(`${what}하지 못했습니다 — 그 끼니는 이미 다른 가족이 기록했거나, 내 기록이 아닙니다.`, 5000);
    } else {
      setSync('error', `● 오류: ${err.code || err.message}`);
    }
  });
}

/* ───────── 새 버전 안내 (서비스 워커) ───────── */
function registerSW() {
  if (!('serviceWorker' in navigator) || location.hostname === 'localhost' || location.hostname === '127.0.0.1') return;
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((reg) => {
    const ask = (w) => toast('새 버전이 있습니다.', 0, { label: '새로고침', run: () => w.postMessage('skipWaiting') });
    if (reg.waiting && navigator.serviceWorker.controller) ask(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) ask(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((e) => console.warn('[Food Diary] 서비스 워커', e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

window.addEventListener('online', () => setSync('pending', '● 동기화 중…'));
window.addEventListener('offline', () => setSync('offline', '● 오프라인 (연결되면 자동 동기화)'));

$('#version').textContent = `v${VERSION}`;
bind();
renderAll();
if (store.DEMO) onAuth({ uid: 'demo', email: 'demo@local (점검용)', displayName: '김영배' });
else { finishRedirect(); watchAuth(onAuth); }
registerSW();

// 점검용 (개발 서버에서만)
if (import.meta.env.DEV) window.__ybf = { state, renderAll, addPhoto, select, store };
