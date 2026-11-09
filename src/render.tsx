import type { h } from 'koishi'
import { API } from './apis'
import type { SearchPage } from './search'

export function renderCardText(card: API.Card) {
  return <>
    <p>[MD 卡名] {card.md_name || '无'}</p>
    <p>[常用名] {card.cn_name || '无'}</p>
    <p>[日文名] {card.jp_name ? `${card.jp_name}${card.jp_ruby ? `（${card.jp_ruby}）` : ''}` : '无'}</p>
    <p>[英文名] {card.en_name || '无'}</p>
    <p>{card.text.types}</p>
    <p>{card.text.desc}</p>
    {card.text.pdesc && <p>[灵摆效果] {card.text.pdesc}</p>}
  </>
}

export function renderCandidates(page: SearchPage, timeout: number) {
  const { cards, offset, number, totalPages, hasNext } = page
  return <message forward>
    <message>
      <p>第 {number} 页{totalPages === undefined ? '' : `，共 ${totalPages} 页`}，本页 {cards.length} 张卡片。</p>
      <p>请查卡人在 {timeout / 1000} 秒内输入 {offset + 1}～{offset + cards.length} 查看详情，输入“取消”结束。</p>
      <p>翻页：{[number > 1 && '上一页', hasNext && '下一页', '第 n 页'].filter(Boolean).join(' / ')}。翻页后重新计时。</p>
    </message>
    {cards.map((card, index) => <message>
      <p>[序号] {offset + index + 1}</p>
      {renderCardText(card)}
    </message>)}
  </message>
}

export function renderMdmInfo(card: API.MdmCard, showExpiredPacks: boolean) {
  const now = new Date()
  const packs = card.obtain
    .map((obtain) => ({
      ...obtain,
      expired: !! obtain.source.expires && new Date(obtain.source.expires) < now,
    }))
    .filter(obtain => ! obtain.expired || showExpiredPacks)
    .sort((a, b) => Number(a.expired) - Number(b.expired))
    .map(obtain => `${obtain.source.name}${obtain.expired ? ' (过期)' : ''}`)
    .join(', ') || '无'
  return <>
    <p>[MD 稀有度] {card.rarity}</p>
    <p>[MD 禁限] {API.showMdmBanStatus(card.banStatus)}</p>
    <p>[OCG 禁限] {API.showMdmBanStatus(card.ocgBanStatus)}</p>
    <p>[TCG 禁限] {API.showMdmBanStatus(card.tcgBanStatus)}</p>
    <p>[MD 卡包] {packs}</p>
  </>
}

export function renderDetail(card: API.Card, cardImageUrl: string, mdmInfo?: h.Fragment) {
  return <message forward>
    <message>
      <img src={API.cardImage(cardImageUrl, { id: card.id })} alt={card.en_name} />
      {renderCardText(card)}
    </message>
    {mdmInfo !== undefined ? <message>{mdmInfo}</message> : null}
  </message>
}
