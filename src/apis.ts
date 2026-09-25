export namespace API {
  export const ygocdb = (query: { search: string }) => `https://ygocdb.com/api/v0/?search=${encodeURIComponent(query.search)}`
  export type Ygocdb = {
    result: Array<{
      cid: number
      id: number
      en_name: string
      jp_name: string
      jp_ruby: string
      cn_name: string
      sc_name: string
      md_name: string
      nwbbs_n: string
      cnocg_n: string
      text: {
        types: string
        desc: string
        pdesc: string
      }
      data: {
        ot: number
        setcode: string
        type: number
        atk: number
        def: number
        level: number
        race: number
        attribute: number
      }
      html: {
        desc: string
        pdesc: string
        refer: Record<string, string>
      }
      weight: number
      faqs: string[]
      artid: number
    }>
    next: number
  }

  export const mdmcards = (query: { name: string }) => `https://www.masterduelmeta.com/api/v1/cards?search=${encodeURIComponent(query.name)}`

  export type MdmBanStatus = 'Limited 2' | 'Limited 1' | 'Forbidden'
  export const showMdmBanStatus = (banStatus: MdmBanStatus | undefined) => {
    if (! banStatus) return '无'
    switch (banStatus) {
      case 'Limited 2': return '限 2'
      case 'Limited 1': return '限 1'
      case 'Forbidden': return '禁止'
    }
  }
  export type MdmRarity = 'N' | 'R' | 'SR' | 'UR'
  export type MdmLinkArrow = 'Top' | 'Bottom' | 'Left' | 'Right' | 'Top-Left' | 'Top-Right' | 'Bottom-Left' | 'Bottom-Right'
  export type MdmObtain = {
    source: {
      _id: string
      type: string
      name: string
      expires?: string
      linkedArticle?: {
        _id: string
        title: string
        url: string
        image: string
      }
      url: string
      image: string
    }
    amount: number
    type: string
  }
  export type MdmCard = {
    _id: string
    gameId: string | number
    konamiID: string

    name: string
    type: string
    monsterType: string[]
    race: string
    level: number
    attribute: string
    atk: number
    def: number
    alternateArt: boolean
    linkArrows: MdmLinkArrow[]
    description: string
    handtrap?: boolean

    rarity: MdmRarity
    obtain: MdmObtain[]
    banStatus?: MdmBanStatus
    ocgBanStatus?: MdmBanStatus
    tcgBanStatus?: MdmBanStatus

    release: string
    ocgRelease: string
    tcgRelease: string

    popRank: number
    deckTypes: string[]
  }
  export type MdmCards = MdmCard[]

  export const cardImage = (template: string, query: { id: number }) => template.replaceAll('{id}', String(query.id))
}
