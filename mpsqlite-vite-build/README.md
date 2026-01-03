# @llehtahw/mpsqlite-vite-build

Vite 插件，用于在 uni-app 项目构建时自动安装 mpsqlite 所需的静态文件。

**注意**：目前仅支持微信小程序平台。

## 安装

```bash
npm install --save-dev @llehtahw/mpsqlite-vite-build
```

## 使用方法

### 1. 在 vite.config.ts 中配置插件

**主包路径**：

```typescript
import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { mpsqliteFilesPlugin } from "@llehtahw/mpsqlite-vite-build";

export default defineConfig({
  plugins: [
    mpsqliteFilesPlugin({
      staticDir: "static/",
    }),
    uni(),
  ],
  optimizeDeps: {
    exclude: ["@llehtahw/mpsqlite-vite-build"],
  },
});
```

**分包路径**：

```typescript
import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import { mpsqliteFilesPlugin } from "@llehtahw/mpsqlite-vite-build";

export default defineConfig({
  plugins: [
    mpsqliteFilesPlugin({
      staticDir: "subpackages/A/static/",
    }),
    uni(),
  ],
  optimizeDeps: {
    exclude: ["@llehtahw/mpsqlite-vite-build"],
  },
});
```

### 2. 在代码中配置 mpsqlite

在调用 `initSQLite` 之前，使用相同的 `staticDir` 路径配置：

**主包路径**：

```typescript
import { configureMPSQLite } from "@llehtahw/mpsqlite";

configureMPSQLite({
  staticDir: "static/",
});
```

**分包路径**：

```typescript
import { configureMPSQLite } from "@llehtahw/mpsqlite";

configureMPSQLite({
  staticDir: "subpackages/A/static/",
});
```

## 配置说明

- `staticDir` (必需): 小程序代码包内的静态文件路径
  - 主包示例: `'static/'` - 文件放在主包根目录
  - 分包示例: `'subpackages/A/static/'` - 文件放在分包 A 目录
  - **重要**: vite 插件和 `configureMPSQLite` 中的路径必须完全一致

## 功能

构建完成后自动：

- 压缩并复制 `sql-wasm.wasm` 为 Brotli 格式
- 复制 `mpsqlite/static` 目录下的所有必要文件

## 依赖

- `@llehtahw/mpsqlite`
- `sql.js`

## 故障排除

如果遇到 `ESM file cannot be loaded by require` 错误：

1. **确保在 `vite.config.ts` 中添加了 `optimizeDeps.exclude` 配置**（见上方示例）
2. 删除 `node_modules` 和 `package-lock.json`，然后重新运行 `npm install`
3. 确保使用 `import` 而不是 `require` 导入插件

## License

MIT
