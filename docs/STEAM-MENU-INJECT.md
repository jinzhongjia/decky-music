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
  `afterPatch`**。唯一的持久导出锚点 `cj` 离 `Ie` 太远(~11 层),要写深度 tree-patcher。

### 为什么最终没走「持久锚定 `cj`」(实测否掉)

一度打算锚在导出组件 `cj`(MainMenuBrowserView)上、用 `createReactTreePatcher` 深链下钻,让 React
自己的重渲染做触发器(无定时器、无闪烁)。CDP 实测把它否了 —— **不是"更贵",是实际更差**:

- **`cj` 极少重渲染**:它是 memoized 的。开/关菜单时只有下面的 `fe` 在**原地**重渲染,`cj` 直接
  bail out 不跑。实测把 `cj.type` 换成探针后,反复开关菜单,探针**从没被调用**;只有切 UI 模式 /
  登录态变化 / popup 彻底销毁这类**深层重挂载**才会让 `cj` 真正重渲染。
- **冷启动空窗**:插件在 `cj` **已挂载之后**才加载,而 patch `exp.cj.type` 只对**将来的**挂载生效
  → 当前 `cj` 实例仍用原始 type;`cj` 又极少重挂载 → 「音乐」项可能**很久不出现**。这比轮询版
  ≤1s 的闪烁差得多(轮询版打开菜单 ~1s 内必出)。
- **深链脆弱**:`cj → Ie` ~11 层,每层 step 都是 Steam 更新可能断的点。

反观 `fe`:开菜单就**原地**重渲染(fiber 复用 → 包裹保留),父级 `d` 重渲染或菜单重挂载时才丢。
所以轮询版首次包上后大多数时候一直在,timer 很少真需要补,"闪烁"基本只是理论上的。故**保留轮询版**。

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

## 踩坑记录:定位插错(第 5 → 第 4)

第一版把「音乐」插到了第 5 个而非第 4,根因是**核对探针在骗人**,值得记:

- 菜单里**并非所有项都有 `route`**:「好友与聊天」「电源」是 `me` 组件、**无 route**;有 route 的
  (`Ae`)只有 主页/库/商店/媒体/下载/设置。
- 最初用的核对探针只列**同时有 `route` 和 `label`** 的项,把无 route 的滤掉了 → 看到的是"6 项"的
  残缺菜单,误以为「媒体前 = 第 4」。真实数组里「好友与聊天」夹在商店与媒体之间,于是"媒体前"实际
  落到它**之后** = 第 5。(插入代码用的一直是真实数组,错的只是"看不见它、锚点选偏"。)
- 修法:锚「**商店 `/steamweb` 之后**」(无视中间几个无 route 项),核对改用
  `scripts/cdp/probe-menu-items.js`(列**所有带 label 的项**,含无 route 的)。

**教训:验证要看完整数组,别用过滤过的子集 —— 量错了还以为对了。**

## 复验 / 调试

见 `scripts/cdp/README.md`。核对结构:

```bash
ssh -N -L 8080:localhost:8080 deck@<ip> &
node scripts/cdp/cdp.mjs SharedJSContext scripts/cdp/probe-mainmenu.js
```

关注:`navID` 仍是 `MainNavMenuContainer`、菜单项组件仍有 `{route,label,icon,onGamepadFocus}`、
`fe`/`Ie` 的 prop 签名未变。
