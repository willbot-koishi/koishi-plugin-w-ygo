import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { Context, h, type Plugin } from 'koishi'
import memory from '@koishijs/plugin-database-memory'
import Mock from '@koishijs/plugin-mock'
import * as ygo from '../src'
import { card, mdmCard } from './fixtures'

const fixtures: Array<{ ctx: Context, mock: { dispose(): boolean } }> = []

afterEach(async () => {
  for (const { ctx, mock } of fixtures.splice(0)) {
    mock.dispose()
    await ctx.stop()
  }
})

function deferred<T>() {
  let resolve: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve: (value: T) => resolve(value) }
}

async function fixture(config: Partial<ygo.Config> = {}, handler?: (url: URL) => unknown | Promise<unknown>) {
  const ctx = new Context()
  const calls: URL[] = []
  const sent: h[][] = []
  const passed: string[] = []
  ctx.set('http', {
    async get(value: string) {
      const url = new URL(value)
      calls.push(url)
      if (handler) return handler(url)
      return url.hostname === 'ygocdb.com'
        ? { result: [card(1), card(2), card(3)], next: 0 }
        : [mdmCard(1001), mdmCard(1002), mdmCard(1003)]
    },
  } as unknown as Context['http'])
  ctx.plugin(memory)
  const mock = ctx.plugin(Mock as Plugin.Constructor)
  const plugin = ctx.plugin(ygo, { retry: 0, ...config })
  ctx.command('ping').action(() => 'pong')
  ctx.on('before-send', (session) => {
    sent.push(session.elements)
  })
  ctx.middleware((session, next) => {
    passed.push(session.content)
    return next()
  })
  fixtures.push({ ctx, mock })
  await ctx.start()
  await ctx.mock.initUser('alice')
  await ctx.mock.initUser('bob')
  await ctx.mock.initChannel('group1')
  await ctx.mock.initChannel('group2')
  return { ctx, client: ctx.mock.client('alice'), calls, sent, passed, plugin }
}

test('multi-result searches send exactly one forward with its prompt first and text-only card nodes', async () => {
  const { client, calls, sent } = await fixture({ maxResults: 2, mdmDefault: true })
  const replies = await client.receive('ygo 测试')
  assert.equal(replies.length, 3)
  assert.equal(sent.length, 1)
  const [forward] = sent[0]
  assert.equal(forward.type, 'message')
  assert.equal(forward.attrs.forward, true)
  const nodes = forward.children
  assert.equal(nodes.length, 3)
  assert.ok(nodes.every(node => node.type === 'message'))
  assert.match(nodes[0].toString(true), /120 秒内输入 1～2/)
  assert.match(nodes[1].toString(true), /\[序号\] 1[\s\S]*卡片1的效果文本[\s\S]*灵摆效果/)
  assert.match(nodes[2].toString(true), /\[序号\] 2[\s\S]*卡片2/)
  assert.doesNotMatch(forward.toString(true), /卡片密码|00000001|卡片3|稀有度|禁限|MD 卡包/)
  assert.equal(h.select(forward.children, 'img').length, 0)
  assert.equal(calls.length, 1)
})

test('selection reuses the displayed card, fetches MDM only for it and consumes the interaction', async () => {
  const { client, calls } = await fixture({ mdmDefault: true })
  await client.receive('ygo 测试')
  const replies = await client.receive('2')
  assert.equal(replies.length, 2)
  assert.match(replies[0], /<img[^>]*\/2.webp[^>]*>[\s\S]*卡片2/)
  assert.match(replies[1], /\[MD 稀有度\] UR[\s\S]*\[OCG 禁限\] 禁止/)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].searchParams.get('search'), 'Card 2')
  await client.shouldNotReply('1')
  assert.equal(calls.length, 2)
})

test('one result goes directly to the existing full detail, without a selection prompt', async () => {
  const { client, sent } = await fixture({}, () => ({ result: [card(9)], next: 0 }))
  const [reply] = await client.receive('ygo 唯一')
  assert.match(reply, /<img[^>]*\/9.webp/)
  assert.match(reply, /卡片9的效果文本/)
  assert.doesNotMatch(reply, /输入|序号/)
  assert.equal(sent.length, 1)
  await client.shouldNotReply('1')
})

