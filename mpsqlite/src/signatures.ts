/// <reference types="@dcloudio/types" />
/// <reference types="@types/wechat-miniprogram" />
import { getConfig } from "./config.js";

declare const uni: UniNamespace.Uni | undefined;
declare const wx: WechatMiniprogram.Wx | undefined;

let signatures: Record<string, ArrayBuffer> | null = null;

/**
 * 获取签名数据
 */
function getSignatures(): Record<string, ArrayBuffer> {
  if (signatures) {
    return signatures;
  }

  const fs = (
    typeof uni !== "undefined" ? uni : typeof wx !== "undefined" ? wx : null
  )?.getFileSystemManager();
  if (!fs) {
    throw new Error(
      "[mpsqlite] 未找到 FileSystemManager，请确保在 MiniProgram/UniApp 环境中运行",
    );
  }

  const config = getConfig();
  const _signatures: Record<string, ArrayBuffer> = {};

  for (const item of config.signatureFiles) {
    try {
      const data = fs.readFileSync(`${config.staticDir}${item}.wasm`);
      console.debug(`[mpsqlite] 已读取签名数据: ${item}`, data);
      _signatures[item] = data as ArrayBuffer;
    } catch (error) {
      console.error(`[mpsqlite] 读取签名文件 ${item}.wasm 失败:`, error);
      throw new Error(`读取签名文件 ${item}.wasm 失败: ${error}`);
    }
  }

  signatures = _signatures;
  return signatures;
}

/**
 * 将 WASM 数据转换为文件路径
 * 通过签名匹配找到对应的 WASM 文件路径
 * @param data WASM 数据（Uint8Array 或 ArrayBuffer）
 * @returns 匹配的文件路径
 */
export function DataToPath(data: Uint8Array | ArrayBuffer): string {
  const sigs = getSignatures();
  const dataArray = data instanceof Uint8Array ? data : new Uint8Array(data);

  for (const item of Object.keys(sigs)) {
    const sigData = sigs[item];
    if (dataArray.length === sigData.byteLength) {
      const sigArray = new Uint8Array(sigData);
      let isEqual = true;
      for (let i = 0; i < dataArray.length; i++) {
        if (dataArray[i] !== sigArray[i]) {
          isEqual = false;
          break;
        }
      }
      if (isEqual) {
        const config = getConfig();
        return `${config.staticDir}${item}.wasm`;
      }
    }
  }

  console.error("[mpsqlite] DataToPath: 未找到匹配的签名", data);
  throw new Error("DataToPath: 未找到匹配的签名");
}
