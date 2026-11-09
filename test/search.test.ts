import assert from 'node:assert/strict'
import { test } from 'node:test'
import { API } from '../src/apis'
import { CardSearch, nameIncludes, validPage } from '../src/search'
import { card } from './fixtures'

test('slices cached results into globally numbered pages, including a partial last page', async () => {
  let calls = 0
  const search = new CardSearch('卡片', async () => {
    calls ++
    return { result: Array.from({ length: 7 }, (_, i) => card(i + 1)), next: 0 }
  })
  const second = await search.page(2, 2)
  assert.deepEqual(second.cards.map(card => card.id), [3, 4])
  assert.equal(second.offset, 2)
  assert.equal(second.totalPages, 4)
  assert.equal(second.hasNext, true)
  await search.page(1, 2)
  const last = await search.page(4, 2)
  assert.deepEqual(last.cards.map(card => card.id), [7])
  assert.equal(last.hasNext, false)
  assert.equal(await search.page(5, 2), undefined)
  assert.equal(calls, 1)
})

test('follows weight-based API cursors lazily and does not claim an unknown page count', async () => {
  const starts: number[] = []
  const search = new CardSearch('卡片', async (start) => {
    starts.push(start)
    if (start === 0) return { result: [card(1), card(2)], next: 2 }
    if (start === 2) return { result: [card(3), card(4)], next: 4 }
    if (start === 4) return { result: [card(5)], next: 5 }
    return { result: [], next: 0 }
  })
  assert.equal((await search.page(1, 2)).totalPages, undefined)
  assert.deepEqual(starts, [0, 2])
  assert.equal((await search.page(2, 2)).hasNext, true)
  const last = await search.page(3, 2)
  assert.equal(last.totalPages, 3)
  assert.equal(last.hasNext, false)
  await search.page(1, 2)
  assert.deepEqual(starts, [0, 2, 4, 5])
})

test('probes beyond an exact page boundary so there is no phantom next page', async () => {
  const starts: number[] = []
  const search = new CardSearch('卡片', async (start) => {
    starts.push(start)
    return start === 0 ? { result: [card(1), card(2)], next: 2 } : { result: [], next: 0 }
  })
  const page = await search.page(1, 2)
  assert.equal(page.totalPages, 1)
  assert.equal(page.hasNext, false)
  assert.equal(await search.page(2, 2), undefined)
  assert.deepEqual(starts, [0, 2])
})

test('failed fetches retain cached batches and retry the failed cursor', async () => {
  const starts: number[] = []
  let fail = true
  const search = new CardSearch('卡片', async (start) => {
    starts.push(start)
    if (start === 0) return { result: [card(1), card(2)], next: 2 }
    if (fail) {
      fail = false
      throw new Error('unavailable')
    }
    return { result: [card(3)], next: 0 }
  })
  await assert.rejects(search.page(1, 2), /unavailable/)
  assert.deepEqual(search.cards.map(card => card.id), [1, 2])
  assert.equal((await search.page(1, 2)).hasNext, true)
  assert.deepEqual(starts, [0, 2, 2])
})

test('rejects malformed batches and non-advancing cursors instead of looping', async () => {
  for (const batch of [
    { result: [], next: 1 }, { result: [card(1)], next: - 1 },
    { result: null, next: 0 }, { result: [], next: Number.POSITIVE_INFINITY },
  ]) {
    const search = new CardSearch('卡片', async () => batch)
    await assert.rejects(search.page(1, 2), /Invalid search result/)
    assert.deepEqual(search.cards, [])
  }
  let calls = 0
  const search = new CardSearch('卡片', async () => {
    calls ++
    return { result: [card(calls)], next: 1 }
  })
  await assert.rejects(search.page(1, 2), /non-advancing cursor/)
  assert.equal(calls, 2)
  assert.equal(search.cards.length, 1)
})

test('does not retain or follow responses from an invalidated search', async () => {
  let current = true
  let calls = 0
  const search = new CardSearch('卡片', async () => {
    calls ++
    current = false
    return { result: [card(1)], next: 1 }
  })
  assert.equal(await search.page(1, 2, () => current), undefined)
  assert.equal(calls, 1)
  assert.deepEqual(search.cards, [])
})

test('validates page numbers and page sizes before making requests', async () => {
  const search = new CardSearch('卡片', async () => assert.fail('must not request invalid pages'))
  for (const [page, size] of [[0, 2], [- 1, 2], [1.5, 2], [Infinity, 2], [Number.MAX_SAFE_INTEGER, 2], [1, 0]]) {
    assert.equal(validPage(page, size), false)
    await assert.rejects(search.page(page, size), /Invalid page number/)
  }
})

test('search API URLs encode keywords and include the continuation offset when needed', () => {
  const initial = new URL(API.ygocdb({ search: 'Blue Eyes & 青眼', start: 0 }))
  assert.equal(initial.searchParams.get('search'), 'Blue Eyes & 青眼')
  assert.equal(initial.searchParams.has('start'), false)
  const next = new URL(API.ygocdb({ search: '青眼', start: 123 }))
  assert.equal(next.searchParams.get('start'), '123')
})