test('no results keep the current message and do not install a selection handler', async () => {
  const { client } = await fixture({}, () => ({ result: [], next: 0 }))
  await client.shouldReply('ygo 不存在', '未找到相关卡片')
  await client.shouldNotReply('1')
})

test('maxResults=1 still prompts when the API found multiple cards', async () => {
  const { client, calls } = await fixture({ maxResults: 1 })
  const replies = await client.receive('ygo 测试')
  assert.equal(replies.length, 2)
  assert.match(replies[0], /输入 1～1/)
  const [reply] = await client.receive('1')
  assert.match(reply, /<img[^>]*\/1.webp/)
  assert.equal(calls.length, 1)
})

test('out-of-range selections leave the interaction active', async () => {
  const { client } = await fixture({ maxResults: 2 })
  await client.receive('ygo 测试')
  for (const input of ['0', '3', '99999999999999999999999999999999999999999']) {
    await client.shouldReply(input, '请输入 1～2 之间的序号。')
  }
  const [reply] = await client.receive('2')
  assert.match(reply, /<img[^>]*\/2.webp/)
})

test('ordinary messages, other commands and attachments pass through without losing the selection', async () => {
  const { client, passed } = await fixture()
  await client.receive('ygo 测试')
  for (const input of ['普通聊天', '1.5', '1 图片', '<at id="bob"/>1', '<img src="https://example.invalid/a.png"/>1']) {
    await client.shouldNotReply(input)
    assert.ok(passed.includes(input))
  }
  await client.shouldReply('ping', 'pong')
  const [reply] = await client.receive('1')
  assert.match(reply, /卡片1/)
})

test('allows an optional leading mention of the receiving bot', async () => {
  const { client, ctx } = await fixture()
  await client.receive('ygo 测试')
  const [reply] = await client.receive(`<at id="${ctx.bots[0].selfId}"/> 2`)
  assert.match(reply, /<img[^>]*\/2.webp/)
})

test('cancel ends the interaction', async () => {
  const { client } = await fixture()
  await client.receive('ygo 测试')
  await client.shouldReply('取消', '已取消选卡。')
  await client.shouldNotReply('1')
})

test('isolates users, groups and private chats', async () => {
  const { ctx, client } = await fixture()
  const group1 = ctx.mock.client('alice', 'group1')
  const group2 = ctx.mock.client('alice', 'group2')
  const bob = ctx.mock.client('bob', 'group1')
  await group1.receive('ygo 测试')
  await group2.shouldNotReply('1')
  await bob.shouldNotReply('1')
  await client.shouldNotReply('1')
  const [reply] = await group1.receive('2')
  assert.match(reply, /卡片2/)
})

test('isolates different receiving bots even for the same user and channel', async () => {
  const { ctx, client } = await fixture()
  const otherBotClient = ctx.mock.client('alice')
  otherBotClient.event.selfId = 'another-bot'
  await client.receive('ygo 测试')
  await otherBotClient.shouldNotReply('1')
  const [reply] = await client.receive('1')
  assert.match(reply, /卡片1/)
})

test('selection expires silently without consuming later input', async (t) => {
  const { client, passed } = await fixture({ selectionTimeout: 1000 })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await client.receive('ygo 测试')
  t.mock.timers.tick(1000)
  await client.shouldNotReply('1')
  assert.ok(passed.includes('1'))
})

test('a new query replaces old candidates and their timeout cannot clear the new selection', async (t) => {
  const { client } = await fixture({ selectionTimeout: 1000 }, url => ({
    result: url.searchParams.get('search') === '旧查询' ? [card(1), card(2)] : [card(8), card(9)], next: 0,
  }))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await client.receive('ygo 旧查询')
  t.mock.timers.tick(600)
  await client.receive('ygo 新查询')
  t.mock.timers.tick(500)
  const [reply] = await client.receive('1')
  assert.match(reply, /<img[^>]*\/8.webp/)
})

test('an older slow API response cannot replace newer candidates', async () => {
  const started = deferred<void>()
  const response = deferred<unknown>()
  const { ctx, client } = await fixture({}, (url) => {
    if (url.searchParams.get('search') === '慢查询') {
      started.resolve()
      return response.promise
    }
    return { result: [card(8), card(9)], next: 0 }
  })
  const oldClient = ctx.mock.client('alice')
  const oldReplies = oldClient.receive('ygo 慢查询')
  await started.promise
  await client.receive('ygo 新查询')
  response.resolve({ result: [card(1), card(2)], next: 0 })
  assert.deepEqual(await oldReplies, [])
  const [reply] = await client.receive('1')
  assert.match(reply, /<img[^>]*\/8.webp/)
})

