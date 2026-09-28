// 내 PC 업무 폴더 읽기 — 브라우저 폴더 접근(File System Access API, 크롬·엣지). 읽기만 한다.
//
// 사용자가 [업무파일 폴더 연결]로 한 번 고른 폴더만 본다. 고른 폴더는 이 브라우저(IndexedDB)에 기억하고,
// 브라우저를 새로 열면 허락을 한 번 다시 묻는다(브라우저 규칙). 파일은 사용자가 [올리기]를 누를 때만 읽어 올린다.
import { SKIP, SKIP_DIR } from './gwpFolder';

/* 표준 타입(lib.dom)에 아직 없는 부분만 좁게 적는다. */
interface Perm { mode: 'read' }
export interface DirHandle {
  kind: 'directory'; name: string;
  values(): AsyncIterable<DirHandle | FileHandle>;
  getDirectoryHandle(name: string): Promise<DirHandle>;
  getFileHandle(name: string): Promise<FileHandle>;
  queryPermission(p: Perm): Promise<PermissionState>;
  requestPermission(p: Perm): Promise<PermissionState>;
}
interface FileHandle { kind: 'file'; name: string; getFile(): Promise<File> }
type Picker = (o: { id?: string; mode?: 'read' }) => Promise<DirHandle>;

export const folderSupported = (): boolean => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

const DB = 'jaytax-folder', STORE = 'h', KEY = 'workRoot';
function db(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
}
async function idb<T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const d = await db();
  return new Promise((ok, no) => {
    const q = f(d.transaction(STORE, mode).objectStore(STORE));
    q.onsuccess = () => ok(q.result as T);
    q.onerror = () => no(q.error);
  });
}

/** 전에 연결한 폴더(이 브라우저). 없거나 읽을 수 없으면 null. */
export async function savedRoot(): Promise<DirHandle | null> {
  try { return (await idb<DirHandle | undefined>('readonly', (s) => s.get(KEY))) ?? null; } catch { return null; }
}
/** 폴더를 고르게 하고 기억한다. */
export async function connectRoot(): Promise<DirHandle> {
  const pick = (window as unknown as { showDirectoryPicker: Picker }).showDirectoryPicker;
  const h = await pick({ id: 'jaytax-work', mode: 'read' });
  try { await idb('readwrite', (s) => s.put(h, KEY)); } catch { /* 기억 못 해도 이번엔 쓴다 */ }
  return h;
}
/** 읽기 허락 — ask 면 물어본다(버튼 클릭 안에서만 된다). */
export async function canRead(h: DirHandle, ask: boolean): Promise<boolean> {
  if ((await h.queryPermission({ mode: 'read' })) === 'granted') return true;
  return ask ? (await h.requestPermission({ mode: 'read' })) === 'granted' : false;
}

/** 바로 아래 폴더 이름들. */
export async function subdirs(h: DirHandle): Promise<string[]> {
  const out: string[] = [];
  for await (const e of h.values()) if (e.kind === 'directory' && !SKIP.test(e.name)) out.push(e.name);
  return out.sort((a, b) => a.localeCompare(b, 'ko'));
}
export async function dirAt(h: DirHandle, path: string[]): Promise<DirHandle> {
  let d = h;
  for (const p of path) d = await d.getDirectoryHandle(p);
  return d;
}
/** 아래 파일들의 상대 경로(「000_A파일/기말감사일반조서_….xlsx」). 삭제·PBC 같은 폴더는 들어가지 않는다. */
export async function listFiles(h: DirHandle, depth = 4, rel = ''): Promise<string[]> {
  const out: string[] = [];
  if (depth < 0) return out;
  for await (const e of h.values()) {
    if (SKIP.test(e.name)) continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.kind === 'directory') { if (!SKIP_DIR.test(e.name)) out.push(...await listFiles(e, depth - 1, p)); }
    else out.push(p);
  }
  return out;
}
export async function readAt(h: DirHandle, path: string): Promise<{ name: string; bytes: Uint8Array }> {
  const parts = path.split('/');
  const d = await dirAt(h, parts.slice(0, -1));
  const f = await (await d.getFileHandle(parts[parts.length - 1])).getFile();
  return { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) };
}

/** 거래처 → 회사 폴더 짝(이름이 다른 곳) — 이 브라우저에 기억한다. */
const MAP = 'jaytax.folderMap';
export function rememberedFolder(entityId: string): string | null {
  try { return (JSON.parse(localStorage.getItem(MAP) ?? '{}') as Record<string, string>)[entityId] ?? null; } catch { return null; }
}
export function rememberFolder(entityId: string, folder: string): void {
  try {
    const m = JSON.parse(localStorage.getItem(MAP) ?? '{}') as Record<string, string>;
    m[entityId] = folder;
    localStorage.setItem(MAP, JSON.stringify(m));
  } catch { /* 기억 못 해도 이번엔 쓴다 */ }
}
