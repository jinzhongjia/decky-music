// 资产页共骨(NCM 我的 / QQ 我的音乐 同构去重):LoginGate + user_assets 计数 + 二级 Tab。
// 各 app 只声明 tab 列表(计数从 assets 取哪个字段由声明处决定);登录通过后才拉资产。

import { UserAssets, api } from "../api";
import { LoginGate } from "./LoginGate";
import { SecTab, SecondaryTabs } from "./SecondaryTabs";
import { useAsync } from "./useAsync";

export function AssetTabs({ tabs }: { tabs: (assets: UserAssets | null) => SecTab[] }) {
  return (
    <LoginGate>
      <Inner tabs={tabs} />
    </LoginGate>
  );
}

function Inner({ tabs }: { tabs: (assets: UserAssets | null) => SecTab[] }) {
  const assets = useAsync(() => api.getUserAssets(), []);
  return <SecondaryTabs tabs={tabs(assets)} />;
}
