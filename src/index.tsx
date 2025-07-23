import { Context, Schema } from 'koishi'
import { API } from './apis'

export const name = 'w-ygo'

export interface Config {
  retry: number
  mdmDefault: boolean
  showExpiredPacks: boolean
}

export const Config: Schema<Config> = Schema.object({
  retry: Schema.number().default(3).description('API 请求失败时的重试次数'),
  mdmDefault: Schema.boolean().default(false).description('是否默认启用 Master Duel Meta 信息'),
  showExpiredPacks: Schema.boolean().default(false).description('是否显示过期的 MD 卡包'),
})

export function apply(ctx: Context, config: Config) {
  const get = async <T = unknown>(url: string, { retry = config.retry }: { retry?: number } = {}): Promise<T> => {
    try {
      return await ctx.http.get<T>(url)
    }
    catch (error) {
      if (retry > 0) return get<T>(url, { retry: retry - 1 })
      throw error
    }
  }

  ctx.command('ygo <search:text>', '通过 ygocdb.com 搜索游戏王卡片')
    .option('mdm', '-m 从 Master Duel Meta 获取额外信息（会消耗更多时间）', { fallback: config.mdmDefault })
    .option('mdm', '-M', { value: false })
    .action(async ({ session, options }, search) => {
      const { result: cards } = await get<API.Ygocdb>(API.ygocdb({ search }))
      if (! cards.length) return <>未找到相关卡片</>

      const [ card ] = cards

      let mdminfo = <>从 MDM 获取信息失败</>
      if (options.mdm) {
        const mdmcards = await get<API.MdmCards>(API.mdmcards({ name: card.en_name }))
        const gameId = String(card.cid)
        const mdmcard = mdmcards.find(it => String(it.gameId) === gameId)
        if (mdmcard) {
          mdminfo = <>
            <p>[MD 稀有度] {mdmcard.rarity}</p>
            <p>[MD 禁限] {API.showMdmBanStatus(mdmcard.banStatus)}</p>
            <p>[OCG 禁限] {API.showMdmBanStatus(mdmcard.ocgBanStatus)}</p>
            <p>[TCG 禁限] {API.showMdmBanStatus(mdmcard.tcgBanStatus)}</p>
            <p>[MD 卡包] {
              mdmcard.obtain
                .map(it => {
                  const expired = it.source.expires && new Date(it.source.expires) < new Date
                  return { ...it, expired }
                })
                .filter(it => ! it.expired || config.showExpiredPacks)
                .sort(it => + it.expired)
                .map(obtain => `${obtain.source.name}${obtain.expired ? ' (过期)' : ''}`)
                .join(', ') || '无'
            }</p>
          </>
        }
      }

      session.send(<message forward>
        <message>
          <img src={API.momobako({ id: card.id })} alt={card.en_name} />
          <p>[MD 卡名] {card.md_name || '无'}</p>
          <p>[常用名] {card.cn_name}</p>
          <p>[日文名] {card.jp_name ? `${card.jp_name}（${card.jp_ruby}）` : '无'}</p>
          <p>[英文名] {card.en_name || '无'}</p>
          <p>{card.text.types}</p>
          <p>{card.text.desc}</p>
          {
            card.text.pdesc && <p>[灵摆效果] {card.text.pdesc}</p>
          }
        </message>
        { options.mdm && <message>{mdminfo}</message> }
      </message>)
    })
}