test('a new single-result or empty query also discards old candidates', async () => {
  const { client } = await fixture({}, url => ({
    result: url.searchParams.get('search') === '多个' ? [card(1), card(2)]
      : url.searchParams.get('search') === '唯一' ? [card(8)] : [], next: 0,
  }))
  await client.receive('ygo 多个')
  await client.receive('ygo 唯一')
  await client.shouldNotReply('1')
  await client.receive('ygo 多个')
  await client.receive('ygo 空')
  await client.shouldNotReply('1')
})

test('retains -m/-M behavior and accepts flags after multiword search terms', async () => {
  const { client, calls } = await fixture({ mdmDefault: true })
  await client.receive('ygo Blue Eyes -M')
  const [reply] = await client.receive('1')
  assert.match(reply, /卡片1/)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.get('search'), 'Blue Eyes')
  await client.receive('ygo -m Blue Eyes')
  const replies = await client.receive('2')
  assert.match(replies[1], /MD 稀有度/)
  assert.equal(calls.length, 3)
})

test('failed MDM requests still show the selected card plus an explicit MDM error', async () => {
  const { client } = await fixture({}, (url) => {
    if (url.hostname !== 'ygocdb.com') throw new Error('MDM unavailable')
    return { result: [card(1), card(2)], next: 0 }
  })
  await client.receive('ygo 测试 -m')
  const replies = await client.receive('2')
  assert.match(replies[0], /<img[^>]*\/2.webp/)
  assert.equal(replies[1], '从 MDM 获取信息失败')
})

test('failed searches report an error and clear the old interaction', async () => {
  const { client } = await fixture({}, (url) => {
    if (url.searchParams.get('search') === '错误') throw new Error('API unavailable')
    return { result: [card(1), card(2)], next: 0 }
  })
  await client.receive('ygo 测试')
  await client.shouldReply('ygo 错误', '查询或发送失败，请稍后重试。')
  await client.shouldNotReply('1')
})

test('plugin disposal removes selection handling and invalidates in-flight queries', async () => {
  const started = deferred<void>()
  const response = deferred<unknown>()
  const { client, plugin } = await fixture({}, () => {
    started.resolve()
    return response.promise
  })
  const replies = client.receive('ygo 慢查询')
  await started.promise
  plugin.dispose()
  response.resolve({ result: [card(1), card(2)], next: 0 })
  assert.deepEqual(await replies, [])
  await client.shouldNotReply('1')
})

