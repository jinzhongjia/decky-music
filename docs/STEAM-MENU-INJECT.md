# 左侧 Steam 主菜单注入「音乐」入口

对应 issue #28。在 Steam Deck 游戏模式左侧主菜单(STEAM 键弹出的 主页/库/商店/媒体/设置/电源)里
插一个「音乐」项,点击进入大屏播放页(route `/music`)。

**定位:可选增强。** 依赖 Steam 私有 React 结构,Steam 客户端更新可能失效。QAM 面板 + 账号页
「打开播放器」按钮始终是 fallback,注入失败绝不影响插件本体。实现见 `src/steamMenu.ts`。

## 铁律

**绝不能崩 UI。** 所有步骤 try/catch,任何异常都返回原始渲染;找不到目标就 no-op。注入的是
「加一项」,失败退化为「菜单和原来一样」,不会白屏/卡死。

## 菜单结构(CDP 实测,当前 SteamOS)

用 `scripts/cdp/` 连活动前端逆向出来的结构:

- 菜单容器 fiber:`memoizedProps.navID === "MainNavMenuContainer"`(稳定锚点)。
- 菜单项组件 = `Ae`,props:`{ route, label, icon, active:"if-within-route", onGamepadFocus }`,**可复用**。
- 真正内联生成菜单项数组的是内部组件 `Ie`(props `{loggedIn, menuOpen}`),其输出形如
  `<容器>{[ p.map(descriptor→<Ae>) , <footer> ]}`。
- `<Ie>` 由内部组件 `fe`(props `{bLoggedIn, open, popup, …}`)在自己的 render 里创建。
- 从导出组件 `cj`(MainMenuBrowserView)到 `Ie` 隔着约 11 个组件边界;`fe`/`Ie`/`ve` **都不是模块导出**。

## 为什么不用「一跳 findInReactTree」/「afterPatch 导出组件」

- issue #28 设想 patch `navID` 容器的父 renderer 后一次 `findInReactTree` 拿到菜单项数组 —— 实测
  **不成立**:菜单项数组在容器**下方**约 11 层,不在容器父级的 render 输出里。
- `Ie`/`fe` 非导出、`Ie` 也不是 memo 包裹(其父是 Context.Provider),**没有稳定的模块对象可持久
  `afterPatch`**。唯一的持久导出锚点 `cj` 离 `Ie` 太远(~11 层深度 patcher,过脆)。

## 采用的机制:live-fiber 包裹 + 定时重打

`src/steamMenu.ts`:

1. **找 `fe`**:在 fiber 树 DFS,按 prop 签名(`bLoggedIn`/`open`/`popup`)命中 `fe` fiber。
2. **包 `fe`**:把 `fe.type`(和 `fe.alternate.type`)换成包裹函数。包裹每次渲染调用原始 `fe`
   拿到输出,在输出里 `deepFind` 到 `<Ie>`(`loggedIn`/`menuOpen`),把 `<Ie>.type` 换成**缓存的**
   `Ie` 包裹(按原始 `Ie` 引用缓存 → 同一 type 引用,React 不会 remount)。
3. **包 `Ie`**:包裹调用原始 `Ie` 拿到输出,`deepFind` 到菜单项数组,`cloneElement` 一个原生
   `Ae` 项、改成 `{route:"/music", label:t("music")(i18n), icon:<FaMusic/>}`,**按 route 定位**插入
   ——插到「商店」`/steamweb` **之后**(即第 4 个);锚点 route 找不到就退化到末尾。按 route 而非固定
   index 定位,Steam 增删菜单项也不错位。按 route 去重。
   注意:菜单里「好友与聊天」「电源」是**无 route** 的项(`me` 组件,非 `Ae`),所以若锚「媒体」前会
   落到好友与聊天之后(第 5)—— 锚「商店」后才是第 4。
4. **定时重打**:`setInterval(1s)`。菜单 remount 后父级会用原始 `fe` 重建 element → `fe.type` 被
   还原,需要重打。`disableMenuInjection()`(`onDismount`)清定时器 + 还原 `fe.type`。

### 已知局限

- **闪烁窗口**:`fe` 的 element 被父级重建后、下次 retry 命中前(≤1s),「音乐」项会短暂消失。
  可接受(可选增强)。想更稳可缩短 retry 或抬高锚点(代价是更深的下钻)。
- **Steam 更新脆弱点**:`navID` 串、`fe`/`Ie` 的 prop 签名、`Ae` 的 props 约定任一变化都会让注入
  静默失效(退回 fallback,不崩)。升级时用 `scripts/cdp/probe-mainmenu.js` 重新核对。

## 复验 / 调试

见 `scripts/cdp/README.md`。核对结构:

```bash
ssh -N -L 8080:localhost:8080 deck@<ip> &
node scripts/cdp/cdp.mjs SharedJSContext scripts/cdp/probe-mainmenu.js
```

关注:`navID` 仍是 `MainNavMenuContainer`、菜单项组件仍有 `{route,label,icon,onGamepadFocus}`、
`fe`/`Ie` 的 prop 签名未变。
