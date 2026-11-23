# glass

液态玻璃实验台

项目仓库 [yanruyi130/glass](https://github.com/yanruyi130/glass)。可运行版本位于 `main`，后续修改可以从 `main` 新建 `codex/功能名` 分支。

## 本地运行

```sh
git clone https://github.com/yanruyi130/glass.git
cd glass
pnpm install --frozen-lockfile
pnpm dev
```

使用 `pnpm build` 构建生产版本。

## 功能

- 实验台以同一实时背景提供舞台画面和玻璃采样，支持六个材质层、透明度调节和分层查看。
- 按住玻璃可通过 Three.js 绕固定中心旋转。

## 署名

玻璃折射的材质设计参考 [Glasswork](https://github.com/kubai087/glasswork)，其授权见 [MIT 许可证](public/licenses/glasswork-MIT.txt)。

交互使用 [Three.js](https://threejs.org/)，其授权见 [MIT 许可证](public/licenses/three-MIT.txt)。