test('the response window starts after a slow forward finishes sending', async (t) => {
  const started = deferred<void>()
  const release = deferred<void>()
  const { ctx, client } = await fixture({ selectionTimeout: 1000 })
  ctx.on('before-send', async (session) => {
    if (! session.content.includes('请查卡人')) return
    started.resolve()
    await release.promise
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const replies = client.receive('ygo 测试')
  await started.promise
  t.mock.timers.tick(2000)
  release.resolve()
  await replies
  t.mock.timers.tick(999)
  const [reply] = await client.receive('2')
  assert.match(reply, /<img[^>]*\/2.webp/)
})

test('a failed forward send is awaited and leaves no active selection', async () => {
  const { ctx, client } = await fixture()
  ctx.on('before-send', (session) => {
    if (session.content.includes('请查卡人')) throw new Error('forward unavailable')
  })
  await client.shouldReply('ygo 测试', '查询或发送失败，请稍后重试。')
  await client.shouldNotReply('1')
})

test('rapid duplicate selections only request and send one detail', async () => {
  const started = deferred<void>()
  const response = deferred<unknown>()
  const { ctx, client, calls } = await fixture({ mdmDefault: true }, (url) => {
    if (url.hostname === 'ygocdb.com') return { result: [card(1), card(2)], next: 0 }
    started.resolve()
    return response.promise
  })
  await client.receive('ygo 测试')
  const replies = client.receive('1')
  await started.promise
  const other = ctx.mock.client('alice')
  await other.shouldNotReply('2')
  response.resolve([mdmCard(1001)])
  assert.equal((await replies).length, 2)
  assert.equal(calls.length, 2)
})

test('-p selects the requested page and card numbers stay global', async () => {
  const { client, calls } = await fixture({ maxResults: 2 })
  const replies = await client.receive('ygo 测试 -p 2 -m')
  assert.equal(replies.length, 2)
  assert.match(replies[0], /第 2 页，共 2 页[\s\S]*输入 3～3/)
  assert.match(replies[1], /\[序号\] 3[\s\S]*卡片3/)
  await client.shouldReply('1', '请输入 3～3 之间的序号。')
  const details = await client.receive('3')
  assert.match(details[0], /<img[^>]*\/3.webp/)
  assert.match(details[1], /MD 稀有度/)
  assert.equal(calls.length, 2)
  assert.equal(calls[1].searchParams.get('search'), 'Card 3')
})

test('supports previous, next and explicit pages with optional whitespace using cached results', async () => {
  const { client, calls } = await fixture({ maxResults: 2 }, () => ({
    result: Array.from({ length: 7 }, (_, i) => card(i + 1)), next: 0,
  }))
  await client.receive('ygo 测试')
  assert.match((await client.receive('下一页'))[0], /第 2 页，共 4 页/)
  assert.match((await client.receive('上一页'))[0], /第 1 页，共 4 页/)
  assert.match((await client.receive('第  3 \t页'))[0], /第 3 页，共 4 页[\s\S]*输入 5～6/)
  const last = await client.receive('第4页')
  assert.match(last[0], /第 4 页，共 4 页[\s\S]*输入 7～7/)
  assert.match(last[1], /\[序号\] 7/)
  assert.doesNotMatch(last[0], /下一页/)
  assert.equal(calls.length, 1)
  assert.match((await client.receive('7'))[0], /<img[^>]*\/7.webp/)
})

test('invalid interactive pages and missing pages leave the current page usable', async () => {
  const { client, calls } = await fixture({ maxResults: 2 })
  await client.receive('ygo 测试')
  await client.shouldReply('上一页', /页码无效/)
  await client.shouldReply('第0页', /页码无效/)
  await client.shouldReply('第999999999999999999999999999页', /页码无效/)
  await client.shouldReply('第100页', '页码超出范围，共有 2 页。')
  assert.equal(calls.length, 1)
  assert.match((await client.receive('1'))[0], /<img[^>]*\/1.webp/)
})

test('invalid -p values do not fetch; out-of-range initial pages do not install a session', async () => {
  const { client, calls } = await fixture({ maxResults: 2 })
  for (const value of ['0', '-1', '1.5']) {
    await client.shouldReply(`ygo 测试 -p ${value}`, /选项 page 输入无效/)
  }
  await client.shouldReply('ygo 测试 -p 999999999999999999999999999', /页码无效/)
  assert.equal(calls.length, 0)
  await client.shouldReply('ygo 测试 --page 3', '页码超出范围，共有 2 页。')
  await client.shouldNotReply('下一页')
  await client.shouldNotReply('1')
})

test('the default session lasts two minutes and paging renews the configured timeout', async (t) => {
  const { client } = await fixture({ maxResults: 2 })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await client.receive('ygo 测试')
  t.mock.timers.tick(119_999)
  assert.match((await client.receive('下一页'))[0], /第 2 页/)
  // The first timer would have expired here; it must not clear page 2.
  t.mock.timers.tick(119_999)
  assert.match((await client.receive('上一页'))[0], /第 1 页/)
  t.mock.timers.tick(120_000)
  await client.shouldNotReply('下一页')
  await client.shouldNotReply('1')
})

test('pages lazily follow API start/next cursors and cache previous API batches', async () => {
  const { client, calls } = await fixture({ maxResults: 2 }, (url) => {
    const start = Number(url.searchParams.get('start') ?? 0)
    if (start === 0) return { result: [card(1), card(2)], next: 2 }
    if (start === 2) return { result: [card(3), card(4)], next: 4 }
    if (start === 4) return { result: [card(5)], next: 0 }
    assert.fail(`unexpected cursor ${start}`)
  })
  await client.receive('ygo 卡片')
  assert.equal(calls.length, 2)
  const second = await client.receive('下一页')
  assert.match(second[0], /第 2 页，共 3 页/)
  await client.receive('上一页')
  await client.receive('第3页')
  assert.equal(calls.length, 3)
  assert.deepEqual(calls.map(url => Number(url.searchParams.get('start') ?? 0)), [0, 2, 4])
  assert.ok(calls.every(url => url.searchParams.get('search') === '卡片'))
  assert.match((await client.receive('5'))[0], /<img[^>]*\/5.webp/)
})

test('a singleton first API batch is not mistaken for the whole result set', async () => {
  const { client, calls } = await fixture({}, url => url.searchParams.has('start')
    ? { result: [card(2)], next: 0 } : { result: [card(1)], next: 1 })
  const replies = await client.receive('ygo 测试')
  assert.equal(replies.length, 3)
  assert.match(replies[0], /输入 1～2/)
  assert.doesNotMatch(replies.join(''), /<img/)
  assert.equal(calls.length, 2)
})

test('failed page fetches keep the old selection and retry the failed cursor', async () => {
  let fail = true
  const { client, calls } = await fixture({ maxResults: 2 }, (url) => {
    if (! url.searchParams.has('start')) return { result: [card(1), card(2), card(3)], next: 3 }
    if (fail) {
      fail = false
      throw new Error('page unavailable')
    }
    return { result: [card(4), card(5)], next: 0 }
  })
  await client.receive('ygo 卡片')
  await client.shouldReply('下一页', '翻页失败，仍保留原页面，请稍后重试。')
  await client.shouldReply('3', '请输入 1～2 之间的序号。')
  assert.match((await client.receive('下一页'))[0], /第 2 页/)
  assert.deepEqual(calls.map(url => Number(url.searchParams.get('start') ?? 0)), [0, 3, 3])
  assert.match((await client.receive('4'))[0], /<img[^>]*\/4.webp/)
})

test('failed page sends keep the old page and permit a cached retry', async () => {
  const { ctx, client, calls } = await fixture({ maxResults: 2 })
  let fail = true
  ctx.on('before-send', (session) => {
    if (fail && session.content.includes('第 2 页')) {
      fail = false
      throw new Error('page forward unavailable')
    }
  })
  await client.receive('ygo 测试')
  await client.shouldReply('下一页', '翻页失败，仍保留原页面，请稍后重试。')
  await client.shouldReply('3', '请输入 1～2 之间的序号。')
  assert.match((await client.receive('下一页'))[0], /第 2 页/)
  assert.equal(calls.length, 1)
  assert.match((await client.receive('3'))[0], /<img[^>]*\/3.webp/)
})

test('concurrent paging and selection are guarded; idle time is paused during a slow page fetch', async (t) => {
  const started = deferred<void>()
  const response = deferred<unknown>()
  const { ctx, client, calls } = await fixture({ maxResults: 2, selectionTimeout: 1000 }, (url) => {
    if (! url.searchParams.has('start')) return { result: [card(1), card(2), card(3)], next: 3 }
    started.resolve()
    return response.promise
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await client.receive('ygo 卡片')
  const flipping = client.receive('下一页')
  await started.promise
  t.mock.timers.tick(2000)
  const other = ctx.mock.client('alice')
  await other.shouldReply('下一页', '正在翻页，请稍候。')
  await other.shouldReply('1', '正在翻页，请稍候。')
  assert.equal(calls.length, 2)
  response.resolve({ result: [card(4), card(5)], next: 0 })
  assert.match((await flipping)[0], /第 2 页/)
  t.mock.timers.tick(999)
  assert.match((await client.receive('4'))[0], /<img[^>]*\/4.webp/)
})

test('a new query invalidates an old in-flight page without losing its own timer', async (t) => {
  const started = deferred<void>()
  const response = deferred<unknown>()
  const { ctx, client } = await fixture({ maxResults: 2, selectionTimeout: 1000 }, (url) => {
    if (url.searchParams.get('search') === '新查询') return { result: [card(8), card(9)], next: 0 }
    if (! url.searchParams.has('start')) return { result: [card(1, '旧查询卡片1'), card(2, '旧查询卡片2'), card(3, '旧查询卡片3')], next: 3 }
    started.resolve()
    return response.promise
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  await client.receive('ygo 旧查询')
  const oldClient = ctx.mock.client('alice')
  const flipping = oldClient.receive('下一页')
  await started.promise
  await client.receive('ygo 新查询')
  response.resolve({ result: [card(4), card(5)], next: 0 })
  assert.deepEqual(await flipping, [])
  t.mock.timers.tick(999)
  assert.match((await client.receive('1'))[0], /<img[^>]*\/8.webp/)
})

test('cancel during paging prevents the late page from reactivating the session', async () => {
  const started = deferred<void>()
  const response = deferred<unknown>()
  const { ctx, client } = await fixture({ maxResults: 2 }, (url) => {
    if (! url.searchParams.has('start')) return { result: [card(1), card(2), card(3)], next: 3 }
    started.resolve()
    return response.promise
  })
  await client.receive('ygo 卡片')
  const flipping = client.receive('下一页')
  await started.promise
  await ctx.mock.client('alice').shouldReply('取消', '已取消选卡。')
  response.resolve({ result: [card(4), card(5)], next: 0 })
  assert.deepEqual(await flipping, [])
  await client.shouldNotReply('下一页')
  await client.shouldNotReply('1')
})

test('candidate lists only contain name hits when any literal name matches exist', async () => {
  const broad = card(1, '无关魔法卡')
  broad.text.desc = '将青眼白龙加入手卡。'
  const { client } = await fixture({}, () => ({
    result: [broad, card(2, '青眼白龙'), card(3, '青眼亚白龙')], next: 0,
  }))
  const replies = await client.receive('ygo 青眼')
  assert.equal(replies.length, 3)
  assert.match(replies[1], /\[序号\] 1[\s\S]*青眼白龙/)
  assert.match(replies[2], /\[序号\] 2[\s\S]*青眼亚白龙/)
  assert.doesNotMatch(replies.join(''), /无关魔法卡/)
  assert.match((await client.receive('2'))[0], /<img[^>]*\/3.webp/)
})

test('effect searches keep unrestricted results when no card name contains the query', async () => {
  const { client, calls } = await fixture({ maxResults: 2 })
  const replies = await client.receive('ygo 抽2张')
  assert.equal(replies.length, 3)
  assert.match(replies[1], /卡片1/)
  assert.match((await client.receive('下一页'))[1], /卡片3/)
  assert.equal(calls.length, 1)
})

test('a sole name hit found after a broad first batch opens its detail directly', async () => {
  const { client, calls } = await fixture({}, url => url.searchParams.has('start')
    ? { result: [card(4, '青眼白龙')], next: 0 }
    : { result: [card(1), card(2), card(3)], next: 3 })
  const replies = await client.receive('ygo 青眼')
  assert.equal(replies.length, 1, replies.join('\n\n'))
  assert.match(replies[0], /<img[^>]*\/4.webp/)
  assert.doesNotMatch(replies[0], /\[序号\]|卡片1|卡片2|卡片3/)
  assert.equal(calls.length, 2)
})

test('-p and interactive selection use the filtered result set, not raw API positions', async () => {
  const { client } = await fixture({ maxResults: 2 }, () => ({
    result: [card(1, '青眼1'), card(2), card(3, '青眼2'), card(4), card(5, '青眼3'), card(6, '青眼4')], next: 0,
  }))
  const replies = await client.receive('ygo 青眼 -p 2')
  assert.match(replies[0], /第 2 页，共 2 页[\s\S]*输入 3～4/)
  assert.match(replies[1], /\[序号\] 3[\s\S]*青眼3/)
  assert.match(replies[2], /\[序号\] 4[\s\S]*青眼4/)
  assert.match((await client.receive('4'))[0], /<img[^>]*\/6.webp/)
})

test('paging never broadens a name-filtered list with later API results', async () => {
  const { client, calls } = await fixture({ maxResults: 2 }, (url) => {
    const start = Number(url.searchParams.get('start') ?? 0)
    if (start === 0) return { result: [card(1, '青眼1'), card(2, '青眼2'), card(3, '青眼3')], next: 3 }
    if (start === 3) return { result: [card(4, '不应出现')], next: 4 }
    return { result: [card(5, '青眼4')], next: 0 }
  })
  await client.receive('ygo 青眼')
  assert.equal(calls.length, 1)
  const second = await client.receive('下一页')
  assert.match(second[0], /第 2 页，共 2 页/)
  assert.match(second[2], /\[序号\] 4[\s\S]*青眼4/)
  assert.doesNotMatch(second.join(''), /不应出现/)
  assert.match((await client.receive('4'))[0], /<img[^>]*\/5.webp/)
})
