import { handleUnfurlRequest } from 'cloudflare-workers-unfurl'
import type { IRequest } from 'itty-router';
import { AutoRouter, error } from 'itty-router'
import { handleAssetDownload, handleAssetUpload } from './assetUploads'
import { handleEngineMessages } from './engine'

// make sure our sync durable object is made available to cloudflare
export { TldrawDurableObject } from './TldrawDurableObject'
// the ant-mover physics room (its own DO — has a server tick loop the Toolkit lacks)
export { AntMoverDurableObject } from './AntMoverDurableObject'

// we use itty-router (https://itty.dev/) to handle routing. in this example we turn on CORS because
// we're hosting the worker separately to the client. you should restrict this to your own domain.
const router = AutoRouter<IRequest, [env: Env, ctx: ExecutionContext]>({
	catch: (e) => {
		console.error(e)
		return error(e)
	},
})
	// requests to /connect are routed to the Durable Object, and handle realtime websocket syncing
	.get('/api/connect/:roomId', (request, env) => {
		const id = env.TLDRAW_DURABLE_OBJECT.idFromName(request.params.roomId)
		const room = env.TLDRAW_DURABLE_OBJECT.get(id)
		return room.fetch(request.url, { headers: request.headers, body: request.body })
	})

	// referee RPCs (dice/shuffle/secrets) are POSTed to the same room's DO.
	// Forward the whole request so method + body are preserved.
	.post('/api/referee/:roomId', (request, env) => {
		const id = env.TLDRAW_DURABLE_OBJECT.idFromName(request.params.roomId)
		const room = env.TLDRAW_DURABLE_OBJECT.get(id)
		return room.fetch(request as unknown as Request)
	})

	// the Engine demo's AI converters POST Anthropic Messages requests here; the
	// proxy attaches the server-side API key (see worker/engine.ts).
	.post('/api/engine/messages', handleEngineMessages)

	// ant-mover: the sync socket + the dedicated input socket both route to the
	// SAME AntMover DO for a given room (via idFromName), like /api/connect above.
	.get('/api/am/connect/:roomId', (request, env) => {
		const id = env.ANT_MOVER_DURABLE_OBJECT.idFromName(request.params.roomId)
		const room = env.ANT_MOVER_DURABLE_OBJECT.get(id)
		return room.fetch(request.url, { headers: request.headers, body: request.body })
	})
	.get('/api/am/input/:roomId', (request, env) => {
		const id = env.ANT_MOVER_DURABLE_OBJECT.idFromName(request.params.roomId)
		const room = env.ANT_MOVER_DURABLE_OBJECT.get(id)
		return room.fetch(request.url, { headers: request.headers, body: request.body })
	})

	// assets can be uploaded to the bucket under /uploads:
	.post('/api/uploads/:uploadId', handleAssetUpload)

	// they can be retrieved from the bucket too:
	.get('/api/uploads/:uploadId', handleAssetDownload)

	// bookmarks need to extract metadata from pasted URLs:
	.get('/api/unfurl', handleUnfurlRequest)
	.all('*', () => {
		return new Response('Not found', { status: 404 })
	})

export default {
	fetch: router.fetch,
}
