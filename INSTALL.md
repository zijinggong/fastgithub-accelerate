# FastGithub 加速插件 — 安装说明

本插件为 DSH (DeepSeek Harness) 提供 GitHub 自动加速，**支持两种加速源**：
host 半身注入 DSH 代理策略，让 `web_fetch` / `web_search` 绕过 DNS 固定
（pinning）并加速；child 工具（git/curl）继承代理；浏览器端在输入框工具条
显示实时加速状态徽章。

- **加速源 A — FastGithub**（默认）：本机已装 FastGithub，靠它的 DNS 劫持 +
  本地拦截器加速；
- **加速源 B — 自定义代理**（`config.proxyUrl`）：本机**没有** FastGithub 时，
  指定任意上游 HTTP(S) 代理（gh-proxy 加速器 / 公司代理 / VPN 节点等），DSH
  流量直走该代理加速，无需本地装任何东西。

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

**二选一即可加速**：

**加速源 A（FastGithub）**，目标机需具备：
1. **FastGithub 已安装并运行**：服务 `fastgithub` 与 `FastGithub.dnscrypt-proxy` 处于 `Running`；
2. **DNS 劫持生效**：`github.com` 解析到 `127.0.0.1` / `::1`
   （插件靠 `dnsHijack` 检测判断是否加速）；
3. **FastGithub MITM 根证书已装进受信任根**：`FastGithub.cer` 导入 `LocalMachine\Root`
   （否则 Node / curl / git 走 MITM 时报证书错误）。

**加速源 B（自定义代理）**，目标机只需一个可用的上游代理并把它写进配置：
`proxyUrl: "http://host:port"`（详见第六节「自定义代理加速」）。**不需要** FastGithub、
不需要 DNS 劫持、不需要装 MITM 证书。

> 若两者都没有：插件仍可正常加载，`/fastgithub/status` 返回 `source:"none"`、
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

## 四、自定义代理加速（无 FastGithub 时）

目标机**没有 FastGithub**，但有一个可达的上游 HTTP(S) 代理（gh-proxy 加速器 /
公司代理 / VPN 节点 / 自建反代）时，把插件配置成 `mode: "custom-proxy"` 或
`mode: "auto"` 并指定 `proxyUrl`：

- `mode: "auto"`（默认）：FastGithub 的 DNS 劫持生效就用 FastGithub；否则回退到
  `proxyUrl`。**推荐**，一台机器两种情况都能覆盖。
- `mode: "custom-proxy"`：只用自定义代理，忽略 FastGithub。

**配置方式**：bundle 导出 `Config`（`mode` / `proxyUrl` 两个键），配置写在目标机
web profile 的 `cordis.patch.yml` 里，以 `- id: fastgithub-accelerate` + `config:`
块给出（`mode` 缺省为 `auto`，`proxyUrl` 缺省为空）：

```yaml
# 目标机 ~/.dsh/profiles/web/cordis.patch.yml
- id: fastgithub-accelerate
  config:
    mode: auto                      # auto | fastgithub | custom-proxy
    proxyUrl: http://<proxy-host>:<proxy-port>
```

> `mode: "auto"`（默认，推荐）：FastGithub 的 DNS 劫持生效就用 FastGithub；
> 否则回退到 `proxyUrl`，一台机器两种情况都覆盖。
> `mode: "custom-proxy"`：只用自定义代理，忽略 FastGithub。
> 改完配置**重启 DSH** 生效。

`proxyUrl` 指向任何 HTTP(S) 正向代理即可——DSH 的 GitHub 流量会直接走它，
无需本地 FastGithub、无需 DNS 劫持、无需安装 MITM 证书。

**验证自定义代理路线**：改完重启后 `GET /fastgithub/status` 应返回
`"source": "custom-proxy"`、`"proxyUrl": "<你填的地址>"`、`"accelerating": true`；
再 `web_fetch https://github.com/git/git` 应返回 HTTP 200，`git ls-remote
https://github.com/git/git.git HEAD` 应 exit 0。

> ⚠️ 代理必须**能稳定连 GitHub**，且是可信任的。若用的是 gh-proxy 类公网加速器，
> 注意其稳定性与证书策略（必要时在代理侧放行 GitHub 域名）。

---

## 五、验证

安装完成后在目标机确认：

- `GET http://127.0.0.1:3080/fastgithub/status`
  → 应返回 JSON，含 `accelerating` / `source` / `policy` / `module` / `fastgithub` 字段；
  `source` 为 `fastgithub` 或 `custom-proxy` 时 `accelerating` 应为 `true`；
- `web_fetch https://github.com/git/git` → 应返回 HTTP 200（此前会被 DNS 固定阻断）；
- 刷新 Web UI，输入框工具条应出现状态徽章（🚀加速中 / ⚠无加速源 / ·代理就绪 / 未加速）。

---

## 六、常见问题

- **`fastgithub` 服务未运行 / DNS 未劫持，且未配 `proxyUrl`**：徽章显示
  「⚠ 无加速源」，`source:"none"`。启动 FastGithub，或在配置里填 `proxyUrl`。
- **配了 `proxyUrl` 但报 `source:"none"`**：确认 `mode` 不是 `"fastgithub"`，
  且 `proxyUrl` 非空、格式为 `http://host:port`。
- **MITM 证书报错**（FastGithub 场景，`self-signed certificate in certificate chain`）：
  把 FastGithub 生成的 `FastGithub.cer` 导入目标机 `LocalMachine\Root`。
- **安装后无效果**：确认走 `install_bundle` 且 bundle 在 `bundles` 数组里，
  必要时重启 DSH。

---

## 七、发布到插件市场

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
     en: Route DSH web_fetch and git GitHub traffic through FastGithub or a custom proxy, with a live status badge.
     zh: 让 DSH 的 web_fetch 与 git 的 GitHub 流量经由 FastGithub 或自定义代理加速，并带实时状态徽章。
   ```

   > 描述含 `: `（冒号加空格）时必须加引号，否则 YAML 解析成嵌套键。

3. 一个 PR 最多 3 条；合并后站点自动重建，dsh-market 通常一天内收录。

**发布 npm（可选）**：可让市场按下载量排序。发布包的 `repository` 字段必须指回
上面那个仓库，否则两者不关联；映射会自动从 registry 采集，无需在 yml 里手写。

**截图（可选，推荐）**：本仓库已含 `screenshots.json`（声明 `assets/badge.png`）。
建议用浏览器真实截图替换 `assets/badge.png`（1-8 张，必须是 GitHub 托管的
https 链接或仓库内相对路径，路径不能带 `..` 或前导 `/`）。