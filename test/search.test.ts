import assert from 'node:assert/strict'
import { test } from 'node:test'
import { API } from '../src/apis'
import { CardSearch, validPage } from '../src/search'
import { card } from './fixtures'

test('slices cached results into globally numbered pages, including a partial last page', async () => {
  let calls = 0
  const search = new CardSearch(async () => {
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
  const search = new CardSearch(async (start) => {
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
  const search = new CardSearch(async (start) => {
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
  const search = new CardSearch(async (start) => {
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
    const search = new CardSearch(async () => batch)
    await assert.rejects(search.page(1, 2), /Invalid search result/)
    assert.deepEqual(search.cards, [])
  }
  let calls = 0
  const search = new CardSearch(async () => {
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
  const search = new CardSearch(async () => {
    calls ++
    current = false
    return { result: [card(1)], next: 1 }
  })
  assert.equal(await search.page(1, 2, () => current), undefined)
  assert.equal(calls, 1)
  assert.deepEqual(search.cards, [])
})

test('validates page numbers and page sizes before making requests', async () => {
  const search = new CardSearch(async () => assert.fail('must not request invalid pages'))
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
