/// <reference types="@dcloudio/types" />
/// <reference types="@types/wechat-miniprogram" />

export interface MPSQLiteConfig {
  // 必需：static 目录路径（基础路径）
  staticDir: string;
}

interface InternalConfig {
  staticDir: string;
  sqlWasmPath: string;
  prefillWasmPath: string;
  signatureFiles: string[];
}

let config: InternalConfig | null = null;
let configured = false;

/**
 * 配置 MPSQLite，只能调用一次
 * @param config 配置对象，包含 staticDir
 * @throws 如果已经配置过，抛出错误
 */
export function configureMPSQLite(userConfig: MPSQLiteConfig): void {
  if (configured) {
    throw new Error("[mpsqlite] configureMPSQLite 只能调用一次");
  }

  const staticDir = userConfig.staticDir;
  if (!staticDir) {
    throw new Error("[mpsqlite] staticDir 是必需的");
  }

  // 确保路径以 / 结尾
  const normalizedStaticDir = staticDir.endsWith("/")
    ? staticDir
    : `${staticDir}/`;

  config = {
    staticDir: normalizedStaticDir,
    sqlWasmPath: `${normalizedStaticDir}sql-wasm.wasm.br`,
    prefillWasmPath: `${normalizedStaticDir}prefill.wasm.br`,
    signatureFiles: ["viii", "viiiil"],
  };

  configured = true;
}

/**
 * 获取当前配置
 * @throws 如果未配置，抛出错误
 */
export function getConfig(): InternalConfig {
  if (!config || !configured) {
    throw new Error("[mpsqlite] 必须先调用 configureMPSQLite");
  }
  return config;
}

/**
 * 检查是否已配置
 */
export function isConfigured(): boolean {
  return configured;
}
