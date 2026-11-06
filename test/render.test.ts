import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderCardText, renderDetail, renderMdmInfo } from '../src/render'
import { card, mdmCard } from './fixtures'

test('card text includes names, types and effects without images or MDM metadata', () => {
  const text = renderCardText(card(1)).toString()
  assert.match(text, /MD卡片1[\s\S]*カード1[\s\S]*Card 1[\s\S]*龙\/光[\s\S]*效果文本[\s\S]*灵摆效果/)
  assert.doesNotMatch(text, /卡片密码|00000001|<img|稀有度|禁限|MD 卡包/)
})

test('provider text is escaped instead of being parsed as message elements', () => {
  const entry = card(1, '<at id="all"/>')
  entry.text.desc = '<img src="file:///etc/passwd"/>'
  const text = renderCardText(entry).toString()
  assert.match(text, /&lt;at/)
  assert.match(text, /&lt;img/)
  assert.doesNotMatch(text, /<at|<img/)
})

test('details retain the configurable image endpoint', () => {
  const detail = renderDetail(card(123), 'https://example.invalid/cards/{id}.jpg').toString()
  assert.match(detail, /src="https:\/\/example.invalid\/cards\/123.jpg"/)
  assert.doesNotMatch(detail, /卡片密码|00000123/)
})

test('expired MDM packs are hidden by default or sorted after current packs', () => {
  const entry = mdmCard(1001)
  entry.obtain = [
    { amount: 1, type: 'pack', source: { _id: 'old1', name: '旧卡包1', type: 'Selection Pack', expires: '2000-01-01', url: '', image: '' } },
    { amount: 1, type: 'pack', source: { _id: 'new1', name: '当前卡包1', type: 'Secret Pack', url: '', image: '' } },
    { amount: 1, type: 'pack', source: { _id: 'old2', name: '旧卡包2', type: 'Selection Pack', expires: '2000-01-01', url: '', image: '' } },
    { amount: 1, type: 'pack', source: { _id: 'new2', name: '当前卡包2', type: 'Secret Pack', url: '', image: '' } },
  ]
  const current = renderMdmInfo(entry, false).toString(true)
  assert.doesNotMatch(current, /旧卡包/)
  const all = renderMdmInfo(entry, true).toString(true)
  assert.match(all, /当前卡包1, 当前卡包2, 旧卡包1 \(过期\), 旧卡包2 \(过期\)/)
})
