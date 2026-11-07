// 저장소 — 가족 공용 일기
// Firestore family/{FAMILY}/meals/{날짜_끼니}(기록·미리보기) · family/{FAMILY}/mealImages/{같은 ID}(사진)
// 문서 ID가 '날짜_끼니'이므로 같은 날 같은 끼니는 가족 전체에서 1건만 존재 (보안 규칙도 남의 기록 덮어쓰기를 막음)
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, getDoc, writeBatch, Bytes,
} from 'firebase/firestore';
import { fs } from './firebase.js';

const FAMILY = 'yb';
let unsub = null;
const col = () => collection(fs, 'family', FAMILY, 'meals');
const ref = (id) => doc(fs, 'family', FAMILY, 'meals', id);
const imgRef = (id) => doc(fs, 'family', FAMILY, 'mealImages', id);
const clean = (o) => JSON.parse(JSON.stringify(o));
let onError = null;
const report = (what) => (err) => {
  console.error(`[Food Diary] ${what} 실패`, err);
  onError?.(err, what);
};

// 점검용 가짜 저장소 (개발 서버 + 주소 끝 ?demo 일 때만)
export const DEMO = import.meta.env.DEV && new URLSearchParams(location.search).has('demo');
const mem = { recs: new Map(), imgs: new Map(), cb: null };
const memEmit = () => setTimeout(() => mem.cb?.([...mem.recs.values()].map((r) => ({ ...r })), { fromCache: false, pending: false }), 0);

/** 가족 일기 전체를 실시간으로 받음 */
export function start(cb, errCb) {
  stop();
  onError = errCb;
  if (DEMO) { mem.cb = cb; memEmit(); return; }
  unsub = onSnapshot(
    col(),
    { includeMetadataChanges: true },
    (snap) => cb(snap.docs.map((d) => ({ ...d.data(), id: d.id })), { fromCache: snap.metadata.fromCache, pending: snap.metadata.hasPendingWrites }),
    (err) => errCb?.(err, '불러오기')
  );
}

export function stop() {
  unsub?.();
  unsub = null;
}

export function saveMeal(r) {
  const { id, ...rest } = r;
  if (DEMO) { mem.recs.set(id, { ...clean(rest), id, updatedAt: Date.now() }); memEmit(); return Promise.resolve(); }
  return setDoc(ref(id), clean({ ...rest, updatedAt: Date.now() })).catch(report('저장'));
}

export function patchMeal(id, fields) {
  if (DEMO) { mem.recs.set(id, { ...(mem.recs.get(id) || {}), ...clean(fields), id, updatedAt: Date.now() }); memEmit(); return Promise.resolve(); }
  return updateDoc(ref(id), clean({ ...fields, updatedAt: Date.now() })).catch(report('수정'));
}

export function removeMeal(id) {
  if (DEMO) { mem.recs.delete(id); mem.imgs.delete(id); memEmit(); return Promise.resolve(); }
  const b = writeBatch(fs);
  b.delete(ref(id));
  b.delete(imgRef(id));
  return b.commit().catch(report('삭제'));
}

/** 날짜·시간을 바꿔 끼니가 달라질 때: 새 ID로 옮기고(사진 포함) 예전 것을 지움 */
export async function moveMeal(oldId, rec, blob) {
  const { id, ...rest } = rec;
  if (DEMO) {
    const img = mem.imgs.get(oldId);
    mem.recs.delete(oldId); mem.imgs.delete(oldId);
    mem.recs.set(id, { ...clean(rest), id, updatedAt: Date.now() });
    if (img) mem.imgs.set(id, img);
    memEmit();
    return;
  }
  const b = writeBatch(fs);
  b.set(ref(id), clean({ ...rest, updatedAt: Date.now() }));
  if (blob) b.set(imgRef(id), await imgDoc(blob, rest.owner));
  b.delete(ref(oldId));
  b.delete(imgRef(oldId));
  return b.commit().catch(report('끼니 옮기기'));
}

async function imgDoc(blob, owner) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  return { data: Bytes.fromUint8Array(buf), mime: blob.type || 'image/jpeg', size: buf.length, owner };
}

export async function saveImage(id, blob, owner) {
  if (DEMO) { mem.imgs.set(id, blob); return; }
  return setDoc(imgRef(id), await imgDoc(blob, owner)).catch(report('사진 저장'));
}

const imgCache = new Map(); // id → object URL

export async function loadImageURL(id) {
  if (imgCache.has(id)) return imgCache.get(id);
  let blob = null;
  if (DEMO) blob = mem.imgs.get(id) || null;
  else {
    const snap = await getDoc(imgRef(id));
    if (snap.exists()) { const { data, mime } = snap.data(); blob = new Blob([data.toUint8Array()], { type: mime || 'image/jpeg' }); }
  }
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  imgCache.set(id, url);
  return url;
}

export async function loadImageBlob(id) {
  const url = await loadImageURL(id);
  return url ? (await fetch(url)).blob() : null;
}

export function forgetImage(id) {
  const u = imgCache.get(id);
  if (u) URL.revokeObjectURL(u);
  imgCache.delete(id);
}
