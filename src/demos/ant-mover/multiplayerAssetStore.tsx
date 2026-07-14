import type { TLAssetStore } from 'tldraw'
import { uniqueId } from 'tldraw'

// useSync requires an asset store even though ant-mover's maze/object are drawn
// shapes — a player could still paste an image. We reuse the Worker's shared R2
// upload routes (/api/uploads/*, the same ones the Toolkit uses). Kept in the
// ant-mover dir (not imported from toolkit/) so the demo stays self-contained.
export const multiplayerAssetStore: TLAssetStore = {
	async upload(_asset, file) {
		const id = uniqueId()
		const objectName = `${id}-${file.name}`.replace(/[^a-zA-Z0-9.]/g, '-')
		const url = `/api/uploads/${objectName}`
		const response = await fetch(url, { method: 'POST', body: file })
		if (!response.ok) throw new Error(`Failed to upload asset: ${response.statusText}`)
		return { src: url }
	},
	resolve(asset) {
		return asset.props.src
	},
}