test('name matching checks translated names and readings, not effects or card IDs', () => {
  const fields = ['cn_name', 'sc_name', 'md_name', 'nwbbs_n', 'cnocg_n', 'jp_name', 'jp_ruby', 'en_name', 'wiki_en'] as const
  for (const field of fields) {
    const entry = { ...card(1), [field]: '前缀目标词后缀' }
    assert.equal(nameIncludes(entry, '目标词'), true, field)
  }
  const entry = { ...card(1, '无关卡名'), id: 89631139 }
  entry.text.desc = '青眼白龙的相关效果。'
  assert.equal(nameIncludes(entry, '青眼'), false)
  assert.equal(nameIncludes(entry, '89631139'), false)
  assert.equal(nameIncludes(entry, ' '), false)
  assert.equal(nameIncludes({ ...entry, en_name: undefined, cn_name: undefined }, '不存在'), false)
})

test('name matching uses a complete literal phrase, ignoring Latin case and width differences', () => {
  const entry = { ...card(1), en_name: 'Blue-Eyes White Dragon' }
  assert.equal(nameIncludes(entry, ' ｂＬＵＥ－ＥＹＥＳ '), true)
  assert.equal(nameIncludes(entry, 'Blue-Eyes White'), true)
  assert.equal(nameIncludes(entry, 'Blue Dragon'), false)
  assert.equal(nameIncludes(entry, '.*'), false)
  assert.equal(nameIncludes({ ...entry, cn_name: '特制[青眼]' }, '[青眼]'), true)
})

test('literal name matches exclude broad matches before numbering and pagination', async () => {
  const search = new CardSearch('青眼', async () => ({
    result: [card(1, '宽泛结果1'), card(2, '青眼白龙'), card(3, '宽泛结果3'), card(4, '青眼亚白龙')], next: 0,
  }))
  const first = await search.page(1, 1)
  assert.deepEqual(first.cards.map(card => card.id), [2])
  assert.equal(first.totalPages, 2)
  const second = await search.page(2, 1)
  assert.deepEqual(second.cards.map(card => card.id), [4])
  assert.equal(second.offset, 1)
  assert.equal(second.hasNext, false)
  assert.deepEqual(search.cards.map(card => card.id), [2, 4])
})

test('a name hit in a later batch discards all earlier broad matches', async () => {
  const starts: number[] = []
  const search = new CardSearch('青眼', async (start) => {
    starts.push(start)
    if (start === 0) return { result: [card(1), card(2)], next: 2 }
    if (start === 2) return { result: [card(3), card(4, '青眼白龙')], next: 4 }
    return { result: [card(5, '青眼亚白龙')], next: 0 }
  })
  const page = await search.page(1, 1)
  assert.deepEqual(page.cards.map(card => card.id), [4])
  assert.deepEqual(search.cards.map(card => card.id), [4, 5])
  assert.deepEqual(starts, [0, 2, 4])
})

test('when no names match, all batches are checked before preserving the original broad results', async () => {
  const starts: number[] = []
  const search = new CardSearch('抽2张', async (start) => {
    starts.push(start)
    return start === 0 ? { result: [card(1), card(2), card(3)], next: 3 }
      : { result: [card(4), card(5)], next: 0 }
  })
  const page = await search.page(1, 2)
  assert.equal(page.totalPages, 3)
  assert.deepEqual(search.cards.map(card => card.id), [1, 2, 3, 4, 5])
  assert.deepEqual((await search.page(3, 2)).cards.map(card => card.id), [5])
  assert.deepEqual(starts, [0, 3])
})

test('name-only mode stays lazy but never admits non-name matches from subsequent batches', async () => {
  const starts: number[] = []
  const search = new CardSearch('青眼', async (start) => {
    starts.push(start)
    if (start === 0) return { result: [card(1, '青眼1'), card(2, '青眼2'), card(3, '青眼3')], next: 3 }
    if (start === 3) return { result: [card(4), card(5)], next: 5 }
    return { result: [card(6, '青眼4'), card(7, '青眼5')], next: 0 }
  })
  await search.page(1, 2)
  assert.deepEqual(starts, [0])
  const second = await search.page(2, 2)
  assert.deepEqual(second.cards.map(card => card.id), [3, 6])
  assert.equal(second.totalPages, 3)
  assert.deepEqual(search.cards.map(card => card.id), [1, 2, 3, 6, 7])
  assert.deepEqual(starts, [0, 3, 5])
})

test('an initial filtering failure cannot lock the retry into broad mode', async () => {
  let fail = true
  const starts: number[] = []
  const search = new CardSearch('青眼', async (start) => {
    starts.push(start)
    if (start === 0) return { result: [card(1), card(2)], next: 2 }
    if (fail) {
      fail = false
      throw new Error('unavailable')
    }
    return { result: [card(3, '青眼白龙')], next: 0 }
  })
  await assert.rejects(search.page(1, 1), /unavailable/)
  const page = await search.page(1, 1)
  assert.deepEqual(page.cards.map(card => card.id), [3])
  assert.equal(page.hasNext, false)
  assert.deepEqual(starts, [0, 2, 2])
})
