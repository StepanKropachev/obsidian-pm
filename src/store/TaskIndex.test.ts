import { describe, expect, it } from 'vitest'
import { makeProject, makeTask, type Task } from '../types'
import {
  buildTaskIndex,
  findParentId,
  findTaskById,
  indexAddSubtree,
  indexRemoveSubtree,
  indexSetParent,
  rebuildTaskIndex
} from './TaskIndex'

function tree(): Task[] {
  return [
    makeTask({
      id: 'a',
      subtasks: [makeTask({ id: 'a1', subtasks: [makeTask({ id: 'a1x' })] }), makeTask({ id: 'a2' })]
    }),
    makeTask({ id: 'b' })
  ]
}

describe('buildTaskIndex', () => {
  it('indexes every task with the right parentId', () => {
    const idx = buildTaskIndex(tree())
    expect(idx.size).toBe(5)
    expect(idx.get('a')?.parentId).toBeNull()
    expect(idx.get('b')?.parentId).toBeNull()
    expect(idx.get('a1')?.parentId).toBe('a')
    expect(idx.get('a2')?.parentId).toBe('a')
    expect(idx.get('a1x')?.parentId).toBe('a1')
  })

  it('returns task references that point into the same tree', () => {
    const t = tree()
    const idx = buildTaskIndex(t)
    expect(idx.get('a')?.task).toBe(t[0])
    expect(idx.get('a1x')?.task).toBe(t[0].subtasks[0].subtasks[0])
  })

  it('builds an empty index for an empty tree', () => {
    expect(buildTaskIndex([]).size).toBe(0)
  })
})

describe('findTaskById / findParentId', () => {
  const project = makeProject('P', 'P.md')
  project.tasks = tree()
  rebuildTaskIndex(project)

  it('finds a task by id in O(1)', () => {
    expect(findTaskById(project, 'a1x')?.id).toBe('a1x')
  })

  it('returns null for an unknown id', () => {
    expect(findTaskById(project, 'nope')).toBeNull()
    expect(findParentId(project, 'nope')).toBeNull()
  })

  it('returns the right parentId, including null for top-level tasks', () => {
    expect(findParentId(project, 'a')).toBeNull()
    expect(findParentId(project, 'a1')).toBe('a')
    expect(findParentId(project, 'a1x')).toBe('a1')
  })
})

describe('indexAddSubtree / indexRemoveSubtree / indexSetParent', () => {
  it('adds a single task to the index', () => {
    const project = makeProject('P', 'P.md')
    const t = makeTask({ id: 'solo' })
    indexAddSubtree(project, t, null)
    expect(findTaskById(project, 'solo')).toBe(t)
    expect(findParentId(project, 'solo')).toBeNull()
  })

  it('adds a whole subtree with correct parent chain', () => {
    const project = makeProject('P', 'P.md')
    const child = makeTask({ id: 'c' })
    const root = makeTask({ id: 'r', subtasks: [child] })
    indexAddSubtree(project, root, null)
    expect(project.taskIndex.size).toBe(2)
    expect(findParentId(project, 'c')).toBe('r')
  })

  it('removes a task and its whole subtree from the index', () => {
    const project = makeProject('P', 'P.md')
    project.tasks = tree()
    rebuildTaskIndex(project)
    const a = findTaskById(project, 'a')!
    indexRemoveSubtree(project, a)
    expect(findTaskById(project, 'a')).toBeNull()
    expect(findTaskById(project, 'a1')).toBeNull()
    expect(findTaskById(project, 'a1x')).toBeNull()
    expect(findTaskById(project, 'a2')).toBeNull()
    // siblings unaffected
    expect(findTaskById(project, 'b')?.id).toBe('b')
  })

  it("updates only the named task's parent on indexSetParent", () => {
    const project = makeProject('P', 'P.md')
    project.tasks = tree()
    rebuildTaskIndex(project)
    indexSetParent(project, 'a1', 'b')
    expect(findParentId(project, 'a1')).toBe('b')
    // descendants of a1 still point at a1
    expect(findParentId(project, 'a1x')).toBe('a1')
    // siblings of a1 untouched
    expect(findParentId(project, 'a2')).toBe('a')
  })
})
