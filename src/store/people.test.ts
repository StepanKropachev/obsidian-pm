import { describe, expect, it } from 'vitest'
import { TFile, type App } from 'obsidian'
import { makeFakeApp } from '../../test/fakeVault'
import {
  createPersonLink,
  createPersonNote,
  matchPersonNotes,
  personCandidates,
  personKey,
  personKeyer,
  personLink,
  personNotes,
  resolvePerson
} from './people'

async function appWithPeople(paths: string[]): Promise<App> {
  const { app, vault } = makeFakeApp({ liveMetadataCache: true })
  for (const path of paths) await vault.create(path, '')
  return app as unknown as App
}

function fileAt(app: App, path: string): TFile {
  const file = app.vault.getAbstractFileByPath(path)
  if (!(file instanceof TFile)) throw new Error(`no file at ${path}`)
  return file
}

describe('resolvePerson', () => {
  it('treats a bare name as plain even when a note shares it', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    expect(resolvePerson(app, 'Jane Doe', 'Projects/P.md')).toMatchObject({
      name: 'Jane Doe',
      path: null,
      state: 'plain'
    })
  })

  it('resolves a wikilink to its note', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    expect(resolvePerson(app, '[[Jane Doe]]', 'Projects/P.md')).toMatchObject({
      name: 'Jane Doe',
      path: 'People/Jane Doe.md',
      state: 'linked'
    })
  })

  it('resolves a full path with an alias and keeps the alias as the name', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    expect(resolvePerson(app, '[[People/Jane Doe|JD]]', 'Projects/P.md')).toMatchObject({
      name: 'JD',
      path: 'People/Jane Doe.md',
      state: 'linked'
    })
  })

  it('reports a wikilink pointing nowhere as unresolved', async () => {
    const app = await appWithPeople([])
    expect(resolvePerson(app, '[[Ghost]]', 'Projects/P.md')).toMatchObject({
      name: 'Ghost',
      path: null,
      state: 'unresolved'
    })
  })
})

describe('personLink', () => {
  it('uses the bare name when it is unambiguous', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    const file = fileAt(app, 'People/Jane Doe.md')
    expect(personLink(app, file, 'Projects/P.md')).toBe('[[Jane Doe]]')
  })

  it('keeps the name readable when two notes share a basename', async () => {
    const app = await appWithPeople(['People/Jane Doe.md', 'Contacts/Jane Doe.md'])
    const file = fileAt(app, 'Contacts/Jane Doe.md')
    expect(personLink(app, file, 'Projects/P.md')).toBe('[[Contacts/Jane Doe|Jane Doe]]')
  })
})

describe('personNotes', () => {
  it('limits suggestions to the people folder when one is set', async () => {
    const app = await appWithPeople(['People/Jane.md', 'Notes/Meeting.md'])
    expect(personNotes(app, 'People').map((f) => f.path)).toEqual(['People/Jane.md'])
  })

  it('offers every note when no folder is set', async () => {
    const app = await appWithPeople(['People/Jane.md', 'Notes/Meeting.md'])
    expect(personNotes(app, '').length).toBe(2)
  })
})

describe('createPersonNote', () => {
  it('creates the note inside the people folder', async () => {
    const app = await appWithPeople([])
    const file = await createPersonNote(app, 'People', 'Jane Doe')
    expect(file.path).toBe('People/Jane Doe.md')
  })

  it('returns the existing note instead of a duplicate', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    const file = await createPersonNote(app, 'People', 'Jane Doe')
    expect(file.path).toBe('People/Jane Doe.md')
    expect(personNotes(app, 'People')).toHaveLength(1)
  })
})

describe('personCandidates', () => {
  it('matches notes on part of the name', async () => {
    const app = await appWithPeople(['People/Jane Doe.md', 'People/John Roe.md'])
    expect(personCandidates(app, 'People', 'jane', 'Projects/P.md')).toEqual([
      { link: '[[Jane Doe]]', name: 'Jane Doe' }
    ])
  })

  it('returns nothing for an empty query, so the picker stays quiet until asked', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    expect(personCandidates(app, 'People', '  ', 'Projects/P.md')).toEqual([])
  })

  it('ignores notes outside the people folder', async () => {
    const app = await appWithPeople(['People/Jane Doe.md', 'Archive/Jane Doe Old.md'])
    expect(personCandidates(app, 'People', 'jane', 'Projects/P.md')).toHaveLength(1)
  })
})

describe('createPersonLink', () => {
  it('creates the note and returns the link to store', async () => {
    const app = await appWithPeople([])
    const link = await createPersonLink(app, 'People', 'Jane Doe', 'Projects/P.md')
    expect(link).toBe('[[Jane Doe]]')
    expect(resolvePerson(app, link, 'Projects/P.md').path).toBe('People/Jane Doe.md')
  })
})

describe('personKey', () => {
  it('keys a link by the note it points at', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    expect(personKey(app, '[[Jane Doe]]')).toBe('People/Jane Doe.md')
  })

  it('keys an alias and a full path to the same note alike', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    expect(personKey(app, '[[People/Jane Doe|JD]]')).toBe(personKey(app, '[[Jane Doe]]'))
  })

  it('tells two people with the same name apart by their notes', async () => {
    const app = await appWithPeople(['People/Jane Doe.md', 'Contacts/Jane Doe.md'])
    expect(personKey(app, '[[People/Jane Doe]]')).not.toBe(personKey(app, '[[Contacts/Jane Doe]]'))
  })

  it('groups a typed name with the link to that same note', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    expect(personKey(app, 'Jane Doe')).toBe(personKey(app, '[[Jane Doe]]'))
  })

  it('falls back to the name when nothing in the vault matches', async () => {
    const app = await appWithPeople([])
    expect(personKey(app, 'Jane Doe')).toBe('Jane Doe')
    expect(personKey(app, '[[Jane Doe]]')).toBe('Jane Doe')
  })
})

describe('personKeyer', () => {
  it('gives the same answer as personKey', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    const keyer = personKeyer(app)
    expect(keyer('[[Jane Doe]]')).toBe(personKey(app, '[[Jane Doe]]'))
    expect(keyer('[[Jane Doe]]')).toBe('People/Jane Doe.md')
  })
})

describe('matchPersonNotes', () => {
  it('matches a plain name to its note', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    expect(matchPersonNotes(app, 'People', ['Jane Doe'])).toEqual([
      { name: 'Jane Doe', link: '[[Jane Doe]]', ambiguous: false }
    ])
  })

  it('matches regardless of how the name was capitalised', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    expect(matchPersonNotes(app, 'People', ['jane doe'])[0].link).toBe('[[Jane Doe]]')
  })

  it('reports a name matching several notes instead of guessing', async () => {
    const app = await appWithPeople(['People/Jane Doe.md', 'People/Team/Jane Doe.md'])
    expect(matchPersonNotes(app, 'People', ['Jane Doe'])[0]).toMatchObject({ link: null, ambiguous: true })
  })

  it('leaves a name with no note alone', async () => {
    const app = await appWithPeople(['People/Jane Doe.md'])
    expect(matchPersonNotes(app, 'People', ['Nobody Here'])[0]).toMatchObject({ link: null, ambiguous: false })
  })

  it('ignores notes outside the people folder', async () => {
    const app = await appWithPeople(['Archive/Jane Doe.md'])
    expect(matchPersonNotes(app, 'People', ['Jane Doe'])[0].link).toBeNull()
  })
})
