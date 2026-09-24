# FastGithub 加速插件 — 安装说明

本插件为 DSH (DeepSeek Harness) 提供基于 **FastGithub** 的 GitHub 自动加速：
host 半身自建环回正向代理并注入 DSH 代理策略，让 `web_fetch` / `web_search`
绕过 DNS 固定（pinning）并加速；child 工具（git/curl）继承代理；浏览器端在
输入框工具条显示实时加速状态徽章。

---

## 一、插件包含的文件

| 文件 | 作用 |
|------|------|
| `package.json` | bundle 清单（`dsh.bundle.patch` + `dsh.client.platform: "web"` + `exports ./client`） |
| `index.js` | host 半身：正向代理 `127.0.0.1:39467` + 注入代理策略 + `/fastgithub/status` 路由 + FastGithub 探测 |
| `client.js` | client 半身：`conversation.composer.dock` 状态徽章 |
| `cordis.patch.yml` | 仅 host 装载行（client 由 `dsh.client` manifest 扫描自动接线，**勿**加 client 行） |

---

## 二、目标机器前置条件（务必先确认）

本插件**依赖 FastGithub 底层加速**。目标机器必须先具备：

1. **FastGithub 已安装并运行**：服务 `fastgithub` 与 `FastGithub.dnscrypt-proxy` 处于 `Running`；
2. **DNS 劫持生效**：`github.com` 解析到 `127.0.0.1` / `::1`
   （插件靠 `dnsHijack` 检测判断是否加速）；
3. **FastGithub MITM 根证书已装进受信任根**：`FastGithub.cer` 导入 `LocalMachine\Root`
   （否则 Node / curl / git 走 MITM 时报证书错误）。

> 若目标机**没有 FastGithub**：插件仍可正常加载，`/fastgithub/status` 返回
> `dnsHijack:false`，只是不加速，UI 徽章显示「未加速」——不会崩溃。

---

## 三、安装步骤（目标机操作）

1. 将 `fastgithub-accelerate` 整个目录放到目标机任意位置，
   例如 `C:\AI\setup\fastgithub-accelerate`。
2. 在目标机的 DSH 中调用 `plugin_manager`：

   ```
   action: install_bundle
   target: C:\AI\setup\fastgithub-accelerate
   ```

   该工具会自动完成：pnpm 链接依赖 → 把 `fastgithub-accelerate` 写入该机
   web profile 的 `bundles` 数组 → 应用 `cordis.patch.yml` 的 host 装载行 → 激活。

> ⚠️ 不要手工改 package.json、不要手动复制文件进 `node_modules`。必须用目标机
> 自己的 `plugin_manager` 走 `install_bundle`。装完若提示激活失败，**重启该机 DSH**
> 即可（ESM 模块缓存需重启清空）。

---

## 四、验证

安装完成后在目标机确认：

- `GET http://127.0.0.1:3080/fastgithub/status`
  → 应返回 JSON，含 `accelerating` / `policy` / `module` / `fastgithub` 字段；
- `web_fetch https://github.com/git/git` → 应返回 HTTP 200（此前会被 DNS 固定阻断）；
- 刷新 Web UI，输入框工具条应出现状态徽章（🚀加速中 / ⚠未接管DNS / ·代理就绪 / 未加速）。

---

## 五、常见问题

- **`fastgithub` 服务未运行 / DNS 未劫持**：徽章显示「⚠ FastGithub 未接管 DNS」，
  启动 FastGithub 服务/UI 即可。
- **MITM 证书报错**（`self-signed certificate in certificate chain`）：
  把 FastGithub 生成的 `FastGithub.cer` 导入目标机 `LocalMachine\Root`。
- **安装后无效果**：确认走 `install_bundle` 且 bundle 在 `bundles` 数组里，
  必要时重启 DSH。

---

## 六、发布到插件市场

DSH 内置的 dsh-market 插件列表来自精选列表
[awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
（`awesome-dsh-plugin.com/plugins.json`，CI 每日刷新）。dsh-market 仓库本身是
市场应用，**不是**插件目录，请勿往那里提插件条目。

**上架步骤**：

1. 把本插件源码推到一个 **GitHub 仓库**（`package.json` 已声明 `dsh.bundle`；
   仓库需**创建满 1 天**，并添加 `dsh-plugin` topic）。
2. 去 `awesome-dsh-plugin/awesome-dsh-plugin` 仓库提 PR，新增一个文件
   `data/plugins/<owner>__<repo>.yml`：

   ```yaml
   url: https://github.com/owner/repo          # 必须与仓库完全一致
   name: owner/repo
   category: network                           # 或 git / dev，见贡献指南分类列表
   description:
     en: Automatically accelerate DSH's GitHub traffic via FastGithub.
     zh: 基于 FastGithub 自动加速 DSH 的 GitHub 流量。
   ```

   > 描述含 `: `（冒号加空格）时必须加引号，否则 YAML 解析成嵌套键。

3. 一个 PR 最多 3 条；合并后站点自动重建，dsh-market 通常一天内收录。

**发布 npm（可选）**：可让市场按下载量排序。发布包的 `repository` 字段必须指回
上面那个仓库，否则两者不关联；映射会自动从 registry 采集，无需在 yml 里手写。

**截图（可选，推荐）**：本仓库已含 `screenshots.json`（声明 `assets/badge.png`）。
建议用浏览器真实截图替换 `assets/badge.png`（1-8 张，必须是 GitHub 托管的
https 链接或仓库内相对路径，路径不能带 `..` 或前导 `/`）。