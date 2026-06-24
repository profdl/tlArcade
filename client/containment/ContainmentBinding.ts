/**
 * CONTAINMENT BINDING  (SPEC §4.2)
 * ================================
 * tldraw has no native "reparent a shape when it's dropped on top of another".
 * We build it with a BINDING (container → item) plus a drag side-effect
 * (see containmentSideEffect.ts) that creates/removes the binding on overlap.
 *
 * The binding is intentionally tiny — it just records "item X is inside
 * container C". The container's layout reads its bindings to position children.
 */
import { BindingUtil, TLBaseBinding } from 'tldraw'

export type ContainmentBinding = TLBaseBinding<'containment', { index: number }>

declare module 'tldraw' {
	interface TLGlobalBindingPropsMap {
		containment: { index: number }
	}
}

export class ContainmentBindingUtil extends BindingUtil<ContainmentBinding> {
	static override type = 'containment' as const

	getDefaultProps() {
		return { index: 0 }
	}

	// When the binding is removed (item dragged out / deleted), nothing else to
	// clean up — the item is a normal shape again. The container re-lays-out via
	// the side-effect handler.
}
