# glass

四种天气下的液态玻璃实验台。可以旋转玻璃、拆开六层材质，并在圆角矩形、收音机、磁带和唱片机之间切换。实际播放的音乐会轻柔调制液态曲面。

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
- 四种外观共用播放器和音量。首次打开保持暂停。播放中切换天气时，曲目在约 1.55 秒内交叉淡化，已暂停时切换仍保持暂停。在圆角矩形、收音机或磁带上点击文件夹可导入或选择曲目，拖动进度条可跳转，收音机的旋钮用于调节共享音量。文件与选择保存在当前浏览器，仓库内没有歌曲。
- 唱片和磁带卷轴随实际播放状态启停。唱片机默认每分钟 33⅓ 转，唱臂播放时落针，暂停或曲目结束时归位。
- 舞台右上角可暂停背景和复位。系统启用减少动态效果时，背景默认暂停。

## 天气曲目

| 天气 | 内置曲目 |
| --- | --- |
| 雨天 | Location |
| 晴天 | Our Theme |
| 阴天 | River Flows in You |
| 下雪 | Time To Paint You |

在播放器右侧的曲库菜单可导入本地文件。导入会分配给当前天气，选择已导入的曲目可将它分配到其他天气。「恢复当前天气内置曲目」清除此天气的自定义分配并保留文件。「从本地曲库移除当前曲目」移除本地文件及其分配。自定义文件只保存在当前浏览器。

## 从哪里修改

| 需求 | 入口 |
| --- | --- |
| 调整天空、液面和天气过渡 | `src/background.ts`、`src/sunnySky.ts`、`src/climate.ts` |
| 修改玻璃取样、六层材质、旋转或命中检测 | `src/glassRenderer.ts`、`src/material.ts`、`src/projection.ts`、`src/GlassStage.tsx` |
| 调整表面雨痕、冰花与覆盖范围 | `src/rainWaterField.ts`、`src/frostPattern.ts`、`src/surfaceWeather.ts` |
| 增改外观、文字、控件布局和天气效果的清晰区 | `src/shape.ts`、`src/playerLayout.ts`、`src/deviceInk.ts`、`src/PlayerControls.tsx` |
| 修改唱片机布局、播放机构或封面 | `src/turntableLayout.ts`、`src/turntableMotion.ts`、`src/TurntableDeck.tsx` |
| 更换内置曲目或天气映射 | `src/builtInMusic.ts`、`public/music/` |
| 调整本地曲库、淡化和声音分析 | `src/audio.ts`、`src/musicTransport.ts` |
| 调整曲面接收的音乐变化 | `src/musicEnergy.ts`、`src/background.ts` |

唱片机的转速和落针位置定义在 `src/turntableLayout.ts`。将来可通过 `TurntableDeck` 的 `artworkUrl` 传入当前曲目的封面。

背景先绘制到 Canvas，再由 Three.js 读取同一帧。雨水和霜纹使用玻璃的局部坐标，挂在边缘光层。新增天气请从 `climate.ts` 开始，新增外观请同时定义控件布局和清晰区。内置曲目使用构建配置里的相对基础路径，支持将产物部署在子路径。

音乐分析值在 `src/musicEnergy.ts` 中平滑，低、中、高频轻微影响液面局部起伏、纹理和反光。可以在开发版浏览器控制台用下列事件验证，第二个事件清空输入。

```js
window.dispatchEvent(new CustomEvent('glass-lab:music-energy', {
  detail: { low: 0.7, mid: 0.4, high: 0.3, energy: 0.75 },
}))
window.dispatchEvent(new Event('glass-lab:music-energy'))
```

## 许可

玻璃边缘折射的实现参考 [Glasswork](https://github.com/kubai087/glasswork)。舞台背景与云层由程序绘制。随项目保留 [Glasswork 的 MIT 许可](public/licenses/glasswork-MIT.txt) 和 [Three.js 的 MIT 许可](public/licenses/three-MIT.txt)。
