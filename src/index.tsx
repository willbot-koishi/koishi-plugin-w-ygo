import { Context, h, Schema, Time, type Fragment, type Session } from 'koishi'
import { API } from './apis'
import { renderCandidates, renderDetail, renderMdmInfo } from './render'
import { CardSearch, validPage, type SearchPage } from './search'

export const name = 'w-ygo'
export const inject = ['http']

export interface Config {
  retry: number
  mdmDefault: boolean
  showExpiredPacks: boolean
  cardImageUrl: string
  maxResults: number
  selectionTimeout: number
}

export const Config: Schema<Config> = Schema.object({
  retry: Schema.number().default(3).description('API 请求失败时的重试次数'),
  mdmDefault: Schema.boolean().default(false).description('是否默认启用 Master Duel Meta 信息'),
  showExpiredPacks: Schema.boolean().default(false).description('是否显示过期的 MD 卡包'),
  cardImageUrl: Schema.string()
    .default('https://cdn.233.momobako.com/ygoimg/sc/{id}.webp')
    .description('卡图 URL 模板，使用 {id} 表示卡片密码'),
  maxResults: Schema.natural().min(1).default(5).description('多结果查询每页展示的卡片数'),
  selectionTimeout: Schema.natural().min(Time.second).role('ms').default(2 * Time.minute)
    .description('查询会话有效期，翻页后重新计时'),
})

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger(name)
  let disposed = false
  interface Pending {
    mdm: boolean
    search: CardSearch
    page?: SearchPage
    busy?: boolean
    cancelTimeout?: () => void
  }
  const pending = new Map<string, Pending>()
  // session.fid does not include selfId, so it cannot isolate multiple bots.
  const keyOf = (session: Session) => JSON.stringify([session.sid, session.guildId, session.channelId, session.userId])
  const clear = (key: string, entry: Pending) => {
    if (pending.get(key) !== entry) return
    pending.delete(key)
    entry.cancelTimeout?.()
  }
  const current = (key: string, entry: Pending) => ! disposed && pending.get(key) === entry
  const renew = (key: string, entry: Pending) => {
    if (! current(key, entry)) return
    entry.cancelTimeout?.()
    entry.cancelTimeout = ctx.setTimeout(() => clear(key, entry), config.selectionTimeout)
  }
  ctx.on('dispose', () => {
    disposed = true
    for (const [key, entry] of pending) clear(key, entry)
  })

  const get = async <T = unknown>(url: string, { retry = config.retry }: { retry?: number } = {}): Promise<T> => {
    try {
      return await ctx.http.get<T>(url)
    }
    catch (error) {
      if (retry > 0 && ! disposed) return get<T>(url, { retry: retry - 1 })
      throw error
    }
  }

  // session.send() catches adapter errors internally. For forwards, propagate
  // failures so an unsent candidate list cannot leave an active selection.
  const send = (session: Session, content: Fragment) => session.bot.sendMessage(
    session.channelId, h.normalize(content), session.event.referrer, { session },
  )

  const sendDetail = async (session: Session, card: API.Card, mdm: boolean, current = () => ! disposed) => {
    let mdmInfo: ReturnType<typeof renderMdmInfo> | undefined
    if (mdm) {
      mdmInfo = <>从 MDM 获取信息失败</>
      try {
        const mdmCards = await get<API.MdmCards>(API.mdmcards({ name: card.en_name }))
        const mdmCard = mdmCards.find(item => String(item.gameId) === String(card.cid))
        if (mdmCard) mdmInfo = renderMdmInfo(mdmCard, config.showExpiredPacks)
      }
      catch (error) {
        logger.warn('failed to load MDM info for card %s (%s)', card.id, error instanceof Error ? error.message : 'unknown error')
      }
    }
    if (current()) await send(session, renderDetail(card, config.cardImageUrl, mdmInfo))
  }

  const showPage = async (session: Session, key: string, entry: Pending, number: number) => {
    const isCurrent = () => current(key, entry)
    if (! validPage(number, config.maxResults)) {
      await session.send('页码无效，请输入有效的正整数页码。')
      return
    }
    const page = await entry.search.page(number, config.maxResults, isCurrent)
    if (! isCurrent()) return
    if (! page) {
      const total = entry.search.totalPages(config.maxResults)
      await session.send(`页码超出范围，共有 ${total} 页。`)
      return
    }
    await send(session, renderCandidates(page, config.selectionTimeout))
    if (isCurrent()) entry.page = page
  }

  ctx.middleware(async (session, next) => {
    const key = keyOf(session)
    const entry = pending.get(key)
    if (! entry?.page) return next()
    const elements = session.elements.slice()
    if (elements[0]?.type === 'at' && elements[0].attrs.id === session.selfId) elements.shift()
    // Attachments, mentions of other users and ordinary chat must pass through.
    if (elements.some(element => element.type !== 'text')) return next()
    const input = elements.map(element => element.attrs.content).join('').trim()
    if (input === '取消') {
      clear(key, entry)
      return session.send('已取消选卡。')
    }
    const pageMatch = /^第\s*(\d+)\s*页$/.exec(input)
    const paging = input === '上一页' || input === '下一页' || !! pageMatch
    if (! paging && ! /^\d+$/.test(input)) return next()
    if (entry.busy) return session.send('正在翻页，请稍候。')
    if (paging) {
      const number = pageMatch ? Number(pageMatch[1]) : entry.page.number + (input === '下一页' ? 1 : - 1)
      // Pause expiry during API/adapter I/O. All recognized page operations
      // renew the idle timeout; a failed send keeps the previously shown page.
      entry.busy = true
      entry.cancelTimeout?.()
      try {
        await showPage(session, key, entry, number)
      }
      catch (error) {
        if (! current(key, entry)) return
        logger.warn('page query or send failed (%s)', error instanceof Error ? error.message : 'unknown error')
        await session.send('翻页失败，仍保留原页面，请稍后重试。')
      }
      finally {
        entry.busy = false
        renew(key, entry)
      }
      return
    }
    const index = Number(input)
    const { offset, cards } = entry.page
    if (index < offset + 1 || index > offset + cards.length) {
      return session.send(`请输入 ${offset + 1}～${offset + cards.length} 之间的序号。`)
    }
    const card = cards[index - offset - 1]
    // Consume before awaiting MDM/the adapter, preventing duplicate selections.
    clear(key, entry)
    try {
      await sendDetail(session, card, entry.mdm)
    }
    catch (error) {
      if (disposed) return
      logger.warn('failed to send card %s (%s)', card.id, error instanceof Error ? error.message : 'unknown error')
      await session.send('卡片详情发送失败，请重新查询。')
    }
  }, true)

  // :text consumes trailing flags; variadic strings keep -m/-M usable after
  // the keyword while preserving searches containing spaces.
  ctx.command('ygo <...search:string>', '通过 ygocdb.com 搜索游戏王卡片')
    .option('mdm', '-m 从 Master Duel Meta 获取额外信息（会消耗更多时间）', { fallback: config.mdmDefault })
    .option('mdm', '-M', { value: false })
    .option('page', '-p <page:posint> 指定结果页码', { fallback: 1 })
    .action(async ({ session, options }, ...words) => {
      const search = words.join(' ').trim()
      if (! search) return <>请输入搜索关键词。</>
      if (! validPage(options.page, config.maxResults)) return <>页码无效，请输入有效的正整数页码。</>
      const key = keyOf(session)
      const previous = pending.get(key)
      if (previous) clear(key, previous)
      const entry: Pending = {
        mdm: !! options.mdm,
        search: new CardSearch(search, start => get<API.Ygocdb>(API.ygocdb({ search, start }))),
      }
      pending.set(key, entry)
      // Identity, rather than request completion order, determines which query
      // owns the interaction. A slow earlier response cannot replace it.
      const isCurrent = () => current(key, entry)
      try {
        const page = await entry.search.page(options.page, config.maxResults, isCurrent)
        if (! isCurrent()) return
        if (! entry.search.cards.length) return <>未找到相关卡片</>
        if (! page) return <>页码超出范围，共有 {entry.search.totalPages(config.maxResults)} 页。</>
        if (entry.search.cards.length === 1) return await sendDetail(session, entry.search.cards[0], entry.mdm, isCurrent)

        await send(session, renderCandidates(page, config.selectionTimeout))
        if (! isCurrent()) return
        // Activate only after the forward is sent, so the full response window
        // remains available even on a slow adapter. No prompt is sent outside it.
        entry.page = page
        renew(key, entry)
      }
      catch (error) {
        if (! isCurrent()) return
        logger.warn('query or send failed (%s)', error instanceof Error ? error.message : 'unknown error')
        return <>查询或发送失败，请稍后重试。</>
      }
      finally {
        if (! entry.page) clear(key, entry)
      }
    })
}
