/// <reference types="@types/webassembly-web-api" />
import { DataToPath } from "./signatures.js";

declare const WXWebAssembly: typeof WebAssembly | undefined;

const WASM =
  (globalThis as any).WebAssembly || (globalThis as any).WXWebAssembly;
if (!WASM) {
  throw new Error("[mpsqlite] 未找到 WASM");
}

let global_instance: WebAssembly.Instance | null = null;
let set_flag = false;

/**
 * 设置全局实例（用于 table patch）
 */
export function setGlobalInstance(instance: WebAssembly.Instance): void {
  global_instance = instance;
}

/**
 * 获取 Table 的原型，patch set方法
 * 至少截止到2025-12-23，当Table.set导致空值被覆盖时，会触发微信原生代码控制针解引用(IOS上触发问题，未测试安卓)。
 */
export function _getTablePrototype(tb?: WebAssembly.Table): void {
  const _tmp_tb =
    tb ||
    new WASM.Table({
      initial: 1,
      element: "anyfunc",
    });
  const table_prototype = Object.getPrototypeOf(_tmp_tb);
  const originTableSet = table_prototype.set;
  table_prototype.set = function (...args: any[]) {
    set_flag = true;
    if (args[args.length - 1]) {
      // 有值，直接使用
    } else {
      // 空值，从 global_instance 获取原值
      if (global_instance) {
        args[args.length - 1] = (global_instance.exports as any).O.get(args[0]);
      }
    }
    return originTableSet.apply(this, args);
  };
}

/**
 * 检查 set_flag 是否已设置
 */
export function getSetFlag(): boolean {
  return set_flag;
}

/**
 * 重置 set_flag
 */
export function resetSetFlag(): void {
  set_flag = false;
}

/**
 * 包装函数以临时替换 WebAssembly 和 TypeError
 */
export function modulePatched<T extends (...args: any[]) => any>(
  this: any,
  func: T,
): T {
  return ((...args: any[]) => {
    const originTypeError = globalThis.TypeError;
    globalThis.TypeError = globalThis.Error as any;
    const origin = globalThis.WebAssembly;
    globalThis.WebAssembly = new Proxy(
      (globalThis as any).WXWebAssembly || (globalThis as any).WebAssembly,
      {
        get: (target: any, prop: string, _receiver: any) => {
          switch (prop) {
            case "Module":
              // 小程序应该是堵死了任何JIT，好在需要JIT的函数不多，可以提前放进代码包中。
              return (data: any) => {
                const path = DataToPath(data);
                return new target.Module(path);
              };
            default:
              return (target as any)[prop];
          }
        },
      },
    );
    try {
      return func.apply(this, args);
    } finally {
      globalThis.WebAssembly = origin;
      globalThis.TypeError = originTypeError;
    }
  }) as T;
}

/**
 * 包装函数以 patch WebAssembly API
 */
export function patchWebAssembly<T extends (...args: any[]) => any>(
  this: any,
  func: T,
): T {
  const originWebAssembly = globalThis.WebAssembly;
  const originTypeError = globalThis.TypeError;
  return ((...args: any[]) => {
    try {
      globalThis.WebAssembly = new Proxy(
        (globalThis as any).WXWebAssembly || (globalThis as any).WebAssembly,
        {
          get: (target, prop, _receiver) => {
            switch (prop) {
              case "Module":
                return (data: any) => {
                  const path = DataToPath(data);
                  return new target.Module(path);
                };
              case "Instance":
                return (a: any, b: any) => {
                  globalThis.TypeError = originTypeError;
                  const res = target.Instance(a, b);
                  return res;
                };
              default:
                return (target as any)[prop];
            }
          },
        },
      );
      return func.apply(this, args);
    } finally {
      globalThis.WebAssembly = originWebAssembly;
    }
  }) as T;
}

/**
 * 包装函数以测试 create_function
 */
export function patchWeakMapReturnTrue<T extends (...args: any[]) => any>(
  this: any,
  func: T,
): T {
  return ((...args: any[]) => {
    const originGet = globalThis.WeakMap.prototype.get;
    try {
      globalThis.WeakMap.prototype.get = function (..._args: any[]) {
        throw new Error("I do not know");
      };
      return func.apply(this, args);
    } finally {
      globalThis.WeakMap.prototype.get = originGet;
    }
  }) as T;
}
