/**
 * Vitest setup — jest-dom matchers + the browser globals tldraw's editor needs
 * under jsdom. jsdom implements the DOM but not layout/measurement APIs, so a
 * real tldraw <Editor> won't mount without these shims. Kept minimal: only the
 * globals tldraw actually touches at construction/mount time. Mirrors the shims
 * tldraw uses in its own vitest suite.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount React trees between tests so editors don't leak across cases.
afterEach(() => cleanup())

// ResizeObserver — tldraw watches its container for size changes.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

// IntersectionObserver — used by the canvas culling / on-screen checks.
class IntersectionObserverStub {
  root = null
  rootMargin = ''
  thresholds = []
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}
vi.stubGlobal('IntersectionObserver', IntersectionObserverStub)

// matchMedia — read for prefers-color-scheme / coarse-pointer at mount.
vi.stubGlobal(
  'matchMedia',
  vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
)

// jsdom's getContext() throws "not implemented"; replace it with a minimal 2d
// context stub covering only the calls tldraw makes (mostly text measurement).
{
  const stub2d = () => ({
    measureText: () => ({ width: 0 }),
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: [] }),
    putImageData: () => {},
    createImageData: () => [],
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    fill: () => {},
  })
  HTMLCanvasElement.prototype.getContext =
    stub2d as unknown as typeof HTMLCanvasElement.prototype.getContext
}
if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {}
HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,'

// document.fonts (FontFaceSet) — tldraw's FontManager iterates it and adds
// FontFaces; jsdom implements neither. A minimal iterable set + FontFace stub.
class FontFaceStub {
  status = 'loaded'
  load() {
    return Promise.resolve(this)
  }
}
vi.stubGlobal('FontFace', FontFaceStub)
const fontFaceSet = {
  add() {},
  delete() {},
  clear() {},
  forEach() {},
  has: () => false,
  check: () => true,
  load: () => Promise.resolve([]),
  ready: Promise.resolve(undefined),
  *[Symbol.iterator]() {},
}
Object.defineProperty(document, 'fonts', { value: fontFaceSet, configurable: true })

// HTMLImageElement.decode — tldraw preloads UI asset images and awaits decode().
if (!HTMLImageElement.prototype.decode) {
  HTMLImageElement.prototype.decode = () => Promise.resolve()
}

// CSS.supports — tldraw feature-detects at import time; jsdom has no CSS object.
const css = (globalThis as { CSS?: { supports?: unknown } }).CSS ?? {}
css.supports = () => false
;(globalThis as { CSS?: unknown }).CSS = css
