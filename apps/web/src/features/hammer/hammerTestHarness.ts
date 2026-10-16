/* eslint-disable @typescript-eslint/no-explicit-any */
// Минимальный рендерер для тестов без DOM: прогоняет дерево функциональных компонентов с
// настоящим состоянием хуков, чтобы проверить динамику HammerGame (rAF, удар, колбэки).
// Подключается через vi.mock('react') в самом тесте: см. hookOverrides.

const FRAGMENT = Symbol.for('react.fragment');

interface Instance {
  hooks: any[];
  index: number;
  effects: Array<() => void>;
}

let current: Instance | null = null;
let dirty = false;
const instances = new Map<string, Instance>();
const cleanups: Array<() => void> = [];

function hook(): { slot: any; i: number; inst: Instance } {
  const inst = current as Instance;
  const i = inst.index++;
  return { slot: inst.hooks[i], i, inst };
}

const depsChanged = (a: any[] | undefined, b: any[] | undefined) =>
  !a || !b || a.length !== b.length || a.some((v, i) => !Object.is(v, b[i]));

export const hookOverrides = {
  useState(initial: any) {
    const { slot, i, inst } = hook();
    if (slot) return [slot.value, slot.set];
    const value = typeof initial === 'function' ? initial() : initial;
    const s: any = { value };
    s.set = (next: any) => {
      const v = typeof next === 'function' ? next(s.value) : next;
      if (!Object.is(v, s.value)) {
        s.value = v;
        dirty = true;
      }
    };
    inst.hooks[i] = s;
    return [s.value, s.set];
  },
  useRef(initial: any) {
    const { slot, i, inst } = hook();
    if (slot) return slot;
    return (inst.hooks[i] = { current: initial });
  },
  useMemo(factory: () => any, deps: any[]) {
    const { slot, i, inst } = hook();
    if (slot && !depsChanged(slot.deps, deps)) return slot.value;
    inst.hooks[i] = { value: factory(), deps };
    return inst.hooks[i].value;
  },
  useCallback(fn: any, deps: any[]) {
    return hookOverrides.useMemo(() => fn, deps);
  },
  useEffect(effect: () => void | (() => void), deps?: any[]) {
    const { slot, i, inst } = hook();
    if (slot && deps && !depsChanged(slot.deps, deps)) return;
    if (slot?.cleanup) slot.cleanup();
    const record: any = { deps, cleanup: undefined };
    inst.hooks[i] = record;
    inst.effects.push(() => {
      record.cleanup = effect() ?? undefined;
      if (record.cleanup) cleanups.push(record.cleanup);
    });
  },
};

export interface HostNode {
  type: string;
  props: Record<string, any>;
  children: Array<HostNode | string>;
}

function expand(el: any, path: string, pending: Array<() => void>): any {
  if (el === null || el === undefined || el === false || el === true) return [];
  if (typeof el === 'string' || typeof el === 'number') return [String(el)];
  if (Array.isArray(el)) return el.flatMap((c, i) => expand(c, `${path}[${i}]`, pending));
  const { type, props } = el;
  if (type === FRAGMENT) return expand(props.children, path, pending);
  if (typeof type === 'function') {
    const key = `${path}/${type.name}`;
    let inst = instances.get(key);
    if (!inst) instances.set(key, (inst = { hooks: [], index: 0, effects: [] }));
    inst.index = 0;
    inst.effects = [];
    current = inst;
    const out = type(props);
    current = null;
    pending.push(...inst.effects);
    return expand(out, key, pending);
  }
  const children = [props.children].flat(Infinity).flatMap((c, i) => expand(c, `${path}.${i}`, pending));
  return [{ type, props, children } as HostNode];
}

export interface Mounted {
  tree: () => HostNode[];
  /** Дорендеривает, пока есть изменения состояния, и запускает эффекты. */
  flush: () => void;
  unmount: () => void;
}

export function mount(root: () => any): Mounted {
  instances.clear();
  cleanups.length = 0;
  let tree: HostNode[] = [];
  const flush = () => {
    for (let guard = 0; guard < 20; guard++) {
      dirty = false;
      const pending: Array<() => void> = [];
      tree = expand(root(), 'root', pending) as HostNode[];
      pending.forEach((run) => run());
      if (!dirty && pending.length === 0) return;
    }
  };
  flush();
  return { tree: () => tree, flush, unmount: () => cleanups.splice(0).forEach((c) => c()) };
}

export function find(nodes: Array<HostNode | string>, pred: (n: HostNode) => boolean): HostNode | null {
  for (const n of nodes) {
    if (typeof n === 'string') continue;
    if (pred(n)) return n;
    const inner = find(n.children, pred);
    if (inner) return inner;
  }
  return null;
}

/** Детерминированная сериализация дерева (функции — как "fn") для сравнения до/после. */
export function dump(nodes: Array<HostNode | string>, depth = 0): string {
  return nodes
    .map((n) => {
      const pad = '  '.repeat(depth);
      if (typeof n === 'string') return `${pad}"${n}"`;
      const props = Object.entries(n.props)
        .filter(([k]) => k !== 'children')
        .map(([k, v]) => `${k}=${typeof v === 'function' ? 'fn' : JSON.stringify(v)}`)
        .join(' ');
      return `${pad}<${n.type} ${props}>\n${dump(n.children, depth + 1)}`;
    })
    .join('\n');
}
