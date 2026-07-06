import { describe, it, expect } from 'vitest'
import { toImageInput } from './perceive'

describe('toImageInput', () => {
  it('splits a png data URL into media type + base64 payload', () => {
    expect(toImageInput('data:image/png;base64,AAAB')).toEqual({
      mediaType: 'image/png',
      base64: 'AAAB',
    })
  })

  it('handles jpeg', () => {
    expect(toImageInput('data:image/jpeg;base64,ZZZ')).toEqual({
      mediaType: 'image/jpeg',
      base64: 'ZZZ',
    })
  })

  it('throws on a non-data-URL', () => {
    expect(() => toImageInput('https://example.com/x.png')).toThrow()
    expect(() => toImageInput('not a url')).toThrow()
  })
})
