import { parse } from 'yaml'

export const parseYaml = (raw: string): unknown => parse(raw)

export class Notice {
  hide(): void {}
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

export function parseLinktext(linktext: string): { path: string; subpath: string } {
  const hash = linktext.indexOf('#')
  return hash < 0
    ? { path: linktext, subpath: '' }
    : { path: linktext.slice(0, hash), subpath: linktext.slice(hash) }
}

export class TAbstractFile {
  path = ''
  name = ''
  parent: TFolder | null = null
}

export class TFile extends TAbstractFile {
  basename = ''
  extension = ''
  stat = { ctime: 0, mtime: 0, size: 0 }
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = []
  isRoot(): boolean {
    return this.parent === null
  }
}
