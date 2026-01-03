/// <reference types="@dcloudio/types" />
/// <reference types="@types/webassembly-web-api" />
import initSqlJs, {
  SqlJsConfig,
  type Database,
  type SqlJsStatic,
} from "sql.js";
import { getConfig, isConfigured } from "./config.js";
import {
  _getTablePrototype,
  setGlobalInstance,
  getSetFlag,
  resetSetFlag,
  modulePatched,
  patchWebAssembly,
  patchWeakMapReturnTrue,
} from "./wasm-patch.js";

declare const uni: UniNamespace.Uni | undefined;
declare const wx: WechatMiniprogram.Wx | undefined;
declare const WXWebAssembly: typeof WebAssembly | undefined;

let SQL: SqlJsStatic | Promise<SqlJsStatic> | null = null;
let wasm_path: string | null = null;

/**
 * Initializes the SQL.js engine with enhanced features.
 * This includes prefill, table patch, and function cleanup.
 * Requires configureMPSQLite to be called first.
 */
export async function initSQLite(
  config: { wasm_path?: string; config?: SqlJsConfig } = {},
): Promise<SqlJsStatic> {
  // 检查是否已配置
  if (!isConfigured()) {
    throw new Error(
      "[mpsqlite] 在调用 initSQLite 之前必须先调用 configureMPSQLite",
    );
  }

  if (config.wasm_path && wasm_path && config.wasm_path !== wasm_path) {
    console.warn(
      `[mpsqlite] 指定了不同的 WASM 路径: ${wasm_path} -> ${config.wasm_path}`,
    );
  }
  if (SQL instanceof Promise) {
    const sql = await SQL;
    SQL = sql;
    return SQL;
  } else if (SQL) return SQL;

  const internalConfig = getConfig();
  const sqlWasmPath = config.wasm_path || internalConfig.sqlWasmPath;

  if (config.wasm_path && !wasm_path) {
    wasm_path = config.wasm_path;
    console.info(`[mpsqlite] 从 ${wasm_path} 加载 WASM`);
  } else if (!wasm_path) {
    wasm_path = sqlWasmPath;
    console.info(`[mpsqlite] 从 ${wasm_path} 加载 WASM`);
  }

  const WASM =
    (globalThis as any).WebAssembly || (globalThis as any).WXWebAssembly;
  if (!WASM) {
    throw new Error("[mpsqlite] 找不到合适的 WASM 接口");
  }

  SQL = new Promise<SqlJsStatic>((resolve, reject) => {
    initSqlJs({
      instantiateWasm: (
        imports: WebAssembly.Imports,
        successCallback: (module: WebAssembly.Instance) => void,
      ): undefined => {
        console.info("[mpsqlite] 加载 WASM", imports);
        console.info(`[mpsqlite] 使用 WASM: ${WASM}`);

        WASM.instantiate(wasm_path!, imports)
          .then((result: any) => {
            const table = result.instance.exports.O;
            setGlobalInstance(result.instance);

            // Growing table
            console.info("[mpsqlite] 扩展 table");
            table.grow(512);

            // Prefilling table
            console.info("[mpsqlite] 预填充 table");
            const prefillPath = internalConfig.prefillWasmPath;
            WASM.instantiate(prefillPath, {
              env: {
                table,
              },
            });
            console.info("[mpsqlite] table 预填充完成");

            // Patch table prototype
            _getTablePrototype(table);
            console.info(`[mpsqlite] 预填充后 table 长度: ${table.length}`);

            successCallback(result.instance);
          })
          .catch((error: any) => {
            console.error(`[mpsqlite] WASM 实例化失败: ${error}`);
            reject(new Error(`WASM 实例化失败: ${error.message || error}`));
          });
        return undefined;
      },
    })
      .then((res) => {
        console.info("[mpsqlite] 初始化 sql.js 成功");
        resolve(res);
      })
      .catch((err) => {
        console.error("[mpsqlite] 加载 sql.js 失败", err);
        reject(new Error(`加载 sql.js 失败: ${err.message || err}`));
      });
  });

  const sqlInstance = await SQL;
  SQL = sqlInstance;

  // 测试和清理
  try {
    if (getSetFlag()) {
      throw new Error("[mpsqlite] table set 已被 patch");
    }

    patchWebAssembly(() => {
      const db = new sqlInstance.Database();
      try {
        patchWeakMapReturnTrue(() => {
          db.create_function("hahaha", () => {});
        })();
      } catch (e: any) {
        if (e.message && e.message.includes("I do not know")) {
          // 预期的错误，忽略
        } else {
          console.error("[mpsqlite] create_function 测试失败", e);
          throw e;
        }
      } finally {
        db.close();
      }
    })();

    // 清理预填充的函数
    for (let i = 488; i < 488 + 512; ++i) {
      (sqlInstance as any).removeFunction(i);
    }

    if (!getSetFlag()) {
      throw new Error("[mpsqlite] table set 未被 patch");
    }

    return sqlInstance;
  } catch (e) {
    SQL = null;
    wasm_path = null;
    resetSetFlag();
    setGlobalInstance(null as any);
    throw e;
  }
}

