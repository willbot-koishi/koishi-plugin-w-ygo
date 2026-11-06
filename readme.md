# koishi-plugin-w-ygo

[![npm](https://img.shields.io/npm/v/koishi-plugin-w-ygo?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-w-ygo)

WillBot: YuGiOh function

卡图默认使用百鸽提供的简体中文卡图，也可以通过 `cardImageUrl` 配置含 `{id}` 占位符的 URL 模板。
如需使用 YGOPRODeck 的英文卡图，可以配置为 `https://images.ygoprodeck.com/images/cards/{id}.jpg`。

## 多结果查询

```text
ygo 青眼
下一页
上一页
第 3 页
ygo 青眼 -p 2
7
```

只有一张卡时直接显示完整详情；多张时按 API 返回顺序分页，每页 `maxResults` 张（默认 5 张），组成合并转发。第一个节点包含页码、选择及翻页提示，之后每张卡一个节点，仅包含序号、名称、类型和效果等文本，不含图片、稀有度、禁限及卡包信息。候选列表和完整详情均不额外显示卡片密码。

使用 `-p <页码>` / `--page <页码>` 指定首次展示的页码，默认为第 1 页。查卡人可在同一机器人、同一会话中发送“上一页”“下一页”或“第 n 页”翻页，`n` 两侧允许空白。

卡片序号跨页连续，例如每页 5 张时第二页为 6～10。输入当前页显示的序号查看完整详情，不会因翻页而让同一序号指向另一张卡片。上游搜索 API 本身按权重分批返回，插件按需继续读取并缓存；回翻已加载页面不会重新搜索，尚未读完时不显示未经确认的总页数。

`selectionTimeout` 控制会话有效期，默认 **2 分钟**，从列表发送完成后开始计算。翻页操作（包括越界或失败提示）会重新计时；翻页请求、发送进行中暂停计时，完成后再开始完整有效期。普通聊天和无效卡片序号不会延长有效期。输入“取消”、成功选卡、超时或发起新查询都会结束旧会话；普通聊天和其它指令不会中断选择，也不会被吞掉。翻页失败时保留原页面，可以重试。

候选列表不会查询 Master Duel Meta；选中后才根据原查询的 `-m/-M` 设置请求 MDM。选卡复用原搜索结果，不会重新搜索导致序号变化。MDM 请求失败时仍显示卡片详情，并附上失败提示。

```text
ygo Blue Eyes -m
ygo 青眼 -M
```

`-m` 启用 MDM 信息，`-M` 禁用，均可放在关键词前后；未指定时使用 `mdmDefault` 配置。

## 开发检查

```sh
yarn workspace koishi-plugin-w-ygo check
yarn workspace koishi-plugin-w-ygo test
yarn workspace koishi-plugin-w-ygo build
```
