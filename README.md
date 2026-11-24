# glass

四种天气下的液态玻璃实验台。可以旋转玻璃、拆开六层材质，或在圆角矩形、收音机和磁带外观中播放本地音乐。

项目地址为 [yanruyi130/glass](https://github.com/yanruyi130/glass)。可运行版本放在 [main](https://github.com/yanruyi130/glass/tree/main)。后续功能从 `main` 新建 `codex/功能名` 分支，验证后再合入 `main`。

## 本地运行

使用 Node.js 20.19 及以上的 20.x，或 22.12 及以上版本。依赖由 pnpm 安装，浏览器需支持 WebGL 2。

```sh
git clone https://github.com/yanruyi130/glass.git
cd glass
pnpm install --frozen-lockfile
pnpm dev
```

打开终端给出的本地地址。`pnpm build` 检查 TypeScript 并生成 `dist/`，`pnpm preview` 预览构建产物。在 Windows PowerShell 中也可使用 `pnpm.cmd`。

## 页面操作

- 按住玻璃拖动可旋转。键盘焦点在玻璃上时可用方向键，双击或按 Home 复位。分层后可调节层间距，在画面中或材质列表中选择单层。
- 四种天气共用背景画面。晴天的白云与日光置于连续流动的抽象曲面后。雨天可以调节雨量和滑落速度，雪天可以调节霜与冰花覆盖范围。
- 三种外观共用同一个播放器。点击文件夹可导入或选择曲目，拖动进度条跳转，收音机的旋钮用于调节共享音量。文件与选择保存在当前浏览器，仓库内没有歌曲。
- 舞台右上角可暂停背景和复位。系统启用减少动态效果时，背景默认暂停。

## 从哪里修改

| 需求 | 入口 |
| --- | --- |
| 调整天空、液面和天气过渡 | `src/background.ts`、`src/sunnySky.ts`、`src/climate.ts` |
| 修改玻璃取样、六层材质、旋转或命中检测 | `src/glassRenderer.ts`、`src/material.ts`、`src/projection.ts`、`src/GlassStage.tsx` |
| 调整表面雨痕、冰花与覆盖范围 | `src/rainWaterField.ts`、`src/frostPattern.ts`、`src/surfaceWeather.ts` |
| 增改外观、文字、控件布局和天气效果的清晰区 | `src/shape.ts`、`src/playerLayout.ts`、`src/deviceInk.ts`、`src/PlayerControls.tsx` |
| 扩展本地曲库、播放控制或音乐律动 | `src/audio.ts`、`src/musicEnergy.ts` |

背景先绘制到 Canvas，再由 Three.js 读取同一帧。雨水和霜纹使用玻璃的局部坐标，挂在边缘光层。新增天气请从 `climate.ts` 开始，新增外观请同时定义控件布局和清晰区。若将来加入内置曲目，先取得公开分发授权并记录来源，再通过同一播放器接入。

音乐分析值在 `src/musicEnergy.ts` 中平滑，低、中、高频轻微影响液面局部起伏、纹理和反光。可以在开发版浏览器控制台用下列事件验证，第二个事件清空输入。

```js
window.dispatchEvent(new CustomEvent('glass-lab:music-energy', {
  detail: { low: 0.7, mid: 0.4, high: 0.3, energy: 0.75 },
}))
window.dispatchEvent(new Event('glass-lab:music-energy'))
```

## 许可

玻璃边缘折射的实现参考 [Glasswork](https://github.com/kubai087/glasswork)。舞台背景与云层由程序绘制。随项目保留 [Glasswork 的 MIT 许可](public/licenses/glasswork-MIT.txt) 和 [Three.js 的 MIT 许可](public/licenses/three-MIT.txt)。