// 辅助函数：从 buffer 打开数据库
function openFromBuffer(
  buffer: ArrayBuffer | Uint8Array,
  SQL: SqlJsStatic,
): Database {
  console.info(`[mpsqlite] 从 buffer 打开数据库`);
  let content: Uint8Array;
  if (buffer instanceof Uint8Array) {
    content = buffer;
  } else if (buffer instanceof ArrayBuffer) {
    content = new Uint8Array(buffer);
  } else {
    // 尝试转换为 Uint8Array
    content = new Uint8Array(buffer);
  }
  return new SQL.Database(content);
}

// 辅助函数：创建空数据库
function openEmptyDatabase(SQL: SqlJsStatic): Database {
  console.info(`[mpsqlite] 创建空数据库`);
  return new SQL.Database();
}

// 辅助函数：从压缩文件（.br）打开数据库
async function openFromCompressedFile(
  path: string,
  SQL: SqlJsStatic,
): Promise<Database> {
  console.info(`[mpsqlite] 从压缩文件打开数据库: ${path}`);
  const fs = (
    typeof uni !== "undefined" ? uni : typeof wx !== "undefined" ? wx : null
  )?.getFileSystemManager();

  if (!fs) {
    throw new Error(
      "[mpsqlite] 未找到 FileSystemManager，请确保在 MiniProgram/UniApp 环境中运行",
    );
  }

  // 读取并解压文件
  const decompressedData = await new Promise<Uint8Array>((resolve, reject) => {
    (fs as any).readCompressedFile({
      filePath: path,
      compressionAlgorithm: "br",
      success: (res: any) => {
        // 解压后的数据是 ArrayBuffer
        const data = new Uint8Array(res.data);
        console.info("[mpsqlite] 数据库解压成功");
        resolve(data);
      },
      fail: (err: any) => {
        console.error("[mpsqlite] 读取压缩数据库文件失败", err);
        reject(
          new Error(
            `[mpsqlite] 读取压缩数据库失败: ${err.errMsg || "未知错误"}`,
          ),
        );
      },
    });
  });

  // 调用 openFromBuffer 从解压后的数据创建数据库
  return openFromBuffer(decompressedData, SQL);
}

// 辅助函数：从普通数据库文件打开
async function openFromDatabaseFile(
  path: string,
  SQL: SqlJsStatic,
): Promise<Database> {
  console.info(`[mpsqlite] 从数据库文件打开: ${path}`);
  const fs = (
    typeof uni !== "undefined" ? uni : typeof wx !== "undefined" ? wx : null
  )?.getFileSystemManager();

  if (!fs) {
    throw new Error(
      "[mpsqlite] 未找到 FileSystemManager，请确保在 MiniProgram/UniApp 环境中运行",
    );
  }

  // 读取文件
  const fileData = await new Promise<Uint8Array>((resolve, reject) => {
    fs.readFile({
      filePath: path,
      success: (res: any) => {
        const data = new Uint8Array(res.data);
        resolve(data);
      },
      fail: (err: any) => {
        console.error("[mpsqlite] 读取数据库文件失败", err);
        reject(
          new Error(`[mpsqlite] 读取数据库失败: ${err.errMsg || "未知错误"}`),
        );
      },
    });
  });

  // 调用 openFromBuffer 从文件数据创建数据库
  return openFromBuffer(fileData, SQL);
}

/**
 * 统一的数据库打开接口
 * 支持从 buffer、普通文件、压缩文件(.br)、空数据库打开
 * @param pathOrBuffer 文件路径（string）或 buffer（ArrayBuffer/Uint8Array），或 null/undefined 创建空数据库
 * @returns Database 实例
 */
export async function sqliteOpen(
  pathOrBuffer?: string | ArrayBuffer | Uint8Array | null,
): Promise<Database> {
  const SQL = await initSQLite();
  const res = await (async () => {
    // 如果参数为空，返回空数据库
    if (pathOrBuffer === null || pathOrBuffer === undefined) {
      return openEmptyDatabase(SQL);
    }

    // 判断参数类型：string 表示文件路径，否则是 buffer
    if (typeof pathOrBuffer === "string") {
      const path = pathOrBuffer;

      // 根据文件扩展名选择相应的处理函数
      if (path.endsWith(".br")) {
        return await openFromCompressedFile(path, SQL);
      } else {
        return await openFromDatabaseFile(path, SQL);
      }
    } else {
      // Buffer 模式（ArrayBuffer, Uint8Array 等）
      return openFromBuffer(pathOrBuffer, SQL);
    }
  })();

  // 对返回的数据库对象进行 patch
  (res as any).create_function = modulePatched((res as any).create_function);
  (res as any).updateHook = modulePatched((res as any).updateHook);
  return res;
}

// 导出配置函数
export { configureMPSQLite, type MPSQLiteConfig } from "./config.js";
