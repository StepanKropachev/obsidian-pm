import { parse } from 'yaml'

export const parseYaml = (raw: string): unknown => parse(raw)

export class Notice {
  constructor(_message?: string | DocumentFragment, _timeout?: number) {}
  hide(): void {}
}
