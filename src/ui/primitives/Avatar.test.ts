import { describe, expect, it } from 'vitest'
import { displayName } from './Avatar'

describe('displayName', () => {
  it('returns a plain name unchanged', () => {
    expect(displayName('Jane Doe')).toBe('Jane Doe')
  })

  it('trims a plain name', () => {
    expect(displayName('  Jane Doe  ')).toBe('Jane Doe')
  })

  it('unwraps a bare wikilink', () => {
    expect(displayName('[[Jane Doe]]')).toBe('Jane Doe')
  })

  it('strips the folder path from a bare wikilink', () => {
    expect(displayName('[[People/Team/Jane Doe]]')).toBe('Jane Doe')
  })

  it('prefers the alias when present', () => {
    expect(displayName('[[People/Jane Doe|JD]]')).toBe('JD')
  })

  it('trims the alias', () => {
    expect(displayName('[[People/Jane Doe| JD ]]')).toBe('JD')
  })

  it('falls back to the path when the alias is empty', () => {
    expect(displayName('[[People/Jane Doe|]]')).toBe('Jane Doe')
  })

  it('drops a file extension', () => {
    expect(displayName('[[People/Jane Doe.md]]')).toBe('Jane Doe')
  })

  it('drops a heading reference', () => {
    expect(displayName('[[People/Jane Doe#Bio]]')).toBe('Jane Doe')
  })

  it('drops a block reference', () => {
    expect(displayName('[[People/Jane Doe#^abc123]]')).toBe('Jane Doe')
  })

  it('keeps a dot inside a name', () => {
    expect(displayName('[[People/Jane.Doe]]')).toBe('Jane.Doe')
  })

  it('keeps a version-style name with a dot', () => {
    expect(displayName('[[v1.2 release]]')).toBe('v1.2 release')
  })

  it('leaves a non-wikilink string with brackets alone', () => {
    expect(displayName('[[unterminated')).toBe('[[unterminated')
  })
})
