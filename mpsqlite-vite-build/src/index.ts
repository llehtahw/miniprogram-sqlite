import {
  existsSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  linkSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join, dirname, basename } from "path";
import { brotliCompressSync, constants } from "zlib";
import type { OutputOptions } from "rollup";
import type { Plugin } from "vite";

/**
 * 获取构建输出包根目录
 * 自动判断是 dist/build 还是 dist/dev
 */
export function getOutputPackageRoot(outputOptions: OutputOptions): string {
  // 优先使用 outputOptions.dir
  if (outputOptions.dir) {
    return outputOptions.dir;
  }

  // 从 outputOptions.file 推断（如果有）
  if (outputOptions.file) {
    return dirname(outputOptions.file);
  }

  // 根据 NODE_ENV 判断基础目录
  const baseDir =
    process.env.NODE_ENV === "production" ? "dist/build" : "dist/dev";
  const cwd = process.cwd();

  // 尝试从环境变量获取平台信息
  const platform = process.env.UNI_PLATFORM || "h5";
  const platformDir =
    platform === "h5" ? "h5" : `mp-${platform.replace("mp-", "")}`;

  // 检查可能的目录
  const possibleDirs = [
    join(cwd, baseDir, platformDir),
    join(
      cwd,
      "dist",
      process.env.NODE_ENV === "production" ? "build" : "dev",
      platformDir,
    ),
  ];

  // 如果 dist 目录存在，检查其子目录
  const distDir = join(cwd, "dist");
  if (existsSync(distDir)) {
    const distSubDirs = ["build", "dev"];
    for (const subDir of distSubDirs) {
      const fullSubDir = join(distDir, subDir);
      if (existsSync(fullSubDir)) {
        try {
          const entries = readdirSync(fullSubDir);
          for (const entry of entries) {
            const entryPath = join(fullSubDir, entry);
            if (statSync(entryPath).isDirectory()) {
              possibleDirs.push(entryPath);
            }
          }
        } catch {
          // 忽略读取错误
        }
      }
    }
  }

  // 查找第一个存在的目录
  for (const dir of possibleDirs) {
    if (existsSync(dir)) {
      return dir;
    }
  }

  // 默认返回
  return join(cwd, baseDir, platformDir);
}

/**
 * 复制文件，优先使用硬链接
 * 如果硬链接失败，则检查目标文件是否需要更新（基于修改时间）
 * @param sourcePath 源文件路径
 * @param destPath 目标文件路径
 */
export function copyFileWithHardLink(
  sourcePath: string,
  destPath: string,
): void {
  // 检查源文件是否存在
  if (!existsSync(sourcePath)) {
    console.warn(`Source file not found: ${sourcePath}`);
    return;
  }

  // 确保目标目录存在
  const destDir = dirname(destPath);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  // 如果目标文件已存在，检查是否需要更新
  if (existsSync(destPath)) {
    try {
      const sourceStat = statSync(sourcePath);
      const destStat = statSync(destPath);
      // 如果目标文件比源文件新或相等，跳过
      if (destStat.mtime >= sourceStat.mtime) {
        console.log(`✓ Skipped ${basename(sourcePath)} (target is up to date)`);
        return;
      }
      // 否则删除目标文件，准备更新
      unlinkSync(destPath);
    } catch (error) {
      console.warn(`Failed to check file stats: ${error}`);
      // 如果检查失败，继续尝试复制
    }
  }

  // 优先尝试硬链接
  try {
    linkSync(sourcePath, destPath);
    console.log(`✓ Hard linked ${basename(sourcePath)} to ${destPath}`);
  } catch (error) {
    // 硬链接失败，使用复制
    try {
      copyFileSync(sourcePath, destPath);
      console.log(
        `✓ Copied ${basename(sourcePath)} to ${destPath} (hard link failed)`,
      );
    } catch (copyError) {
      console.error(`Failed to copy ${basename(sourcePath)}:`, copyError);
    }
  }
}

/**
 * 压缩文件为 Brotli 格式
 * 只在目标文件不存在或源文件更新时执行压缩
 * @param sourcePath 源文件路径
 * @param destPath 目标压缩文件路径（应包含 .br 扩展名）
 */
