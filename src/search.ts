import type { API } from './apis'

const normalize = (text: string) => text.normalize('NFKC').toLowerCase()

export function nameIncludes(card: API.Card, query: string) {
  const keyword = normalize(query.trim())
  if (! keyword) return false
  return [card.cn_name, card.sc_name, card.md_name, card.nwbbs_n, card.cnocg_n,
    card.jp_name, card.jp_ruby, card.en_name, card.wiki_en].some(name => (
    typeof name === 'string' && normalize(name).includes(keyword)
  ))
}

export interface SearchPage {
  number: number
  offset: number
  cards: API.Card[]
  hasNext: boolean
  totalPages?: number
}

export function validPage(page: number, pageSize: number) {
  return Number.isSafeInteger(page) && page > 0 && Number.isSafeInteger(pageSize) && pageSize > 0
    && Number.isSafeInteger(page * pageSize + 1)
}

export class CardSearch {
  readonly cards: API.Card[] = []
  private next: number | undefined = 0
  private nameOnly = false

  constructor(private query: string, private request: (start: number) => Promise<API.Ygocdb>) {}

  async page(number: number, pageSize: number, current = () => true): Promise<SearchPage | undefined> {
    if (! validPage(number, pageSize)) throw new Error('Invalid page number')
    // One extra card tells us whether Next exists, even at an exact page
    // boundary. API batches are weight-based, not the configured UI page size.
    const needed = Math.max(number * pageSize + 1, 2)
    // Until a name hit is found, broad matches cannot be shown: a later API
    // batch may still contain a literal name match. Fall back only at EOF.
    while (current() && this.next !== undefined && (! this.nameOnly || this.cards.length < needed)) {
      const start = this.next
      const batch = await this.request(start)
      if (! current()) return
      if (! Array.isArray(batch?.result) || ! Number.isSafeInteger(batch.next) || batch.next < 0
        || (batch.next !== 0 && (batch.next <= start || ! batch.result.length))) {
        throw new Error('Invalid search result or non-advancing cursor')
      }
      const matches = batch.result.filter(card => nameIncludes(card, this.query))
      if (! this.nameOnly && matches.length) {
        this.nameOnly = true
        this.cards.length = 0
      }
      this.cards.push(...(this.nameOnly ? matches : batch.result))
      this.next = batch.next || undefined
    }
    if (! current()) return
    const offset = (number - 1) * pageSize
    if (offset >= this.cards.length) return
    const cards = this.cards.slice(offset, offset + pageSize)
    return {
      number, offset, cards,
      hasNext: offset + cards.length < this.cards.length || this.next !== undefined,
      totalPages: this.next === undefined ? Math.ceil(this.cards.length / pageSize) : undefined,
    }
  }

  totalPages(pageSize: number) {
    return this.next === undefined ? Math.ceil(this.cards.length / pageSize) : undefined
  }
}
