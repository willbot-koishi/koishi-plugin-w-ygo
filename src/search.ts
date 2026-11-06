import type { API } from './apis'

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

  constructor(private request: (start: number) => Promise<API.Ygocdb>) {}

  async page(number: number, pageSize: number, current = () => true): Promise<SearchPage | undefined> {
    if (! validPage(number, pageSize)) throw new Error('Invalid page number')
    // One extra card tells us whether Next exists, even at an exact page
    // boundary. API batches are weight-based, not the configured UI page size.
    const needed = Math.max(number * pageSize + 1, 2)
    while (current() && this.cards.length < needed && this.next !== undefined) {
      const start = this.next
      const batch = await this.request(start)
      if (! current()) return
      if (! Array.isArray(batch?.result) || ! Number.isSafeInteger(batch.next) || batch.next < 0
        || (batch.next !== 0 && (batch.next <= start || ! batch.result.length))) {
        throw new Error('Invalid search result or non-advancing cursor')
      }
      this.cards.push(...batch.result)
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
