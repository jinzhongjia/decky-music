"""登录账号信息:昵称 + 头像 + VIP 档位 code。"""


async def get(q) -> dict:
    """当前登录账号:昵称 + 头像 + VIP 档位 code(前端 vipText() 本地化,不用服务端图标)。"""
    cred = q.client.credential
    home = await q.client.user.get_homepage(cred.encrypt_uin, credential=cred)
    base = home.base_info
    return {"nickname": base.name, "avatar": base.avatar, "vip": await _vip(q, cred)}


async def _vip(q, cred) -> str:
    # 出档位 code(<tier> / <tier>_annual),前端 vipText() 本地化;不用服务端图标。
    # identity.icon 是等级图标(lv_N)非档位徽章,会误导,不用(参照 quaverq)。
    info = await q.client.user.get_vip_info(credential=cred)
    idt = info.identity
    svip = int(getattr(info, "svip", 0) or 0)
    huge = int(getattr(idt, "huge_vip", 0) or 0)
    vip = int(getattr(idt, "vip", 0) or 0)
    yf = int(getattr(idt, "year_flag", 0) or 0)
    hyf = int(getattr(idt, "huge_year_flag", 0) or 0)
    if svip:
        return "svip_annual" if (hyf or yf) else "svip"
    if huge:
        return "luxury_annual" if hyf else "luxury"
    if vip:
        return "green_annual" if yf else "green"
    return ""
