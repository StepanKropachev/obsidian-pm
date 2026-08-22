import { describe, expect, it } from 'vitest'
import { TFile, type App } from 'obsidian'
import { makeFakeApp } from '../../test/fakeVault'
import { createPersonNote, personLink, personNotes, resolvePerson } from './people'

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
