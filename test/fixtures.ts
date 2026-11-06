import type { API } from '../src/apis'

export function card(id: number, name = `卡片${id}`): API.Card {
  return {
    id, cid: id + 1000, en_name: `Card ${id}`, jp_name: `カード${id}`, jp_ruby: '',
    cn_name: name, sc_name: name, md_name: `MD${name}`, nwbbs_n: name, cnocg_n: name,
    text: { types: '[怪兽|效果] 龙/光', desc: `${name}的效果文本。`, pdesc: `${name}的灵摆效果。` },
    data: { ot: 1, setcode: '0', type: 1, atk: 1000, def: 1000, level: 4, race: 1, attribute: 1 },
    html: { desc: '', pdesc: '', refer: {} }, weight: 1, faqs: [], artid: 0,
  }
}

export function mdmCard(gameId: number | string): API.MdmCard {
  return {
    _id: 'mdm-card', gameId, konamiID: '1', name: 'MDM Card', type: 'Effect Monster',
    monsterType: [], race: 'Dragon', level: 4, attribute: 'Light', atk: 1000, def: 1000,
    alternateArt: false, linkArrows: [], description: 'Effect', handtrap: false,
    rarity: 'UR', banStatus: 'Limited 1', ocgBanStatus: 'Forbidden', tcgBanStatus: 'Limited 2',
    obtain: [{ amount: 1, type: 'pack', source: { _id: 'pack', name: '当前卡包', type: 'Secret Pack', url: '', image: '' } }],
    release: '', ocgRelease: '', tcgRelease: '', popRank: 0, deckTypes: [],
  }
}
