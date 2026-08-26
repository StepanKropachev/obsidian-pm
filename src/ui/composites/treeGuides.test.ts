import { describe, expect, it } from 'vitest'
import { childTreeGuides } from './treeGuides'

describe('childTreeGuides', () => {
  it("gives a root row's children only their own elbow column", () => {
    expect(childTreeGuides([], false)).toEqual([false])
    expect(childTreeGuides([], true)).toEqual([false])
  })

  it('carries a line down past the rows below a row that still has siblings', () => {
    expect(childTreeGuides([false], false)).toEqual([true, false])
  })

  it('stops the line at a row that is the last of its siblings', () => {
    expect(childTreeGuides([false], true)).toEqual([false, false])
  })

  it('keeps the columns of the ancestors above', () => {
    expect(childTreeGuides([true, false], false)).toEqual([true, true, false])
    expect(childTreeGuides([true, false], true)).toEqual([true, false, false])
  })
})