export function compressFileIfNew(sourcePath: string, destPath: string): void {
  // 检查源文件是否存在
  if (!existsSync(sourcePath)) {
    console.warn(`Source file not found: ${sourcePath}`);
    return;
  }

  // 确保目标目录存在
  const destDir = dirname(destPath);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  // 如果目标文件已存在，检查是否需要更新
  if (existsSync(destPath)) {
    try {
      const sourceStat = statSync(sourcePath);
      const destStat = statSync(destPath);
      // 如果目标文件比源文件新或相等，跳过
      if (destStat.mtime >= sourceStat.mtime) {
        console.log(
          `✓ Skipped compressing ${basename(sourcePath)} (target is up to date)`,
        );
        return;
      }
      // 否则删除目标文件，准备重新压缩
      unlinkSync(destPath);
    } catch (error) {
      console.warn(`Failed to check file stats: ${error}`);
      // 如果检查失败，继续尝试压缩
    }
  }

  try {
    // 读取源文件
    const fileBuffer = readFileSync(sourcePath);

    // 使用 brotli 压缩，最高压缩级别
    const compressed = brotliCompressSync(fileBuffer, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11, // 最高压缩级别
      },
    });
    // 写入压缩文件
    writeFileSync(destPath, compressed);
    const originalSizeMB = (fileBuffer.length / 1024 / 1024).toFixed(2);
    const compressedSizeMB = (compressed.length / 1024 / 1024).toFixed(2);
    console.log(
      `✓ Compressed ${basename(sourcePath)}: ${originalSizeMB}MB -> ${compressedSizeMB}MB`,
    );
  } catch (error) {
    console.error(`Failed to compress ${basename(sourcePath)}:`, error);
  }
}

/**
 * 递归复制目录内容
 * @param sourceDir 源目录路径
 * @param destDir 目标目录路径
 */
export function copyDirectoryRecursive(
  sourceDir: string,
  destDir: string,
): void {
  // 检查源目录是否存在
  if (!existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  // 确保目标目录存在
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  // 读取源目录内容
  const entries = readdirSync(sourceDir);

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry);
    const destPath = join(destDir, entry);

    const stat = statSync(sourcePath);

    if (stat.isDirectory()) {
      // 递归复制子目录
      copyDirectoryRecursive(sourcePath, destPath);
    } else {
      // 复制文件
      copyFileWithHardLink(sourcePath, destPath);
    }
  }
}

/**
 * mpsqlite 文件安装插件的选项
 */
export interface MpsqliteFilesPluginOptions {
  /**
   * 静态文件目标目录（相对于构建输出目录）
   */
  staticDir: string;
}

/**
 * mpsqlite 文件安装 Vite 插件
 *
 * 功能：
 * 1. 压缩 sql-wasm.wasm 为 brotli 格式并复制到静态目录
 * 2. 复制 mpsqlite/static/ 目录内容到静态目录
 *
 * @param options 插件选项
 * @returns Vite 插件
 *
 * @example
 * ```ts
 * import { mpsqliteFilesPlugin } from '@llehtahw/mpsqlite-vite-build';
 *
 * export default defineConfig({
 *   plugins: [
 *     mpsqliteFilesPlugin({ staticDir: 'static/' }),
 *   ],
 * });
 * ```
 */
export function mpsqliteFilesPlugin(
  options: MpsqliteFilesPluginOptions,
): Plugin {
  const { staticDir } = options;

  return {
    name: "mpsqlite-files",
    writeBundle(outputOptions: OutputOptions) {
      // 获取输出包根目录
      const outputDir = getOutputPackageRoot(outputOptions);
      // 将输出目录与静态目录参数拼接
      const targetStaticDir = join(outputDir, staticDir);

      const cwd = process.cwd();

      // 压缩 sql-wasm.wasm 为 brotli 格式并复制到静态目录
      const wasmSourcePath = join(
        cwd,
        "node_modules/sql.js/dist/sql-wasm.wasm",
      );
      const wasmDestPath = join(targetStaticDir, "sql-wasm.wasm.br");
      compressFileIfNew(wasmSourcePath, wasmDestPath);

      // 复制 mpsqlite/static/ 目录内容到静态目录
      const sqliteStaticSourcePath = join(
        cwd,
        "node_modules/@llehtahw/mpsqlite/static",
      );
      if (!existsSync(sqliteStaticSourcePath)) {
        throw new Error(
          `mpsqlite/static directory does not exist: ${sqliteStaticSourcePath}`,
        );
      }
      copyDirectoryRecursive(sqliteStaticSourcePath, targetStaticDir);
    },
  };
}
