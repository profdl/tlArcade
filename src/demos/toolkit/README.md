# Toolkit

> Part of the [tlArcade](../../../README.md) prototyping platform — mounted
> at `/demos/toolkit/*`. This started from tldraw's official
> `tldraw-sync-cloudflare` template; most of the content below is that
> template's own docs about the sync architecture (still accurate) with the
> local paths/commands corrected for where things live now. See
> [CLAUDE.md](CLAUDE.md) for what was actually *built* on top of the
> template (custom shapes, the referee, creatures, physics).
>
> **What moved:** `worker/` and `wrangler.toml` are now at the **repo
> root** (this is the one Worker backing every prototype, not just this
> one); the client (formerly `client/`) is this directory. There's no
> `package.json`/`yarn.lock` here anymore — dependencies live in the root
> `package.json`, installed with **npm**, not yarn.

This is a production-ready backend for [tldraw sync](https://tldraw.dev/docs/sync).

- Your client-side tldraw-based app can be served from anywhere you want.
- This backend uses [Cloudflare Workers](https://developers.cloudflare.com/workers/), and will need
  to be deployed to your own Cloudflare account.
- Each whiteboard is synced via
  [WebSockets](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) to a [Cloudflare
  Durable Object](https://developers.cloudflare.com/durable-objects/), which persists room state in
  its built-in SQLite storage.
- Uploaded images and videos are stored in a [Cloudflare
  R2](https://developers.cloudflare.com/r2/) bucket.
- Although unrelated to tldraw sync, this server also includes a component to fetch link previews
  for URLs added to the canvas.
  This is a minimal setup of the same system that powers multiplayer collaboration for hundreds of
  thousands of rooms & users on www.tldraw.com. Because durable objects effectively create a mini
  server instance for every single active room, we've never needed to worry about scale. Cloudflare
  handles the tricky infrastructure work of ensuring there's only ever one instance of each room, and
  making sure that every user gets connected to that instance. We've found that with this approach,
  each room is able to handle about 50 simultaneous collaborators.

[![architecture](./arch.png)](https://www.tldraw.com/ro/Yb_QHJFP9syPZq1YrV3YR?v=-255,-148,2025,1265&p=page)

When a user opens a room, they connect via Workers to a durable object. Each durable object is like
its own miniature server. There's only ever one for each room, and all the users of that room
connect to it. When a user makes a change to the drawing, it's sent via a websocket connection to
the durable object for that room. The durable object applies the change to its in-memory copy of the
document, and broadcasts the change via websockets to all other connected clients. Room state is
persisted automatically to the durable object's built-in SQLite storage, so it survives restarts
and hibernation. When the last client leaves the room, the durable object will shut down.

Static assets like images and videos are too big to be synced via websockets and a durable object.
Instead, they're uploaded to workers which store them in an R2 bucket. When they're downloaded,
they're cached on cloudflare's edge network to reduce costs and make serving them faster.

## Development

From the **repo root**: `npm install`, then `npm run dev`. This starts a
[`vite`](https://vitejs.dev/) dev server running the whole tlArcade app
*and* the Cloudflare Workers backend together, via the [cloudflare vite
plugin](https://developers.cloudflare.com/workers/vite-plugin/). Visit
`http://localhost:5173/demos/toolkit`.

The backend worker is under [`worker/`](../../../worker/) at the repo root
(shared by every prototype, not just this one), split across several files:

- **[`worker/worker.ts`](../../../worker/worker.ts):** the main entrypoint to
  the worker — routes everything under `/api/*` (see the root
  `wrangler.toml`'s `run_worker_first`); every other path is served as a
  static asset / SPA fallback.
- **[`worker/TldrawDurableObject.ts`](../../../worker/TldrawDurableObject.ts):**
  the sync durable object. An instance of this is created for every active
  room. This exposes a
  [`TLSocketRoom`](https://tldraw.dev/reference/sync-core/TLSocketRoom) over
  websockets, and persists room state to the durable object's built-in
  SQLite storage.
- **[`worker/assetUploads.ts`](../../../worker/assetUploads.ts):** uploads,
  downloads, and caching for static assets like images and videos.
- **[`worker/Referee.ts`](../../../worker/Referee.ts):** server-authoritative
  logic (dice, seats, secrets, decks) — not part of the original template,
  added for the tabletop-toolkit shapes. See [CLAUDE.md](CLAUDE.md).

The frontend client is this directory (`src/demos/toolkit/`):

- **[`App.tsx`](App.tsx):** nested under the switcher's `/demos/toolkit/*`
  route (it owns its own `Root`/`Room` sub-routes for room ids — see
  [pages/](pages/)) rather than mounting its own top-level router the way
  the standalone template did.
- **[`multiplayerAssetStore.tsx`](multiplayerAssetStore.tsx):** how the
  client uploads and retrieves assets like images & videos from the worker.
- **[`getBookmarkPreview.tsx`](getBookmarkPreview.tsx):** how the client
  fetches bookmark previews from the worker (via `/api/unfurl`, handled in
  `worker/worker.ts` using the `cloudflare-workers-unfurl` package).

## Custom shapes

To add support for custom shapes, see the [tldraw sync custom shapes docs](https://tldraw.dev/docs/sync#Custom-shapes--bindings)
and, for the conventions this codebase actually follows, [CLAUDE.md](CLAUDE.md)'s
"RECIPE: add a custom shape."

## Adapting this for your own app

If you want to lift the sync backend out of tlArcade for a standalone app:
copy the root [`worker/`](../../../worker/) folder and
[`wrangler.toml`](../../../wrangler.toml), plus this directory's `shared/`
dependency (at the repo root — [`shared/`](../../../shared/)). Pull the
relevant `dependencies` out of the root `package.json` (the ones listed
under Toolkit in the root README's stack notes). You can run the worker
standalone with `wrangler dev` from wherever `wrangler.toml` ends up. To
point an existing client at that server, copy
[`multiplayerAssetStore.tsx`](multiplayerAssetStore.tsx) and
[`getBookmarkPreview.tsx`](getBookmarkPreview.tsx) into it, adapt
[`App.tsx`](App.tsx) to your app's routing, and point the `/api/` URLs in
each of these files at your new `wrangler dev` server.

## Deployment

To deploy tlArcade, you'll need a Cloudflare account and an R2 bucket to
store uploaded images and videos — the root [`wrangler.toml`](../../../wrangler.toml)
already names it `tlarcade-toolkit` (create a bucket with that name, or
change the `bucket_name`/`preview_bucket_name` to match one you create).

From the **repo root**: `npm run build`, then `npx wrangler deploy`. This
deploys the backend worker along with every prototype's static assets to
Cloudflare in one shot. This should give you a workers.dev URL, but you can
also [configure a custom
domain](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/).

## License

This project is provided under the MIT license found [here](https://github.com/tldraw/tldraw-sync-cloudflare/blob/main/LICENSE.md). The tldraw SDK is provided under the [tldraw license](https://github.com/tldraw/tldraw/blob/main/LICENSE.md).

## Trademarks

Copyright (c) 2024-present tldraw Inc. The tldraw name and logo are trademarks of tldraw. Please see our [trademark guidelines](https://github.com/tldraw/tldraw/blob/main/TRADEMARKS.md) for info on acceptable usage.

## Distributions

You can find tldraw on npm [here](https://www.npmjs.com/package/@tldraw/tldraw?activeTab=versions).

## Contribution

Please see our [contributing guide](https://github.com/tldraw/tldraw/blob/main/CONTRIBUTING.md). Found a bug? Please [submit an issue](https://github.com/tldraw/tldraw/issues/new).

## Community

Have questions, comments or feedback? [Join our discord](https://discord.tldraw.com/?utm_source=github&utm_medium=readme&utm_campaign=sociallink). For the latest news and release notes, visit [tldraw.dev](https://tldraw.dev).

## Contact

Find us on Twitter/X at [@tldraw](https://twitter.com/tldraw).
